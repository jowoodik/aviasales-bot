const cron = require('node-cron');

function setupScheduler(priceMonitor, flexibleMonitor) {
  // Каждые 2 часа
  cron.schedule('0 */2 * * *', async () => {
    console.log('\n⏰ Запуск автоматической проверки...');

    try {
      // Обычные маршруты
      await priceMonitor.checkPrices();
      await priceMonitor.close();

      // Гибкие маршруты
      await flexibleMonitor.checkAllRoutes();
      await flexibleMonitor.close();

    } catch (error) {
      console.error('Ошибка автоматической проверки:', error);
    }
  });

  console.log('✅ Планировщик настроен (каждые 2 часа)');
}

module.exports = setupScheduler;
