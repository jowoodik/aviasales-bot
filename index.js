require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/database');
const RouteHandlers = require('./handlers/routeHandlers');
const SettingsHandlers = require('./handlers/settingsHandlers');
const SubscriptionHandlers = require('./handlers/subscriptionHandlers'); // Добавляем
const SubscriptionService = require('./services/SubscriptionService'); // Добавляем

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

// Состояния пользователей
const userStates = {};

// Инициализация обработчиков
const routeHandlers = new RouteHandlers(bot, userStates);
const settingsHandlers = new SettingsHandlers(bot, userStates);
const subscriptionHandlers = new SubscriptionHandlers(bot, userStates); // Добавляем

// Обновленное главное меню с кнопкой подписки
const getMainMenuKeyboard = (chatId) => {
  const keyboard = [
    ['📋 Мои маршруты'],
    ['⚙️ Настройки', '📊 Моя подписка'],
    ['ℹ️ Помощь']
  ];

  // Админу добавляем кнопку проверки
  if (chatId === 341508411) {
    keyboard.push(['✅ Проверить сейчас']);
  }

  return {
    reply_markup: {
      keyboard,
      resize_keyboard: true,
      persistent: true
    }
  };
};

// Обновляем метод в routeHandlers для использования нового меню
RouteHandlers.prototype.getMainMenuKeyboard = getMainMenuKeyboard;

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
        '📊 Вам доступна бесплатная подписка со следующими возможностями:\n' +
        '• 3 фиксированных маршрута\n' +
        '• 1 гибкий маршрут\n' +
        '• До 20 комбинаций в гибком маршруте\n' +
        '• Проверка каждые 4 часа\n\n' +
        'Хотите настроить таймзону сейчас?',
        keyboard
    );

    userStates[chatId] = { step: 'welcome_timezone' };

    // Создаем настройки пользователя и инициализируем подписку
    await initializeUserSettings(chatId);

  } else {
    // Обычное приветствие
    bot.sendMessage(
        chatId,
        'С возвращением! 👋\n\n' +
        'Используйте меню ниже для управления маршрутами.',
        getMainMenuKeyboard(chatId)
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
            getMainMenuKeyboard(chatId)
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

    if (text === '📊 Моя подписка') {
      await subscriptionHandlers.handleSubscriptionInfo(chatId);
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
          getMainMenuKeyboard(chatId)
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
            getMainMenuKeyboard(chatId)
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
            getMainMenuKeyboard(chatId)
        );
        return;
      }

      // Фоллбек — просто главное меню
      bot.sendMessage(
          chatId,
          'Главное меню',
          getMainMenuKeyboard(chatId)
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
        getMainMenuKeyboard(chatId)
    );

  } catch (error) {
    console.error('Ошибка обработки сообщения:', error);
    bot.sendMessage(
        chatId,
        '❌ Произшел ошибка. Попробуйте еще раз.',
        getMainMenuKeyboard(chatId)
    );
    delete userStates[chatId];
  }
});

/**
 * ОБРАБОТКА КОМАНД (со слешем)
 */
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  handleHelp(chatId);
});

bot.onText(/\/subscription/, (msg) => {
  const chatId = msg.chat.id;
  subscriptionHandlers.handleSubscriptionInfo(chatId);
});

bot.onText(/\/upgrade/, (msg) => {
  const chatId = msg.chat.id;
  subscriptionHandlers.handleUpgrade(chatId);
});

bot.onText(/\/admin_check/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId === 341508411) {
    handleCheckNow(chatId);
  }
});

/**
 * ОБРАБОТКА CALLBACK-ЗАПРОСОВ (для оплаты подписки)
 */
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  try {
    if (data === 'payment_plus') {
      // Здесь будет реальная интеграция с платежной системой
      // Пока что имитируем успешную оплату для тестирования

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '🔗 Переход к оплате...'
      });

      // В реальном приложении здесь был бы редирект на платежную систему
      // Для теста просто активируем подписку

      // Обновляем подписку пользователя
      await SubscriptionService.updateSubscription(chatId, 'plus');

      // Удаляем старое сообщение с кнопкой оплаты
      await bot.deleteMessage(chatId, messageId);

      // Отправляем подтверждение
      await bot.sendMessage(
          chatId,
          '🎉 Поздравляем! Подписка Plus активирована на 1 месяц!\n\n' +
          'Теперь вы можете:\n' +
          '• Создать до 5 фиксированных маршрутов\n' +
          '• Создать до 3 гибких маршрутов\n' +
          '• Проверять до 50 комбинаций в гибком маршруте\n' +
          '• Получать проверки каждые 2 часа\n\n' +
          'Спасибо за доверие! 😊'
      );

      // Показываем обновленную информацию о подписке
      await subscriptionHandlers.handleSubscriptionInfo(chatId);
    }

    else if (data.startsWith('subscription_info_')) {
      const action = data.replace('subscription_info_', '');
      if (action === 'back') {
        await bot.deleteMessage(chatId, messageId);
        await subscriptionHandlers.handleSubscriptionInfo(chatId);
      }
    }

  } catch (error) {
    console.error('Ошибка обработки callback:', error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Ошибка при обработке запроса'
    });
  }
});

function handleHelp(chatId) {
  const helpText = `
ℹ️ СПРАВКА

📌 Ваш chat id: \`${chatId}\`

📋 Мои маршруты - просмотр и управление вашими маршрутами

📊 Моя подписка - информация о текущей подписке и возможностях

⚙️ Настройки:
  🌙 Тихие часы - время, когда бот не отправляет уведомления
  🌍 Таймзона - для корректного отображения времени
  🔔 Уведомления о проверках - получать отчеты после каждой проверки

✈️ Создание маршрута:
  • Выберите откуда и куда летите
  • Укажите тип поиска (конкретная дата или диапазон)
  • Выберите нужен ли обратный билет
  • Настройте фильтры (пассажиры, багаж, пересадки)
  • Установите пороговую цену для уведомлений

🔔 Уведомления:
  Бот автоматически проверяет цены и отправляет уведомления, когда находит билеты дешевле вашего порога.

📊 Аналитика:
  • График цен - динамика изменения цен
  • Heatmap - лучшее время для покупки билетов

💎 ПОДПИСКИ:

1. Бесплатная (по умолчанию):
   • 3 фиксированных маршрута
   • 1 гибкий маршрут
   • До 20 комбинаций в гибком маршруте
   • Проверка каждые 4 часа

2. Plus (199 ₽/мес):
   • 5 фиксированных маршрутов
   • 3 гибких маршрута
   • До 50 комбинаций в гибком маршруте
   • Проверка каждые 2 часа
   • Приоритетная поддержка

📞 Поддержка:
  Если у вас есть вопросы, обращайтесь: @jowoodik
`;

  bot.sendMessage(chatId, helpText, {
    ...getMainMenuKeyboard(chatId),
    parse_mode: 'Markdown'
  });
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

    bot.sendMessage(chatId, '✅ Проверка завершена!', getMainMenuKeyboard(chatId));
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

async function initializeUserSettings(chatId) {
  return new Promise(async (resolve, reject) => {
    // Создаем запись в user_settings
    db.run(
        'INSERT OR IGNORE INTO user_settings (chat_id, timezone) VALUES (?, ?)',
        [chatId, 'Asia/Yekaterinburg'],
        async (err) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            // Определяем тип подписки (admin для админа, free для остальных)
            const subscriptionType = chatId === 341508411 ? 'admin' : 'free';

            // Инициализируем подписку пользователя
            await SubscriptionService.initializeUserSubscription(chatId, subscriptionType);

            // Логируем для отладки
            console.log(`✅ Пользователь ${chatId} инициализирован с подпиской ${subscriptionType}`);

            resolve();
          } catch (subscriptionError) {
            console.error('Ошибка инициализации подписки:', subscriptionError);
            reject(subscriptionError);
          }
        }
    );
  });
}

console.log('✅ Бот запущен успешно!');