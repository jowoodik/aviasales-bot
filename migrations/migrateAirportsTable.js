// scripts/migrateAirportsTable.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/bot.db');
const db = new sqlite3.Database(dbPath);

console.log('🔄 Запуск миграции таблицы airports...\n');

db.serialize(() => {
    // 1. Создаем резервную копию данных
    console.log('📦 Создаю резервную копию...');
    db.run(`
        CREATE TABLE IF NOT EXISTS airports_backup AS 
        SELECT * FROM airports
    `, (err) => {
        if (err) {
            console.error('❌ Ошибка создания backup:', err.message);
            db.close();
            return;
        }
        console.log('✅ Резервная копия создана');

        // 2. Удаляем старую таблицу
        console.log('\n🗑️ Удаляю старую таблицу airports...');
        db.run(`DROP TABLE IF EXISTS airports`, (err) => {
            if (err) {
                console.error('❌ Ошибка удаления таблицы:', err.message);
                db.close();
                return;
            }
            console.log('✅ Старая таблица удалена');

            // 3. Создаем новую таблицу с правильной структурой
            console.log('\n🔨 Создаю новую таблицу airports...');
            db.run(`
                CREATE TABLE airports (
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
                    airport_type TEXT DEFAULT 'airport',
                    is_major INTEGER DEFAULT 0,
                    is_popular INTEGER DEFAULT 0,
                    is_international INTEGER DEFAULT 0,
                    display_order INTEGER DEFAULT 0,
                    region TEXT,
                    
                    -- Служебные
                    source TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    
                    -- 🔥 СОСТАВНОЙ УНИКАЛЬНЫЙ ИНДЕКС
                    UNIQUE(iata_code, airport_type)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Ошибка создания таблицы:', err.message);
                    db.close();
                    return;
                }
                console.log('✅ Новая таблица создана');

                // 4. Восстанавливаем данные из backup
                console.log('\n📥 Восстанавливаю данные...');
                db.run(`
                    INSERT INTO airports 
                    SELECT * FROM airports_backup
                `, (err) => {
                    if (err) {
                        console.error('❌ Ошибка восстановления данных:', err.message);
                    } else {
                        console.log('✅ Данные восстановлены');
                    }

                    // 5. Создаем индексы
                    console.log('\n🔧 Создаю индексы...');
                    const indexes = [
                        `CREATE INDEX IF NOT EXISTS idx_airports_iata_code ON airports(iata_code)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_airport_type ON airports(airport_type)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_iata_type ON airports(iata_code, airport_type)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_city_name_lower ON airports(city_name_lower)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_airport_name_lower ON airports(airport_name_lower)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_country_name_lower ON airports(country_name_lower)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_is_popular ON airports(is_popular)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_country_code ON airports(country_code)`,
                        `CREATE INDEX IF NOT EXISTS idx_airports_region ON airports(region)`
                    ];

                    let completed = 0;
                    indexes.forEach(sql => {
                        db.run(sql, (err) => {
                            if (err) {
                                console.error('⚠️ Ошибка создания индекса:', err.message);
                            }
                            completed++;
                            if (completed === indexes.length) {
                                console.log(`✅ Создано ${indexes.length} индексов`);

                                // 6. Удаляем backup
                                console.log('\n🗑️ Удаляю backup...');
                                db.run(`DROP TABLE IF EXISTS airports_backup`, (err) => {
                                    if (err) {
                                        console.error('⚠️ Ошибка удаления backup:', err.message);
                                    } else {
                                        console.log('✅ Backup удален');
                                    }

                                    // 7. Проверяем результат
                                    db.get(`SELECT COUNT(*) as count FROM airports`, [], (err, row) => {
                                        if (err) {
                                            console.error('❌ Ошибка проверки:', err.message);
                                        } else {
                                            console.log(`\n📊 Всего записей в таблице: ${row.count}`);
                                        }

                                        console.log('\n🎉 Миграция завершена успешно!');
                                        console.log('Теперь можно запустить импорт: node scripts/importAirports.js');
                                        db.close();
                                    });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
});
