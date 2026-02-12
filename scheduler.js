const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const UnifiedMonitor = require('./services/UnifiedMonitor');
const NotificationService = require('./services/NotificationService');
const RouteResult = require('./models/RouteResult');
const Trip = require('./models/Trip');
const TripLeg = require('./models/TripLeg');
const TripResult = require('./models/TripResult');
const TripOptimizer = require('./services/TripOptimizer');
const airportResolver = require('./utils/AirportCodeResolver');
const TimezoneUtils = require('./utils/timezoneUtils');
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
 * Проверка конкретного типа подписки (обертка с логированием)
 */
async function checkSubscriptionType(type) {
  const emoji = type === 'admin' ? '🔴' : type === 'plus' ? '🟠' : '🟢';
  const startTime = new Date();
  console.log(`\n${emoji} [${formatTimestamp(startTime)}] ⚡ СТАРТ: ${type.toUpperCase()} подписка`);

  try {
    await checkRoutesBySubscription(type);
  } catch (error) {
    console.error(`${emoji} ❌ Ошибка при проверке ${type}:`, error);
  }

  const endTime = new Date();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`${emoji} [${formatTimestamp(endTime)}] ✅ ЗАВЕРШЕНО: ${type.toUpperCase()} (${duration}s)`);
}

/**
 * Определить, какие типы подписок должны проверяться в этот час
 */
function getSubscriptionTypesToCheck() {
  const now = new Date();
  const currentHour = now.getHours();
  const typesToCheck = [];

  // Проверяем каждый тип подписки по приоритету
  const priorityOrder = ['admin', 'plus', 'free'];

  for (const type of priorityOrder) {
    if (!currentIntervals[type]) continue;

    const interval = currentIntervals[type];

    // Проверяем, должен ли этот тип проверяться в этот час
    // Используем делимость текущего часа на интервал
    if (currentHour % interval === 0) {
      typesToCheck.push(type);
    }
  }

  return typesToCheck;
}

/**
 * Последовательная проверка типов подписок с учетом приоритетов
 */
async function checkScheduledSubscriptions() {
  const typesToCheck = getSubscriptionTypesToCheck();

  if (typesToCheck.length === 0) {
    console.log(`\n⏭️  [${formatTimestamp()}] Нет типов подписок для проверки в этот час`);
    return;
  }

  console.log(`\n🔄 [${formatTimestamp()}] Начало проверки: ${typesToCheck.join(' → ')}`);
  const globalStart = new Date();

  for (const type of typesToCheck) {
    await checkSubscriptionType(type);
  }

  const globalEnd = new Date();
  const totalDuration = ((globalEnd - globalStart) / 1000).toFixed(2);
  console.log(`\n🏁 [${formatTimestamp(globalEnd)}] Все проверки завершены (общее время: ${totalDuration}s)`);
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

    // Находим минимальный интервал и создаем общий cron
    const intervals = Object.values(newIntervals);
    const minInterval = Math.min(...intervals);

    console.log('\n📅 Перезапуск планировщика с новыми интервалами:');
    console.log(`  • Общий cron: ${hoursToCron(minInterval)} (каждые ${minInterval} ч.)`);
    console.log(`  • Интервалы: ${Object.entries(newIntervals).map(([type, hours]) => `${type}=${hours}ч`).join(', ')}`);
    console.log(`  • Порядок проверки: admin → plus → free (последовательно)`);

    const mainJob = cron.schedule(hoursToCron(minInterval), async () => {
      await checkScheduledSubscriptions();
    });

    activeJobs.set('main', mainJob);

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
      currentIntervals = { free: 2, plus: 1, admin: 1 };
    }

    // Находим минимальный интервал для общего крона
    const intervals = Object.values(currentIntervals);
    const minInterval = Math.min(...intervals);

    console.log('✅ Планировщик настроен:');
    console.log(`  • Общий cron: ${hoursToCron(minInterval)} (каждые ${minInterval} ч.)`);
    console.log(`  • Интервалы: ${Object.entries(currentIntervals).map(([type, hours]) => `${type}=${hours}ч`).join(', ')}`);
    console.log(`  • Порядок проверки: admin → plus → free (последовательно)`);

    // Создаем один общий cron-job, который запускает проверку по расписанию
    const mainJob = cron.schedule(hoursToCron(minInterval), async () => {
      await checkScheduledSubscriptions();
    });

    activeJobs.set('main', mainJob);

    // Запускаем периодическую проверку изменений
    setInterval(updateSchedulerJobs, CONFIG_CHECK_INTERVAL);
    console.log(`\n🔄 Проверка изменений интервалов: каждые ${CONFIG_CHECK_INTERVAL / 1000} сек.`);

  } catch (error) {
    console.error('❌ Ошибка инициализации планировщика:', error);
    // Fallback на статические интервалы
    console.log('⚠️  Используем fallback интервалы...');
    currentIntervals = { free: 2, plus: 1, admin: 1 };

    const mainJob = cron.schedule(hoursToCron(1), async () => {
      await checkScheduledSubscriptions();
    });
    activeJobs.set('main', mainJob);
  }
}

/**
 * BATCH-версия: Проверить маршруты для подписки параллельно (оптимизация)
 */
async function checkRoutesBySubscriptionBatch(subscriptionType, monitor, notificationService) {
  console.log(`\n📦 BATCH-режим для подписки ${subscriptionType.toUpperCase()}`);

  try {
    // 1. Получить всех пользователей подписки
    const users = await getUsersBySubscription(subscriptionType);

    if (users.length === 0) {
      console.log(`  ℹ️  Нет активных пользователей с подпиской ${subscriptionType}`);
      return;
    }

    console.log(`  📊 Найдено ${users.length} пользователей с подпиской ${subscriptionType}`);

    // 2. Собрать все маршруты всех пользователей с метаданными
    const batchItems = [];
    const routeMetaMap = new Map(); // routeId → {route, chatId, userSettings, combinations, urls}

    for (const user of users) {
      const routes = await getUserActiveRoutes(user.chat_id);
      const userSettings = await getUserSettings(user.chat_id);

      for (const route of routes) {
        // Проверяем истечение срока маршрута
        const isExpired = await checkAndArchiveExpiredRoute(route, userSettings);
        if (isExpired) {
          console.log(`    📦 Маршрут #${route.id} архивирован - пропускаем проверку`);
          continue;
        }

        // Генерируем URLs с метаданными для маршрута (с учетом таймзоны)
        const items = monitor.prepareBatchItem(route, userSettings);

        if (items.length === 0) {
          console.log(`    ⏭️  Маршрут #${route.id}: нет комбинаций для проверки`);
          continue;
        }

        // Сохраняем метаданные маршрута
        routeMetaMap.set(route.id, {
          route,
          chatId: user.chat_id,
          userSettings,
          combinations: items.map(item => item.combination),
          urls: items.map(item => item.url)
        });

        // Добавляем items в общий пул с привязкой к маршруту
        items.forEach(item => {
          batchItems.push({
            ...item,
            routeId: route.id,
            chatId: user.chat_id
          });
        });
      }
    }

    // --- СБОР ТРИПОВ ---
    const tripBatchItems = [];
    const tripMetaMap = new Map(); // tripId → {trip, legs, chatId, userSettings}

    for (const user of users) {
      const trips = await Trip.getActiveByChatId(user.chat_id);
      const userSettings = await getUserSettings(user.chat_id);

      for (const trip of trips) {
        const isExpired = await checkAndArchiveTripIfExpired(trip, userSettings);
        if (isExpired) continue;

        const legs = await TripLeg.getByTripId(trip.id);
        const items = TripOptimizer.generateBatchItems(trip, legs, userSettings, monitor.api);

        if (items.length === 0) continue;

        tripMetaMap.set(trip.id, { trip, legs, chatId: user.chat_id, userSettings });

        items.forEach(item => {
          tripBatchItems.push({ ...item, chatId: user.chat_id });
        });
      }
    }

    if (tripBatchItems.length > 0) {
      console.log(`  🗺️  Подготовлено ${tripBatchItems.length} URLs для ${tripMetaMap.size} трипов`);
    }

    const allBatchItems = [...batchItems, ...tripBatchItems];

    if (allBatchItems.length === 0) {
      console.log('  ℹ️  Нет маршрутов для проверки');
      return;
    }

    console.log(`  📋 Подготовлено ${allBatchItems.length} URLs (${batchItems.length} маршрутов + ${tripBatchItems.length} трипов)`);

    // 3. Проверить ВСЕ URLs одним батчем с индивидуальными фильтрами!
    const urlsWithFilters = allBatchItems.map(item => ({
      url: item.url,
      airline: item.airline,
      baggage: item.baggage,
      max_stops: item.max_stops,
      max_layover_hours: item.max_layover_hours
    }));

    const response = await monitor.pricer.getPricesFromUrlsWithIndividualFilters(urlsWithFilters);

    console.log(`  ✅ Batch-проверка завершена: ${response.stats.success}/${response.stats.total} успешно`);

    // 4. Группируем результаты по маршрутам (только первые batchItems.length элементов)
    const routeResults = new Map(); // routeId → [{combination, priceResult, url}]

    for (let i = 0; i < batchItems.length; i++) {
      const item = batchItems[i];
      const result = response.results[i];

      if (!routeResults.has(item.routeId)) {
        routeResults.set(item.routeId, []);
      }

      routeResults.get(item.routeId).push({
        combination: item.combination,
        priceResult: result,
        url: item.url
      });
    }

    console.log(`  📦 Результаты сгруппированы по ${routeResults.size} маршрутам`);

    // 5. Обрабатываем каждый маршрут (сохраняем в БД)
    for (const [routeId, results] of routeResults) {
      const meta = routeMetaMap.get(routeId);

      try {
        // Сохраняем результаты в БД (аналогично checkSingleRoute)
        await monitor.processBatchResults(routeId, meta.route, results);
      } catch (error) {
        console.error(`  ❌ Ошибка сохранения результатов для маршрута ${routeId}:`, error);
      }
    }

    // 6. Отправляем уведомления по пользователям (КАК РАНЬШЕ!)
    await airportResolver.load();
    let totalSent = 0;

    for (const [routeId, results] of routeResults) {
      const meta = routeMetaMap.get(routeId);
      const route = meta.route;
      const chatId = meta.chatId;
      const userSettings = meta.userSettings;
      const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';

      try {
        // Получаем лучший результат
        const bestResults = await RouteResult.getTopResults(routeId, 1);
        const bestResult = bestResults[0] || null;

        // Обработка NO_RESULTS
        if (!bestResult) {
          const noResultsCheck = await notificationService.processNoResults(chatId, routeId);

          if (noResultsCheck.shouldSend) {
            const analytics = await notificationService.getRouteAnalytics(routeId);
            const checkStats = await notificationService.getRouteCheckStats(routeId);
            const noResultsBlock = notificationService.formatNoResultsBlock(route, analytics, checkStats, timezone);

            await notificationService._sendInstantAlert(
              chatId,
              routeId,
              noResultsBlock,
              'NO_RESULTS',
              null,
              timezone,
              true // всегда без звука
            );

            await notificationService._logNotification(
              chatId,
              routeId,
              'NO_RESULTS',
              null,
              'NO_RESULTS',
              true
            );

            console.log(`    📭 NO_RESULTS уведомление отправлено для маршрута ${routeId}`);
            totalSent++;
          }

          await updateRouteLastCheck(routeId);
          continue;
        }

        // Аналитика, классификация, маршрутизация
        const analytics = await notificationService.getRouteAnalytics(routeId);
        const checkStats = await notificationService.getRouteCheckStats(routeId);

        const currentPrice = bestResult.total_price;
        const classified = await notificationService.classifyPriority({
          currentPrice,
          userBudget: route.threshold_price,
          historicalMin: analytics.minPrice,
          routeId
        });
        const priority = classified.priority;
        const reasons = classified.reasons;

        // Маршрутизация уведомления
        const routeResult = await notificationService.processAndRouteNotification({
          chatId,
          routeId,
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

        // Отправка уведомления
        if (routeResult.action === 'sent' || routeResult.action === 'sent_silent') {
          const block = await notificationService.formatSingleRouteBlock(route, bestResult, analytics, checkStats, priority);

          await notificationService._sendInstantAlert(
            chatId,
            routeId,
            block,
            priority,
            currentPrice,
            timezone,
            routeResult.action === 'sent_silent'
          );

          totalSent++;
        }

        await updateRouteLastCheck(routeId);

      } catch (error) {
        console.error(`  ❌ Ошибка уведомления для маршрута ${routeId}:`, error);
      }
    }

    // --- ОБРАБОТКА ТРИПОВ ---
    if (tripBatchItems.length > 0) {
      // Группировка результатов: one-way и round-trip отдельно
      const tripPriceResults = new Map(); // tripId → Map<legOrder, Map<date, priceResult>>
      const tripRtPrices = new Map();     // tripId → Map<pairKey, Map<depDate, Map<retDate, priceResult>>>

      for (let i = batchItems.length; i < allBatchItems.length; i++) {
        const item = allBatchItems[i];
        const result = response.results[i];

        if (item.isRoundTrip) {
          // Round-trip результат
          if (!tripRtPrices.has(item.tripId)) {
            tripRtPrices.set(item.tripId, new Map());
          }
          const rtMap = tripRtPrices.get(item.tripId);
          const pairKey = `${item.outLegOrder}-${item.retLegOrder}`;

          if (!rtMap.has(pairKey)) {
            rtMap.set(pairKey, new Map());
          }
          if (!rtMap.get(pairKey).has(item.departureDate)) {
            rtMap.get(pairKey).set(item.departureDate, new Map());
          }

          if (result && result.price > 0) {
            rtMap.get(pairKey).get(item.departureDate).set(item.returnDate, {
              price: result.price,
              searchLink: result.searchLink || item.url,
              airline: result.airline || null
            });
          }
        } else {
          // One-way результат
          if (!tripPriceResults.has(item.tripId)) {
            tripPriceResults.set(item.tripId, new Map());
          }
          const legMap = tripPriceResults.get(item.tripId);

          if (!legMap.has(item.legOrder)) {
            legMap.set(item.legOrder, new Map());
          }

          if (result && result.price > 0) {
            legMap.get(item.legOrder).set(item.departureDate, {
              price: result.price,
              searchLink: result.searchLink || item.url,
              airline: result.airline || null
            });
          }
        }
      }

      for (const [tripId, pricesByLeg] of tripPriceResults) {
        const meta = tripMetaMap.get(tripId);
        if (!meta) continue;

        try {
          const roundTripPrices = tripRtPrices.get(tripId) || null;
          const bestCombo = TripOptimizer.findBestCombination(meta.trip, meta.legs, pricesByLeg, roundTripPrices);

          if (!bestCombo) {
            // NO_RESULTS для трипа
            const noResultsCheck = await notificationService.processNoResults(meta.chatId, null, tripId);
            if (noResultsCheck.shouldSend) {
              const timezone = meta.userSettings?.timezone || 'Asia/Yekaterinburg';
              const noResultsBlock = notificationService.formatTripNoResultsBlock(meta.trip, meta.legs, timezone);

              await notificationService._sendInstantAlert(
                meta.chatId, null, noResultsBlock, 'NO_RESULTS', null, timezone, true
              );

              await notificationService._logNotification(
                meta.chatId, null, 'NO_RESULTS', null, 'NO_RESULTS', true, tripId
              );

              console.log(`    📭 NO_RESULTS для трипа ${tripId}`);
              totalSent++;
            }
            await Trip.updateLastCheck(tripId);
            continue;
          }

          // Сохранить результат
          const legResults = bestCombo.legs.map(l => ({
            legOrder: l.legOrder,
            departureDate: l.departureDate,
            price: l.price,
            airline: l.airline,
            searchLink: l.searchLink
          }));
          await TripResult.save(tripId, bestCombo.totalPrice, legResults);

          // Аналитика
          const analytics = await notificationService.getTripAnalytics(tripId);

          // Классификация
          const classified = await notificationService.classifyPriority({
            currentPrice: bestCombo.totalPrice,
            userBudget: meta.trip.threshold_price,
            historicalMin: analytics.minPrice,
            tripId: tripId
          });

          const timezone = meta.userSettings?.timezone || 'Asia/Yekaterinburg';

          // Маршрутизация уведомления
          const tripRouteResult = await notificationService.processAndRouteNotification({
            chatId: meta.chatId,
            routeId: null,
            tripId: tripId,
            route: meta.trip,
            priority: classified.priority,
            reasons: classified.reasons,
            currentPrice: bestCombo.totalPrice,
            analytics,
            bestResult: bestCombo,
            userSettings: meta.userSettings,
            subscriptionType
          });

          if (tripRouteResult.action === 'sent' || tripRouteResult.action === 'sent_silent') {
            const block = notificationService.formatTripBlock(meta.trip, meta.legs, bestCombo, analytics, classified.priority);

            await notificationService._sendTripAlert(
              meta.chatId, tripId, block, classified.priority,
              bestCombo.totalPrice, timezone, tripRouteResult.action === 'sent_silent'
            );

            totalSent++;
          }

          await Trip.updateLastCheck(tripId);

        } catch (error) {
          console.error(`  ❌ Ошибка обработки трипа ${tripId}:`, error);
        }
      }
    }

    console.log(`  📬 Отправлено ${totalSent} уведомлений`);

  } catch (error) {
    console.error(`  ❌ Критическая ошибка batch-проверки для ${subscriptionType}:`, error);
  }
}

/**
 * Проверить маршруты для определенного типа подписки (с оптимизацией batch-проверки)
 */
async function checkRoutesBySubscription(subscriptionType) {
  const startTime = new Date();
  console.log(`\n⏰ [${formatTimestamp(startTime)}] → НАЧАЛО проверки для подписки ${subscriptionType.toUpperCase()}`);

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
  const notificationService = new NotificationService(bot);

  try {
    // 🔥 ИСПОЛЬЗУЕМ BATCH-ВЕРСИЮ для параллельной проверки всех маршрутов
    await checkRoutesBySubscriptionBatch(subscriptionType, monitor, notificationService);

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`✅ [${formatTimestamp(endTime)}] ← КОНЕЦ проверки для подписки ${subscriptionType.toUpperCase()} (${duration}s)`);

  } catch (error) {
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.error(`❌ [${formatTimestamp(endTime)}] Ошибка при проверке для подписки ${subscriptionType} (${duration}s):`, error);
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

// ========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================================

/**
 * Получить "сегодня" в таймзоне пользователя (00:00:00)
 */
function getTodayInUserTimezone(timezone) {
  try {
    const userNow = TimezoneUtils.getCurrentTimeInTimezone(timezone);
    userNow.setHours(0, 0, 0, 0);
    return userNow;
  } catch (error) {
    console.error('Ошибка получения даты в таймзоне:', error);
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
}

/**
 * Проверить истечение срока маршрута и архивировать если нужно
 * @returns {boolean} true если маршрут архивирован, false если актуален
 */
async function checkAndArchiveExpiredRoute(route, userSettings) {
  const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
  const today = getTodayInUserTimezone(timezone);

  // Определяем дату для проверки
  let checkDate;
  let dateLabel;

  if (route.is_flexible) {
    // Для гибких маршрутов проверяем конец диапазона
    checkDate = new Date(route.departure_end);
    dateLabel = `${route.departure_start} - ${route.departure_end}`;
  } else {
    // Для фиксированных проверяем дату вылета
    checkDate = new Date(route.departure_date);
    dateLabel = route.departure_date;
  }

  checkDate.setHours(0, 0, 0, 0);

  // Если дата прошла - архивируем
  if (checkDate < today) {
    try {
      // Архивируем маршрут
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE unified_routes SET is_archived = 1 WHERE id = ?',
          [route.id],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Отправляем уведомление пользователю
      const message = `📦 *Маршрут архивирован*\n\n` +
        `${route.origin} → ${route.destination}\n` +
        `Дата: ${dateLabel}\n\n` +
        `Причина: дата вылета прошла`;

      await bot.sendMessage(route.chat_id, message, { parse_mode: 'Markdown' });

      console.log(`    📦 Маршрут ${route.id} автоматически архивирован (дата прошла)`);
      return true; // Маршрут архивирован
    } catch (error) {
      console.error(`    ❌ Ошибка архивации маршрута ${route.id}:`, error);
      return false;
    }
  }

  return false; // Маршрут актуален
}

/**
 * Проверить истечение срока трипа и архивировать если нужно
 */
async function checkAndArchiveTripIfExpired(trip, userSettings) {
  const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
  const today = getTodayInUserTimezone(timezone);

  const checkDate = new Date(trip.departure_end);
  checkDate.setHours(0, 0, 0, 0);

  if (checkDate < today) {
    try {
      await Trip.setAsArchived(trip.id);

      const message = `📦 *Составной маршрут архивирован*\n\n` +
        `🗺️ ${trip.name}\n` +
        `Причина: дата вылета прошла`;

      await bot.sendMessage(trip.chat_id, message, { parse_mode: 'Markdown' });
      console.log(`    📦 Трип ${trip.id} автоматически архивирован`);
      return true;
    } catch (error) {
      console.error(`    ❌ Ошибка архивации трипа ${trip.id}:`, error);
      return false;
    }
  }

  return false;
}

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
      WHERE chat_id = ? AND is_paused = 0 AND is_archived = 0
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

    // Удаляем старые результаты трипов
    db.run(`
      DELETE FROM trip_results
      WHERE found_at < datetime('now', '-30 days')
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки trip_results:', err);
      } else {
        console.log('  ✅ Очищены старые trip_results');
      }
    });

    // Удаляем осиротевшие trip_leg_results
    db.run(`
      DELETE FROM trip_leg_results
      WHERE trip_result_id NOT IN (SELECT id FROM trip_results)
    `, (err) => {
      if (err) {
        console.error('  ❌ Ошибка очистки trip_leg_results:', err);
      } else {
        console.log('  ✅ Очищены осиротевшие trip_leg_results');
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
  checkUserRoutes, // для команды /check и ручной проверки
  updateSchedulerJobs, // для принудительного обновления интервалов
  getIntervalsFromDB, // для диагностики
  activeJobs // для мониторинга активных задач
};

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️  Остановка планировщика...');
  process.exit(0);
});
