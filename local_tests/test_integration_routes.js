// Полноценные интеграционные тесты:
// 1. Создание фиксированного маршрута (туда-обратно)
// 2. Создание гибкого маршрута (диапазон дат)
// 3. Создание составного маршрута (трип)
//
// Используем in-memory SQLite + моки бота, сервисов

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const Module = require('module');

let db;
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
    console.log(`  ❌ ${testName} (ожидалось: ${JSON.stringify(expected)}, получено: ${JSON.stringify(actual)})`);
    failed++;
  }
}

// =============================================
// НАСТРОЙКА IN-MEMORY БД
// =============================================
function setupDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        // unified_routes
        db.run(`
          CREATE TABLE IF NOT EXISTS unified_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            origin TEXT NOT NULL,
            destination TEXT NOT NULL,
            is_flexible INTEGER DEFAULT 0,
            has_return INTEGER DEFAULT 1,
            departure_date TEXT,
            return_date TEXT,
            departure_start TEXT,
            departure_end TEXT,
            min_days INTEGER,
            max_days INTEGER,
            adults INTEGER DEFAULT 1,
            children INTEGER DEFAULT 0,
            airline TEXT,
            baggage INTEGER DEFAULT 0,
            max_stops INTEGER,
            max_layover_hours INTEGER,
            threshold_price REAL NOT NULL,
            currency TEXT DEFAULT 'RUB',
            is_paused INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_check DATETIME
          )
        `);

        // route_results
        db.run(`
          CREATE TABLE IF NOT EXISTS route_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER NOT NULL,
            departure_date TEXT NOT NULL,
            return_date TEXT,
            days_in_country INTEGER,
            total_price REAL NOT NULL,
            airline TEXT NOT NULL,
            search_link TEXT NOT NULL,
            screenshot_path TEXT,
            found_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // trips
        db.run(`
          CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            departure_start TEXT NOT NULL,
            departure_end TEXT NOT NULL,
            adults INTEGER DEFAULT 1,
            children INTEGER DEFAULT 0,
            airline TEXT,
            baggage INTEGER DEFAULT 0,
            max_stops INTEGER,
            max_layover_hours INTEGER,
            threshold_price REAL NOT NULL,
            currency TEXT DEFAULT 'RUB',
            is_paused INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            last_check TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `);

        // trip_legs
        db.run(`
          CREATE TABLE IF NOT EXISTS trip_legs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            leg_order INTEGER NOT NULL,
            origin TEXT NOT NULL,
            destination TEXT NOT NULL,
            min_days INTEGER,
            max_days INTEGER
          )
        `);

        // trip_results
        db.run(`
          CREATE TABLE IF NOT EXISTS trip_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            total_price REAL NOT NULL,
            found_at TEXT DEFAULT (datetime('now'))
          )
        `);

        db.run(`
          CREATE TABLE IF NOT EXISTS trip_leg_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_result_id INTEGER NOT NULL,
            leg_order INTEGER NOT NULL,
            departure_date TEXT NOT NULL,
            price REAL,
            airline TEXT,
            search_link TEXT
          )
        `);

        // subscription_types
        db.run(`
          CREATE TABLE IF NOT EXISTS subscription_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            max_fixed_routes INTEGER NOT NULL,
            max_flexible_routes INTEGER NOT NULL,
            max_combinations INTEGER NOT NULL,
            check_interval_hours INTEGER NOT NULL,
            price_per_month REAL DEFAULT 0,
            is_active INTEGER DEFAULT 1
          )
        `);

        db.run(`
          INSERT OR IGNORE INTO subscription_types
            (name, display_name, max_fixed_routes, max_flexible_routes, max_combinations, check_interval_hours)
          VALUES
            ('free', 'Free', 3, 1, 20, 4),
            ('admin', 'Admin', 999, 999, 999, 1)
        `);

        // user_subscriptions
        db.run(`
          CREATE TABLE IF NOT EXISTS user_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL UNIQUE,
            subscription_type TEXT NOT NULL DEFAULT 'admin',
            valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
            valid_to DATETIME,
            is_active INTEGER DEFAULT 1
          )
        `);

        // user_activity_log
        db.run(`
          CREATE TABLE IF NOT EXISTS user_activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT,
            created_at DATETIME DEFAULT (datetime('now'))
          )
        `);

        // price_analytics / direction stats
        db.run(`
          CREATE TABLE IF NOT EXISTS price_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_type TEXT, origin TEXT, destination TEXT, price REAL,
            airline TEXT, found_at DATETIME, hour_of_day INTEGER, day_of_week INTEGER,
            day_of_month INTEGER, month INTEGER, year INTEGER, is_weekend INTEGER,
            season TEXT, chat_id INTEGER, route_id INTEGER, trip_id INTEGER
          )
        `);

        // user_settings
        db.run(`
          CREATE TABLE IF NOT EXISTS user_settings (
            chat_id INTEGER PRIMARY KEY,
            quiet_hours_start INTEGER DEFAULT 23,
            quiet_hours_end INTEGER DEFAULT 7,
            timezone TEXT DEFAULT 'Asia/Yekaterinburg',
            notify_on_check INTEGER DEFAULT 0,
            night_mode INTEGER DEFAULT 1,
            notifications_enabled INTEGER DEFAULT 1,
            digest_enabled INTEGER DEFAULT 1
          )
        `);

        // route_check_stats
        db.run(`
          CREATE TABLE IF NOT EXISTS route_check_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER,
            check_timestamp DATETIME,
            total_combinations INTEGER,
            successful_checks INTEGER,
            failed_checks INTEGER,
            trip_id INTEGER
          )
        `);

        // combination_check_results
        db.run(`
          CREATE TABLE IF NOT EXISTS combination_check_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER,
            check_timestamp DATETIME,
            departure_date TEXT,
            return_date TEXT,
            days_in_country INTEGER,
            status TEXT,
            price REAL,
            currency TEXT DEFAULT 'RUB',
            error_reason TEXT,
            search_url TEXT
          )
        `);

        // notification_log
        db.run(`
          CREATE TABLE IF NOT EXISTS notification_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            route_id INTEGER,
            trip_id INTEGER,
            priority TEXT NOT NULL,
            price REAL,
            message_type TEXT NOT NULL,
            sent_at DATETIME DEFAULT (datetime('now')),
            disable_notification INTEGER DEFAULT 0
          )
        `);

        // airports (минимальная структура для AirportCodeResolver)
        db.run(`
          CREATE TABLE IF NOT EXISTS airports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            iata_code TEXT NOT NULL,
            airport_name TEXT NOT NULL,
            city_name TEXT NOT NULL,
            city_name_en TEXT,
            country_name TEXT NOT NULL,
            city_code TEXT,
            country_code TEXT,
            airport_name_lower TEXT,
            city_name_lower TEXT,
            country_name_lower TEXT,
            is_popular INTEGER DEFAULT 0,
            is_international INTEGER DEFAULT 0,
            is_major INTEGER DEFAULT 0,
            region TEXT,
            latitude REAL,
            longitude REAL,
            timezone TEXT,
            icao_code TEXT,
            altitude INTEGER,
            airport_type TEXT,
            display_order INTEGER DEFAULT 0,
            source TEXT,
            updated_at DATETIME,
            created_at DATETIME
          )
        `);

        // Добавляем тестовые аэропорты
        db.run(`INSERT INTO airports (iata_code, airport_name, city_name, city_name_en, country_name) VALUES ('SVX', 'Кольцово', 'Екатеринбург', 'Yekaterinburg', 'Россия')`);
        db.run(`INSERT INTO airports (iata_code, airport_name, city_name, city_name_en, country_name) VALUES ('IST', 'Istanbul', 'Стамбул', 'Istanbul', 'Турция')`);
        db.run(`INSERT INTO airports (iata_code, airport_name, city_name, city_name_en, country_name) VALUES ('AYT', 'Antalya', 'Анталья', 'Antalya', 'Турция')`);

        // Подписка для тестового пользователя (admin — без ограничений)
        db.run(`INSERT INTO user_subscriptions (chat_id, subscription_type) VALUES (12345, 'admin')`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });
}

// =============================================
// ПЕРЕХВАТ МОДУЛЕЙ
// =============================================
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent) {
  // Подменяем database
  if (request.endsWith('config/database') || request === '../config/database' || request === '../../config/database') {
    return '__inmemory_db__';
  }
  return originalResolve.apply(this, arguments);
};

require.cache['__inmemory_db__'] = {
  id: '__inmemory_db__',
  filename: '__inmemory_db__',
  loaded: true,
  get exports() { return db; }
};

// =============================================
// МОКИ
// =============================================

function createMockBot() {
  const messages = [];
  return {
    messages,
    sendMessage: async (chatId, text, opts) => {
      messages.push({ chatId, text, opts });
      return { message_id: messages.length };
    },
    deleteMessage: async () => {},
    lastMessage() { return messages[messages.length - 1]; },
    clearMessages() { messages.length = 0; }
  };
}

// =============================================
// ЗАПУСК ТЕСТОВ
// =============================================
async function runTests() {
  try {
    await setupDatabase();
    console.log('✅ In-memory БД создана\n');

    // Загружаем модули после создания БД
    const RouteHandlers = require('../handlers/routeHandlers');
    const TripHandlers = require('../handlers/tripHandlers');
    const UnifiedRoute = require('../models/UnifiedRoute');
    const Trip = require('../models/Trip');
    const TripLeg = require('../models/TripLeg');

    // ===================================================
    // ТЕСТ 1: ФИКСИРОВАННЫЙ МАРШРУТ (туда-обратно)
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 1: Создание фиксированного маршрута (туда-обратно)');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new RouteHandlers(bot, userStates);

      // Мок AirportService
      handler.airportService = {
        getPopularOriginAirports: async () => [
          { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия' }
        ],
        getPopularDestinationAirports: async () => [
          { iata_code: 'IST', city_name: 'Стамбул', airport_name: 'Istanbul', country_name: 'Турция' }
        ],
        getAirportByCode: async (code) => {
          const airports = {
            SVX: { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия', city_code: 'SVX' },
            IST: { iata_code: 'IST', city_name: 'Стамбул', airport_name: 'Istanbul', country_name: 'Турция', city_code: 'IST' }
          };
          return airports[code] || null;
        },
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      // Шаг 1: Начало создания
      await handler.handleCreateRoute(chatId);
      assert(userStates[chatId]?.step === 'origin', 'шаг = origin');

      // Шаг 2: Выбор аэропорта вылета
      bot.clearMessages();
      await handler.handleCreateStep(chatId, 'Екатеринбург [SVX]');
      assertEqual(userStates[chatId].routeData.origin, 'SVX', 'origin = SVX');
      assertEqual(userStates[chatId].step, 'destination', 'шаг = destination');

      // Шаг 3: Выбор аэропорта назначения
      bot.clearMessages();
      await handler.handleCreateStep(chatId, 'Стамбул [IST]');
      assertEqual(userStates[chatId].routeData.destination, 'IST', 'destination = IST');
      assertEqual(userStates[chatId].step, 'search_type', 'шаг = search_type');

      // Шаг 4: Тип поиска — конкретная дата
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '📅 Конкретная дата');
      assertEqual(userStates[chatId].routeData.is_flexible, false, 'is_flexible = false');
      assertEqual(userStates[chatId].step, 'has_return', 'шаг = has_return');

      // Шаг 5: Обратный билет — да
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '✅ Да, нужен обратный билет');
      assertEqual(userStates[chatId].routeData.has_return, true, 'has_return = true');
      assertEqual(userStates[chatId].step, 'departure_date', 'шаг = departure_date');

      // Шаг 6: Дата вылета
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '15.06.2027');
      assertEqual(userStates[chatId].routeData.departure_date, '2027-06-15', 'departure_date = 2027-06-15');
      assertEqual(userStates[chatId].step, 'return_date', 'шаг = return_date');

      // Шаг 7: Дата возврата
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '25.06.2027');
      assertEqual(userStates[chatId].routeData.return_date, '2027-06-25', 'return_date = 2027-06-25');
      assertEqual(userStates[chatId].step, 'airline', 'шаг = airline');

      // Шаг 8: Авиакомпания
      bot.clearMessages();
      await handler.handleCreateStep(chatId, 'S7 Airlines (S7)');
      assertEqual(userStates[chatId].routeData.airline, 'S7', 'airline = S7');
      assertEqual(userStates[chatId].step, 'adults', 'шаг = adults');

      // Шаг 9: Взрослые
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '2');
      assertEqual(userStates[chatId].routeData.adults, 2, 'adults = 2');
      assertEqual(userStates[chatId].step, 'children', 'шаг = children');

      // Шаг 10: Дети
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '1');
      assertEqual(userStates[chatId].routeData.children, 1, 'children = 1');
      assertEqual(userStates[chatId].step, 'baggage', 'шаг = baggage');

      // Шаг 11: Багаж
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '🧳 С багажом 20 кг');
      assertEqual(userStates[chatId].routeData.baggage, 1, 'baggage = 1');
      assertEqual(userStates[chatId].step, 'max_stops', 'шаг = max_stops');

      // Шаг 12: Пересадки — прямой
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '0 (прямой)');
      assertEqual(userStates[chatId].routeData.max_stops, 0, 'max_stops = 0');
      assertEqual(userStates[chatId].step, 'threshold', 'шаг = threshold');

      // Шаг 13: Бюджет
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '50000');
      assertEqual(userStates[chatId].routeData.threshold_price, 50000, 'threshold = 50000');
      assertEqual(userStates[chatId].step, 'confirm', 'шаг = confirm');

      // Шаг 14: Подтверждение
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '✅ Да, создать');

      // Проверяем что состояние очищено
      assertEqual(userStates[chatId], undefined, 'состояние очищено после создания');

      // Проверяем маршрут в БД
      const routes = await UnifiedRoute.findNonArchivedByChatId(chatId);
      assertEqual(routes.length, 1, 'маршрут создан в БД');

      const route = routes[0];
      assertEqual(route.origin, 'SVX', 'БД: origin = SVX');
      assertEqual(route.destination, 'IST', 'БД: destination = IST');
      assertEqual(route.is_flexible, 0, 'БД: is_flexible = 0');
      assertEqual(route.has_return, 1, 'БД: has_return = 1');
      assertEqual(route.departure_date, '2027-06-15', 'БД: departure_date');
      assertEqual(route.return_date, '2027-06-25', 'БД: return_date');
      assertEqual(route.adults, 2, 'БД: adults = 2');
      assertEqual(route.children, 1, 'БД: children = 1');
      assertEqual(route.airline, 'S7', 'БД: airline = S7');
      assertEqual(route.baggage, 1, 'БД: baggage = 1');
      assertEqual(route.max_stops, 0, 'БД: max_stops = 0');
      assertEqual(route.threshold_price, 50000, 'БД: threshold = 50000');
      assertEqual(route.is_paused, 0, 'БД: is_paused = 0');

      // Проверяем что бот отправил сообщение об успехе
      const lastMsg = bot.lastMessage();
      assert(lastMsg.text.includes('Маршрут успешно создан'), 'бот отправил сообщение об успехе');

      console.log('');
    }

    // ===================================================
    // ТЕСТ 2: ГИБКИЙ МАРШРУТ (диапазон дат, туда-обратно)
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 2: Создание гибкого маршрута (диапазон дат)');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new RouteHandlers(bot, userStates);

      handler.airportService = {
        getPopularOriginAirports: async () => [
          { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия' }
        ],
        getPopularDestinationAirports: async () => [
          { iata_code: 'AYT', city_name: 'Анталья', airport_name: 'Antalya', country_name: 'Турция' }
        ],
        getAirportByCode: async (code) => {
          const airports = {
            SVX: { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия', city_code: 'SVX' },
            AYT: { iata_code: 'AYT', city_name: 'Анталья', airport_name: 'Antalya', country_name: 'Турция', city_code: 'AYT' }
          };
          return airports[code] || null;
        },
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      // Шаг 1: origin
      await handler.handleCreateRoute(chatId);

      // Шаг 2: Выбор SVX
      await handler.handleCreateStep(chatId, 'Екатеринбург [SVX]');
      assertEqual(userStates[chatId].routeData.origin, 'SVX', 'origin = SVX');

      // Шаг 3: Выбор AYT
      await handler.handleCreateStep(chatId, 'Анталья [AYT]');
      assertEqual(userStates[chatId].routeData.destination, 'AYT', 'destination = AYT');

      // Шаг 4: Диапазон дат
      await handler.handleCreateStep(chatId, '📆 Диапазон дат');
      assertEqual(userStates[chatId].routeData.is_flexible, true, 'is_flexible = true');

      // Шаг 5: Обратный билет
      await handler.handleCreateStep(chatId, '✅ Да, нужен обратный билет');
      assertEqual(userStates[chatId].routeData.has_return, true, 'has_return = true');
      assertEqual(userStates[chatId].step, 'departure_start', 'шаг = departure_start');

      // Шаг 6: Начало диапазона
      await handler.handleCreateStep(chatId, '01.07.2027');
      assertEqual(userStates[chatId].routeData.departure_start, '2027-07-01', 'departure_start = 2027-07-01');
      assertEqual(userStates[chatId].step, 'departure_end', 'шаг = departure_end');

      // Шаг 7: Конец диапазона
      await handler.handleCreateStep(chatId, '05.07.2027');
      assertEqual(userStates[chatId].routeData.departure_end, '2027-07-05', 'departure_end = 2027-07-05');
      assertEqual(userStates[chatId].step, 'min_days', 'шаг = min_days');

      // Шаг 8: Мин. дней
      await handler.handleCreateStep(chatId, '7');
      assertEqual(userStates[chatId].routeData.min_days, 7, 'min_days = 7');
      assertEqual(userStates[chatId].step, 'max_days', 'шаг = max_days');

      // Шаг 9: Макс. дней
      await handler.handleCreateStep(chatId, '10');
      assertEqual(userStates[chatId].routeData.max_days, 10, 'max_days = 10');
      // Должно быть: 5 * 4 = 20 комбинаций (5 дней диапазона * 4 варианта дней)

      // Шаг 10: Авиакомпания
      assertEqual(userStates[chatId].step, 'airline', 'шаг = airline');
      await handler.handleCreateStep(chatId, '🌍 Любая');
      assertEqual(userStates[chatId].routeData.airline, null, 'airline = null');

      // Шаг 11: Взрослые
      await handler.handleCreateStep(chatId, '1');
      assertEqual(userStates[chatId].routeData.adults, 1, 'adults = 1');

      // Шаг 12: Дети
      await handler.handleCreateStep(chatId, '0 (без детей)');
      assertEqual(userStates[chatId].routeData.children, 0, 'children = 0');

      // Шаг 13: Багаж
      await handler.handleCreateStep(chatId, '🎒 Без багажа');
      assertEqual(userStates[chatId].routeData.baggage, 0, 'baggage = 0');

      // Шаг 14: Пересадки — 1
      await handler.handleCreateStep(chatId, '1 (до 1)');
      assertEqual(userStates[chatId].routeData.max_stops, 1, 'max_stops = 1');
      assertEqual(userStates[chatId].step, 'max_layover', 'шаг = max_layover');

      // Шаг 15: Время пересадки
      await handler.handleCreateStep(chatId, '10 ч');
      assertEqual(userStates[chatId].routeData.max_layover_hours, 10, 'max_layover = 10');
      assertEqual(userStates[chatId].step, 'threshold', 'шаг = threshold');

      // Шаг 16: Бюджет
      await handler.handleCreateStep(chatId, '35000');
      assertEqual(userStates[chatId].routeData.threshold_price, 35000, 'threshold = 35000');
      assertEqual(userStates[chatId].step, 'confirm', 'шаг = confirm');

      // Шаг 17: Подтверждение
      await handler.handleCreateStep(chatId, '✅ Да, создать');
      assertEqual(userStates[chatId], undefined, 'состояние очищено');

      // Проверяем в БД
      const routes = await UnifiedRoute.findNonArchivedByChatId(chatId);
      // Находим гибкий маршрут (второй по порядку)
      const flexRoute = routes.find(r => r.is_flexible === 1);
      assert(flexRoute !== undefined, 'гибкий маршрут создан в БД');

      assertEqual(flexRoute.origin, 'SVX', 'БД: origin = SVX');
      assertEqual(flexRoute.destination, 'AYT', 'БД: destination = AYT');
      assertEqual(flexRoute.is_flexible, 1, 'БД: is_flexible = 1');
      assertEqual(flexRoute.has_return, 1, 'БД: has_return = 1');
      assertEqual(flexRoute.departure_start, '2027-07-01', 'БД: departure_start');
      assertEqual(flexRoute.departure_end, '2027-07-05', 'БД: departure_end');
      assertEqual(flexRoute.min_days, 7, 'БД: min_days = 7');
      assertEqual(flexRoute.max_days, 10, 'БД: max_days = 10');
      assertEqual(flexRoute.adults, 1, 'БД: adults = 1');
      assertEqual(flexRoute.children, 0, 'БД: children = 0');
      assertEqual(flexRoute.airline, null, 'БД: airline = null');
      assertEqual(flexRoute.baggage, 0, 'БД: baggage = 0');
      assertEqual(flexRoute.max_stops, 1, 'БД: max_stops = 1');
      assertEqual(flexRoute.max_layover_hours, 10, 'БД: max_layover_hours = 10');
      assertEqual(flexRoute.threshold_price, 35000, 'БД: threshold = 35000');

      // Проверяем подсчёт комбинаций
      const combCount = UnifiedRoute.countCombinations(flexRoute);
      assertEqual(combCount, 20, 'комбинаций: 5 дней * 4 варианта = 20');

      console.log('');
    }

    // ===================================================
    // ТЕСТ 3: СОСТАВНОЙ МАРШРУТ (трип) — SVX → IST → AYT → SVX
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 3: Создание составного маршрута (трип)');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new TripHandlers(bot, userStates);

      handler.airportService = {
        getPopularOriginAirports: async () => [
          { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия' }
        ],
        getAirportByCode: async (code) => {
          const airports = {
            SVX: { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия' },
            IST: { iata_code: 'IST', city_name: 'Стамбул', airport_name: 'Istanbul', country_name: 'Турция' },
            AYT: { iata_code: 'AYT', city_name: 'Анталья', airport_name: 'Antalya', country_name: 'Турция' }
          };
          return airports[code] || null;
        },
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      // Шаг 1: Начало создания трипа
      await handler.handleCreateTrip(chatId);
      assertEqual(userStates[chatId].step, 'trip_origin', 'шаг = trip_origin');

      // Шаг 2: Город отправления SVX
      await handler.handleTripStep(chatId, 'Екатеринбург [SVX]');
      assertEqual(userStates[chatId].tripData.origin, 'SVX', 'origin = SVX');
      assertEqual(userStates[chatId].step, 'trip_next_city', 'шаг = trip_next_city');

      // Шаг 3: Первый промежуточный город IST
      await handler.handleTripStep(chatId, 'Стамбул [IST]');
      assertEqual(userStates[chatId]._tempDestination, 'IST', 'tempDestination = IST');
      assertEqual(userStates[chatId].step, 'trip_stay_min', 'шаг = trip_stay_min');

      // Шаг 4: Мин. дней в IST
      await handler.handleTripStep(chatId, '3');
      assertEqual(userStates[chatId]._tempMinDays, 3, 'tempMinDays = 3');
      assertEqual(userStates[chatId].step, 'trip_stay_max', 'шаг = trip_stay_max');

      // Шаг 5: Макс. дней в IST
      await handler.handleTripStep(chatId, '5');
      assertEqual(userStates[chatId].tripData.legs.length, 1, '1 нога добавлена');
      assertEqual(userStates[chatId].tripData.legs[0].origin, 'SVX', 'нога 1 origin = SVX');
      assertEqual(userStates[chatId].tripData.legs[0].destination, 'IST', 'нога 1 dest = IST');
      assertEqual(userStates[chatId].tripData.legs[0].min_days, 3, 'нога 1 min_days = 3');
      assertEqual(userStates[chatId].tripData.legs[0].max_days, 5, 'нога 1 max_days = 5');
      assertEqual(userStates[chatId].step, 'trip_add_more', 'шаг = trip_add_more');

      // Шаг 6: Добавить ещё город
      await handler.handleTripStep(chatId, '➕ Добавить ещё город');
      assertEqual(userStates[chatId].step, 'trip_next_city', 'шаг = trip_next_city');

      // Шаг 7: Второй промежуточный город AYT
      await handler.handleTripStep(chatId, 'Анталья [AYT]');
      assertEqual(userStates[chatId]._tempDestination, 'AYT', 'tempDestination = AYT');

      // Шаг 8: Мин. дней в AYT
      await handler.handleTripStep(chatId, '2');

      // Шаг 9: Макс. дней в AYT
      await handler.handleTripStep(chatId, '4');
      assertEqual(userStates[chatId].tripData.legs.length, 2, '2 ноги добавлены');
      assertEqual(userStates[chatId].tripData.legs[1].origin, 'IST', 'нога 2 origin = IST');
      assertEqual(userStates[chatId].tripData.legs[1].destination, 'AYT', 'нога 2 dest = AYT');
      assertEqual(userStates[chatId].tripData.legs[1].min_days, 2, 'нога 2 min_days = 2');
      assertEqual(userStates[chatId].tripData.legs[1].max_days, 4, 'нога 2 max_days = 4');

      // Шаг 10: Вернуться в Екатеринбург
      await handler.handleTripStep(chatId, '🏠 Вернуться в Екатеринбург');
      assertEqual(userStates[chatId].tripData.legs.length, 3, '3 ноги (с обратной)');
      assertEqual(userStates[chatId].tripData.legs[2].origin, 'AYT', 'нога 3 origin = AYT');
      assertEqual(userStates[chatId].tripData.legs[2].destination, 'SVX', 'нога 3 dest = SVX');
      assertEqual(userStates[chatId].tripData.legs[2].min_days, null, 'нога 3 min_days = null');
      assertEqual(userStates[chatId].step, 'trip_departure_start', 'шаг = trip_departure_start');

      // Шаг 11: Начало диапазона вылета
      await handler.handleTripStep(chatId, '01.08.2027');
      assertEqual(userStates[chatId].tripData.departure_start, '2027-08-01', 'departure_start');
      assertEqual(userStates[chatId].step, 'trip_departure_end', 'шаг = trip_departure_end');

      // Шаг 12: Конец диапазона вылета
      await handler.handleTripStep(chatId, '05.08.2027');
      assertEqual(userStates[chatId].tripData.departure_end, '2027-08-05', 'departure_end');
      assertEqual(userStates[chatId].step, 'trip_airline', 'шаг = trip_airline');

      // Шаг 13: Авиакомпания
      await handler.handleTripStep(chatId, 'Любая авиакомпания');
      assertEqual(userStates[chatId].tripData.airline, null, 'airline = null');

      // Шаг 14: Взрослые
      await handler.handleTripStep(chatId, '2');
      assertEqual(userStates[chatId].tripData.adults, 2, 'adults = 2');

      // Шаг 15: Дети
      await handler.handleTripStep(chatId, '0');
      assertEqual(userStates[chatId].tripData.children, 0, 'children = 0');

      // Шаг 16: Багаж
      await handler.handleTripStep(chatId, '🧳 С багажом');
      assertEqual(userStates[chatId].tripData.baggage, 1, 'baggage = 1');

      // Шаг 17: Пересадки
      await handler.handleTripStep(chatId, '🔄 Любое количество');
      assertEqual(userStates[chatId].tripData.max_stops, null, 'max_stops = null');
      assertEqual(userStates[chatId].step, 'trip_threshold', 'шаг = trip_threshold');

      // Шаг 18: Бюджет
      await handler.handleTripStep(chatId, '100000');
      assertEqual(userStates[chatId].tripData.threshold_price, 100000, 'threshold = 100000');
      assertEqual(userStates[chatId].step, 'trip_confirm', 'шаг = trip_confirm');

      // Шаг 19: Подтверждение
      bot.clearMessages();
      await handler.handleTripStep(chatId, '✅ Подтвердить');
      assertEqual(userStates[chatId], undefined, 'состояние очищено после создания');

      // Проверяем что бот отправил сообщение об успехе
      const lastMsg = bot.lastMessage();
      assert(lastMsg.text.includes('Составной маршрут создан'), 'бот подтвердил создание трипа');

      // Проверяем трип в БД
      const trips = await Trip.getActiveByChatId(chatId);
      assert(trips.length >= 1, 'трип создан в БД');

      const trip = trips[0];
      assertEqual(trip.name, 'SVX → IST → AYT → SVX', 'БД: name = SVX → IST → AYT → SVX');
      assertEqual(trip.departure_start, '2027-08-01', 'БД: departure_start');
      assertEqual(trip.departure_end, '2027-08-05', 'БД: departure_end');
      assertEqual(trip.adults, 2, 'БД: adults = 2');
      assertEqual(trip.children, 0, 'БД: children = 0');
      assertEqual(trip.airline, null, 'БД: airline = null');
      assertEqual(trip.baggage, 1, 'БД: baggage = 1');
      assertEqual(trip.max_stops, null, 'БД: max_stops = null');
      assertEqual(trip.threshold_price, 100000, 'БД: threshold = 100000');

      // Проверяем ноги трипа в БД
      const legs = await TripLeg.getByTripId(trip.id);
      assertEqual(legs.length, 3, 'БД: 3 ноги');

      assertEqual(legs[0].leg_order, 1, 'нога 1: leg_order = 1');
      assertEqual(legs[0].origin, 'SVX', 'нога 1: origin = SVX');
      assertEqual(legs[0].destination, 'IST', 'нога 1: destination = IST');
      assertEqual(legs[0].min_days, 3, 'нога 1: min_days = 3');
      assertEqual(legs[0].max_days, 5, 'нога 1: max_days = 5');

      assertEqual(legs[1].leg_order, 2, 'нога 2: leg_order = 2');
      assertEqual(legs[1].origin, 'IST', 'нога 2: origin = IST');
      assertEqual(legs[1].destination, 'AYT', 'нога 2: destination = AYT');
      assertEqual(legs[1].min_days, 2, 'нога 2: min_days = 2');
      assertEqual(legs[1].max_days, 4, 'нога 2: max_days = 4');

      assertEqual(legs[2].leg_order, 3, 'нога 3: leg_order = 3');
      assertEqual(legs[2].origin, 'AYT', 'нога 3: origin = AYT');
      assertEqual(legs[2].destination, 'SVX', 'нога 3: destination = SVX');
      assertEqual(legs[2].min_days, null, 'нога 3: min_days = null (обратная)');
      assertEqual(legs[2].max_days, null, 'нога 3: max_days = null (обратная)');

      // Проверяем подсчёт API-вызовов
      const TripOptimizer = require('../services/TripOptimizer');
      const apiCalls = TripOptimizer.countApiCalls(trip, legs);
      assert(apiCalls > 0, `API-вызовов: ${apiCalls} (> 0)`);

      console.log('');
    }

    // ===================================================
    // ТЕСТ 4: ОТМЕНА СОЗДАНИЯ МАРШРУТА
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 4: Отмена создания на разных этапах');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new RouteHandlers(bot, userStates);
      handler.airportService = {
        getPopularOriginAirports: async () => [],
        getAirportByCode: async () => null,
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      // Отмена на шаге origin
      await handler.handleCreateRoute(chatId);
      assert(userStates[chatId] !== undefined, 'состояние создано');
      await handler.handleCreateStep(chatId, '🔙 Отмена');
      assertEqual(userStates[chatId], undefined, 'отмена на origin: состояние очищено');
      assert(bot.lastMessage().text.includes('отменено'), 'сообщение об отмене');

      console.log('');
    }

    // ===================================================
    // ТЕСТ 5: ОТМЕНА ТРИПА
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 5: Отмена создания трипа');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new TripHandlers(bot, userStates);
      handler.airportService = {
        getPopularOriginAirports: async () => [],
        getAirportByCode: async (code) => {
          if (code === 'SVX') return { iata_code: 'SVX', city_name: 'Екатеринбург' };
          if (code === 'IST') return { iata_code: 'IST', city_name: 'Стамбул' };
          return null;
        },
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      // Начинаем трип, проходим несколько шагов, потом отменяем
      await handler.handleCreateTrip(chatId);
      await handler.handleTripStep(chatId, 'Екатеринбург [SVX]');
      await handler.handleTripStep(chatId, 'Стамбул [IST]');
      assertEqual(userStates[chatId].step, 'trip_stay_min', 'шаг = trip_stay_min');

      // Отмена посреди процесса
      await handler.handleTripStep(chatId, '❌ Отмена');
      assertEqual(userStates[chatId], undefined, 'отмена трипа: состояние очищено');
      assert(bot.lastMessage().text.includes('отменено'), 'сообщение об отмене');

      console.log('');
    }

    // ===================================================
    // ТЕСТ 6: ВАЛИДАЦИЯ ДАТА (дата в прошлом, неверный формат)
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 6: Валидация ввода');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new RouteHandlers(bot, userStates);
      handler.airportService = {
        getPopularOriginAirports: async () => [],
        getPopularDestinationAirports: async () => [],
        getAirportByCode: async (code) => {
          if (code === 'SVX') return { iata_code: 'SVX', city_name: 'Екатеринбург', airport_name: 'Кольцово', country_name: 'Россия', city_code: 'SVX' };
          if (code === 'IST') return { iata_code: 'IST', city_name: 'Стамбул', airport_name: 'Istanbul', country_name: 'Турция', city_code: 'IST' };
          return null;
        },
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      await handler.handleCreateRoute(chatId);
      await handler.handleCreateStep(chatId, 'Екатеринбург [SVX]');
      await handler.handleCreateStep(chatId, 'Стамбул [IST]');
      await handler.handleCreateStep(chatId, '📅 Конкретная дата');
      await handler.handleCreateStep(chatId, '✅ Да, нужен обратный билет');

      // Неверный формат даты
      bot.clearMessages();
      await handler.handleCreateStep(chatId, 'невалидная-дата');
      assert(bot.lastMessage().text.includes('Неверный формат'), 'ошибка формата даты');
      assertEqual(userStates[chatId].step, 'departure_date', 'остаёмся на шаге departure_date');

      // Дата в прошлом
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '01.01.2020');
      assert(bot.lastMessage().text.includes('прошлом'), 'ошибка: дата в прошлом');
      assertEqual(userStates[chatId].step, 'departure_date', 'остаёмся на шаге departure_date');

      // Корректная дата
      await handler.handleCreateStep(chatId, '10.10.2027');
      assertEqual(userStates[chatId].step, 'return_date', 'переходим к return_date');

      // Дата возврата раньше вылета
      bot.clearMessages();
      await handler.handleCreateStep(chatId, '05.10.2027');
      assert(bot.lastMessage().text.includes('позже'), 'ошибка: возврат раньше вылета');
      assertEqual(userStates[chatId].step, 'return_date', 'остаёмся на return_date');

      // Невалидное число взрослых
      await handler.handleCreateStep(chatId, '20.10.2027'); // valid return
      assertEqual(userStates[chatId].step, 'airline', 'шаг = airline');
      await handler.handleCreateStep(chatId, '🌍 Любая');

      bot.clearMessages();
      await handler.handleCreateStep(chatId, '0'); // 0 взрослых — невалидно
      assert(bot.lastMessage().text.includes('от 1 до 9'), 'ошибка: 0 взрослых');
      assertEqual(userStates[chatId].step, 'adults', 'остаёмся на adults');

      console.log('');
    }

    // ===================================================
    // ТЕСТ 7: ТРИП "ЗАКОНЧИТЬ ЗДЕСЬ" (без возврата)
    // ===================================================
    console.log('=' .repeat(60));
    console.log('📋 ТЕСТ 7: Составной маршрут без возврата ("Закончить здесь")');
    console.log('=' .repeat(60));
    {
      const bot = createMockBot();
      const userStates = {};
      const handler = new TripHandlers(bot, userStates);
      handler.airportService = {
        getPopularOriginAirports: async () => [],
        getAirportByCode: async (code) => {
          const airports = {
            SVX: { iata_code: 'SVX', city_name: 'Екатеринбург' },
            IST: { iata_code: 'IST', city_name: 'Стамбул' }
          };
          return airports[code] || null;
        },
        searchAirportsEnhanced: async () => []
      };

      const chatId = 12345;

      await handler.handleCreateTrip(chatId);
      await handler.handleTripStep(chatId, 'Екатеринбург [SVX]');
      await handler.handleTripStep(chatId, 'Стамбул [IST]');
      await handler.handleTripStep(chatId, '3'); // min days
      await handler.handleTripStep(chatId, '5'); // max days
      assertEqual(userStates[chatId].tripData.legs.length, 1, '1 нога');

      // Закончить здесь (без обратного билета)
      await handler.handleTripStep(chatId, '✅ Закончить здесь');
      assertEqual(userStates[chatId].tripData.legs.length, 1, 'всё ещё 1 нога (без обратной)');
      assertEqual(userStates[chatId].step, 'trip_departure_start', 'шаг = trip_departure_start');

      // Продолжаем до подтверждения
      await handler.handleTripStep(chatId, '01.09.2027');
      await handler.handleTripStep(chatId, '03.09.2027');
      await handler.handleTripStep(chatId, 'Любая авиакомпания');
      await handler.handleTripStep(chatId, '1');
      await handler.handleTripStep(chatId, '0');
      await handler.handleTripStep(chatId, '🎒 Без багажа');
      await handler.handleTripStep(chatId, '✈️ Только прямые');
      await handler.handleTripStep(chatId, '40000');
      await handler.handleTripStep(chatId, '✅ Подтвердить');

      assertEqual(userStates[chatId], undefined, 'состояние очищено');

      const trips = await Trip.getAllActive();
      const onewayTrip = trips.find(t => t.name === 'SVX → IST');
      assert(onewayTrip !== undefined, 'трип без возврата создан');
      assertEqual(onewayTrip.threshold_price, 40000, 'threshold = 40000');
      assertEqual(onewayTrip.max_stops, 0, 'max_stops = 0 (прямые)');
      assertEqual(onewayTrip.baggage, 0, 'baggage = 0');

      const legs = await TripLeg.getByTripId(onewayTrip.id);
      assertEqual(legs.length, 1, '1 нога (без обратной)');
      assertEqual(legs[0].origin, 'SVX', 'нога origin = SVX');
      assertEqual(legs[0].destination, 'IST', 'нога dest = IST');

      console.log('');
    }

  } catch (error) {
    console.error('\n💥 КРИТИЧЕСКАЯ ОШИБКА:', error);
    failed++;
  } finally {
    if (db) db.close();
    Module._resolveFilename = originalResolve;
    delete require.cache['__inmemory_db__'];

    console.log('=' .repeat(60));
    console.log(`📊 ИТОГО: ${passed} пройдено, ${failed} провалено из ${passed + failed}`);
    if (failed === 0) {
      console.log('🎉 Все интеграционные тесты пройдены!');
    } else {
      console.log('⚠️  Есть проваленные тесты!');
      process.exit(1);
    }
  }
}

runTests();
