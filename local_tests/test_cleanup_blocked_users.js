/**
 * 🧪 Тесты очистки заблокированных пользователей
 *
 * Тестирует:
 * 1. _isUserBlockedError — распознавание ошибок блокировки
 * 2. Сбор заблокированных пользователей при отправке алертов
 * 3. cleanupBlockedUsers — архивация маршрутов/трипов и удаление из user_settings
 * 4. Интеграционный тест — полный цикл: отправка → ошибка → очистка
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

// === Создаём in-memory БД ===

function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run(`CREATE TABLE user_settings (
          id INTEGER PRIMARY KEY,
          chat_id INTEGER UNIQUE,
          timezone TEXT DEFAULT 'Asia/Yekaterinburg',
          notifications_enabled INTEGER DEFAULT 1
        )`);

        db.run(`CREATE TABLE unified_routes (
          id INTEGER PRIMARY KEY,
          chat_id INTEGER,
          origin TEXT,
          destination TEXT,
          threshold_price REAL,
          is_paused INTEGER DEFAULT 0,
          is_archived INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`);

        db.run(`CREATE TABLE trips (
          id INTEGER PRIMARY KEY,
          chat_id INTEGER,
          name TEXT,
          threshold_price REAL,
          is_archived INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`);

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

let testDb;

async function setup() {
  testDb = await createTestDb();

  // Подменяем модуль database
  const dbPath = require.resolve('../config/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: testDb };

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

  // Очищаем кэш NotificationService чтобы он подхватил наши моки
  const nsPath = require.resolve('../services/NotificationService');
  delete require.cache[nsPath];

  const NotificationService = require('../services/NotificationService');
  return NotificationService;
}

// === Вспомогательные функции для работы с тестовой БД ===

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function insertTestUser(chatId) {
  await dbRun('INSERT INTO user_settings (chat_id) VALUES (?)', [chatId]);
}

async function insertTestRoute(chatId, origin = 'MOW', destination = 'IST', archived = 0) {
  const result = await dbRun(
    'INSERT INTO unified_routes (chat_id, origin, destination, threshold_price, is_archived) VALUES (?, ?, ?, 50000, ?)',
    [chatId, origin, destination, archived]
  );
  return result.lastID;
}

async function insertTestTrip(chatId, name = 'Тестовый трип', archived = 0) {
  const result = await dbRun(
    'INSERT INTO trips (chat_id, name, threshold_price, is_archived) VALUES (?, ?, 100000, ?)',
    [chatId, name, archived]
  );
  return result.lastID;
}

// === ТЕСТЫ ===

async function runTests() {
  const NotificationService = await setup();

  // ============================================================
  console.log('\n📋 ТЕСТ 1: _isUserBlockedError — распознавание ошибок');
  // ============================================================
  {
    const ns = new NotificationService({ sendMessage: async () => {} });

    const err403 = new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
    assert(ns._isUserBlockedError(err403), '403 bot was blocked — распознаётся');

    const err400 = new Error('ETELEGRAM: 400 Bad Request: chat not found');
    assert(ns._isUserBlockedError(err400), '400 chat not found — распознаётся');

    const errOther = new Error('ETELEGRAM: 429 Too Many Requests');
    assert(!ns._isUserBlockedError(errOther), '429 Too Many Requests — НЕ блокировка');

    const errNetwork = new Error('ECONNREFUSED');
    assert(!ns._isUserBlockedError(errNetwork), 'ECONNREFUSED — НЕ блокировка');

    const errEmpty = new Error('');
    assert(!ns._isUserBlockedError(errEmpty), 'Пустая ошибка — НЕ блокировка');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 2: blockedUsers — сбор при отправке алертов');
  // ============================================================
  {
    const blockedBot = {
      sendMessage: async (chatId) => {
        if (chatId === 111) throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
        if (chatId === 222) throw new Error('ETELEGRAM: 400 Bad Request: chat not found');
        // chatId 333 — успешная отправка
      }
    };

    const ns = new NotificationService(blockedBot);

    assertEqual(ns.blockedUsers.size, 0, 'Изначально blockedUsers пуст');

    // Отправляем алерты
    await ns._sendInstantAlert(111, 1, { text: 'test', searchLink: null }, 'LOW', 1000, 'UTC', true);
    await ns._sendInstantAlert(222, 2, { text: 'test', searchLink: null }, 'LOW', 2000, 'UTC', true);
    await ns._sendInstantAlert(333, 3, { text: 'test', searchLink: null }, 'LOW', 3000, 'UTC', true);

    assertEqual(ns.blockedUsers.size, 2, 'blockedUsers содержит 2 пользователя');
    assert(ns.blockedUsers.has(111), 'Пользователь 111 (403) в blockedUsers');
    assert(ns.blockedUsers.has(222), 'Пользователь 222 (400) в blockedUsers');
    assert(!ns.blockedUsers.has(333), 'Пользователь 333 (успех) НЕ в blockedUsers');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 3: blockedUsers — сбор при отправке trip алертов');
  // ============================================================
  {
    const blockedBot = {
      sendMessage: async (chatId) => {
        if (chatId === 444) throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
      }
    };

    const ns = new NotificationService(blockedBot);

    await ns._sendTripAlert(444, 10, { text: 'test', legs: [] }, 'LOW', 5000, 'UTC', true);
    await ns._sendTripAlert(555, 11, { text: 'test', legs: [] }, 'LOW', 6000, 'UTC', true);

    assertEqual(ns.blockedUsers.size, 1, 'blockedUsers содержит 1 пользователя');
    assert(ns.blockedUsers.has(444), 'Пользователь 444 (403) в blockedUsers');
    assert(!ns.blockedUsers.has(555), 'Пользователь 555 (успех) НЕ в blockedUsers');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 4: Не добавляет при других ошибках (429, network)');
  // ============================================================
  {
    const rateLimitBot = {
      sendMessage: async () => {
        throw new Error('ETELEGRAM: 429 Too Many Requests: retry after 30');
      }
    };

    const ns = new NotificationService(rateLimitBot);

    await ns._sendInstantAlert(666, 1, { text: 'test', searchLink: null }, 'LOW', 1000, 'UTC', true);

    assertEqual(ns.blockedUsers.size, 0, '429 ошибка НЕ добавляет в blockedUsers');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 5: cleanupBlockedUsers — пустой список');
  // ============================================================
  {
    const ns = new NotificationService({ sendMessage: async () => {} });
    // Не должно упасть при пустом множестве
    await ns.cleanupBlockedUsers();
    assertEqual(ns.blockedUsers.size, 0, 'cleanupBlockedUsers работает с пустым списком');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 6: cleanupBlockedUsers — архивация маршрутов');
  // ============================================================
  {
    const chatId = 10001;
    await insertTestUser(chatId);
    const routeId1 = await insertTestRoute(chatId, 'MOW', 'IST');
    const routeId2 = await insertTestRoute(chatId, 'MOW', 'AYT');
    // Уже архивированный маршрут — не должен мешать
    await insertTestRoute(chatId, 'MOW', 'LED', 1);

    const ns = new NotificationService({ sendMessage: async () => {} });
    ns.blockedUsers.add(chatId);

    await ns.cleanupBlockedUsers();

    // Проверяем что маршруты архивированы
    const routes = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ?', [chatId]);
    const allArchived = routes.every(r => r.is_archived === 1);
    assert(allArchived, 'Все маршруты пользователя архивированы');
    assertEqual(routes.length, 3, 'Все 3 маршрута на месте (не удалены)');

    // Проверяем что user_settings удалён
    const user = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId]);
    assert(!user, 'Пользователь удалён из user_settings');

    // blockedUsers очищен
    assertEqual(ns.blockedUsers.size, 0, 'blockedUsers очищен после cleanup');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 7: cleanupBlockedUsers — архивация трипов');
  // ============================================================
  {
    const chatId = 10002;
    await insertTestUser(chatId);
    const tripId1 = await insertTestTrip(chatId, 'Путешествие 1');
    const tripId2 = await insertTestTrip(chatId, 'Путешествие 2');
    // Уже архивированный
    await insertTestTrip(chatId, 'Старый трип', 1);

    const ns = new NotificationService({ sendMessage: async () => {} });
    ns.blockedUsers.add(chatId);

    await ns.cleanupBlockedUsers();

    const trips = await dbAll('SELECT * FROM trips WHERE chat_id = ?', [chatId]);
    const allArchived = trips.every(t => t.is_archived === 1);
    assert(allArchived, 'Все трипы пользователя архивированы');
    assertEqual(trips.length, 3, 'Все 3 трипа на месте');

    const user = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId]);
    assert(!user, 'Пользователь удалён из user_settings');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 8: cleanupBlockedUsers — несколько пользователей');
  // ============================================================
  {
    const chatId1 = 10003;
    const chatId2 = 10004;
    const chatId3 = 10005; // этот НЕ заблокирован

    await insertTestUser(chatId1);
    await insertTestUser(chatId2);
    await insertTestUser(chatId3);
    await insertTestRoute(chatId1, 'MOW', 'IST');
    await insertTestRoute(chatId2, 'LED', 'AYT');
    await insertTestRoute(chatId3, 'MOW', 'LED');
    await insertTestTrip(chatId1, 'Трип 1');
    await insertTestTrip(chatId2, 'Трип 2');

    const ns = new NotificationService({ sendMessage: async () => {} });
    ns.blockedUsers.add(chatId1);
    ns.blockedUsers.add(chatId2);

    await ns.cleanupBlockedUsers();

    // Заблокированные — удалены и архивированы
    const user1 = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId1]);
    const user2 = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId2]);
    assert(!user1, 'Пользователь 1 удалён из user_settings');
    assert(!user2, 'Пользователь 2 удалён из user_settings');

    const routes1 = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ? AND is_archived = 0', [chatId1]);
    assertEqual(routes1.length, 0, 'У пользователя 1 нет активных маршрутов');

    const routes2 = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ? AND is_archived = 0', [chatId2]);
    assertEqual(routes2.length, 0, 'У пользователя 2 нет активных маршрутов');

    // Незаблокированный — нетронут
    const user3 = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId3]);
    assert(!!user3, 'Пользователь 3 НЕ удалён');

    const routes3 = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ? AND is_archived = 0', [chatId3]);
    assertEqual(routes3.length, 1, 'У пользователя 3 маршрут активен');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 9: cleanupBlockedUsers — пользователь без маршрутов');
  // ============================================================
  {
    const chatId = 10006;
    await insertTestUser(chatId);

    const ns = new NotificationService({ sendMessage: async () => {} });
    ns.blockedUsers.add(chatId);

    // Не должно упасть
    await ns.cleanupBlockedUsers();

    const user = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId]);
    assert(!user, 'Пользователь без маршрутов удалён из user_settings');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 10: Дедупликация — один chat_id при нескольких ошибках');
  // ============================================================
  {
    const blockedBot = {
      sendMessage: async () => {
        throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
      }
    };

    const ns = new NotificationService(blockedBot);

    // Несколько алертов одному пользователю — один chatId в blockedUsers
    await ns._sendInstantAlert(777, 1, { text: 'test', searchLink: null }, 'LOW', 1000, 'UTC', true);
    await ns._sendInstantAlert(777, 2, { text: 'test', searchLink: null }, 'HIGH', 2000, 'UTC', false);
    await ns._sendTripAlert(777, 10, { text: 'test', legs: [] }, 'LOW', 3000, 'UTC', true);

    assertEqual(ns.blockedUsers.size, 1, 'Один пользователь, несмотря на 3 ошибки');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 11 (интеграционный): Полный цикл отправки → ошибки → очистка');
  // ============================================================
  {
    const chatIdBlocked = 20001;
    const chatIdOk = 20002;

    await insertTestUser(chatIdBlocked);
    await insertTestUser(chatIdOk);
    const routeBlocked1 = await insertTestRoute(chatIdBlocked, 'MOW', 'IST');
    const routeBlocked2 = await insertTestRoute(chatIdBlocked, 'MOW', 'AYT');
    const tripBlocked = await insertTestTrip(chatIdBlocked, 'Трип заблокированного');
    const routeOk = await insertTestRoute(chatIdOk, 'LED', 'IST');
    const tripOk = await insertTestTrip(chatIdOk, 'Трип активного');

    const sentMessages = [];
    const mockBot = {
      sendMessage: async (chatId, text, opts) => {
        if (chatId === chatIdBlocked) {
          throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
        }
        sentMessages.push({ chatId, text });
      }
    };

    const ns = new NotificationService(mockBot);

    // Эмулируем отправку уведомлений как в scheduler
    await ns._sendInstantAlert(chatIdBlocked, routeBlocked1, { text: 'Цена', searchLink: null }, 'HIGH', 40000, 'UTC', false);
    await ns._sendInstantAlert(chatIdBlocked, routeBlocked2, { text: 'Цена', searchLink: null }, 'LOW', 60000, 'UTC', true);
    await ns._sendTripAlert(chatIdBlocked, tripBlocked, { text: 'Трип', legs: [] }, 'HIGH', 80000, 'UTC', false);
    await ns._sendInstantAlert(chatIdOk, routeOk, { text: 'Цена', searchLink: null }, 'HIGH', 30000, 'UTC', false);
    await ns._sendTripAlert(chatIdOk, tripOk, { text: 'Трип ОК', legs: [] }, 'LOW', 50000, 'UTC', true);

    // Проверяем состояние перед очисткой
    assertEqual(ns.blockedUsers.size, 1, 'Только заблокированный пользователь собран');
    assert(ns.blockedUsers.has(chatIdBlocked), 'Заблокированный пользователь в списке');
    assertEqual(sentMessages.length, 2, 'Активному пользователю отправлено 2 сообщения');

    // Запускаем очистку (как в scheduler после всех уведомлений)
    await ns.cleanupBlockedUsers();

    // Проверяем заблокированного
    const blockedUser = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatIdBlocked]);
    assert(!blockedUser, 'Заблокированный пользователь удалён из user_settings');

    const blockedRoutes = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ? AND is_archived = 0', [chatIdBlocked]);
    assertEqual(blockedRoutes.length, 0, 'Все маршруты заблокированного архивированы');

    const blockedTrips = await dbAll('SELECT * FROM trips WHERE chat_id = ? AND is_archived = 0', [chatIdBlocked]);
    assertEqual(blockedTrips.length, 0, 'Все трипы заблокированного архивированы');

    // Проверяем что активный пользователь нетронут
    const okUser = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatIdOk]);
    assert(!!okUser, 'Активный пользователь остался в user_settings');

    const okRoutes = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ? AND is_archived = 0', [chatIdOk]);
    assertEqual(okRoutes.length, 1, 'Маршруты активного пользователя не тронуты');

    const okTrips = await dbAll('SELECT * FROM trips WHERE chat_id = ? AND is_archived = 0', [chatIdOk]);
    assertEqual(okTrips.length, 1, 'Трипы активного пользователя не тронуты');

    // Повторный вызов cleanup — ничего не ломает
    await ns.cleanupBlockedUsers();
    assertEqual(ns.blockedUsers.size, 0, 'Повторный cleanup безопасен');
  }

  // ============================================================
  console.log('\n📋 ТЕСТ 12 (интеграционный): Смешанные ошибки — 403 и 400');
  // ============================================================
  {
    const chatId403 = 30001;
    const chatId400 = 30002;

    await insertTestUser(chatId403);
    await insertTestUser(chatId400);
    await insertTestRoute(chatId403, 'MOW', 'IST');
    await insertTestTrip(chatId400, 'Трип 400');

    const mockBot = {
      sendMessage: async (chatId) => {
        if (chatId === chatId403) throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
        if (chatId === chatId400) throw new Error('ETELEGRAM: 400 Bad Request: chat not found');
      }
    };

    const ns = new NotificationService(mockBot);

    await ns._sendInstantAlert(chatId403, 1, { text: 'test', searchLink: null }, 'HIGH', 10000, 'UTC', false);
    await ns._sendTripAlert(chatId400, 1, { text: 'test', legs: [] }, 'LOW', 20000, 'UTC', true);

    assertEqual(ns.blockedUsers.size, 2, 'Оба типа ошибок собраны');

    await ns.cleanupBlockedUsers();

    const user403 = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId403]);
    const user400 = await dbGet('SELECT * FROM user_settings WHERE chat_id = ?', [chatId400]);
    assert(!user403, 'Пользователь с 403 удалён');
    assert(!user400, 'Пользователь с 400 удалён');

    const routes403 = await dbAll('SELECT * FROM unified_routes WHERE chat_id = ? AND is_archived = 0', [chatId403]);
    assertEqual(routes403.length, 0, 'Маршруты пользователя 403 архивированы');

    const trips400 = await dbAll('SELECT * FROM trips WHERE chat_id = ? AND is_archived = 0', [chatId400]);
    assertEqual(trips400.length, 0, 'Трипы пользователя 400 архивированы');
  }

  // ============================================================
  // ИТОГИ
  // ============================================================
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Результаты: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  testDb.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
