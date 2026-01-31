const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const UnifiedMonitor = require('./services/UnifiedMonitor');
const NotificationService = require('./services/NotificationService');
const db = require('./config/database');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: false });

console.log('📅 Планировщик запущен');

// Интервалы проверок для каждого типа подписки
const CHECK_INTERVALS = {
  'free': '0 */4 * * *',    // каждые 4 часа
  'plus': '0 */2 * * *',    // каждые 2 часа
  'admin': '0 * * * *'      // каждый час
};

/**
 * Проверить маршруты для определенного типа подписки
 */
async function checkRoutesBySubscription(subscriptionType) {
  console.log(`\n⏰ Запуск проверки для подписки ${subscriptionType}...`);

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
  const notificationService = new NotificationService(bot);

  try {
    // Получаем пользователей с указанным типом подписки
    const users = await getUsersBySubscription(subscriptionType);

    if (users.length === 0) {
      console.log(`Нет активных пользователей с подпиской ${subscriptionType}`);
      return;
    }

    console.log(`Найдено ${users.length} пользователей с подпиской ${subscriptionType}`);

    // Для каждого пользователя проверяем его маршруты
    for (const user of users) {
      try {
        await checkUserRoutes(user.chat_id, monitor, notificationService, subscriptionType);
      } catch (error) {
        console.error(`Ошибка проверки пользователя ${user.chat_id}:`, error);
      }
    }

    console.log(`✅ Проверка для подписки ${subscriptionType} завершена`);

  } catch (error) {
    console.error(`❌ Ошибка при проверке для подписки ${subscriptionType}:`, error);
  }
}

/**
 * Проверить маршруты конкретного пользователя
 */
async function checkUserRoutes(chatId, monitor, notificationService, subscriptionType) {
  try {
    // Получаем активные маршруты пользователя

    if (userRoutes.length === 0) {
      console.log(`Пользователь ${chatId}: нет активных маршрутов`);
      return;
    }

    console.log(`Проверяем ${userRoutes.length} маршрутов для пользователя ${chatId}`);

    let totalChecked = 0;
    let totalBelowThreshold = 0;

    // Проверяем каждый маршрут пользователя
    for (const route of userRoutes) {
      try {
        const results = await monitor.checkSingleRoute(route);
        totalChecked++;

        // Проверяем, есть ли цены ниже порога
        const belowThreshold = results.filter(r => r.total_price <= route.threshold_price);
        totalBelowThreshold += belowThreshold.length;

        // Отправляем уведомления о найденных выгодных ценах
        for (const result of belowThreshold) {
          await notificationService.sendPriceAlert(chatId, route, result);
        }

        // Обновляем время последней проверки
        await updateRouteLastCheck(route.id);

      } catch (error) {
        console.error(`Ошибка проверки маршрута ${route.id}:`, error);
      }
    }

    // Отправляем отчет пользователю, если включены уведомления
    const userSettings = await getUserSettings(chatId);
    if (userSettings && userSettings.notify_on_check) {
      try {
        const stats = await notificationService.getUserRoutesStats(chatId);
        await notificationService.sendCheckReport(chatId, stats);
      } catch (error) {
        console.error(`Ошибка отправки отчета пользователю ${chatId}:`, error);
      }
    }

    console.log(`✅ Проверка завершена для пользователя ${chatId}: ${totalChecked} маршрутов, ${totalBelowThreshold} выгодных цен`);

  } catch (error) {
    console.error(`❌ Ошибка при проверке пользователя ${chatId}:`, error);
  }
}

// ========================================
// CRON ЗАДАЧИ ДЛЯ КАЖДОГО ТИПА ПОДПИСКИ
// ========================================

// Проверка для FREE подписки (каждые 4 часа)
cron.schedule(CHECK_INTERVALS.free, async () => {
  console.log('\n🟢 Запуск проверки для FREE подписки...');
  await checkRoutesBySubscription('free');
});

// Проверка для PLUS подписки (каждые 2 часа)
cron.schedule(CHECK_INTERVALS.plus, async () => {
  console.log('\n🟠 Запуск проверки для PLUS подписки...');
  await checkRoutesBySubscription('plus');
});

// Проверка для ADMIN подписки (каждый час)
cron.schedule(CHECK_INTERVALS.admin, async () => {
  console.log('\n🔴 Запуск проверки для ADMIN подписки...');
  await checkRoutesBySubscription('admin');
});

// ========================================
// ДОПОЛНИТЕЛЬНЫЕ CRON ЗАДАЧИ
// ========================================

// Ежедневная полная проверка всех маршрутов в 9 утра
// cron.schedule('0 9 * * *', async () => {
//   console.log('\n🌅 Ежедневная полная проверка всех маршрутов...');
//
//   try {
//     const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
//     const notificationService = new NotificationService(bot);
//
//     await monitor.checkAllRoutes();
//
//     // Отправляем отчеты пользователям с включенными уведомлениями
//     const usersWithNotifications = await getUsersWithNotificationOn();
//
//     for (const user of usersWithNotifications) {
//       try {
//         const userRoutes = await notificationService.getUserRoutesStats(user.chat_id);
//         await notificationService.sendCheckReport(user.chat_id, userRoutes);
//       } catch (error) {
//         console.error(`Ошибка отправки отчета пользователю ${user.chat_id}:`, error);
//       }
//     }
//
//     console.log('✅ Ежедневная проверка завершена');
//   } catch (error) {
//     console.error('❌ Ошибка при ежедневной проверке:', error);
//   }
// });

// Очистка старых данных раз в день в 3 ночи
cron.schedule('0 3 * * *', async () => {
  console.log('\n🧹 Очистка старых данных...');
  await cleanupOldData();
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
        console.error('Ошибка очистки route_results:', err);
      } else {
        console.log('✅ Очищены старые route_results');
      }
    });

    // Удаляем аналитику старше 90 дней
    db.run(`
      DELETE FROM price_analytics 
      WHERE found_at < datetime('now', '-90 days')
    `, (err) => {
      if (err) {
        console.error('Ошибка очистки price_analytics:', err);
      } else {
        console.log('✅ Очищены старые price_analytics');
      }
    });

    // Удаляем статистику проверок старше 7 дней
    db.run(`
      DELETE FROM route_check_stats 
      WHERE check_timestamp < datetime('now', '-7 days')
    `, (err) => {
      if (err) {
        console.error('Ошибка очистки route_check_stats:', err);
      } else {
        console.log('✅ Очищены старые route_check_stats');
      }
    });

    // Удаляем результаты комбинаций старше 7 дней
    db.run(`
      DELETE FROM combination_check_results 
      WHERE check_timestamp < datetime('now', '-7 days')
    `, (err) => {
      if (err) {
        console.error('Ошибка очистки combination_check_results:', err);
      } else {
        console.log('✅ Очищены старые combination_check_results');
      }
    });

  } catch (error) {
    console.error('Ошибка при очистке данных:', error);
  }
}

// ========================================
// ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ
// ========================================

console.log('✅ Планировщик настроен:');
console.log(`   • FREE подписка: ${CHECK_INTERVALS.free} (каждые 4 часа)`);
console.log(`   • PLUS подписка: ${CHECK_INTERVALS.plus} (каждые 2 часа)`);
console.log(`   • ADMIN подписка: ${CHECK_INTERVALS.admin} (каждый час)`);
console.log(`   • Ежедневная проверка: 0 9 * * * (9:00 утра)`);
console.log(`   • Очистка данных: 0 3 * * * (3:00 ночи)`);

// Функция для ручного запуска проверки
async function runManualCheck(subscriptionType) {
  console.log(`\n🔧 Ручной запуск проверки для подписки ${subscriptionType}...`);
  await checkRoutesBySubscription(subscriptionType);
}

// Экспортируем функции для ручного управления
module.exports = {
  runManualCheck,
  checkRoutesBySubscription,
  CHECK_INTERVALS
};

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️ Остановка планировщика...');
  process.exit(0);
});