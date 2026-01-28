const db = require('../config/database');

// Тестовый пользователь
const TEST_USER_ID = 123456789;

async function cleanupTestData() {
    console.log('🧹 Очистка тестовых данных...\n');

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 1. Удаляем маршруты тестового пользователя
            console.log('🗑️ Удаление маршрутов...');
            db.run('DELETE FROM unified_routes WHERE chat_id = ?', [TEST_USER_ID], function(err) {
                if (err) {
                    console.error('❌ Ошибка удаления маршрутов:', err.message);
                } else {
                    console.log(`✅ Удалено маршрутов: ${this.changes}`);
                }
            });

            // 2. Удаляем настройки
            console.log('🗑️ Удаление настроек...');
            db.run('DELETE FROM user_settings WHERE chat_id = ?', [TEST_USER_ID], function(err) {
                if (err) {
                    console.error('❌ Ошибка удаления настроек:', err.message);
                } else {
                    console.log(`✅ Удалено настроек: ${this.changes}`);
                }
            });

            // 3. Удаляем статистику
            console.log('🗑️ Удаление статистики...');
            db.run('DELETE FROM user_stats WHERE chat_id = ?', [TEST_USER_ID], function(err) {
                if (err) {
                    console.error('❌ Ошибка удаления статистики:', err.message);
                } else {
                    console.log(`✅ Удалено статистики: ${this.changes}`);
                }
            });

            // 4. Удаляем результаты (автоматически удаляются через CASCADE, но для уверенности)
            console.log('🗑️ Удаление результатов поиска...');
            db.run(`
        DELETE FROM route_results 
        WHERE route_id IN (
          SELECT id FROM unified_routes WHERE chat_id = ?
        )
      `, [TEST_USER_ID], function(err) {
                if (err) {
                    console.error('❌ Ошибка удаления результатов:', err.message);
                } else {
                    console.log(`✅ Удалено результатов: ${this.changes}`);
                }
            });

            // 5. Очистка аналитики
            console.log('🗑️ Очистка аналитики цен...');
            db.run('DELETE FROM price_analytics WHERE chat_id = ?', [TEST_USER_ID], function(err) {
                if (err) {
                    console.error('❌ Ошибка очистки аналитики:', err.message);
                } else {
                    console.log(`✅ Удалено записей аналитики: ${this.changes}`);
                }
            });

            setTimeout(() => {
                console.log('\n✅ Очистка тестовых данных завершена!');
                console.log(`📝 Удалены данные пользователя: ${TEST_USER_ID}`);
                resolve();
            }, 500);
        });
    });
}

// Запуск
cleanupTestData()
    .then(() => {
        console.log('\n🎉 Готово!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('\n❌ Ошибка:', err);
        process.exit(1);
    });
