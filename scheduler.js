const cron = require('node-cron');
const db = require('./config/database');  // Твой путь к database.js

function setupScheduler(priceMonitor, flexibleMonitor) {
  // Каждые 2 часа
  cron.schedule('0 */2 * * *', async () => {
    console.log('\n⏰ Запуск автоматической проверки...');
    try {
      // 1️⃣ Обычные маршруты
      console.log('🔍 Проверяем обычные маршруты...');
      await priceMonitor.checkPrices();

      // 🔥 ОТПРАВЛЯЕМ ОТЧЕТЫ
      await sendReportsToUsers(priceMonitor, 'regular');

      await priceMonitor.close();

      // 2️⃣ Гибкие маршруты
      console.log('🔍 Проверяем гибкие маршруты...');
      await flexibleMonitor.checkAllRoutes();

      // 🔥 ОТПРАВЛЯЕМ ОТЧЕТЫ
      await sendReportsToUsers(flexibleMonitor, 'flexible');

      await flexibleMonitor.close();

      console.log('✅ Автопроверка завершена');

    } catch (error) {
      console.error('Ошибка проверки:', error);
    }
  });

  console.log('✅ Scheduler запущен (каждые 2 часа)');
}

// 🔥 ФУНКЦИЯ: Отправить отчеты всем активным пользователям
async function sendReportsToUsers(monitor, type) {
  return new Promise((resolve) => {
    db.all(`
      SELECT DISTINCT chat_id 
      FROM (
        SELECT chat_id FROM routes WHERE is_paused = 0
        UNION
        SELECT chat_id FROM flexible_routes WHERE is_paused = 0
      )
    `, [], async (err, users) => {
      if (err) {
        console.error('Ошибка получения пользователей:', err);
        return resolve();
      }

      console.log(`📤 Отправляем отчеты ${users.length} пользователям (${type})`);

      for (const user of users) {
        try {
          await monitor.sendReport(user.chat_id);
          console.log(`✅ Отчет отправлен: ${user.chat_id}`);
        } catch (e) {
          console.error(`❌ Ошибка отчета ${user.chat_id}:`, e.message);
        }
        // Пауза 500мс между пользователями
        await new Promise(r => setTimeout(r, 500));
      }

      resolve();
    });
  });
}

module.exports = setupScheduler;
