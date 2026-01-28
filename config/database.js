const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/bot.db');
const db = new sqlite3.Database(dbPath);

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
  // ИСТОРИЯ ЦЕН (обновлена для unified_routes)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      price REAL NOT NULL,
      airline TEXT,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
    )
  `);

  // ============================================
  // НАСТРОЙКИ ПОЛЬЗОВАТЕЛЕЙ (+ timezone)
  // ============================================
  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      chat_id INTEGER PRIMARY KEY,
      quiet_hours_start INTEGER DEFAULT 23,
      quiet_hours_end INTEGER DEFAULT 7,
      timezone TEXT DEFAULT 'Asia/Yekaterinburg',
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

  // ============================================
  // МИГРАЦИЯ ДАННЫХ ИЗ СТАРЫХ ТАБЛИЦ
  // ============================================

  // Проверяем наличие старой таблицы routes
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='routes'`, (err, row) => {
    if (row) {
      console.log('🔄 Миграция: копирую routes → unified_routes...');
      db.run(`
        INSERT INTO unified_routes 
        (chat_id, origin, destination, is_flexible, has_return, 
         departure_date, return_date, adults, children, airline, baggage, 
         max_stops, max_layover_hours, threshold_price, currency, is_paused, created_at, last_check)
        SELECT 
          chat_id, origin, destination, 0, 1, 
          departure_date, return_date, adults, children, airline, baggage, 
          max_stops, max_layover_hours, threshold_price, currency, is_paused, created_at, last_check
        FROM routes
      `, (err) => {
        if (err) {
          console.error('❌ Ошибка миграции routes:', err.message);
        } else {
          console.log('✅ Миграция routes завершена');

          // Удаляем старую таблицу
          db.run(`DROP TABLE routes`, (err) => {
            if (err) {
              console.error('❌ Ошибка удаления routes:', err.message);
            } else {
              console.log('🗑️ Старая таблица routes удалена');
            }
          });
        }
      });
    }
  });

  // Проверяем наличие старой таблицы flexible_routes
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='flexible_routes'`, (err, row) => {
    if (row) {
      console.log('🔄 Миграция: копирую flexible_routes → unified_routes...');
      db.run(`
        INSERT INTO unified_routes 
        (chat_id, origin, destination, is_flexible, has_return, 
         departure_start, departure_end, min_days, max_days,
         adults, children, airline, baggage, 
         max_stops, max_layover_hours, threshold_price, currency, is_paused, created_at, last_check)
        SELECT 
          chat_id, origin, destination, 1, 1, 
          departure_start, departure_end, min_days, max_days,
          adults, children, airline, baggage, 
          max_stops, max_layover_hours, threshold_price, currency, is_paused, created_at, last_check
        FROM flexible_routes
      `, (err) => {
        if (err) {
          console.error('❌ Ошибка миграции flexible_routes:', err.message);
        } else {
          console.log('✅ Миграция flexible_routes завершена');

          // Удаляем старую таблицу
          db.run(`DROP TABLE flexible_routes`, (err) => {
            if (err) {
              console.error('❌ Ошибка удаления flexible_routes:', err.message);
            } else {
              console.log('🗑️ Старая таблица flexible_routes удалена');
            }
          });
        }
      });
    }
  });

  // Проверяем наличие старой таблицы best_prices
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='best_prices'`, (err, row) => {
    if (row) {
      console.log('🔄 Миграция: копирую best_prices → route_results...');
      db.run(`
        INSERT INTO route_results 
        (route_id, departure_date, return_date, total_price, airline, search_link, found_at)
        SELECT 
          route_id, 
          (SELECT departure_date FROM routes WHERE id = route_id),
          (SELECT return_date FROM routes WHERE id = route_id),
          price, airline, search_link, found_at
        FROM best_prices
      `, (err) => {
        if (err) {
          console.error('❌ Ошибка миграции best_prices:', err.message);
        } else {
          console.log('✅ Миграция best_prices завершена');

          // Удаляем старую таблицу
          db.run(`DROP TABLE best_prices`, (err) => {
            if (err) {
              console.error('❌ Ошибка удаления best_prices:', err.message);
            } else {
              console.log('🗑️ Старая таблица best_prices удалена');
            }
          });
        }
      });
    }
  });

  // Проверяем наличие старой таблицы flexible_results
  db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='flexible_results'`, (err, row) => {
    if (row) {
      console.log('🔄 Миграция: копирую flexible_results → route_results...');
      db.run(`
        INSERT INTO route_results 
        (route_id, departure_date, return_date, days_in_country, total_price, airline, search_link, screenshot_path, found_at)
        SELECT 
          route_id, departure_date, return_date, days_in_country, 
          total_price, airline, search_link, screenshot_path, found_at
        FROM flexible_results
      `, (err) => {
        if (err) {
          console.error('❌ Ошибка миграции flexible_results:', err.message);
        } else {
          console.log('✅ Миграция flexible_results завершена');

          // Удаляем старую таблицу
          db.run(`DROP TABLE flexible_results`, (err) => {
            if (err) {
              console.error('❌ Ошибка удаления flexible_results:', err.message);
            } else {
              console.log('🗑️ Старая таблица flexible_results удалена');
            }
          });
        }
      });
    }
  });

  // Добавляем timezone в user_settings (если её нет)
  db.run(`ALTER TABLE user_settings ADD COLUMN timezone TEXT DEFAULT 'Asia/Yekaterinburg'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Ошибка добавления timezone:', err.message);
    } else if (!err) {
      console.log('✅ Добавлена колонка timezone в user_settings');
    }
  });

  console.log('✅ База данных инициализирована и мигрирована');
});

module.exports = db;
