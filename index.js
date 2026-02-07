require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./config/database');
const RouteHandlers = require('./handlers/routeHandlers');
const SettingsHandlers = require('./handlers/settingsHandlers');
const SubscriptionHandlers = require('./handlers/subscriptionHandlers'); // Добавляем
const SubscriptionService = require('./services/SubscriptionService'); // Добавляем
const ActivityService = require('./services/ActivityService'); // Логирование активности

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: false });

bot.startPolling({
  restart: true,
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10,
      allowed_updates: ['message', 'callback_query']
    }
  }
});

// ПРИМЕЧАНИЕ: setBotInstance НЕ используется, т.к. web/server.js
// запускается отдельным процессом в pm2 (flyalert-web)
// Webhook ЮКассы сохраняет данные в БД, а бот проверяет и отправляет уведомления

// Периодическая проверка новых платежей и отправка уведомлений
const PaymentNotificationService = require('./services/PaymentNotificationService');
const paymentNotifier = new PaymentNotificationService(bot);

// Проверяем каждую минуту
setInterval(async () => {
    await paymentNotifier.checkAndNotify();
}, 5 * 1000); // 5 cекунд

// Проверяем сразу при старте (через 5 секунд)
setTimeout(async () => {
    console.log('🔍 Проверка необработанных платежей...');
    await paymentNotifier.checkAndNotify();
}, 5000);

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

  // Логируем событие start
  ActivityService.logEvent(chatId, 'start').catch(err => console.error('Activity log error:', err));

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
        'Если нужно получать уведомления о каждой проверке, то можно включить это в настройках.\n\n' +
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
      await handleHelp(chatId);
      return;
    }

    if (text === '✅ Проверить сейчас' && chatId === 341508411) {
      await handleCheckNow(chatId);
      return;
    }

    if (text === '🏠 Главное меню') {
      // Логируем возврат в главное меню
      ActivityService.logEvent(chatId, 'main_menu').catch(err => console.error('Activity log error:', err));

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
      if (text === '🗺️ Тепловая карта цен') {
        await routeHandlers.handleShowHeatmap(chatId, state.route);
        return;
      }
      if (text === '🗑️ Удалить') {
        routeHandlers.handleDeleteRoute(chatId);
        return;
      }
      if (text === '◀️ Назад к маршруту') {
        await routeHandlers.handleRouteDetails(chatId, state.routeIndex);
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
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await handleHelp(chatId);
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

bot.on('message', (msg) => {
  console.log('[UPDATE] message:', msg.chat.id, msg.text);
});

bot.on('callback_query', (query) => {
  console.log('[UPDATE] callback_query:', query.id);
});

// Логируем ВСЕ события
bot.on('polling_error', (error) => {
  console.error('[POLLING ERROR]:', error);
});

// Для некоторых библиотек работает универсальный обработчик
bot.on('update', (update) => {
  console.log('[RAW UPDATE]:', JSON.stringify(update, null, 2));
});

/**
 * ОБРАБОТКА CALLBACK-ЗАПРОСОВ (для оплаты подписки)
 */
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  try {
    // Обработка callback для подписок
    if (data.startsWith('upgrade_') || data.startsWith('payment_')) {
      await subscriptionHandlers.handleCallbackQuery(callbackQuery);
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

async function handleHelp(chatId) {
  // Логируем просмотр помощи
  ActivityService.logEvent(chatId, 'help').catch(err => console.error('Activity log error:', err));

  // Загружаем тарифы из БД
  const subscriptionTypes = await new Promise((resolve, reject) => {
    db.all(
        'SELECT * FROM subscription_types WHERE is_active = 1 AND name != "admin" ORDER BY price_per_month ASC',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
    );
  });

  // Формируем блок тарифов
  let subscriptionsText = '';
  subscriptionTypes.forEach((sub, index) => {
    const price = sub.price_per_month > 0 ? `${sub.price_per_month} ₽/мес` : 'бесплатно';
    const isDefault = sub.name === 'free' ? ' (по умолчанию)' : '';
    subscriptionsText += `\n${index + 1}. *${sub.display_name}${isDefault}* — ${price}:\n`;
    subscriptionsText += `• ${sub.max_fixed_routes} фиксированных + ${sub.max_flexible_routes} гибких маршрутов\n`;
    subscriptionsText += `• До ${sub.max_combinations} комбинаций\n`;
    subscriptionsText += `• Проверка каждые ${sub.check_interval_hours} ч.\n`;

    // Добавляем информацию об уведомлениях
    if (sub.name === 'free') {
      subscriptionsText += `• 🔥 Критические: до 3/день, остальные в дайджест\n`;
      subscriptionsText += `• 📊 Хорошие: только в дайджесте\n`;
      subscriptionsText += `• 📬 Дайджест: 1 раз/день (10:00)\n`;
    } else if (sub.name === 'plus') {
      subscriptionsText += `• 🔥 Критические: неограниченно\n`;
      subscriptionsText += `• 📊 Хорошие: раз в 3 часа\n`;
      subscriptionsText += `• 📬 Дайджест: 2 раза/день (10:00, 18:00)\n`;
    }
    subscriptionsText += `\n`;
  });

  const helpText = `
✈️ *БОТ МОНИТОРИНГА ЦЕН НА АВИАБИЛЕТЫ*

📌 Ваш chat id: \`${chatId}\`

Найти дешёвые билеты — задача сложная. Каждый день проверять цены на Aviasales утомительно, а их уведомления работают через раз: календарь гибких дат не учитывает фильтры, в пуш-уведомлениях не учитываются детские билеты, а другие боты показывают устаревшие кешированные цены из API.

Этот бот решает проблему: он сам заходит на Aviasales через браузер, парсит актуальные цены с учётом всех ваших фильтров и присылает уведомление, когда находит билеты дешевле заданного порога.

*🔥 ОСОБЕННОСТИ БОТА:*

*1. Актуальные цены с Aviasales*
Бот открывает настоящий браузер и парсит цены с учётом ваших фильтров — дети, багаж, пересадки. Это не кешированные данные из API, а реальные цены прямо сейчас.

*2. Гибкий поиск работает правильно*
Укажите диапазон дат вылета, возврата и количество дней — бот проверит все комбинации и найдёт самый дешёвый вариант.

*3. Автоматический мониторинг 24/7*
Создайте маршрут → бот проверяет его каждые 2-4 часа → присылает уведомление, когда цена упала.

*4. Умная система уведомлений*
🔥 Критические находки — мгновенно
📊 Хорошие цены — регулярно
📬 Дайджесты — сводки по всем маршрутам
🌙 Ночной режим — беззвучные уведомления

*💎 УНИКАЛЬНЫЕ ФИЧИ:*

📊 *График цен* — динамика изменения за всё время мониторинга
🗺️ *Heatmap* — лучшее время для покупки на основе статистики
🔔 *Кнопка "Купить"* — переход на Aviasales для покупки
🎯 *Система приоритетов* — важные находки не потеряются

*💰 ТАРИФЫ:*
${subscriptionsText}

⚠️ *Бот в экспериментальном режиме* — возможны мелкие баги. Буду рад обратной связи!

💳 *Оплата Plus:* /upgrade или напишите @jowoodik

📞 *Поддержка:* @jowoodik
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
    const RouteResult = require('./models/RouteResult');
    const airportResolver = require('./utils/AirportCodeResolver');
    const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
    const notificationService = new NotificationService(bot);

    await airportResolver.load();
    await monitor.checkAllRoutes();

    // Формируем сводный отчёт в новом формате
    const stats = await notificationService.getUserRoutesStats(chatId);
    const timezone = await notificationService._getUserTimezone(chatId);
    const routeBlocks = [];

    for (const stat of stats) {
      const route = { id: stat.routeId, origin: stat.origin, destination: stat.destination, threshold_price: stat.thresholdPrice, is_flexible: stat.isFlexible };
      const bestResults = await RouteResult.getTopResults(stat.routeId, 1);
      const bestResult = bestResults[0] || null;
      const analytics = await notificationService.getRouteAnalytics(stat.routeId);
      const checkStats = await notificationService.getRouteCheckStats(stat.routeId);
      const block = await notificationService.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
      routeBlocks.push({ block, route, priority: stat.foundCheaper ? 'CRITICAL' : 'LOW' });
    }

    if (routeBlocks.length > 0) {
      await notificationService.sendConsolidatedReport(chatId, routeBlocks, timezone, false);
    }

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