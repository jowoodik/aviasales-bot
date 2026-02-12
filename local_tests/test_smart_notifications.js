/**
 * 🧪 Тесты адаптивной системы приоритизации уведомлений
 *
 * Тестирует:
 * 1. classifyPriority — скоринг и приоритеты
 * 2. _canSendNotification — квоты и таймауты
 * 3. getTripStatistics / getRouteStatistics — статистика
 */

const sqlite3 = require('sqlite3').verbose();

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName} (ожидалось: ${expected}, получено: ${actual})`);
    failed++;
  }
}

// === Создаём in-memory БД и подменяем модуль ===

function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run(`CREATE TABLE price_analytics (
          id INTEGER PRIMARY KEY,
          route_id INTEGER,
          price REAL,
          found_at TEXT DEFAULT (datetime('now'))
        )`);

        db.run(`CREATE TABLE trip_results (
          id INTEGER PRIMARY KEY,
          trip_id INTEGER,
          total_price REAL,
          found_at TEXT DEFAULT (datetime('now'))
        )`);

        db.run(`CREATE TABLE notification_log (
          id INTEGER PRIMARY KEY,
          chat_id INTEGER,
          route_id INTEGER,
          trip_id INTEGER,
          priority TEXT,
          price REAL,
          message_type TEXT,
          sent_at TEXT,
          disable_notification INTEGER DEFAULT 0
        )`, () => resolve(db));
      });
    });
  });
}

// Подменяем require для database
let testDb;

async function setup() {
  testDb = await createTestDb();

  // Подменяем модуль database
  const dbPath = require.resolve('../config/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: testDb };

  // Подменяем formatters и airportResolver чтобы не тянуть зависимости
  const formattersPath = require.resolve('../utils/formatters');
  require.cache[formattersPath] = {
    id: formattersPath, filename: formattersPath, loaded: true,
    exports: {
      formatPrice: (p) => `${Math.round(p).toLocaleString('ru-RU')} ₽`,
      getAirlineName: () => null
    }
  };

  const airportPath = require.resolve('../utils/AirportCodeResolver');
  require.cache[airportPath] = {
    id: airportPath, filename: airportPath, loaded: true,
    exports: {
      load: async () => {},
      formatRoute: (o, d) => `${o} → ${d}`
    }
  };

  const NotificationService = require('../services/NotificationService');
  return new NotificationService({ sendMessage: async () => {} });
}

// === Вставка тестовых данных ===

function insertPriceAnalytics(routeId, prices) {
  return Promise.all(prices.map(price =>
    new Promise((resolve, reject) => {
      testDb.run(
        'INSERT INTO price_analytics (route_id, price) VALUES (?, ?)',
        [routeId, price],
        (err) => err ? reject(err) : resolve()
      );
    })
  ));
}

function insertTripResults(tripId, prices) {
  return Promise.all(prices.map(price =>
    new Promise((resolve, reject) => {
      testDb.run(
        'INSERT INTO trip_results (trip_id, total_price) VALUES (?, ?)',
        [tripId, price],
        (err) => err ? reject(err) : resolve()
      );
    })
  ));
}

function insertNotification(chatId, routeId, priority, price, hoursAgo, tripId = null) {
  const sentAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return new Promise((resolve, reject) => {
    testDb.run(
      `INSERT INTO notification_log (chat_id, route_id, trip_id, priority, price, message_type, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [chatId, routeId, tripId, priority, price, priority === 'CRITICAL' ? 'URGENT' : 'DAILY', sentAt],
      (err) => err ? reject(err) : resolve()
    );
  });
}

function clearNotificationLog() {
  return new Promise((resolve, reject) => {
    testDb.run('DELETE FROM notification_log', (err) => err ? reject(err) : resolve());
  });
}

// =============================================
// ТЕСТЫ
// =============================================

async function runTests() {
  const ns = await setup();

  // ========================================
  // ТЕСТ 1: classifyPriority — скоринг
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 ТЕСТ 1: classifyPriority — скоринг и приоритеты');
  console.log('='.repeat(60));

  // Вставляем данные для маршрута 1: средняя ~81000, мин 70000, std ~4800
  const routeId = 1;
  const prices = [
    75000, 78000, 80000, 82000, 83000, 84000, 85000, 79000, 81000, 77000,
    70000, 86000, 82000, 80000, 84000
  ];
  await insertPriceAnalytics(routeId, prices);

  // 1.1 Цена ниже бюджета + высокий скор → CRITICAL
  console.log('\n  --- Тест из спеки: цена 38,000, бюджет 40,000 ---');
  let result = await ns.classifyPriority({
    currentPrice: 38000,
    userBudget: 40000,
    historicalMin: 70000,
    routeId
  });
  assertEqual(result.priority, 'CRITICAL', 'Цена 38000 < бюджет 40000 → CRITICAL');
  assert(result.score >= 7, `Скор >= 7 (получено: ${result.score})`);

  // 1.2 Цена около минимума, выше бюджета → HIGH
  console.log('\n  --- Тест из спеки: цена 72,000, бюджет 40,000 ---');
  result = await ns.classifyPriority({
    currentPrice: 72000,
    userBudget: 40000,
    historicalMin: 70000,
    routeId
  });
  assertEqual(result.priority, 'HIGH', 'Цена 72000 около минимума 70000 → HIGH');
  assert(result.score >= 4, `Скор >= 4 (получено: ${result.score})`);

  // 1.3 Обычная цена → LOW
  console.log('\n  --- Тест из спеки: цена 80,000, бюджет 40,000 ---');
  result = await ns.classifyPriority({
    currentPrice: 85000,
    userBudget: 40000,
    historicalMin: 70000,
    routeId
  });
  assertEqual(result.priority, 'LOW', 'Цена 85000, обычная → LOW');
  assert(result.score < 4, `Скор < 4 (получено: ${result.score})`);

  // 1.4 Цена ниже бюджета, но скор < 7 → НЕ CRITICAL (а HIGH или LOW)
  console.log('\n  --- Цена чуть ниже бюджета, но обычная ---');
  result = await ns.classifyPriority({
    currentPrice: 85000,
    userBudget: 86000,
    historicalMin: 70000,
    routeId
  });
  assert(result.priority !== 'CRITICAL', `Цена 85000 < бюджет 86000, но скор ${result.score} < 7 → НЕ CRITICAL (${result.priority})`);

  // 1.5 Новый минимум + ниже бюджета → CRITICAL
  console.log('\n  --- Новый минимум + значительно ниже бюджета ---');
  result = await ns.classifyPriority({
    currentPrice: 60000,
    userBudget: 80000,
    historicalMin: 70000,
    routeId
  });
  assertEqual(result.priority, 'CRITICAL', 'Цена 60000 — новый минимум + ниже бюджета → CRITICAL');
  assert(result.score >= 7, `Скор >= 7 (получено: ${result.score})`);

  // 1.6 Без статистики (routeId без данных)
  console.log('\n  --- Без статистики ---');
  result = await ns.classifyPriority({
    currentPrice: 50000,
    userBudget: 80000,
    historicalMin: 60000,
    routeId: 999 // нет данных
  });
  assert(result.priority !== undefined, `Работает без статистики: ${result.priority} (скор: ${result.score})`);

  // 1.7 Без historicalMin
  console.log('\n  --- Без исторического минимума ---');
  result = await ns.classifyPriority({
    currentPrice: 50000,
    userBudget: 80000,
    historicalMin: null,
    routeId: 999
  });
  assert(result.score >= 0, `Работает без historicalMin: скор ${result.score}`);

  // ========================================
  // ТЕСТ 2: classifyPriority для трипов
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('🗺️  ТЕСТ 2: classifyPriority — трипы');
  console.log('='.repeat(60));

  const tripId = 10;
  const tripPrices = [
    120000, 125000, 130000, 128000, 122000, 135000, 127000, 131000, 126000, 129000,
    118000, 133000
  ];
  await insertTripResults(tripId, tripPrices);

  // 2.1 Трип: цена около минимума
  result = await ns.classifyPriority({
    currentPrice: 119000,
    userBudget: 100000,
    historicalMin: 118000,
    tripId
  });
  assertEqual(result.priority, 'HIGH', 'Трип: цена 119000 около минимума 118000 → HIGH');
  assert(result.score >= 4, `Скор >= 4 (получено: ${result.score})`);

  // 2.2 Трип: цена ниже бюджета + высокий скор
  result = await ns.classifyPriority({
    currentPrice: 95000,
    userBudget: 130000,
    historicalMin: 118000,
    tripId
  });
  assertEqual(result.priority, 'CRITICAL', 'Трип: цена 95000 < бюджет 130000, новый минимум → CRITICAL');

  // ========================================
  // ТЕСТ 3: _canSendNotification — CRITICAL
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('🔥 ТЕСТ 3: _canSendNotification — CRITICAL');
  console.log('='.repeat(60));

  await clearNotificationLog();

  // 3.1 Первое CRITICAL → разрешено
  let check = await ns._canSendNotification(100, 1, 'CRITICAL', 50000);
  assertEqual(check.canSend, true, 'Первое CRITICAL → разрешено');

  // 3.2 После CRITICAL < 6ч, цена не упала → запрещено
  await insertNotification(100, 1, 'CRITICAL', 50000, 2); // 2 часа назад
  check = await ns._canSendNotification(100, 1, 'CRITICAL', 50000);
  assertEqual(check.canSend, false, 'CRITICAL < 6ч, цена не упала → запрещено');

  // 3.3 После CRITICAL < 6ч, но цена упала → разрешено
  check = await ns._canSendNotification(100, 1, 'CRITICAL', 45000);
  assertEqual(check.canSend, true, 'CRITICAL < 6ч, цена упала → разрешено');

  // 3.4 После CRITICAL >= 6ч → разрешено
  await clearNotificationLog();
  await insertNotification(100, 1, 'CRITICAL', 50000, 7); // 7 часов назад
  check = await ns._canSendNotification(100, 1, 'CRITICAL', 50000);
  assertEqual(check.canSend, true, 'CRITICAL >= 6ч → разрешено');

  // ========================================
  // ТЕСТ 4: _canSendNotification — HIGH
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 ТЕСТ 4: _canSendNotification — HIGH');
  console.log('='.repeat(60));

  await clearNotificationLog();

  // 4.1 Первое HIGH → разрешено
  check = await ns._canSendNotification(100, 1, 'HIGH', 75000);
  assertEqual(check.canSend, true, 'Первое HIGH → разрешено');

  // 4.2 Второе HIGH < 8ч → запрещено
  await insertNotification(100, 1, 'HIGH', 75000, 3); // 3 часа назад
  check = await ns._canSendNotification(100, 1, 'HIGH', 74000);
  assertEqual(check.canSend, false, 'HIGH < 8ч → запрещено');

  // 4.3 Второе HIGH >= 8ч → разрешено
  await clearNotificationLog();
  await insertNotification(100, 1, 'HIGH', 75000, 9); // 9 часов назад
  check = await ns._canSendNotification(100, 1, 'HIGH', 74000);
  assertEqual(check.canSend, true, 'HIGH >= 8ч → разрешено (1/2)');

  // 4.4 Квота 2 HIGH/день исчерпана
  await clearNotificationLog();
  // Вставляем 2 HIGH за сегодня
  await insertNotification(100, 1, 'HIGH', 75000, 1);
  await insertNotification(100, 1, 'HIGH', 74000, 0.5);
  check = await ns._canSendNotification(100, 1, 'HIGH', 73000);
  assertEqual(check.canSend, false, 'Квота HIGH исчерпана (2/2) → запрещено');

  // ========================================
  // ТЕСТ 5: _canSendNotification — LOW
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ТЕСТ 5: _canSendNotification — LOW');
  console.log('='.repeat(60));

  await clearNotificationLog();

  // 5.1 Первое LOW → разрешено
  check = await ns._canSendNotification(100, 1, 'LOW', 80000);
  assertEqual(check.canSend, true, 'Первое LOW → разрешено');

  // 5.2 LOW < 6ч → запрещено
  await insertNotification(100, 1, 'LOW', 80000, 3);
  check = await ns._canSendNotification(100, 1, 'LOW', 80000);
  assertEqual(check.canSend, false, 'LOW < 6ч → запрещено');

  // 5.3 LOW >= 6ч, < 3 уведомлений → разрешено
  await clearNotificationLog();
  await insertNotification(100, 1, 'HIGH', 75000, 10);
  check = await ns._canSendNotification(100, 1, 'LOW', 80000);
  assertEqual(check.canSend, true, 'LOW >= 6ч, < 3 уведомлений → разрешено');

  // 5.4 Уже 3 уведомления за день → LOW запрещено
  await clearNotificationLog();
  await insertNotification(100, 1, 'HIGH', 75000, 2);
  await insertNotification(100, 1, 'HIGH', 74000, 1);
  await insertNotification(100, 1, 'LOW', 80000, 0.5);
  check = await ns._canSendNotification(100, 1, 'LOW', 80000);
  assertEqual(check.canSend, false, 'Уже 3 уведомления за день → LOW запрещено');

  // ========================================
  // ТЕСТ 6: _canSendNotification — трипы
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('🗺️  ТЕСТ 6: _canSendNotification — трипы (trip_id)');
  console.log('='.repeat(60));

  await clearNotificationLog();

  // 6.1 Первое для трипа → разрешено
  check = await ns._canSendNotification(100, null, 'HIGH', 120000, 10);
  assertEqual(check.canSend, true, 'Первое HIGH для трипа → разрешено');

  // 6.2 Трип: квота не пересекается с маршрутами
  await insertNotification(100, 1, 'HIGH', 75000, 1); // для маршрута 1
  check = await ns._canSendNotification(100, null, 'HIGH', 120000, 10);
  assertEqual(check.canSend, true, 'HIGH для трипа не зависит от маршрутных уведомлений');

  // ========================================
  // ТЕСТ 7: getRouteStatistics
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('📈 ТЕСТ 7: getRouteStatistics');
  console.log('='.repeat(60));

  const stats = await ns.getRouteStatistics(routeId);
  assert(stats.avgPrice > 0, `avgPrice > 0 (${Math.round(stats.avgPrice)})`);
  assert(stats.minPrice > 0, `minPrice > 0 (${stats.minPrice})`);
  assert(stats.stdPrice > 0, `stdPrice > 0 (${Math.round(stats.stdPrice)})`);
  assertEqual(stats.dataPoints, prices.length, `dataPoints = ${prices.length}`);

  // Проверяем корректность расчета
  const expectedAvg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const expectedMin = Math.min(...prices);
  const expectedVariance = prices.reduce((sum, p) => sum + (p - expectedAvg) ** 2, 0) / prices.length;
  const expectedStd = Math.sqrt(expectedVariance);

  assert(Math.abs(stats.avgPrice - expectedAvg) < 1, `avgPrice корректна (${Math.round(stats.avgPrice)} ≈ ${Math.round(expectedAvg)})`);
  assertEqual(stats.minPrice, expectedMin, `minPrice корректен (${expectedMin})`);
  assert(Math.abs(stats.stdPrice - expectedStd) < 1, `stdPrice корректен (${Math.round(stats.stdPrice)} ≈ ${Math.round(expectedStd)})`);

  // ========================================
  // ТЕСТ 8: getTripStatistics
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('📈 ТЕСТ 8: getTripStatistics');
  console.log('='.repeat(60));

  const tripStats = await ns.getTripStatistics(tripId);
  assert(tripStats.avgPrice > 0, `avgPrice > 0 (${Math.round(tripStats.avgPrice)})`);
  assert(tripStats.minPrice > 0, `minPrice > 0 (${tripStats.minPrice})`);
  assert(tripStats.stdPrice > 0, `stdPrice > 0 (${Math.round(tripStats.stdPrice)})`);
  assertEqual(tripStats.dataPoints, tripPrices.length, `dataPoints = ${tripPrices.length}`);

  const expectedTripMin = Math.min(...tripPrices);
  assertEqual(tripStats.minPrice, expectedTripMin, `minPrice корректен (${expectedTripMin})`);

  // Пустой трип
  const emptyStats = await ns.getTripStatistics(999);
  assertEqual(emptyStats.dataPoints, 0, 'Пустой трип: dataPoints = 0');
  assertEqual(emptyStats.avgPrice, null, 'Пустой трип: avgPrice = null');

  // ========================================
  // ТЕСТ 9: Сценарий из спеки — полный день
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log('📅 ТЕСТ 9: Сценарий из спеки — полный день SVX-SEL');
  console.log('='.repeat(60));

  await clearNotificationLog();

  // Бюджет 40000, минимум 70243, средняя ~81397, std ~4788
  const scenarioData = {
    userBudget: 40000,
    historicalMin: 70243,
    routeId: routeId // используем данные из тестовой БД
  };

  // 08:00 — цена 75179 → HIGH, первое → отправить
  result = await ns.classifyPriority({ ...scenarioData, currentPrice: 75179 });
  assert(result.priority === 'HIGH' || result.priority === 'CRITICAL', `08:00 75179₽ → ${result.priority} (скор: ${result.score})`);

  check = await ns._canSendNotification(200, 1, result.priority, 75179);
  assertEqual(check.canSend, true, '08:00 → отправить (первое)');
  if (check.canSend) await insertNotification(200, 1, result.priority, 75179, 0);

  // 12:00 — цена 78000 → < 8ч → пропустить
  result = await ns.classifyPriority({ ...scenarioData, currentPrice: 78000 });
  console.log(`  ℹ️  12:00 78000₽ → ${result.priority} (скор: ${result.score})`);
  // Подвигаем предыдущее на 4 часа назад
  await clearNotificationLog();
  await insertNotification(200, 1, 'HIGH', 75179, 4); // 4 часа назад
  check = await ns._canSendNotification(200, 1, 'HIGH', 78000);
  assertEqual(check.canSend, false, '12:00 → пропустить (< 8ч)');

  // 16:00 — цена 72000 → HIGH, прошло 8ч → отправить
  await clearNotificationLog();
  await insertNotification(200, 1, 'HIGH', 75179, 8); // 8 часов назад
  result = await ns.classifyPriority({ ...scenarioData, currentPrice: 72000 });
  assertEqual(result.priority, 'HIGH', '16:00 72000₽ → HIGH');
  check = await ns._canSendNotification(200, 1, 'HIGH', 72000);
  assertEqual(check.canSend, true, '16:00 → отправить (прошло 8ч, HIGH 2/2)');

  // ========================================
  // ИТОГИ
  // ========================================
  console.log('\n' + '='.repeat(60));
  console.log(`\n🏁 ИТОГО: ${passed} пройдено, ${failed} провалено\n`);

  testDb.close();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Критическая ошибка:', err);
  process.exit(1);
});
