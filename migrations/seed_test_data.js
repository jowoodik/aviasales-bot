const db = require('../config/database');

// Тестовый пользователь (не админ)
const TEST_USER_ID = 123456789;

// Админ
const ADMIN_ID = 341508411;

async function seedTestData() {
    console.log('🌱 Создание тестовых данных...\n');

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 1. Настройки пользователей
            console.log('📝 Создание настроек пользователей...');
            db.run(`
        INSERT OR REPLACE INTO user_settings 
        (chat_id, quiet_hours_start, quiet_hours_end, timezone)
        VALUES 
        (${TEST_USER_ID}, 23, 7, 'Asia/Yekaterinburg'),
        (${ADMIN_ID}, 23, 7, 'Asia/Yekaterinburg')
      `, (err) => {
                if (err) {
                    console.error('❌ Ошибка создания настроек:', err.message);
                } else {
                    console.log('✅ Настройки пользователей созданы');
                }
            });

            // 2. Статистика пользователей
            console.log('📝 Создание статистики пользователей...');
            db.run(`
        INSERT OR REPLACE INTO user_stats 
        (chat_id, total_routes, total_alerts, total_savings, total_checks)
        VALUES 
        (${TEST_USER_ID}, 3, 0, 0, 0),
        (${ADMIN_ID}, 0, 0, 0, 0)
      `, (err) => {
                if (err) {
                    console.error('❌ Ошибка создания статистики:', err.message);
                } else {
                    console.log('✅ Статистика пользователей создана');
                }
            });

            // 3. Маршруты для тестового пользователя
            console.log('\n📝 Создание тестовых маршрутов...');

            // 3a. Фиксированный туда-обратно
            db.run(`
        INSERT INTO unified_routes 
        (chat_id, origin, destination, is_flexible, has_return, 
         departure_date, return_date, adults, children, airline, baggage, 
         max_stops, max_layover_hours, threshold_price, currency)
        VALUES 
        (${TEST_USER_ID}, 'SVX', 'MOW', 0, 1, 
         '2026-03-15', '2026-03-20', 1, 0, 'SU', 1, 
         1, 10, 15000, 'RUB')
      `, function(err) {
                if (err) {
                    console.error('❌ Ошибка создания фиксированного маршрута 1:', err.message);
                } else {
                    console.log(`✅ Фиксированный маршрут туда-обратно создан (ID: ${this.lastID})`);

                    // Добавляем результаты для этого маршрута
                    const routeId = this.lastID;
                    db.run(`
            INSERT INTO route_results 
            (route_id, departure_date, return_date, days_in_country, 
             total_price, airline, search_link, found_at)
            VALUES 
            (${routeId}, '2026-03-15', '2026-03-20', 5, 
             14500, 'Аэрофлот', 'https://aviasales.ru/search/SVXMOW1503202603', datetime('now')),
            (${routeId}, '2026-03-15', '2026-03-20', 5, 
             14800, 'Аэрофлот', 'https://aviasales.ru/search/SVXMOW1503202603', datetime('now', '-1 hour')),
            (${routeId}, '2026-03-15', '2026-03-20', 5, 
             15200, 'Аэрофлот', 'https://aviasales.ru/search/SVXMOW1503202603', datetime('now', '-2 hours'))
          `, (err) => {
                        if (err) {
                            console.error('  ❌ Ошибка добавления результатов:', err.message);
                        } else {
                            console.log('  ✅ Добавлено 3 результата поиска');
                        }
                    });
                }
            });

            // 3b. Фиксированный в одну сторону
            db.run(`
        INSERT INTO unified_routes 
        (chat_id, origin, destination, is_flexible, has_return, 
         departure_date, adults, children, airline, baggage, 
         max_stops, max_layover_hours, threshold_price, currency)
        VALUES 
        (${TEST_USER_ID}, 'MOW', 'LED', 0, 0, 
         '2026-04-10', 1, 0, NULL, 0, 
         0, 0, 5000, 'RUB')
      `, function(err) {
                if (err) {
                    console.error('❌ Ошибка создания фиксированного маршрута 2:', err.message);
                } else {
                    console.log(`✅ Фиксированный маршрут в одну сторону создан (ID: ${this.lastID})`);

                    const routeId = this.lastID;
                    db.run(`
            INSERT INTO route_results 
            (route_id, departure_date, return_date, days_in_country, 
             total_price, airline, search_link, found_at)
            VALUES 
            (${routeId}, '2026-04-10', NULL, NULL, 
             4200, 'S7 Airlines', 'https://aviasales.ru/search/MOWLED1004', datetime('now')),
            (${routeId}, '2026-04-10', NULL, NULL, 
             4500, 'Аэрофлот', 'https://aviasales.ru/search/MOWLED1004', datetime('now', '-30 minutes'))
          `, (err) => {
                        if (err) {
                            console.error('  ❌ Ошибка добавления результатов:', err.message);
                        } else {
                            console.log('  ✅ Добавлено 2 результата поиска');
                        }
                    });
                }
            });

            // 3c. Гибкий туда-обратно
            db.run(`
        INSERT INTO unified_routes 
        (chat_id, origin, destination, is_flexible, has_return, 
         departure_start, departure_end, min_days, max_days,
         adults, children, airline, baggage, 
         max_stops, max_layover_hours, threshold_price, currency)
        VALUES 
        (${TEST_USER_ID}, 'SVX', 'DXB', 1, 1, 
         '2026-05-01', '2026-05-10', 3, 7,
         2, 1, 'EK', 1, 
         1, 12, 80000, 'RUB')
      `, function(err) {
                if (err) {
                    console.error('❌ Ошибка создания гибкого маршрута:', err.message);
                } else {
                    console.log(`✅ Гибкий маршрут создан (ID: ${this.lastID})`);

                    const routeId = this.lastID;
                    db.run(`
            INSERT INTO route_results 
            (route_id, departure_date, return_date, days_in_country, 
             total_price, airline, search_link, found_at)
            VALUES 
            (${routeId}, '2026-05-02', '2026-05-09', 7, 
             78500, 'Emirates', 'https://aviasales.ru/search/SVXDXB0205092605', datetime('now')),
            (${routeId}, '2026-05-03', '2026-05-08', 5, 
             79200, 'Emirates', 'https://aviasales.ru/search/SVXDXB0305082605', datetime('now', '-3 hours')),
            (${routeId}, '2026-05-01', '2026-05-06', 5, 
             79800, 'Emirates', 'https://aviasales.ru/search/SVXDXB0105062605', datetime('now', '-5 hours'))
          `, (err) => {
                        if (err) {
                            console.error('  ❌ Ошибка добавления результатов:', err.message);
                        } else {
                            console.log('  ✅ Добавлено 3 результата поиска');
                        }
                    });
                }
            });

            // Финальное сообщение
            setTimeout(() => {
                console.log('\n✅ Тестовые данные успешно созданы!');
                console.log(`\n📝 Тестовый пользователь: ${TEST_USER_ID}`);
                console.log(`👑 Админ: ${ADMIN_ID}`);
                console.log('\n💡 Для входа в бота используйте команду /start');
                resolve();
            }, 1000);
        });
    });
}

// Запуск
seedTestData()
    .then(() => {
        console.log('\n🎉 Готово!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Ошибка:', err);
        process.exit(1);
    });
