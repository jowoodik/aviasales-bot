const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/bot.db');
const db = new sqlite3.Database(dbPath);

// КРИТИЧНО: защита от повреждений
db.run("PRAGMA journal_mode=WAL");     // Write-Ahead Logging
db.run("PRAGMA synchronous=NORMAL");   // Безопасная запись
db.run("PRAGMA busy_timeout=5000");    // Ждать 5 сек при блокировке
db.run("PRAGMA cache_size=10000");     // Больше кеша

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    console.log('БД закрыта корректно');
    process.exit(err ? 1 : 0);
  });
});

db.serialize(() => {
  console.log('🔄 Инициализация базы данных...');

  // ============================================
  // НОВАЯ ЕДИНАЯ ТАБЛИЦА МАРШРУТОВ
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS unified_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,

      -- Тип маршрута
      is_flexible INTEGER DEFAULT 0,
      has_return INTEGER DEFAULT 1,

      -- Для фиксированных маршрутов
      departure_date TEXT,
      return_date TEXT,

      -- Для гибких маршрутов
      departure_start TEXT,
      departure_end TEXT,
      min_days INTEGER,
      max_days INTEGER,

      -- Общие параметры
      adults INTEGER DEFAULT 1,
      children INTEGER DEFAULT 0,
      airline TEXT,
      baggage INTEGER DEFAULT 0,
      max_stops INTEGER,
      max_layover_hours INTEGER,
      threshold_price REAL NOT NULL,
      currency TEXT DEFAULT 'RUB',

      -- Служебные
      is_paused INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_check DATETIME
    )
  `);

  // ============================================
  // НОВАЯ ЕДИНАЯ ТАБЛИЦА РЕЗУЛЬТАТОВ
  // ============================================
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
      found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
    )
  `);

  // ============================================
  // 🔥 НОВАЯ ТАБЛИЦА: СТАТИСТИКА ПРОВЕРОК
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS route_check_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      check_timestamp DATETIME DEFAULT (datetime('now')),
      total_combinations INTEGER NOT NULL,
      successful_checks INTEGER NOT NULL,
      failed_checks INTEGER NOT NULL,
      FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
    )
  `);

  // ============================================
  // 🔥 НОВАЯ ТАБЛИЦА: ДЕТАЛЬНЫЕ РЕЗУЛЬТАТЫ КОМБИНАЦИЙ
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS combination_check_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      check_timestamp DATETIME DEFAULT (datetime('now')),
      departure_date TEXT NOT NULL,
      return_date TEXT,
      days_in_country INTEGER,
      status TEXT NOT NULL, -- 'success', 'not_found', 'error'
      price REAL,
      currency TEXT DEFAULT 'RUB',
      error_reason TEXT, -- причина ошибки если status='error'
      search_url TEXT,
      FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
    )
  `);

  // ============================================
  // АНАЛИТИКА ЦЕН (без изменений)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS price_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_type TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      price REAL NOT NULL,
      airline TEXT,
      found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      hour_of_day INTEGER,
      day_of_week INTEGER,
      day_of_month INTEGER,
      month INTEGER,
      year INTEGER,
      is_weekend INTEGER,
      season TEXT,
      chat_id INTEGER,
      route_id INTEGER
    )
  `);

  // ============================================
  // НАСТРОЙКИ ПОЛЬЗОВАТЕЛЕЙ (+ timezone, + notify_on_check)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      chat_id INTEGER PRIMARY KEY,
      quiet_hours_start INTEGER DEFAULT 23,
      quiet_hours_end INTEGER DEFAULT 7,
      timezone TEXT DEFAULT 'Asia/Yekaterinburg',
      notify_on_check INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================
  // СТАТИСТИКА ПОЛЬЗОВАТЕЛЕЙ
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS user_stats (
      chat_id INTEGER PRIMARY KEY,
      total_routes INTEGER DEFAULT 0,
      total_alerts INTEGER DEFAULT 0,
      total_savings REAL DEFAULT 0,
      total_checks INTEGER DEFAULT 0,
      last_check DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================
  // COOLDOWN УВЕДОМЛЕНИЙ
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS notification_cooldown (
      chat_id INTEGER PRIMARY KEY,
      last_notification INTEGER NOT NULL
    )
  `);

  // ============================================
  // ИНДЕКСЫ
  // ============================================
  db.run(`CREATE INDEX IF NOT EXISTS idx_unified_routes_chat_id ON unified_routes(chat_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_route_results_route_id ON route_results(route_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_route_results_price ON route_results(route_id, total_price)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_route_id ON price_analytics(route_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_date ON price_analytics(found_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_route ON price_analytics(origin, destination, route_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_time ON price_analytics(hour_of_day, day_of_week)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_chat ON price_analytics(chat_id)`);

  // 🔥 НОВЫЕ ИНДЕКСЫ ДЛЯ СТАТИСТИКИ ПРОВЕРОК
  db.run(`CREATE INDEX IF NOT EXISTS idx_route_check_stats_route_timestamp ON route_check_stats(route_id, check_timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_combination_check_route_timestamp ON combination_check_results(route_id, check_timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_combination_check_status ON combination_check_results(route_id, status)`);

  // ============================================
  // ТАБЛИЦА АЭРОПОРТОВ (обновленная структура)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS airports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iata_code TEXT NOT NULL,
      icao_code TEXT,

      -- Названия аэропортов
      airport_name TEXT NOT NULL,
      airport_name_en TEXT,
      airport_name_lower TEXT,

      -- Города
      city_code TEXT,
      city_name TEXT NOT NULL,
      city_name_en TEXT,
      city_name_lower TEXT,

      -- Страны
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      country_name_lower TEXT,

      -- Географические данные
      latitude REAL,
      longitude REAL,
      timezone TEXT,
      altitude INTEGER,

      -- Классификация
      airport_type TEXT,
      is_major INTEGER DEFAULT 0,
      is_popular INTEGER DEFAULT 0,
      is_international INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      region TEXT,

      -- Служебные
      source TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ============================================
  // ОПТИМИЗИРОВАННЫЕ ИНДЕКСЫ ДЛЯ ПОИСКА
  // ============================================
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_iata_code ON airports(iata_code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_city_name_lower ON airports(city_name_lower)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_airport_name_lower ON airports(airport_name_lower)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_country_name_lower ON airports(country_name_lower)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_is_popular ON airports(is_popular)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_is_international ON airports(is_international)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_country_code ON airports(country_code)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_airports_region ON airports(region)`);

  // ============================================
  // ТАБЛИЦА ТИПОВ ПОДПИСОК
  // ============================================
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
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

  // ============================================
  // ТАБЛИЦА ПОДПИСОК ПОЛЬЗОВАТЕЛЕЙ
  // ============================================
  db.run(`
  CREATE TABLE IF NOT EXISTS user_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL UNIQUE,
    subscription_type TEXT NOT NULL DEFAULT 'free',
    valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
    valid_to DATETIME,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES user_settings(chat_id)
  )
`);

  // ============================================
  // ВСТАВКА БАЗОВЫХ ТИПОВ ПОДПИСОК
  // ============================================
  db.run(`
  INSERT OR IGNORE INTO subscription_types 
    (name, display_name, max_fixed_routes, max_flexible_routes, max_combinations, check_interval_hours, price_per_month)
  VALUES 
    ('free', 'Бесплатная', 3, 1, 20, 4, 0),
    ('plus', 'Plus', 5, 3, 50, 2, 199),
    ('admin', 'Admin', 999, 999, 999, 1, 0)
`);

  // ИНДЕКСЫ
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_chat_id ON user_subscriptions(chat_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_valid_to ON user_subscriptions(valid_to)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_type ON user_subscriptions(subscription_type)`);

  // ============================================
  // ТАБЛИЦА ПЛАТЕЖЕЙ (Telegram Payments)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      payload TEXT NOT NULL UNIQUE,
      subscription_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'RUB',
      status TEXT DEFAULT 'pending',
      telegram_payment_charge_id TEXT,
      provider_payment_charge_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      pre_checkout_at DATETIME,
      completed_at DATETIME
    )
  `);

  // Индексы для таблицы payments
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_chat_id ON payments(chat_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_payload ON payments(payload)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`);

  // Миграции для ЮКасса API (прямая интеграция)
  db.run(`ALTER TABLE payments ADD COLUMN yookassa_payment_id TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления yookassa_payment_id:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка yookassa_payment_id в payments');
    }
  });

  db.run(`ALTER TABLE payments ADD COLUMN confirmation_url TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления confirmation_url:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка confirmation_url в payments');
    }
  });

  db.run(`ALTER TABLE payments ADD COLUMN webhook_received_at DATETIME`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления webhook_received_at:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка webhook_received_at в payments');
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_payments_yookassa_id ON payments(yookassa_payment_id)`);

  // Добавляем поле для отслеживания отправленных уведомлений
  db.run(`ALTER TABLE payments ADD COLUMN notification_sent INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления notification_sent:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка notification_sent в payments');
    }
  });

  console.log('✅ Таблица payments готова');

  // ============================================
// МАССОВАЯ РАССЫЛКА
// ============================================

// Таблица сообщений для рассылки
  db.run(`
  CREATE TABLE IF NOT EXISTS broadcast_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_text TEXT NOT NULL,
    target_users TEXT NOT NULL, -- 'all' или JSON массив chat_id
    scheduled_time TEXT NOT NULL, -- время в формате HH:MM (локальное время пользователя)
    is_sent INTEGER DEFAULT 0, -- 0 = в процессе, 1 = отправлено всем
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME
  )
`);

// Таблица логов отправленных сообщений
  db.run(`
  CREATE TABLE IF NOT EXISTS broadcast_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (broadcast_id) REFERENCES broadcast_messages(id) ON DELETE CASCADE,
    UNIQUE(broadcast_id, chat_id)
  )
`);

// Индексы для broadcast
  db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_messages_is_sent ON broadcast_messages(is_sent)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_log_broadcast_id ON broadcast_log(broadcast_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_broadcast_log_chat_id ON broadcast_log(chat_id)`);

  console.log('✅ Таблицы для массовой рассылки готовы');

  // ============================================
  // ТАБЛИЦА ЛОГОВ АКТИВНОСТИ ПОЛЬЗОВАТЕЛЕЙ
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS user_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  // Индексы для user_activity_log
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_chat_id ON user_activity_log(chat_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_event_type ON user_activity_log(event_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_created_at ON user_activity_log(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_chat_date ON user_activity_log(chat_id, created_at)`);

  console.log('✅ Таблица user_activity_log готова');

  // Добавляем timezone в user_settings (если её нет)
  db.run(`ALTER TABLE user_settings ADD COLUMN timezone TEXT DEFAULT 'Asia/Yekaterinburg'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления timezone:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка timezone в user_settings');
    }
  });

  // Добавляем notify_on_check в user_settings (если её нет)
  db.run(`ALTER TABLE user_settings ADD COLUMN notify_on_check INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления notify_on_check:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка notify_on_check в user_settings');
    }
  });

  // Добавляем status в broadcast_log (если её нет)
  db.run(`ALTER TABLE broadcast_log ADD COLUMN status TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления status:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка status в broadcast_log');
    }
  });

  // ============================================
  // ТАБЛИЦА ЛОГОВ УВЕДОМЛЕНИЙ
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      route_id INTEGER,
      priority TEXT NOT NULL,
      price REAL,
      message_type TEXT NOT NULL,
      sent_at DATETIME DEFAULT (datetime('now')),
      disable_notification INTEGER DEFAULT 0
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_notif_log_chat_priority ON notification_log(chat_id, priority, sent_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notif_log_route ON notification_log(route_id, priority, sent_at)`);

  // ============================================
  // ОЧЕРЕДЬ ДАЙДЖЕСТА
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_digest_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      route_id INTEGER NOT NULL,
      priority TEXT NOT NULL,
      price REAL NOT NULL,
      avg_price REAL,
      historical_min REAL,
      best_result_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now')),
      processed INTEGER DEFAULT 0
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_digest_queue_chat ON daily_digest_queue(chat_id, processed)`);

  // Новые колонки для уведомлений в user_settings
  db.run(`ALTER TABLE user_settings ADD COLUMN night_mode INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления night_mode:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка night_mode в user_settings');
    }
  });

  db.run(`ALTER TABLE user_settings ADD COLUMN notifications_enabled INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления notifications_enabled:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка notifications_enabled в user_settings');
      // Миграция старого значения notify_on_check
      db.run(`UPDATE user_settings SET notifications_enabled = notify_on_check, digest_enabled = notify_on_check WHERE notify_on_check = 1`, (err2) => {
        if (!err2) console.log('✅ Мигрированы значения notify_on_check');
      });
    }
  });

  db.run(`ALTER TABLE user_settings ADD COLUMN digest_enabled INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления digest_enabled:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка digest_enabled в user_settings');
    }
  });

  db.run(`ALTER TABLE unified_routes ADD COLUMN is_archived INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления is_archived:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка is_archived в unified_routes');
    }
  });

  console.log('✅ База данных инициализирована и мигрирована');
  console.log('🔥 Новые таблицы для статистики проверок готовы');
});

module.exports = db;