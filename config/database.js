const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/bot.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Обычные маршруты
  db.run(`
      CREATE TABLE IF NOT EXISTS routes (
                                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                                            chat_id INTEGER NOT NULL,
                                            origin TEXT NOT NULL,
                                            destination TEXT NOT NULL,
                                            departure_date TEXT NOT NULL,
                                            return_date TEXT NOT NULL,
                                            adults INTEGER DEFAULT 1,
                                            children INTEGER DEFAULT 0,
                                            airline TEXT,
                                            baggage INTEGER DEFAULT 0,
                                            max_stops INTEGER DEFAULT 99,
                                            max_layover_hours INTEGER DEFAULT 5,
                                            threshold_price REAL NOT NULL,
                                            currency TEXT DEFAULT 'RUB',
                                            is_paused INTEGER DEFAULT 0,
                                            auto_delete INTEGER DEFAULT 1,
                                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                            last_check DATETIME
      )
  `);

  // Гибкие маршруты
  db.run(`
      CREATE TABLE IF NOT EXISTS flexible_routes (
                                                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                     chat_id INTEGER NOT NULL,
                                                     origin TEXT NOT NULL,
                                                     destination TEXT NOT NULL,
                                                     departure_start TEXT NOT NULL,
                                                     departure_end TEXT NOT NULL,
                                                     min_days INTEGER NOT NULL,
                                                     max_days INTEGER NOT NULL,
                                                     adults INTEGER DEFAULT 1,
                                                     children INTEGER DEFAULT 0,
                                                     airline TEXT,
                                                     baggage INTEGER DEFAULT 0,
                                                     max_stops INTEGER DEFAULT 99,
                                                     max_layover_hours INTEGER DEFAULT 5,
                                                     threshold_price REAL NOT NULL,
                                                     currency TEXT DEFAULT 'RUB',
                                                     is_paused INTEGER DEFAULT 0,
                                                     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                     last_check DATETIME
      )
  `);

  // Результаты гибкого поиска
  db.run(`
      CREATE TABLE IF NOT EXISTS flexible_results (
                                                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                      route_id INTEGER NOT NULL,
                                                      departure_date TEXT NOT NULL,
                                                      return_date TEXT NOT NULL,
                                                      days_in_country INTEGER NOT NULL,
                                                      total_price REAL NOT NULL,
                                                      airline TEXT NOT NULL,
                                                      search_link TEXT NOT NULL,
                                                      screenshot_path TEXT,
                                                      found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                      FOREIGN KEY (route_id) REFERENCES flexible_routes(id) ON DELETE CASCADE
          )
  `);

  // Аналитика цен с временными метками
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
                                                     chat_id INTEGER
      )
  `);

  // 🔥 МИГРАЦИЯ: Добавляем колонку route_id
  db.run(`ALTER TABLE price_analytics ADD COLUMN route_id INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Ошибка миграции price_analytics:', err.message);
    } else {
      console.log('✅ Миграция: добавлена колонка route_id в price_analytics');
    }
  });

  // 🔥 ИНДЕКС для быстрого поиска по route_id
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_route_id ON price_analytics(route_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_date ON price_analytics(found_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_route ON price_analytics(origin, destination, route_id)`);


  // История цен
  db.run(`
      CREATE TABLE IF NOT EXISTS price_history (
                                                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                   route_id INTEGER NOT NULL,
                                                   price REAL NOT NULL,
                                                   airline TEXT,
                                                   checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                   FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
          )
  `);

  // Топ-3 лучшие цены
  db.run(`
      CREATE TABLE IF NOT EXISTS best_prices (
                                                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                 route_id INTEGER NOT NULL,
                                                 price REAL NOT NULL,
                                                 airline TEXT NOT NULL,
                                                 search_link TEXT NOT NULL,
                                                 found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                 FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
          )
  `);

  // Настройки пользователей
  db.run(`
      CREATE TABLE IF NOT EXISTS user_settings (
                                                   chat_id INTEGER PRIMARY KEY,
                                                   notify_on_drop INTEGER DEFAULT 1,
                                                   notify_on_new_min INTEGER DEFAULT 1,
                                                   notify_on_check INTEGER DEFAULT 0,
                                                   quiet_hours_start INTEGER DEFAULT 23,
                                                   quiet_hours_end INTEGER DEFAULT 7,
                                                   check_frequency INTEGER DEFAULT 120,
                                                   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
  `);

  // Статистика пользователей
  db.run(`
      CREATE TABLE IF NOT EXISTS user_stats (
                                                chat_id INTEGER PRIMARY KEY,
                                                total_routes INTEGER DEFAULT 0,
                                                total_flexible INTEGER DEFAULT 0,
                                                total_alerts INTEGER DEFAULT 0,
                                                total_savings REAL DEFAULT 0,
                                                total_checks INTEGER DEFAULT 0,
                                                last_check DATETIME,
                                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
  `);

  // Cooldown уведомлений
  db.run(`
      CREATE TABLE IF NOT EXISTS notification_cooldown (
                                                           chat_id INTEGER PRIMARY KEY,
                                                           last_notification INTEGER NOT NULL
      )
  `);

  // Индексы для быстрой аналитики
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_date ON price_analytics(found_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_route ON price_analytics(origin, destination)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_time ON price_analytics(hour_of_day, day_of_week)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_price_analytics_chat ON price_analytics(chat_id)`);

  // 🔥 МИГРАЦИЯ: Добавляем колонку max_layover_hours в routes
  db.run(`ALTER TABLE routes ADD COLUMN max_layover_hours INTEGER DEFAULT 5`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Ошибка миграции routes:', err.message);
    }
  });

  // 🔥 МИГРАЦИЯ: Добавляем колонку max_layover_hours в flexible_routes
  db.run(`ALTER TABLE flexible_routes ADD COLUMN max_layover_hours INTEGER DEFAULT 5`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Ошибка миграции flexible_routes:', err.message);
    }
  });

  // 🔥 МИГРАЦИЯ: Добавляем колонку notify_on_check в user_settings
  db.run(`ALTER TABLE user_settings ADD COLUMN notify_on_check INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Ошибка миграции user_settings:', err.message);
    } else if (!err) {
      console.log('✅ Миграция: добавлена колонка notify_on_check');
    }
  });

  console.log('✅ База данных инициализирована');
});

module.exports = db;
