require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/database');
const RouteHandlers = require('./handlers/routeHandlers');
const SettingsHandlers = require('./handlers/settingsHandlers');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

// Состояния пользователей
const userStates = {};

// Инициализация обработчиков
const routeHandlers = new RouteHandlers(bot, userStates);
const settingsHandlers = new SettingsHandlers(bot, userStates);

/**
 * КОМАНДА /start
 */
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // Проверяем, первый ли раз пользователь
  const isFirstTime = await checkIfFirstTime(chatId);

  if (isFirstTime) {
    // Велком-сообщение с настройкой таймзоны
    const keyboard = {
      reply_markup: {
        keyboard: [
          ['⚙️ Настроить таймзону сейчас'],
          ['Продолжить с текущей']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    };

    bot.sendMessage(
        chatId,
        '👋 Добро пожаловать в бот мониторинга цен на авиабилеты!\n\n' +
        'Я помогу отслеживать цены на билеты и сообщу, когда найду выгодные предложения.\n\n' +
        '⚠️ Важно! Для корректного отображения времени уведомлений настройте вашу таймзону.\n\n' +
        '🌍 По умолчанию установлена таймзона: Asia/Yekaterinburg (UTC+5)\n\n' +
        'Хотите настроить таймзону сейчас?',
        keyboard
    );

    userStates[chatId] = { step: 'welcome_timezone' };

    // Создаем настройки пользователя
    await initializeUserSettings(chatId);

  } else {
    // Обычное приветствие
    bot.sendMessage(
        chatId,
        'С возвращением! 👋\n\n' +
        'Используйте меню ниже для управления маршрутами.',
        routeHandlers.getMainMenuKeyboard(chatId)
    );
  }
});

/**
 * ОБРАБОТКА СООБЩЕНИЙ
 */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates[chatId];

  try {
    // ========================================
    // ПРИВЕТСТВЕННАЯ НАСТРОЙКА ТАЙМЗОНЫ
    // ========================================
    if (state?.step === 'welcome_timezone') {
      if (text.includes('Настроить')) {
        await settingsHandlers.handleTimezone(chatId);
        return;
      } else {
        bot.sendMessage(
            chatId,
            'Отлично! Вы всегда можете изменить таймзону в разделе Настройки.\n\nНачнем работу! 🚀',
            routeHandlers.getMainMenuKeyboard(chatId)
        );
        delete userStates[chatId];
        return;
      }
    }

    // ========================================
    // ГЛАВНОЕ МЕНЮ
    // ========================================
    if (text === '📋 Мои маршруты') {
      await routeHandlers.handleMyRoutes(chatId);
      return;
    }

    if (text === '⚙️ Настройки') {
      settingsHandlers.handleSettings(chatId);
      return;
    }

    if (text === 'ℹ️ Помощь') {
      handleHelp(chatId);
      return;
    }

    if (text === '✅ Проверить сейчас' && chatId === 341508411) {
      await handleCheckNow(chatId);
      return;
    }

    if (text === '🏠 Главное меню') {
      bot.sendMessage(
          chatId,
          'Главное меню',
          routeHandlers.getMainMenuKeyboard(chatId)
      );
      delete userStates[chatId];
      return;
    }

    if (text === '◀️ Назад к маршрутам') {
      await routeHandlers.handleMyRoutes(chatId);
      return;
    }

    // ========================================
    // РАБОТА С МАРШРУТАМИ
    // ========================================
    if (text === '➕ Создать маршрут' || text.includes('Создать маршрут')) {
      routeHandlers.handleCreateRoute(chatId);
      return;
    }

    // Выбор маршрута из списка
    if (state?.step === 'select_route' && text.match(/^\d+\./)) {
      const index = parseInt(text.match(/^(\d+)\./)[1]) - 1;
      await routeHandlers.handleRouteDetails(chatId, index);
      return;
    }

    // Создание маршрута (многошаговый процесс)
    if (state && state.routeData) {
      const handled = await routeHandlers.handleCreateStep(chatId, text);
      if (handled) return;
    }

    // Действия с маршрутом
    if (state?.step === 'route_action') {
      if (text === '✏️ Редактировать') {
        routeHandlers.handleEditRoute(chatId);
        return;
      }
      if (text === '📊 График цен') {
        await routeHandlers.handleShowChart(chatId, state.route);
        return;
      }
      if (text === '🗺️ Heatmap') {
        await routeHandlers.handleShowHeatmap(chatId, state.route);
        return;
      }
      if (text === '🗑️ Удалить') {
        routeHandlers.handleDeleteRoute(chatId);
        return;
      }
    }

    // Редактирование маршрута
    if (state?.step === 'edit_action') {
      const handled = await routeHandlers.handleEditAction(chatId, text);
      if (handled) return;
    }

    if (state?.step === 'edit_threshold') {
      const handled = await routeHandlers.handleEditThreshold(chatId, text);
      if (handled) return;
    }

    // Подтверждение удаления
    if (state?.step === 'confirm_delete') {
      const handled = await routeHandlers.handleConfirmDelete(chatId, text);
      if (handled) return;
    }

    // ========================================
    // НАСТРОЙКИ (ЦЕНТРАЛИЗОВАННЫЙ ОБРАБОТЧИК)
    // ========================================
    const settingsHandled = await settingsHandlers.handleMessage(chatId, text, userStates);
    if (settingsHandled) return;

    // ========================================
    // УНИВЕРСАЛЬНЫЙ ОБРАБОТЧИК КНОПКИ "НАЗАД"
    // ========================================
    if (text === '◀️ Назад') {
      const state = userStates[chatId];

      // Если мы в деталях маршрута -> назад к списку маршрутов
      if (state?.step === 'route_action') {
        await routeHandlers.handleMyRoutes(chatId);
        return;
      }

      // Если мы в редактировании маршрута -> назад к деталям
      if (state?.step === 'edit_action') {
        const routeIndex = state.routes.findIndex(r => r.id === state.route.id);
        await routeHandlers.handleRouteDetails(chatId, routeIndex);
        return;
      }

      // Если мы в списке маршрутов -> главное меню
      if (state?.step === 'select_route') {
        bot.sendMessage(
            chatId,
            'Главное меню',
            routeHandlers.getMainMenuKeyboard(chatId)
        );
        delete userStates[chatId];
        return;
      }

      // Если мы в создании маршрута -> отмена и главное меню
      if (state?.routeData) {
        delete userStates[chatId];
        bot.sendMessage(
            chatId,
            '❌ Создание маршрута отменено.\n\nВы в главном меню.',
            routeHandlers.getMainMenuKeyboard(chatId)
        );
        return;
      }

      // Фоллбек — просто главное меню
      bot.sendMessage(
          chatId,
          'Главное меню',
          routeHandlers.getMainMenuKeyboard(chatId)
      );
      delete userStates[chatId];
      return;
    }

    // ========================================
    // НЕИЗВЕСТНАЯ КОМАНДА
    // ========================================
    bot.sendMessage(
        chatId,
        '❓ Неизвестная команда. Используйте меню ниже.',
        routeHandlers.getMainMenuKeyboard(chatId)
    );

  } catch (error) {
    console.error('Ошибка обработки сообщения:', error);
    bot.sendMessage(
        chatId,
        '❌ Произошла ошибка. Попробуйте еще раз.',
        routeHandlers.getMainMenuKeyboard(chatId)
    );
    delete userStates[chatId];
  }
});

/**
 * ПОМОЩЬ
 */
function handleHelp(chatId) {
  const helpText = `
ℹ️ СПРАВКА

📌 Ваш chat id: ${chatId}

📋 Мои маршруты - просмотр и управление вашими маршрутами

⚙️ Настройки:
  🌙 Тихие часы - время, когда бот не отправляет уведомления
  🌍 Таймзона - для корректного отображения времени

✈️ Создание маршрута:
  • Выберите откуда и куда летите
  • Укажите тип поиска (конкретная дата или диапазон)
  • Выберите нужен ли обратный билет
  • Настройте фильтры (пассажиры, багаж, пересадки)
  • Установите пороговую цену для уведомлений

🔔 Уведомления:
  Бот проверяет цены автоматически каждый час и отправляет уведомления, когда находит билеты дешевле вашего порога.

📊 Аналитика:
  • График цен - динамика изменения цен
  • Heatmap - лучшее время для покупки билетов

⚠️ Лимиты (бесплатно):
  • 1 гибкий маршрут (диапазон дат)
  • 3 фиксированных маршрута (конкретные даты)
  • Максимум 20 комбинаций для гибкого поиска

💎 В будущем будет доступна платная подписка для расширенных возможностей.
`;

  bot.sendMessage(chatId, helpText, routeHandlers.getMainMenuKeyboard(chatId));
}

/**
 * ПРОВЕРКА СЕЙЧАС (только для админа)
 */
async function handleCheckNow(chatId) {
  try {
    bot.sendMessage(chatId, '🔍 Запускаю проверку всех маршрутов...\n⏳ Это может занять несколько минут.');

    const UnifiedMonitor = require('./services/UnifiedMonitor');
    const NotificationService = require('./services/NotificationService');
    const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
    const notificationService = new NotificationService(bot);

    await monitor.checkAllRoutes();
    const stats = await notificationService.getUserRoutesStats(chatId);
    await notificationService.sendCheckReport(chatId, stats);

    bot.sendMessage(chatId, '✅ Проверка завершена!', routeHandlers.getMainMenuKeyboard(chatId));
  } catch (error) {
    console.error('Ошибка проверки:', error);
    bot.sendMessage(chatId, '❌ Ошибка при проверке: ' + error.message);
  }
}

/**
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 */
function checkIfFirstTime(chatId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT chat_id FROM user_settings WHERE chat_id = ?', [chatId], (err, row) => {
      if (err) reject(err);
      else resolve(!row); // true если пользователь новый
    });
  });
}

function initializeUserSettings(chatId) {
  return new Promise((resolve, reject) => {
    db.run(
        'INSERT OR IGNORE INTO user_settings (chat_id, timezone) VALUES (?, ?)',
        [chatId, 'Asia/Yekaterinburg'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
    );
  });
}

console.log('✅ Бот запущен успешно!');
