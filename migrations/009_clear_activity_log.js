/**
 * Миграция 009: Очистка таблицы user_activity_log
 * Удаляет все старые данные для чистого старта воронки
 */

const db = require('../config/database');

function up() {
  return new Promise((resolve, reject) => {
    console.log('Миграция 009: Очистка user_activity_log...');

    db.run('DELETE FROM user_activity_log', (err) => {
      if (err) {
        console.error('Ошибка очистки user_activity_log:', err);
        reject(err);
      } else {
        console.log('✅ Таблица user_activity_log очищена');
        resolve();
      }
    });
  });
}

function down() {
  return new Promise((resolve) => {
    console.log('⚠️  Откат миграции 009: Данные не восстанавливаются');
    resolve();
  });
}

module.exports = { up, down };
