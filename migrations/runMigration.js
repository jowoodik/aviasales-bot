/**
 * Запуск миграции
 * Использование: node migrations/runMigration.js
 */

const migration = require('./010_clear_notification_log');

console.log('🚀 Запуск миграции...\n');

migration.up()
  .then(() => {
    console.log('\n✅ Миграция выполнена успешно!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Ошибка выполнения миграции:', err);
    process.exit(1);
  });
