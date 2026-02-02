const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const NotificationService = require('./services/NotificationService');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: false });

console.log('📅 Планировщик рассылок запущен');

// ========================================
// МАССОВАЯ РАССЫЛКА
// ========================================

const BroadcastService = require('./services/BroadcastService');

/**
 * Обработка массовых рассылок
 * Проверяется каждую минуту
 */
cron.schedule('*/5 * * * *', async () => {
  try {
    const notificationService = new NotificationService(bot);

    // Получаем все неотправленные рассылки
    const pendingBroadcasts = await BroadcastService.getPendingBroadcasts();

    if (pendingBroadcasts.length === 0) {
      return; // Нет рассылок для обработки
    }

    console.log(`\n📢 Проверка рассылок: найдено ${pendingBroadcasts.length} активных`);

    // Обрабатываем каждую рассылку
    for (const broadcast of pendingBroadcasts) {
      try {
        // Получаем пользователей, которым нужно отправить сообщение
        const usersToNotify = await BroadcastService.getUsersToNotify(broadcast);

        if (usersToNotify.length === 0) {
          console.log(`📭 Рассылка #${broadcast.id}: нет пользователей для отправки`);

          // Проверяем, может рассылка уже завершена
          await BroadcastService.checkAndMarkComplete(broadcast.id);
          continue;
        }

        console.log(
            `📤 Рассылка #${broadcast.id}: найдено ${usersToNotify.length} пользователей для отправки (время: ${broadcast.scheduled_time})`
        );

        // Отправляем сообщения с rate limiting (25 сообщений в секунду)
        await notificationService.sendBroadcastMessages(
            usersToNotify,
            broadcast.message_text,
            broadcast.id,
            25 // Максимум 25 сообщений в секунду
        );

      } catch (error) {
        console.error(`❌ Ошибка обработки рассылки #${broadcast.id}:`, error);
      }
    }

  } catch (error) {
    console.error('❌ Ошибка при обработке рассылок:', error);
  }
});

console.log('✅ Задача массовой рассылки настроена (каждую минуту)');

// ========================================
// ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ
// ========================================

console.log('✅ Планировщик рассылок настроен:');
console.log(`   • Массовая рассылка: * * * * * (каждую минуту)`);

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('\n⚠️ Остановка планировщика рассылок...');
  process.exit(0);
});