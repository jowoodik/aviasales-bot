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
    const checkResults = await monitor.checkAllRoutes();

    // Отправляем отчеты пользователям с включенными уведомлениями
    for (const user of usersWithNotifications) {
      try {
        // Здесь нужно получить статистику по маршрутам пользователя
        // Предполагаем, что checkResults содержит информацию о всех проверенных маршрутах
        const userRoutes = await getUserRoutesStats(user.chat_id);
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

// Функция для получения статистики по маршрутам пользователя
function getUserRoutesStats(chatId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        r.origin,
        r.destination,
        MIN(rr.total_price) as bestPrice,
        COUNT(rr.id) as checksCount
      FROM unified_routes r
      LEFT JOIN route_results rr ON r.id = rr.route_id
      WHERE r.chat_id = ? AND r.is_paused = 0
      GROUP BY r.id
    `, [chatId], (err, rows) => {
      if (err) reject(err);
      else {
        const stats = rows.map(row => ({
          origin: row.origin,
          destination: row.destination,
          bestPrice: row.bestPrice,
          checksCount: row.checksCount || 0,
          foundCheaper: false // Эта информация должна приходить из UnifiedMonitor
        }));
        resolve(stats);
      }
    });
  });
}

console.log('✅ Планировщик настроен: проверка каждый час');

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️ Остановка планировщика...');
  process.exit(0);
});