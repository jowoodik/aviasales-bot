/**
 * Integration-тест: Batch из 30 маршрутов (3 пользователя × 10 маршрутов)
 *
 * ВНИМАНИЕ: Этот тест выполняет РЕАЛЬНЫЕ запросы к Aviasales API!
 * Не запускайте часто, чтобы не превысить лимиты.
 */

require('dotenv').config();
const db = require('../../config/database');

// Mock бота
const bot = {
  sendMessage: async () => {},
  editMessageText: async () => {},
};

const UnifiedMonitor = require('../../services/UnifiedMonitor');
const NotificationService = require('../../services/NotificationService');

const TEST_CHAT_IDS = [99991, 99992, 99993];
const ROUTES_PER_USER = 10;

async function cleanupTestData() {
  console.log('🧹 Очистка старых тестовых данных...');

  for (const chatId of TEST_CHAT_IDS) {
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DELETE FROM route_results WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [chatId]);
        db.run('DELETE FROM route_check_stats WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [chatId]);
        db.run('DELETE FROM combination_check_results WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [chatId]);
        db.run('DELETE FROM price_analytics WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM notification_log WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM unified_routes WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_settings WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_subscriptions WHERE chat_id = ?', [chatId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  console.log('✅ Очистка завершена\n');
}

async function createTestUsers() {
  console.log('👥 Создание тестовых пользователей...\n');

  for (const chatId of TEST_CHAT_IDS) {
    // Создаем подписку admin
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO user_subscriptions (chat_id, subscription_type, is_active, valid_to)
        VALUES (?, 'admin', 1, datetime('now', '+1 year'))
      `, [chatId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Создаем настройки
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO user_settings (chat_id, timezone, notifications_enabled, night_mode)
        VALUES (?, 'Asia/Yekaterinburg', 1, 0)
      `, [chatId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`  ✅ Пользователь ${chatId} создан`);
  }

  console.log();
}

async function createTestRoutes() {
  console.log('✈️  Создание тестовых маршрутов...\n');

  // Популярные направления для тестов
  const directions = [
    ['MOW', 'DXB'], // Москва - Дубай
    ['LED', 'DPS'], // Санкт-Петербург - Бали
    ['MOW', 'BCN'], // Москва - Барселона
    ['LED', 'AMS'], // Санкт-Петербург - Амстердам
    ['MOW', 'IST'], // Москва - Стамбул
    ['SVX', 'AYT'], // Екатеринбург - Анталья
    ['MOW', 'TBS'], // Москва - Тбилиси
    ['LED', 'HKT'], // Санкт-Петербург - Пхукет
    ['MOW', 'PRG'], // Москва - Прага
    ['SVX', 'MOW'], // Екатеринбург - Москва
  ];

  const routeIds = [];
  let routeId = 99000;

  for (let userIdx = 0; userIdx < TEST_CHAT_IDS.length; userIdx++) {
    const chatId = TEST_CHAT_IDS[userIdx];

    for (let routeIdx = 0; routeIdx < ROUTES_PER_USER; routeIdx++) {
      routeId++;
      const [origin, destination] = directions[routeIdx];

      // Даты через 2 месяца от текущей
      const departureDate = new Date();
      departureDate.setMonth(departureDate.getMonth() + 2);
      const departureDateStr = departureDate.toISOString().split('T')[0];

      const returnDate = new Date(departureDate);
      returnDate.setDate(returnDate.getDate() + 10);
      const returnDateStr = returnDate.toISOString().split('T')[0];

      await new Promise((resolve, reject) => {
        db.run(`
          INSERT INTO unified_routes
          (id, chat_id, origin, destination, departure_date, return_date,
           has_return, is_flexible, threshold_price,
           airline, baggage, max_stops, adults, is_paused, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0, 50000, NULL, 0, NULL, 1, 0, datetime('now'))
        `, [routeId, chatId, origin, destination, departureDateStr, returnDateStr], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      routeIds.push(routeId);
    }

    console.log(`  ✅ Создано ${ROUTES_PER_USER} маршрутов для пользователя ${chatId}`);
  }

  console.log(`\n✅ Всего создано маршрутов: ${routeIds.length}\n`);
  return routeIds;
}

async function runBatchCheck() {
  console.log('========================================');
  console.log('🚀 Запуск batch-проверки для admin');
  console.log('========================================\n');

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
  const notificationService = new NotificationService(bot);

  const startTime = Date.now();

  // Импортируем функцию из scheduler
  const { checkRoutesBySubscription } = require('../../scheduler');

  try {
    await checkRoutesBySubscription('admin');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n========================================');
    console.log(`✅ Batch-проверка завершена за ${elapsed}s`);
    console.log('========================================\n');

    return elapsed;
  } catch (error) {
    console.error('❌ Ошибка batch-проверки:', error);
    throw error;
  }
}

async function verifyResults(routeIds) {
  console.log('🔍 Проверка результатов...\n');

  let allTestsPassed = true;

  // Проверка route_results
  const resultsCounts = await new Promise((resolve, reject) => {
    db.all(`
      SELECT route_id, COUNT(*) as count
      FROM route_results
      WHERE route_id IN (${routeIds.join(',')})
      GROUP BY route_id
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  const routesWithResults = resultsCounts.length;
  console.log(`  📊 Маршрутов с результатами: ${routesWithResults}/${routeIds.length}`);

  if (routesWithResults === 0) {
    console.error('  ❌ ОШИБКА: ни один маршрут не имеет результатов!');
    allTestsPassed = false;
  } else {
    console.log('  ✅ Результаты сохранены');
  }

  // Проверка route_check_stats
  const statsCount = await new Promise((resolve, reject) => {
    db.get(`
      SELECT COUNT(*) as count
      FROM route_check_stats
      WHERE route_id IN (${routeIds.join(',')})
    `, [], (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });

  console.log(`  📊 Записей в route_check_stats: ${statsCount}`);

  if (statsCount !== routeIds.length) {
    console.error(`  ❌ ОШИБКА: ожидалось ${routeIds.length} записей, получено ${statsCount}`);
    allTestsPassed = false;
  } else {
    console.log('  ✅ Статистика проверок сохранена для всех маршрутов');
  }

  // Проверка combination_check_results
  const combinationCount = await new Promise((resolve, reject) => {
    db.get(`
      SELECT COUNT(*) as count
      FROM combination_check_results
      WHERE route_id IN (${routeIds.join(',')})
    `, [], (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });

  console.log(`  📊 Записей в combination_check_results: ${combinationCount}`);

  if (combinationCount !== routeIds.length) {
    console.error(`  ❌ ОШИБКА: ожидалось ${routeIds.length} записей, получено ${combinationCount}`);
    allTestsPassed = false;
  } else {
    console.log('  ✅ Детальные результаты комбинаций сохранены');
  }

  // Проверка last_check обновлен
  const updatedRoutes = await new Promise((resolve, reject) => {
    db.all(`
      SELECT id, last_check
      FROM unified_routes
      WHERE id IN (${routeIds.join(',')})
        AND last_check IS NOT NULL
    `, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  console.log(`  📊 Маршрутов с обновленным last_check: ${updatedRoutes.length}/${routeIds.length}`);

  if (updatedRoutes.length !== routeIds.length) {
    console.error('  ❌ ОШИБКА: не все маршруты имеют обновленный last_check');
    allTestsPassed = false;
  } else {
    console.log('  ✅ last_check обновлен для всех маршрутов');
  }

  return allTestsPassed;
}

async function runTest() {
  console.log('\n========================================');
  console.log('📋 Integration-тест: Batch из 30 маршрутов');
  console.log('========================================\n');

  console.log('⚠️  ВНИМАНИЕ: Этот тест выполняет РЕАЛЬНЫЕ запросы к API!');
  console.log('⚠️  Для полного теста потребуется ~30-60 секунд\n');

  let allTestsPassed = true;
  let routeIds = [];

  try {
    // Подготовка
    await cleanupTestData();
    await createTestUsers();
    routeIds = await createTestRoutes();

    // Выполнение batch-проверки
    const elapsed = await runBatchCheck();

    // Проверка что время выполнения приемлемое
    console.log('📊 Анализ производительности:\n');
    console.log(`  ⏱️  Время выполнения: ${elapsed}s`);
    console.log(`  📈 Среднее время на маршрут: ${(elapsed / 30).toFixed(2)}s`);

    if (parseFloat(elapsed) > 120) {
      console.warn('  ⚠️  ПРЕДУПРЕЖДЕНИЕ: время выполнения превышает 2 минуты');
      console.warn('  💡 Ожидаемое время: 30-60 секунд для 30 маршрутов');
    } else {
      console.log('  ✅ Время выполнения в пределах нормы');
    }

    // Проверка результатов
    console.log();
    const resultsValid = await verifyResults(routeIds);

    if (!resultsValid) {
      allTestsPassed = false;
    }

  } catch (error) {
    console.error('❌ Критическая ошибка теста:', error);
    allTestsPassed = false;
  } finally {
    // Очистка после теста
    console.log('\n🧹 Очистка тестовых данных...');
    await cleanupTestData();
    console.log('✅ Тестовые данные удалены\n');
  }

  // Итоговый результат
  console.log('========================================');
  if (allTestsPassed) {
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО');
  } else {
    console.log('❌ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛИЛИСЬ');
    process.exit(1);
  }
  console.log('========================================\n');

  db.close();
}

// Запуск теста
runTest().catch(error => {
  console.error('❌ Критическая ошибка теста:', error);
  db.close();
  process.exit(1);
});
