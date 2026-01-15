require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
require('./config/database');

const PriceMonitor = require('./services/PriceMonitor');
const FlexibleMonitor = require('./services/FlexibleMonitor');
const RouteHandlers = require('./handlers/routeHandlers');
const FlexibleHandlers = require('./handlers/flexibleHandlers');
const SettingsHandlers = require('./handlers/settingsHandlers');
const setupScheduler = require('./scheduler');
const Route = require('./models/Route');
const DateUtils = require('./utils/dateUtils');
const Formatters = require('./utils/formatters');
const db = require('./config/database');
const PriceAnalytics = require('./services/PriceAnalytics');
const FlexibleRoute = require('./models/FlexibleRoute');


const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const userStates = {};

const priceMonitor = new PriceMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
const flexibleMonitor = new FlexibleMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
const routeHandlers = new RouteHandlers(bot, userStates);
const flexibleHandlers = new FlexibleHandlers(bot, userStates);
const settingsHandlers = new SettingsHandlers(bot, userStates);

function getMainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ['➕ Добавить маршрут', '🔍 Гибкий поиск'],
        ['📋 Мои маршруты', '🔍 Мои гибкие'],
        ['📊 Лучшие варианты', '📈 История цен'],
        ['✏️ Редактировать', '🗑 Удалить'],
        ['📊 Статистика', '⚙️ Настройки'],
        ['✅ Проверить сейчас', '🎯 Проверить один'],  // 🔥 ИЗМЕНЕНО
        ['ℹ️ Помощь']  // 🔥 ПЕРЕНЕСЕНО НА НОВУЮ СТРОКУ
      ],
      resize_keyboard: true,
      persistent: true
    }
  };
}

function initUserSettings(chatId) {
  db.run(`INSERT OR IGNORE INTO user_settings (chat_id) VALUES (?)`, [chatId]);
  db.run(
    `INSERT OR IGNORE INTO user_stats (chat_id, total_routes, total_flexible) 
     VALUES (?, 
       (SELECT COUNT(*) FROM routes WHERE chat_id = ?),
       (SELECT COUNT(*) FROM flexible_routes WHERE chat_id = ?)
     )`,
    [chatId, chatId, chatId]
  );
}

// Команды
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  initUserSettings(chatId);

  const welcomeMessage =
    '👋 Добро пожаловать в бот поиска авиабилетов v3.0!\n\n' +
    '✈️ ОБЫЧНЫЕ МАРШРУТЫ:\n' +
    'Конкретные даты вылета и возврата\n\n' +
    '🔍 ГИБКИЙ ПОИСК:\n' +
    'Задайте диапазон дат вылета (25 фев - 10 мар) и пребывания (27-30 дней)\n' +
    '→ Бот найдет все комбинации и покажет топ-5 лучших!\n\n' +
    '⚡ Автопроверка каждые 2 часа\n' +
    '🔔 Уведомления о снижении цен\n' +
    '📊 История лучших предложений\n\n' +
    'Используйте кнопки меню ниже 👇';

  bot.sendMessage(chatId, welcomeMessage, getMainMenuKeyboard());
});

bot.onText(/\/add/, (msg) => {
  routeHandlers.handleAddRoute(msg.chat.id);
});

bot.onText(/\/flexible/, (msg) => {
  flexibleHandlers.handleAddFlexible(msg.chat.id);
});

bot.onText(/\/list/, (msg) => {
  routeHandlers.handleListRoutes(msg.chat.id);
});

bot.onText(/\/list_flexible/, (msg) => {
  flexibleHandlers.handleListFlexible(msg.chat.id);
});

bot.onText(/\/stats/, (msg) => {
  settingsHandlers.handleStats(msg.chat.id);
});

bot.onText(/\/settings/, (msg) => {
  settingsHandlers.handleSettings(msg.chat.id);
});

bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🔄 Запускаю проверку всех маршрутов...');

  await priceMonitor.checkPrices();
  await flexibleMonitor.checkAllRoutes();

  bot.sendMessage(chatId, '✅ Проверка завершена!', getMainMenuKeyboard());
});

bot.onText(/\/check_prices/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, '🔍 Запускаю проверку цен...\n⏳ Это может занять несколько минут.');

    const FlexibleMonitor = require('./services/FlexibleMonitor');
    const monitor = new FlexibleMonitor(process.env.AVIASALES_TOKEN, bot);

    await monitor.checkAllRoutes();
    await monitor.close();

    await bot.sendMessage(chatId, '✅ Проверка завершена! Если найдены хорошие цены, вы получите уведомление.');
  } catch (error) {
    console.error('Ошибка проверки:', error);
    await bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
  }
});

bot.onText(/\/report/, (msg) => {
  priceMonitor.generateDailyReport(msg.chat.id);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    // Проверка цены обычного маршрута
    if (data.startsWith('check_price_')) {
      const routeId = parseInt(data.replace('check_price_', ''));
      console.log(`📸 Запрос цены для маршрута ${routeId} от пользователя ${chatId}`);
      await routeHandlers.handleCheckPrice(chatId, routeId);
      bot.answerCallbackQuery(query.id, { text: '✅ Проверяю цену...' });
      return;
    }

    // 🔥 НОВЫЕ ОБРАБОТЧИКИ ДЛЯ СТАТИСТИКИ
    if (data === 'general_analytics') {
      await settingsHandlers.handleGeneralAnalytics(chatId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'regular_route_stats') {
      await settingsHandlers.handleRegularRouteStats(chatId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'flexible_route_stats') {
      await settingsHandlers.handleFlexibleRouteStats(chatId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'price_trends_menu') {
      await settingsHandlers.handlePriceTrendsMenu(chatId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('route_stats_')) {
      const routeId = parseInt(data.replace('route_stats_', ''));
      await settingsHandlers.showRouteStatistics(chatId, routeId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('flex_stats_')) {
      const routeId = parseInt(data.replace('flex_stats_', ''));
      await settingsHandlers.showFlexibleRouteStatistics(chatId, routeId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('route_trend_')) {
      const routeId = parseInt(data.replace('route_trend_', ''));
      await settingsHandlers.showPriceTrend(chatId, routeId, false);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('flex_trend_')) {
      const routeId = parseInt(data.replace('flex_trend_', ''));
      await settingsHandlers.showPriceTrend(chatId, routeId, true);
      bot.answerCallbackQuery(query.id);
      return;
    }

    // Детальная аналитика (старый обработчик, можно оставить)
    if (data === 'detailed_analytics') {
      const dayAnalysis = await PriceAnalytics.analyzeByDayOfWeek(chatId);
      const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
      let message = '📊 ДЕТАЛЬНАЯ АНАЛИТИКА\n\n';
      message += 'Средние цены по дням недели:\n\n';

      if (dayAnalysis.length === 0) {
        message += 'Недостаточно данных. Продолжайте использовать бота!';
      } else {
        dayAnalysis.forEach(day => {
          const dayName = days[day.day_of_week];
          const icon = day.is_weekend ? '🏖' : '💼';
          message += `${icon} ${dayName}: ${Math.floor(day.avg_price).toLocaleString('ru-RU')} ₽\n`;
          message += `  └ от ${Math.floor(day.min_price).toLocaleString('ru-RU')} до ${Math.floor(day.max_price).toLocaleString('ru-RU')} ₽\n`;
        });
      }

      await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'price_trends') {
      await bot.sendMessage(chatId, '📈 Выберите маршрут для просмотра трендов:', {
        reply_markup: {
          inline_keyboard: [[
            { text: '◀️ Назад к статистике', callback_data: 'back_to_stats' }
          ]]
        }
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'back_to_stats') {
      await settingsHandlers.handleStats(chatId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    // Если ничего не подошло
    bot.answerCallbackQuery(query.id);

  } catch (error) {
    console.error('Ошибка callback:', error);
    bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
  }
});

// Обработка кнопок и сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) return;

  // Главное меню
  if (text === '➕ Добавить маршрут') {
    routeHandlers.handleAddRoute(chatId);
    return;
  }

  if (text === '🔍 Гибкий поиск') {
    flexibleHandlers.handleAddFlexible(chatId);
    return;
  }

  if (text === '📋 Мои маршруты') {
    routeHandlers.handleListRoutes(chatId);
    return;
  }

  if (text === '🔍 Мои гибкие') {
    flexibleHandlers.handleListFlexible(chatId);
    return;
  }

  if (text === '📊 Лучшие варианты') {
    flexibleHandlers.handleShowTopResults(chatId);
    return;
  }

  if (text === '📈 История цен') {
    routeHandlers.handleShowHistory(chatId);
    return;
  }

  if (text === '🎯 Проверить один') {
    flexibleHandlers.handleCheckOne(chatId);
    return;
  }

  if (text === '✏️ Редактировать') {
    bot.sendMessage(chatId, 'Выберите тип маршрута:', {
      reply_markup: {
        keyboard: [
          ['✈️ Обычный маршрут'],
          ['🔍 Гибкий маршрут'],
          ['◀️ Главное меню']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
    userStates[chatId] = { step: 'edit_type_select' };
    return;
  }

  if (text === '🗑 Удалить') {
    bot.sendMessage(chatId, 'Выберите тип маршрута:', {
      reply_markup: {
        keyboard: [
          ['✈️ Обычный маршрут'],
          ['🔍 Гибкий маршрут'],
          ['◀️ Главное меню']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
    userStates[chatId] = { step: 'delete_type_select' };
    return;
  }

  if (text === '📊 Статистика') {
    settingsHandlers.handleStats(chatId);
    return;
  }

  if (text === '⚙️ Настройки') {
    settingsHandlers.handleSettings(chatId);
    return;
  }

  if (text === '✅ Проверить сейчас') {
    flexibleHandlers.handleCheckNow(chatId);
    return;
  }

  if (text === 'ℹ️ Помощь') {
    const helpMessage =
      '📖 СПРАВКА\n\n' +
      '✈️ ОБЫЧНЫЕ МАРШРУТЫ:\n' +
      '• Конкретные даты вылета/возврата\n' +
      '• Редактирование порога цены\n' +
      '• История топ-3 лучших цен\n' +
      '• Автоудаление прошедших\n\n' +
      '🔍 ГИБКИЙ ПОИСК:\n' +
      '• Диапазон дат вылета (25.02-10.03)\n' +
      '• Диапазон пребывания (27-30 дней)\n' +
      '• Автоматический поиск всех комбинаций\n' +
      '• Топ-5 лучших вариантов\n\n' +
      '💡 Коды аэропортов:\n' +
      '• SVX - Екатеринбург\n' +
      '• MOW - Москва\n' +
      '• DXB - Дубай\n' +
      '• DPS - Денпасар (Бали)\n' +
      '• LED - Санкт-Петербург\n\n' +
      '📱 Команды:\n' +
      '/add - обычный маршрут\n' +
      '/flexible - гибкий поиск\n' +
      '/list - мои маршруты\n' +
      '/stats - статистика\n' +
      '/settings - настройки\n' +
      '/check - проверить сейчас\n\n' +
      '⚠️ Цены примерные с учетом всех пассажиров';

    bot.sendMessage(chatId, helpMessage, getMainMenuKeyboard());
    return;
  }

  if (text === '◀️ Главное меню' || text === '◀️ Отмена') {
    delete userStates[chatId];
    bot.sendMessage(chatId, 'Главное меню:', getMainMenuKeyboard());
    return;
  }

  // Обработка состояний
  if (!userStates[chatId]) return;

  const state = userStates[chatId];

  // Выбор типа для редактирования
  if (state.step === 'edit_type_select') {
    if (text === '✈️ Обычный маршрут') {
      delete userStates[chatId];
      routeHandlers.handleEditRoute(chatId);
    } else if (text === '🔍 Гибкий маршрут') {
      delete userStates[chatId];
      flexibleHandlers.handleEditFlexible(chatId); // <-- ФИКС: Добавили
    }
    return;
  }

  if (state && state.step === 'flex_check_select') {
    if (await flexibleHandlers.handleCheckSelectStep(chatId, text)) return;
  }

  // Выбор типа для удаления
  if (state.step === 'delete_type_select') {
    if (text === '✈️ Обычный маршрут') {
      delete userStates[chatId];
      routeHandlers.handleDeleteRoute(chatId);
    } else if (text === '🔍 Гибкий маршрут') {
      delete userStates[chatId];
      flexibleHandlers.handleDeleteFlexible(chatId);
    }
    return;
  }

  // Обработка шагов обычного маршрута
  if (state.type === 'regular') {
    if (routeHandlers.handleRouteStep(chatId, text)) {
      return;
    }
  }

  // Обработка шагов гибкого поиска
  if (state.type === 'flexible') {
    if (flexibleHandlers.handleFlexibleStep(chatId, text)) {
      return;
    }
  }

  // Обработка настроек
  if (state.step === 'settings_menu') {
    if (settingsHandlers.handleSettingsStep(chatId, text)) {
      return;
    }
  }

  if (state.step === 'settings_quiet') {
    if (settingsHandlers.handleQuietHours(chatId, text)) {
      return;
    }
  }

  if (state.step === 'settings_frequency') {
    if (settingsHandlers.handleFrequency(chatId, text)) {
      return;
    }
  }

  if (state.step === 'settings_notify') {
    if (settingsHandlers.handleNotifications(chatId, text)) {
      return;
    }
  }

  // Обработка статистики
  if (state.step === 'stats_menu') {
    if (settingsHandlers.handleStatsMenuStep(chatId, text)) {
      return;
    }
  }

  if (state.step === 'stats_back') {
    if (text === '◀️ Назад к статистике') {
      settingsHandlers.handleStats(chatId);
      return;
    }
  }

  if (state.step === 'route_stats_select') {
    if (text === '◀️ Назад к статистике') {
      settingsHandlers.handleStats(chatId);
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];
      if (route) {
        await settingsHandlers.showRouteStatistics(chatId, route);
      }
    }
    return;
  }

  if (state.step === 'flex_stats_select') {
    if (text === '◀️ Назад к статистике') {
      settingsHandlers.handleStats(chatId);
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];
      if (route) {
        await settingsHandlers.showFlexibleRouteStatistics(chatId, route);
      }
    }
    return;
  }

  if (state.step === 'route_stats_detail' || state.step === 'flex_stats_detail') {
    if (text === '📈 Посмотреть тренд') {
      await settingsHandlers.showPriceTrend(chatId, state.route, state.step === 'flex_stats_detail');
      return;
    }
    if (text === '◀️ Назад к статистике') {
      settingsHandlers.handleStats(chatId);
      return;
    }
  }

  if (state.step === 'trend_select') {
    if (text === '◀️ Назад к статистике') {
      settingsHandlers.handleStats(chatId);
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];
      if (route) {
        await settingsHandlers.showPriceTrend(chatId, route, route.isFlexible);
      }
    }
    return;
  }

  // Редактирование гибкого маршрута - выбор маршрута
  if (state.step === 'flex_edit_select') {
    if (text === '◀️ Отмена') {
      bot.sendMessage(chatId, 'Отменено', getMainMenuKeyboard());
      delete userStates[chatId];
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];

      if (route) {
        const keyboard = {
          reply_markup: {
            keyboard: [
              ['💰 Изменить порог цены'],
              ['⏸️ Приостановить', '▶️ Возобновить'],
              ['◀️ Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        };

        bot.sendMessage(
          chatId,
          `✏️ Редактирование гибкого маршрута:\n` +
          `${route.origin} → ${route.destination}\n` +
          `Вылет: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n` +
          `Пребывание: ${route.min_days}-${route.max_days} дней\n` +
          `Текущий порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n` +
          `Статус: ${route.is_paused ? '⏸️ Приостановлен' : '✅ Активен'}\n\n` +
          `Что изменить?`,
          keyboard
        );

        state.step = 'flex_edit_action';
        state.selected_route = route;
      }
    }
    return;
  }

  // Редактирование гибкого маршрута - выбор действия
  if (state.step === 'flex_edit_action') {
    if (text === '💰 Изменить порог цены') {
      bot.sendMessage(
        chatId,
        `Текущий порог: ${Formatters.formatPrice(state.selected_route.threshold_price, state.selected_route.currency)}\n\n` +
        `Введите новый порог цены в рублях:`,
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'flex_edit_price';
    } else if (text === '⏸️ Приостановить') {
      FlexibleRoute.togglePause(state.selected_route.id, chatId, 1).then(() => {
        bot.sendMessage(chatId, '⏸️ Гибкий маршрут приостановлен', getMainMenuKeyboard());
        delete userStates[chatId];
      });
    } else if (text === '▶️ Возобновить') {
      FlexibleRoute.togglePause(state.selected_route.id, chatId, 0).then(() => {
        bot.sendMessage(chatId, '▶️ Гибкий маршрут возобновлен', getMainMenuKeyboard());
        delete userStates[chatId];
      });
    } else if (text === '◀️ Отмена') {
      bot.sendMessage(chatId, 'Отменено', getMainMenuKeyboard());
      delete userStates[chatId];
    }
    return;
  }

  // Редактирование гибкого маршрута - ввод новой цены
  if (state.step === 'flex_edit_price') {
    const newPrice = parseFloat(text);
    if (isNaN(newPrice) || newPrice <= 0) {
      bot.sendMessage(chatId, '❌ Неверная цена. Введите число:');
      return;
    }

    FlexibleRoute.updateThreshold(state.selected_route.id, chatId, newPrice).then(() => {
      bot.sendMessage(
        chatId,
        `✅ Порог цены обновлен!\n` +
        `${state.selected_route.origin} → ${state.selected_route.destination}\n` +
        `Было: ${Formatters.formatPrice(state.selected_route.threshold_price, state.selected_route.currency)}\n` +
        `Стало: ${Formatters.formatPrice(newPrice, state.selected_route.currency)}`,
        getMainMenuKeyboard()
      );
      delete userStates[chatId];
    });
    return;
  }

  // Редактирование обычного маршрута
  if (state.step === 'edit_select' && state.type === 'regular') {
    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];

      if (route) {
        const keyboard = {
          reply_markup: {
            keyboard: [
              ['💰 Изменить порог цены'],
              ['⏸️ Приостановить', '▶️ Возобновить'],
              ['◀️ Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        };

        bot.sendMessage(
          chatId,
          `✏️ Редактирование маршрута:\n` +
          `${route.origin} → ${route.destination}\n` +
          `Текущий порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n` +
          `Статус: ${route.is_paused ? '⏸️ Приостановлен' : '✅ Активен'}\n\n` +
          `Что изменить?`,
          keyboard
        );

        state.step = 'edit_action';
        state.selected_route = route;
      }
    }
    return;
  }

  if (state.step === 'edit_action' && state.type === 'regular') {
    if (text === '💰 Изменить порог цены') {
      bot.sendMessage(
        chatId,
        `Текущий порог: ${Formatters.formatPrice(state.selected_route.threshold_price, state.selected_route.currency)}\n\n` +
        `Введите новый порог цены в рублях:`,
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'edit_price';
    } else if (text === '⏸️ Приостановить') {
      Route.togglePause(state.selected_route.id, chatId, 1).then(() => {
        bot.sendMessage(chatId, '⏸️ Маршрут приостановлен', getMainMenuKeyboard());
        delete userStates[chatId];
      });
    } else if (text === '▶️ Возобновить') {
      Route.togglePause(state.selected_route.id, chatId, 0).then(() => {
        bot.sendMessage(chatId, '▶️ Маршрут возобновлен', getMainMenuKeyboard());
        delete userStates[chatId];
      });
    } else if (text === '◀️ Отмена') {
      bot.sendMessage(chatId, 'Отменено', getMainMenuKeyboard());
      delete userStates[chatId];
    }
    return;
  }

  if (state.step === 'edit_price' && state.type === 'regular') {
    const newPrice = parseFloat(text);
    if (isNaN(newPrice) || newPrice <= 0) {
      bot.sendMessage(chatId, '❌ Неверная цена. Введите число:');
      return;
    }

    Route.updateThreshold(state.selected_route.id, chatId, newPrice).then(() => {
      bot.sendMessage(
        chatId,
        `✅ Порог цены обновлен!\n` +
        `${state.selected_route.origin} → ${state.selected_route.destination}\n` +
        `Было: ${Formatters.formatPrice(state.selected_route.threshold_price, state.selected_route.currency)}\n` +
        `Стало: ${Formatters.formatPrice(newPrice, state.selected_route.currency)}`,
        getMainMenuKeyboard()
      );
      delete userStates[chatId];
    });
    return;
  }

  // Удаление обычного маршрута
  if (state.step === 'delete_confirm' && state.type === 'regular') {
    if (text === '◀️ Отмена') {
      bot.sendMessage(chatId, 'Удаление отменено', getMainMenuKeyboard());
      delete userStates[chatId];
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];

      if (route) {
        Route.delete(route.id, chatId).then(() => {
          bot.sendMessage(
            chatId,
            `✅ Маршрут ${route.origin} → ${route.destination} удален`,
            getMainMenuKeyboard()
          );
          delete userStates[chatId];
        });
      }
    }
    return;
  }

  // Просмотр истории - выбор маршрута
  if (state.step === 'history_select') {
    if (text === '◀️ Главное меню') {
      delete userStates[chatId];
      bot.sendMessage(chatId, 'Главное меню:', getMainMenuKeyboard());
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];

      if (route) {
        delete userStates[chatId];

        if (route.type === 'regular') {
          await routeHandlers.showRegularRouteHistory(chatId, route);
        } else if (route.type === 'flexible') {
          await routeHandlers.showFlexibleRouteHistory(chatId, route);
        }
      }
    }
    return;
  }

  // Выбор типа истории для гибкого маршрута
  if (state.step === 'flex_history_type') {
    if (text === '◀️ Главное меню') {
      delete userStates[chatId];
      bot.sendMessage(chatId, 'Главное меню:', getMainMenuKeyboard());
      return;
    }

    if (text === '📊 Сводка по дням') {
      delete userStates[chatId];
      await routeHandlers.showFlexibleRouteDailySummary(chatId, state.route);
      return;
    }

    if (text === '📋 Детальная история') {
      delete userStates[chatId];
      await routeHandlers.showFlexibleRouteDetailedHistory(chatId, state.route);
      return;
    }
  }

  // Просмотр результатов гибкого поиска
  if (state.step === 'flex_show_results') {
    if (text === '◀️ Отмена') {
      bot.sendMessage(chatId, 'Отменено', getMainMenuKeyboard());
      delete userStates[chatId];
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];
      if (route) {
        // 🔥 ИСПОЛЬЗУЕМ НОВЫЙ МЕТОД
        await flexibleHandlers.sendTopResultsWithScreenshots(chatId, route);
        delete userStates[chatId];
      }
    }
    return;
  }

  // Удаление гибкого маршрута
  if (state.step === 'flex_delete_confirm') {
    if (text === '◀️ Отмена') {
      bot.sendMessage(chatId, 'Удаление отменено', getMainMenuKeyboard());
      delete userStates[chatId];
      return;
    }

    const match = text.match(/^(\d+)\./);
    if (match) {
      const index = parseInt(match[1]) - 1;
      const route = state.routes[index];

      if (route) {
        const FlexibleRoute = require('./models/FlexibleRoute');
        FlexibleRoute.delete(route.id, chatId).then(() => {
          bot.sendMessage(
            chatId,
            `✅ Гибкий маршрут ${route.origin} → ${route.destination} удален`,
            getMainMenuKeyboard()
          );
          delete userStates[chatId];
        });
      }
    }
    return;
  }

  // 🔥 ДОБАВЬТЕ ЭТО: Выборочная проверка гибкого маршрута
  if (state.step === 'flex_check_select') {
    if (await flexibleHandlers.handleCheckSelectStep(chatId, text)) {
      return;
    }
  }
});

// Graceful shutdown
let isShuttingDown = false;

const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n⚠️ Получен сигнал остановки, завершаем работу...');

  if (global.flexibleMonitor) {
    await global.flexibleMonitor.close();
  }

  console.log('👋 Бот остановлен');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGQUIT', shutdown);

// Сохраняем экземпляр монитора глобально
global.flexibleMonitor = flexibleMonitor;


// Запуск планировщика
setupScheduler(priceMonitor, flexibleMonitor);

console.log('\n========================================');
console.log('🤖 Бот v3.0 запущен успешно!');
console.log('✈️ Обычные маршруты + 🔍 Гибкий поиск');
console.log('========================================\n');
