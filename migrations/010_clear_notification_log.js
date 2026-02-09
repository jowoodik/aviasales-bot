/**
 * Миграция 010: Очистка таблицы notification_log
 * Удаляет все старые данные для чистого логов и оповещений
 */

const db = require('../config/database');

function up() {
  return new Promise((resolve, reject) => {
    console.log('Миграция 010: Очистка notification_log...');

    db.run('DELETE FROM notification_log', (err) => {
      if (err) {
        console.error('Ошибка очистки notification_log:', err);
        reject(err);
      } else {
        console.log('✅ Таблица notification_log очищена');
        resolve();
      }
    });
  });
}

function down() {
  return new Promise((resolve) => {
    console.log('⚠️  Откат миграции 010: Данные не восстанавливаются');
    resolve();
  });
}

module.exports = { up, down };
