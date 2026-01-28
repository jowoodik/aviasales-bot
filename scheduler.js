const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const UnifiedMonitor = require('./services/UnifiedMonitor');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: false });

console.log('📅 Планировщик запущен');

// Проверка цен каждый час
cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ Запуск проверки маршрутов (по расписанию)...');

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);

  try {
    await monitor.checkAllRoutes();
    console.log('✅ Проверка завершена успешно\n');
  } catch (error) {
    console.error('❌ Ошибка при проверке:', error);
  }
});

console.log('✅ Планировщик настроен: проверка каждый час');

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️ Остановка планировщика...');
  process.exit(0);
});
