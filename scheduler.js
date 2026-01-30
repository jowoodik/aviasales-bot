const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const UnifiedMonitor = require('./services/UnifiedMonitor');
const NotificationService = require('./services/NotificationService');
const db = require('./config/database');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: false });

console.log('📅 Планировщик запущен');

// Проверка цен каждый час
cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ Запуск проверки маршрутов (по расписанию)...');

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
  const notificationService = new NotificationService(bot);

  try {
    // Получаем пользователей с включенными уведомлениями о проверках
    const usersWithNotifications = await getUsersWithNotificationOn();

    // Проверяем все маршруты
    await monitor.checkAllRoutes();

    // Отправляем отчеты пользователям с включенными уведомлениями
    for (const user of usersWithNotifications) {
      try {
        const userRoutes = await notificationService.getUserRoutesStats(user.chat_id);
        await notificationService.sendCheckReport(user.chat_id, userRoutes);
      } catch (error) {
        console.error(`Ошибка отправки отчета пользователю ${user.chat_id}:`, error);
      }
    }

    console.log('✅ Проверка завершена успешно\n');
  } catch (error) {
    console.error('❌ Ошибка при проверке:', error);
  }
});

// Функция для получения пользователей с включенными уведомлениями
function getUsersWithNotificationOn() {
  return new Promise((resolve, reject) => {
    db.all(
        'SELECT chat_id FROM user_settings WHERE notify_on_check = 1',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
    );
  });
}

console.log('✅ Планировщик настроен: проверка каждый час');

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️ Остановка планировщика...');
  process.exit(0);
});