const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const UnifiedMonitor = require('./services/UnifiedMonitor');
const NotificationService = require('./services/NotificationService');
const RouteResult = require('./models/RouteResult');
const airportResolver = require('./utils/AirportCodeResolver');
const db = require('./config/database');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: false });

console.log('📅 Планировщик запущен');

// Динамическое управление cron-задачами
const activeJobs = new Map(); // хранение cron-задач по типу подписки
let currentIntervals = {}; // текущие интервалы из БД (type -> hours)
const CONFIG_CHECK_INTERVAL = 60000; // проверка изменений каждые 60 сек

// Вспомогательная функция для форматирования времени
function formatTimestamp(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

/**
 * Преобразование часов в cron-выражение
 * @param {number} hours - интервал в часах
 * @returns {string} cron-выражение
 */
function hoursToCron(hours) {
  if (hours <= 0) hours = 1;
  if (hours >= 24) {
    return '0 0 * * *'; // раз в день в полночь
  }
  if (hours === 1) {
    return '0 * * * *'; // каждый час
  }
  return `0 */${hours} * * *`; // каждые N часов
}

/**
 * Загрузка интервалов из таблицы subscription_types
 * @returns {Promise} объект { type: hours }
 */
function getIntervalsFromDB() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT name, check_interval_hours
      FROM subscription_types
      WHERE is_active = 1
    `, [], (err, rows) => {
      if (err) reject(err);
      else {
        const intervals = {};
        for (const row of rows || []) {
          intervals[row.name] = row.check_interval_hours || 4; // fallback 4 часа
        }
        resolve(intervals);
      }
    });
  });
}

/**
 * Создание cron-задачи для типа подписки
 * @param {string} type - тип подписки
 * @param {number} hours - интервал в часах
 */
function createSubscriptionJob(type, hours) {
  const cronExpression = hoursToCron(hours);
  const job = cron.schedule(cronExpression, async () => {
    const emoji = type === 'admin' ? '🔴' : type === 'plus' ? '🟠' : '🟢';
    const startTime = new Date();
    console.log(`\n${emoji} [${formatTimestamp(startTime)}] ⚡ CRON TRIGGER: ${type.toUpperCase()} подписка`);

    await checkRoutesBySubscription(type);

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`${emoji} [${formatTimestamp(endTime)}] ✅ CRON COMPLETE: ${type.toUpperCase()} (${duration}s)`);
  });
  activeJobs.set(type, job);
  console.log(`  • ${type.toUpperCase()} подписка: ${cronExpression} (каждые ${hours} ч.)`);
}

/**
 * Проверка изменений интервалов и перезапуск задач при необходимости
 */
async function updateSchedulerJobs() {
  try {
    const newIntervals = await getIntervalsFromDB();

    // Проверяем изменения
    let hasChanges = false;
    const changes = [];

    for (const type of Object.keys(newIntervals)) {
      if (currentIntervals[type] !== newIntervals[type]) {
        hasChanges = true;
        changes.push({
          type,
          oldHours: currentIntervals[type],
          newHours: newIntervals[type]
        });
      }
    }

    // Проверяем удаленные типы
    for (const type of Object.keys(currentIntervals)) {
      if (!(type in newIntervals)) {
        hasChanges = true;
        changes.push({
          type,
          oldHours: currentIntervals[type],
          newHours: null
        });
      }
    }

    if (!hasChanges) return;

    // Логируем изменения
    console.log('\n🔄 Обнаружены изменения интервалов проверки:');
    for (const change of changes) {
      if (change.newHours === null) {
        console.log(`  • ${change.type}: удален`);
      } else if (change.oldHours === undefined) {
        console.log(`  • ${change.type}: добавлен (${change.newHours} ч.)`);
      } else {
        console.log(`  • ${change.type}: ${change.oldHours} ч. → ${change.newHours} ч.`);
      }
    }

    // Останавливаем старые задачи
    for (const [type, job] of activeJobs) {
      job.stop();
    }
    activeJobs.clear();

    // Создаем новые задачи
    console.log('\n📅 Перезапуск планировщика с новыми интервалами:');
    for (const [type, hours] of Object.entries(newIntervals)) {
      createSubscriptionJob(type, hours);
    }

    currentIntervals = newIntervals;
  } catch (error) {
    console.error('❌ Ошибка при обновлении интервалов:', error);
  }
}

/**
 * Инициализация планировщика
 */
async function initializeScheduler() {
  try {
    console.log('🚀 Инициализация динамического планировщика...');

    // Загружаем интервалы из БД
    currentIntervals = await getIntervalsFromDB();

    if (Object.keys(currentIntervals).length === 0) {
      console.log('⚠️  Не найдено активных типов подписок в БД, используем значения по умолчанию');
      currentIntervals = { free: 4, plus: 2, admin: 1 };
    }

    // Создаем cron-задачи
    console.log('✅ Планировщик настроен:');
    for (const [type, hours] of Object.entries(currentIntervals)) {
      createSubscriptionJob(type, hours);
    }

    console.log(`  • Очистка данных: 0 3 * * * (3:00 ночи)`);

    // Запускаем периодическую проверку изменений
    setInterval(updateSchedulerJobs, CONFIG_CHECK_INTERVAL);
    console.log(`\n🔄 Проверка изменений интервалов: каждые ${CONFIG_CHECK_INTERVAL / 1000} сек.`);

  } catch (error) {
    console.error('❌ Ошибка инициализации планировщика:', error);
    // Fallback на статические интервалы
    console.log('⚠️  Используем fallback интервалы...');
    currentIntervals = { free: 4, plus: 2, admin: 1 };
    for (const [type, hours] of Object.entries(currentIntervals)) {
      createSubscriptionJob(type, hours);
    }
  }
}

/**
 * Проверить маршруты для определенного типа подписки
 */
async function checkRoutesBySubscription(subscriptionType) {
  const startTime = new Date();
  console.log(`\n⏰ [${formatTimestamp(startTime)}] → НАЧАЛО проверки для подписки ${subscriptionType.toUpperCase()}`);

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
  const notificationService = new NotificationService(bot);

  try {
    // Получаем пользователей с указанным типом подписки
    const users = await getUsersBySubscription(subscriptionType);

    if (users.length === 0) {
      console.log(`  ℹ️  Нет активных пользователей с подпиской ${subscriptionType}`);
      return;
    }

    console.log(`  📊 Найдено ${users.length} пользователей с подпиской ${subscriptionType}`);

    // Для каждого пользователя проверяем его маршруты
    for (const user of users) {
      try {
        await checkUserRoutes(user.chat_id, monitor, notificationService, subscriptionType);
      } catch (error) {
        console.error(`  ❌ Ошибка проверки пользователя ${user.chat_id}:`, error);
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`✅ [${formatTimestamp(endTime)}] ← КОНЕЦ проверки для подписки ${subscriptionType.toUpperCase()} (${duration}s)`);

  } catch (error) {
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.error(`❌ [${formatTimestamp(endTime)}] Ошибка при проверке для подписки ${subscriptionType} (${duration}s):`, error);
  }
}

/**
 * Проверить маршруты конкретного пользователя (новый flow с приоритетами)
 */
async function checkUserRoutes(chatId, monitor, notificationService, subscriptionType) {
  const userStartTime = new Date();
  console.log(`    👤 [${formatTimestamp(userStartTime)}] Начало проверки пользователя ${chatId}`);

  try {
    await airportResolver.load();

    const userRoutes = await getUserActiveRoutes(chatId);

    if (userRoutes.length === 0) {
      console.log(`    ℹ️  Пользователь ${chatId}: нет активных маршрутов`);
      return;
    }

    const userSettings = await getUserSettings(chatId);
    console.log(`    📋 Проверяем ${userRoutes.length} маршрутов для пользователя ${chatId}`);

    const routeBlocks = [];
    let sentCriticalOrHigh = 0;

    for (const route of userRoutes) {
      try {
        // 1. Проверка маршрута (данные сохраняются в БД внутри checkSingleRoute)
        await monitor.checkSingleRoute(route);

        // 2. Лучший результат
        const bestResults = await RouteResult.getTopResults(route.id, 1);
        const bestResult = bestResults[0] || null;

        // 3. Аналитика
        const analytics = await notificationService.getRouteAnalytics(route.id);

        // 4. Статистика комбинаций
        const checkStats = await notificationService.getRouteCheckStats(route.id);

        // 5. Классификация приоритета
        const currentPrice = bestResult?.total_price;
        let priority = 'LOW';
        let reasons = ['Обычная проверка'];

        if (currentPrice) {
          const priceDropPercent = await notificationService.getPriceDropPercent(route.id, currentPrice);
          const classified = notificationService.classifyPriority({
            currentPrice,
            userBudget: route.threshold_price,
            avgPrice: analytics.avgPrice,
            historicalMin: analytics.minPrice,
            priceDropPercent
          });
          priority = classified.priority;
          reasons = classified.reasons;
        }

        // 6. Маршрутизация уведомления
        const routeResult = await notificationService.processAndRouteNotification({
          chatId,
          routeId: route.id,
          route,
          priority,
          reasons,
          currentPrice,
          analytics,
          bestResult,
          checkStats,
          userSettings,
          subscriptionType
        });

        // 7. Формируем блок для сводного отчета. В отчет попадают только те что не отправили
        if (routeResult.action !== 'sent' && routeResult.action !== 'sent_silent') {
          const block = notificationService.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
          routeBlocks.push({ block, route, priority });
        } else {
          sentCriticalOrHigh++;
        }

        await updateRouteLastCheck(route.id);

      } catch (error) {
        console.error(`    ❌ Ошибка проверки маршрута ${route.id}:`, error);
      }
    }

    // Сводный отчет: отправляем если уведомления включены, не ночь, и есть что отправлять
    const notificationsEnabled = userSettings?.notifications_enabled !== 0;
    const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
    const isNight = notificationService._isNightTime(timezone, userSettings);

    if (routeBlocks.length > 0 && notificationsEnabled && !isNight) {
      try {
        await notificationService.sendConsolidatedReport(chatId, routeBlocks, timezone, true);
      } catch (error) {
        console.error(`    ❌ Ошибка отправки сводного отчета пользователю ${chatId}:`, error);
      }
    }

    const userEndTime = new Date();
    const userDuration = ((userEndTime - userStartTime) / 1000).toFixed(2);
    console.log(`    ✅ [${formatTimestamp(userEndTime)}] Завершено для ${chatId}: ${userRoutes.length} маршрутов, ${sentCriticalOrHigh} срочных алертов (${userDuration}s)`);

  } catch (error) {
    const userEndTime = new Date();
    const userDuration = ((userEndTime - userStartTime) / 1000).toFixed(2);
    console.error(`    ❌ [${formatTimestamp(userEndTime)}] Ошибка для пользователя ${chatId} (${userDuration}s):`, error);
  }
}

// ========================================
// CRON ЗАДАЧИ УПРАВЛЯЮТСЯ ДИНАМИЧЕСКИ
// ========================================

// Очистка старых данных раз в день в 3 ночи
cron.schedule('0 3 * * *', async () => {
  console.log(`\n🧹 [${formatTimestamp()}] Очистка старых данных...`);
  await cleanupOldData();
});

// Дайджест: каждый час проверяем, кому пора отправить
cron.schedule('0 * * * *', async () => {
  console.log(`\n📬 [${formatTimestamp()}] Проверка дайджестов...`);
  await sendDigestsForCurrentHour();
});

// ========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================================

/**
 * Получить пользователей по типу подписки
 */
function getUsersBySubscription(subscriptionType) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT DISTINCT us.chat_id
      FROM user_subscriptions us
      WHERE us.subscription_type = ?
        AND us.is_active = 1
        AND (us.valid_to IS NULL OR us.valid_to > datetime('now'))
    `, [subscriptionType], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Получить активные маршруты пользователя
 */
function getUserActiveRoutes(chatId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM unified_routes
      WHERE chat_id = ? AND is_paused = 0
      ORDER BY created_at DESC
    `, [chatId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Получить настройки пользователя
 */
function getUserSettings(chatId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM user_settings
      WHERE chat_id = ?
    `, [chatId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Получить пользователей с включенными уведомлениями о проверках
 */
function getUsersWithNotificationOn() {
  return new Promise((resolve, reject) => {
    db.all(
        'SELECT chat_id FROM user_settings WHERE notify_on_check = 1',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
    );
  });
}

/**
 * Обновить время последней проверки маршрута
 */
function updateRouteLastCheck(routeId) {
  return new Promise((resolve, reject) => {
    db.run(
        'UPDATE unified_routes SET last_check = datetime("now") WHERE id = ?',
        [routeId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
    );
  });
}

/**
 * Получить тип подписки пользователя
 */
function getSubscriptionForUser(chatId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT us.subscription_type
      FROM user_subscriptions us
      WHERE us.chat_id = ? AND us.is_active = 1
        AND (us.valid_to IS NULL OR us.valid_to > datetime('now'))
    `, [chatId], (err, row) => {
      if (err) reject(err);
      else resolve(row?.subscription_type || 'free');
    });
  });
}

/**
 * Получить пользователей с непустой очередью дайджеста
 */
function getUsersWithPendingDigest() {
  return new Promise((resolve, reject) => {
    db.all(
        'SELECT DISTINCT chat_id FROM daily_digest_queue WHERE processed = 0',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
    );
  });
}

/**
 * Отправка дайджестов для текущего часа
 */
async function sendDigestsForCurrentHour() {
  try {
    const notificationService = new NotificationService(bot);
    const users = await getUsersWithPendingDigest();

    if (users.length === 0) {
      console.log('  ℹ️  Нет пользователей с ожидающим дайджестом');
      return;
    }

    for (const user of users) {
      try {
        const settings = await getUserSettings(user.chat_id);
        const timezone = settings?.timezone || 'Asia/Yekaterinburg';
        const subscriptionType = await getSubscriptionForUser(user.chat_id);

        // Определяем текущий час в таймзоне пользователя
        const now = new Date();
        const userLocalTime = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false
        }).format(now);
        const currentHour = parseInt(userLocalTime);

        // Free: отправлять в 10:00 локальное
        // Plus: отправлять в 10:00 и 18:00 локальное
        let shouldSend = false;
        if (currentHour === 10) {
          shouldSend = true;
        } else if (currentHour === 18 && subscriptionType !== 'free') {
          shouldSend = true;
        }

        if (shouldSend) {
          await notificationService.sendDigestForUser(user.chat_id);
        }

      } catch (error) {
        console.error(`  ❌ Ошибка дайджеста для пользователя ${user.chat_id}:`, error);
      }
    }

    console.log(`  ✅ Проверка дайджестов завершена (${users.length} пользователей)`);

  } catch (error) {
    console.error('❌ Ошибка при отправке дайджестов:', error);
  }
}

/**
 * Очистка старых данных
 */
async function cleanupOldData() {
  try {
    const db = require('./config/database');

    // Удаляем результаты проверок старше 30 дней
    db.run(`
      DELETE FROM route_results
      WHERE found_at < datetime('now', '-30 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки route_results:', err);
      } else {
        console.log('  ✅ Очищены старые route_results');
      }
    });

    // Удаляем аналитику старше 90 дней
    db.run(`
      DELETE FROM price_analytics
      WHERE found_at < datetime('now', '-90 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки price_analytics:', err);
      } else {
        console.log('  ✅ Очищены старые price_analytics');
      }
    });

    // Удаляем статистику проверок старше 7 дней
    db.run(`
      DELETE FROM route_check_stats
      WHERE check_timestamp < datetime('now', '-7 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки route_check_stats:', err);
      } else {
        console.log('  ✅ Очищены старые route_check_stats');
      }
    });

    // Удаляем результаты комбинаций старше 7 дней
    db.run(`
      DELETE FROM combination_check_results
      WHERE check_timestamp < datetime('now', '-7 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки combination_check_results:', err);
      } else {
        console.log('  ✅ Очищены старые combination_check_results');
      }
    });

    // Удаляем логи уведомлений старше 30 дней
    db.run(`
      DELETE FROM notification_log
      WHERE sent_at < datetime('now', '-30 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки notification_log:', err);
      } else {
        console.log('  ✅ Очищены старые notification_log');
      }
    });

    // Удаляем обработанные записи дайджеста старше 7 дней
    db.run(`
      DELETE FROM daily_digest_queue
      WHERE processed = 1 AND created_at < datetime('now', '-7 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки daily_digest_queue:', err);
      } else {
        console.log('  ✅ Очищены старые daily_digest_queue');
      }
    });

  } catch (error) {
    console.error('❌ Ошибка при очистке данных:', error);
  }
}

// ========================================
// ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ
// ========================================

// Инициализация динамического планировщика
initializeScheduler();

// Функция для ручного запуска проверки
async function runManualCheck(subscriptionType) {
  console.log(`\n🔧 [${formatTimestamp()}] Ручной запуск проверки для подписки ${subscriptionType}...`);
  await checkRoutesBySubscription(subscriptionType);
}

// Экспортируем функции для ручного управления
module.exports = {
  runManualCheck,
  checkRoutesBySubscription,
  updateSchedulerJobs, // для принудительного обновления интервалов
  getIntervalsFromDB, // для диагностики
  activeJobs // для мониторинга активных задач
};

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️  Остановка планировщика...');
  process.exit(0);
});
