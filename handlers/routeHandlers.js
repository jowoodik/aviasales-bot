const Route = require('../models/Route');
const FlexibleRoute = require('../models/FlexibleRoute');
const FlexibleResult = require('../models/FlexibleResult');
const AviasalesAPI = require('../services/AviasalesAPI');
const PuppeteerPricer = require('../services/PuppeteerPricer');
const db = require('../config/database');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const fs = require('fs');

class RouteHandlers {
  constructor(bot, userStates) {
    this.bot = bot;
    this.userStates = userStates;
    this.api = new AviasalesAPI(process.env.TRAVELPAYOUTS_TOKEN);
  }

  getMainMenuKeyboard() {
    return {
      reply_markup: {
        keyboard: [
          ['➕ Добавить маршрут', '🔍 Гибкий поиск'],
          ['📋 Мои маршруты', '🔍 Мои гибкие'],
          ['📊 Лучшие варианты', '📈 История цен'],
          ['✏️ Редактировать', '🗑 Удалить'],
          ['📊 Статистика', '⚙️ Настройки'],
          ['✅ Проверить сейчас', '🎯 Проверить один'],
          ['ℹ️ Помощь']
        ],
        resize_keyboard: true,
        persistent: true
      }
    };
  }

  async handleListRoutes(chatId) {
    const routes = await Route.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '✈️ У вас нет обычных маршрутов', this.getMainMenuKeyboard());
      return;
    }

    let message = '✈️ <b>ВАШИ МАРШРУТЫ</b>\n\n';

    routes.forEach((route, index) => {
      const status = route.is_paused ? '⏸️' : '✅';
      const passengersText = Formatters.formatPassengers(route.adults, route.children);
      const baggageIcon = route.baggage ? '🧳' : '';

      message += `${index + 1}. ${status} <b>${route.origin} → ${route.destination}</b>\n`;
      message += `   📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n`;
      message += `   👥 ${passengersText} ${baggageIcon}\n`;
      message += `   💰 ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;
      if (route.airline) {
        message += `   ✈️ ${route.airline}\n`;
      }
      message += '\n';
    });

    const keyboard = {
      inline_keyboard: []
    };

    routes.forEach((route, index) => {
      keyboard.inline_keyboard.push([{
        text: `🔍 ${index + 1}. ${route.origin}→${route.destination}`,
        callback_data: `check_price_${route.id}`
      }]);
    });

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  async handleShowHistory(chatId) {
    try {
      const routes = await Route.findByUser(chatId);
      const flexRoutes = await FlexibleRoute.findByUser(chatId);

      if ((!routes || routes.length === 0) && (!flexRoutes || flexRoutes.length === 0)) {
        this.bot.sendMessage(chatId, '📈 У вас нет маршрутов для просмотра истории', this.getMainMenuKeyboard());
        return;
      }

      let message = '📈 Выберите маршрут для просмотра истории цен:\n\n';
      const keyboard = {
        reply_markup: {
          keyboard: [],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      const allRoutes = [];

      // Добавляем обычные маршруты
      if (routes && routes.length > 0) {
        routes.forEach((route, index) => {
          const depDate = DateUtils.formatDateDisplay(route.departure_date).substring(0, 5);
          const retDate = DateUtils.formatDateDisplay(route.return_date).substring(0, 5);
          const routeText = `${allRoutes.length + 1}. ✈️ ${route.origin}→${route.destination} ${depDate}-${retDate}`;
          message += `${routeText}\n`;
          keyboard.reply_markup.keyboard.push([routeText]);
          allRoutes.push({ ...route, type: 'regular' });
        });
      }

      // Добавляем гибкие маршруты
      if (flexRoutes && flexRoutes.length > 0) {
        flexRoutes.forEach((route, index) => {
          const depStart = DateUtils.formatDateDisplay(route.departure_start).substring(0, 5);
          const depEnd = DateUtils.formatDateDisplay(route.departure_end).substring(0, 5);
          const airline = route.airline;
          const routeText = `${allRoutes.length + 1}. 🔍 ${route.origin}→${route.destination} ${airline} ${depStart}-${depEnd}`;
          message += `${routeText}\n`;
          keyboard.reply_markup.keyboard.push([routeText]);
          allRoutes.push({ ...route, type: 'flexible' });
        });
      }

      keyboard.reply_markup.keyboard.push(['◀️ Главное меню']);

      this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = {
        step: 'history_select',
        routes: allRoutes
      };
    } catch (error) {
      console.error('Ошибка истории цен:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки истории', this.getMainMenuKeyboard());
    }
  }
  async showRegularRouteHistory(chatId, route) {
    try {
      const PriceAnalytics = require('../services/PriceAnalytics');
      const history = await PriceAnalytics.getRegularRoutePriceHistory(route.id, chatId, 30);

      if (!history || history.length === 0) {
        await this.bot.sendMessage(chatId, '📈 Нет истории цен для этого маршрута.\n\nИстория начнет собираться после первой проверки.', this.getMainMenuKeyboard());
        return;
      }

      let message = `📈 ИСТОРИЯ ИЗМЕНЕНИЯ ЦЕН\n\n`;
      message += `✈️ ${route.origin} → ${route.destination}\n`;
      message += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} - ${DateUtils.formatDateDisplay(route.return_date)}\n\n`;

      // Показываем последние 15 изменений
      message += `📊 Последние ${Math.min(history.length, 15)} проверок:\n\n`;

      history.slice(0, 15).forEach((h, i) => {
        const date = new Date(h.found_at).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });

        const priceChange = i < history.length - 1 ?
          (h.price - history[i + 1].price) : 0;

        let changeIcon = '';
        if (priceChange > 0) changeIcon = '📈 ';
        else if (priceChange < 0) changeIcon = '📉 ';
        else changeIcon = '➖ ';

        message += `${changeIcon}${Formatters.formatPrice(h.price, route.currency)}\n`;
        message += `   ✈️ ${h.airline} | 🕒 ${date}\n`;

        if (priceChange !== 0) {
          message += `   ${priceChange > 0 ? '⬆️' : '⬇️'} ${Math.abs(priceChange).toLocaleString('ru-RU')} ₽\n`;
        }
        message += `\n`;
      });

      // Статистика
      const prices = history.map(h => h.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

      message += `📊 Статистика:\n`;
      message += `   💎 Минимум: ${minPrice.toLocaleString('ru-RU')} ₽\n`;
      message += `   📈 Максимум: ${maxPrice.toLocaleString('ru-RU')} ₽\n`;
      message += `   📊 Средняя: ${Math.floor(avgPrice).toLocaleString('ru-RU')} ₽\n`;
      message += `   🎯 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}`;

      await this.bot.sendMessage(chatId, message, this.getMainMenuKeyboard());
    } catch (error) {
      console.error('Ошибка истории обычного маршрута:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки истории', this.getMainMenuKeyboard());
    }
  }

  async showFlexibleRouteHistory(chatId, route) {
    try {
      const PriceAnalytics = require('../services/PriceAnalytics');

      // Сначала спросим - сводная по дням или детальная
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['📊 Сводка по дням'],
            ['📋 Детальная история'],
            ['◀️ Главное меню']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(
        chatId,
        `📈 История цен для гибкого маршрута:\n\n` +
        `🔍 ${route.origin} → ${route.destination}\n` +
        `📅 ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n` +
        `🛬 ${route.min_days}-${route.max_days} дней\n\n` +
        `Выберите формат:`,
        keyboard
      );

      this.userStates[chatId] = {
        step: 'flex_history_type',
        route: route
      };
    } catch (error) {
      console.error('Ошибка истории гибкого маршрута:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки истории', this.getMainMenuKeyboard());
    }
  }

  async showFlexibleRouteDailySummary(chatId, route) {
    try {
      const PriceAnalytics = require('../services/PriceAnalytics');
      const history = await PriceAnalytics.getFlexibleRoutePriceHistory(route.id, 30);

      if (!history || history.length === 0) {
        await this.bot.sendMessage(chatId, '📈 Нет истории цен для этого маршрута.\n\nИстория начнет собираться после первой проверки.', this.getMainMenuKeyboard());
        return;
      }

      let message = `📈 ИСТОРИЯ ИЗМЕНЕНИЯ ЦЕН (СВОДКА ПО ДНЯМ)\n\n`;
      message += `🔍 ${route.origin} → ${route.destination}\n`;
      message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n\n`;

      message += `📊 Последние ${Math.min(history.length, 20)} дней:\n\n`;

      history.slice(0, 20).forEach((h, i) => {
        const date = new Date(h.date).toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit'
        });

        const priceChange = i < history.length - 1 ?
          (h.min_price - history[i + 1].min_price) : 0;

        let changeIcon = '';
        if (priceChange > 0) changeIcon = '📈';
        else if (priceChange < 0) changeIcon = '📉';
        else changeIcon = '➖';

        message += `${changeIcon} ${date}:\n`;
        message += `   💎 Мин: ${Math.floor(h.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `   📊 Ср: ${Math.floor(h.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `   📈 Макс: ${Math.floor(h.max_price).toLocaleString('ru-RU')} ₽\n`;
        message += `   🔍 Проверок: ${h.checks_count}\n`;

        if (priceChange !== 0) {
          message += `   ${priceChange > 0 ? '⬆️' : '⬇️'} ${Math.abs(Math.floor(priceChange)).toLocaleString('ru-RU')} ₽\n`;
        }
        message += `\n`;
      });

      // Статистика
      const minPrices = history.map(h => h.min_price);
      const overallMin = Math.min(...minPrices);
      const overallMax = Math.max(...minPrices);
      const avgMin = minPrices.reduce((a, b) => a + b, 0) / minPrices.length;

      message += `📊 Общая статистика:\n`;
      message += `   💎 Лучшая цена: ${Math.floor(overallMin).toLocaleString('ru-RU')} ₽\n`;
      message += `   📈 Худшая цена: ${Math.floor(overallMax).toLocaleString('ru-RU')} ₽\n`;
      message += `   📊 Средняя: ${Math.floor(avgMin).toLocaleString('ru-RU')} ₽\n`;
      message += `   🎯 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}`;

      await this.bot.sendMessage(chatId, message, this.getMainMenuKeyboard());
    } catch (error) {
      console.error('Ошибка сводки:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки истории', this.getMainMenuKeyboard());
    }
  }

  async showFlexibleRouteDetailedHistory(chatId, route) {
    try {
      const PriceAnalytics = require('../services/PriceAnalytics');
      const history = await PriceAnalytics.getFlexibleRouteDetailedHistory(route.id, 20);

      if (!history || history.length === 0) {
        await this.bot.sendMessage(chatId, '📈 Нет истории цен для этого маршрута.\n\nИстория начнет собираться после первой проверки.', this.getMainMenuKeyboard());
        return;
      }

      let message = `📈 ДЕТАЛЬНАЯ ИСТОРИЯ ЦЕН\n\n`;
      message += `🔍 ${route.origin} → ${route.destination}\n\n`;

      message += `📋 Последние ${Math.min(history.length, 15)} найденных вариантов:\n\n`;

      history.slice(0, 15).forEach((h, i) => {
        const foundDate = new Date(h.found_at).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });

        const priceChange = i < history.length - 1 ?
          (h.total_price - history[i + 1].total_price) : 0;

        let changeIcon = '';
        if (priceChange > 0) changeIcon = '📈';
        else if (priceChange < 0) changeIcon = '📉';
        else changeIcon = '➖';

        message += `${changeIcon} ${h.total_price.toLocaleString('ru-RU')} ₽\n`;
        message += `   ✈️ ${h.airline}\n`;
        message += `   📅 ${DateUtils.formatDateDisplay(h.departure_date)} → ${DateUtils.formatDateDisplay(h.return_date)}\n`;
        message += `   🏝 ${h.days_in_country} дней\n`;
        message += `   🕒 ${foundDate}\n`;

        if (priceChange !== 0) {
          message += `   ${priceChange > 0 ? '⬆️' : '⬇️'} ${Math.abs(priceChange).toLocaleString('ru-RU')} ₽\n`;
        }
        message += `\n`;
      });

      // Статистика
      const prices = history.map(h => h.total_price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

      message += `📊 Статистика:\n`;
      message += `   💎 Минимум: ${Math.floor(minPrice).toLocaleString('ru-RU')} ₽\n`;
      message += `   📈 Максимум: ${Math.floor(maxPrice).toLocaleString('ru-RU')} ₽\n`;
      message += `   📊 Средняя: ${Math.floor(avgPrice).toLocaleString('ru-RU')} ₽\n`;
      message += `   🎯 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}`;

      await this.bot.sendMessage(chatId, message, this.getMainMenuKeyboard());
    } catch (error) {
      console.error('Ошибка детальной истории:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки истории', this.getMainMenuKeyboard());
    }
  }

  async handleAddRoute(chatId) {
    this.bot.sendMessage(
      chatId,
      '✈️ Добавление обычного маршрута\n\nВведите город вылета (SVX, MOW и т.д.):',
      { reply_markup: { remove_keyboard: true } }
    );
    this.userStates[chatId] = { type: 'regular', step: 'origin', data: {} };
  }

  handleRouteStep(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.type !== 'regular') return false;

    const { step, data } = state;

    if (step === 'origin') {
      if (text.length !== 3) {
        this.bot.sendMessage(chatId, '❌ Код аэропорта должен быть из 3 букв. Попробуйте еще раз:');
        return true;
      }
      data.origin = text.toUpperCase();
      this.bot.sendMessage(chatId, `✅ Вылет: ${data.origin}\n\nТеперь введите город назначения:`);
      state.step = 'destination';
      return true;
    }

    if (step === 'destination') {
      if (text.length !== 3) {
        this.bot.sendMessage(chatId, '❌ Код аэропорта должен быть из 3 букв. Попробуйте еще раз:');
        return true;
      }
      data.destination = text.toUpperCase();
      this.bot.sendMessage(
        chatId,
        `✅ Маршрут: ${data.origin} → ${data.destination}\n\nВведите дату вылета (ДД.ММ.ГГГГ или ДД-ММ-ГГГГ), например: 25.02.2026`
      );
      state.step = 'departure_date';
      return true;
    }

    if (step === 'departure_date') {
      const date = DateUtils.parseDate(text);
      if (!date) {
        this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте формат ДД.ММ.ГГГГ, например, 25.02.2026');
        return true;
      }
      data.departure_date = date;
      this.bot.sendMessage(chatId, `✅ Вылет: ${DateUtils.formatDateDisplay(date)}\n\nТеперь введите дату возврата:`);
      state.step = 'return_date';
      return true;
    }

    if (step === 'return_date') {
      const date = DateUtils.parseDate(text);
      if (!date) {
        this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте формат ДД.ММ.ГГГГ');
        return true;
      }
      if (date <= data.departure_date) {
        this.bot.sendMessage(chatId, '❌ Дата возврата должна быть позже даты вылета. Попробуйте еще раз:');
        return true;
      }
      data.return_date = date;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['1 (без детей)', '2 (без детей)'],
            ['1+1 (1 взр + 1 реб)', '2+2'],
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        `✅ Возврат: ${DateUtils.formatDateDisplay(date)}\n\nСколько пассажиров?`,
        keyboard
      );
      state.step = 'passengers';
      return true;
    }

    if (step === 'passengers') {
      const match = text.match(/(\d+)(?:\+(\d+))?/);
      if (!match) {
        this.bot.sendMessage(chatId, '❌ Неверный формат. Используйте: 1, 2, 1+1 и т.д.');
        return true;
      }

      data.adults = parseInt(match[1]) || 1;
      data.children = parseInt(match[2]) || 0;

      const keyboard = {
        reply_markup: {
          keyboard: [['✅ Да', '❌ Нет']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, 'Нужен багаж?', keyboard);
      state.step = 'baggage';
      return true;
    }

    if (step === 'baggage') {
      data.baggage = text.includes('Да') ? 1 : 0;

      this.bot.sendMessage(
        chatId,
        'Укажите авиакомпанию (S7, SU и т.д.) или "Любая":',
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'airline';
      return true;
    }

    if (step === 'airline') {
      data.airline = text.toLowerCase().includes('люб') ? null : text.toUpperCase();

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['5 часов', '10 часов'],
            ['15 часов', '24 часа']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        'Максимальная длительность пересадки (по умолчанию 5)?',
        keyboard
      );
      state.step = 'max_layover';
      return true;
    }

    if (step === 'max_layover') {
      const hours = parseInt(text.replace(/\D/g, ''));
      if (isNaN(hours) || hours <= 0 || hours > 48) {
        this.bot.sendMessage(chatId, '❌ Неверное значение. Введите число от 1 до 48');
        return true;
      }

      data.max_layover_hours = hours;

      this.bot.sendMessage(
        chatId,
        `✅ Макс. пересадка: ${hours} часов\n\nТеперь введите пороговую цену в рублях (например, 50000):`,
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'threshold';
      return true;
    }

    if (step === 'threshold') {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        this.bot.sendMessage(chatId, '❌ Неверная цена. Введите число:');
        return true;
      }

      data.threshold_price = price;

      Route.create(chatId, data).then(() => {
        const summary =
          `✅ Маршрут создан!\n\n` +
          `${data.origin} → ${data.destination}\n` +
          `📅 ${DateUtils.formatDateDisplay(data.departure_date)} → ${DateUtils.formatDateDisplay(data.return_date)}\n` +
          `👥 ${Formatters.formatPassengers(data.adults, data.children)}\n` +
          `${data.baggage ? '🧳 С багажом' : '🎒 Без багажа'}\n` +
          `✈️ ${data.airline || 'Любая авиакомпания'}\n` +
          `⏱ Макс. пересадка: ${data.max_layover_hours}ч\n` +
          `💰 ${Formatters.formatPrice(price, 'RUB')}\n\n` +
          `Бот будет проверять цену каждые 2 часа и уведомит вас о снижении!`;

        this.bot.sendMessage(chatId, summary, this.getMainMenuKeyboard());
        delete this.userStates[chatId];
      });

      return true;
    }

    return false;
  }

  async handleEditRoute(chatId) {
    const routes = await Route.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '✈️ У вас нет обычных маршрутов', this.getMainMenuKeyboard());
      return;
    }

    let message = '✏️ Выберите маршрут для редактирования:\n\n';
    const keyboard = {
      reply_markup: {
        keyboard: [],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination} ${DateUtils.formatDateDisplay(route.departure_date)}`;
      message += `${routeText}\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    keyboard.reply_markup.keyboard.push(['◀️ Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);
    this.userStates[chatId] = { type: 'regular', step: 'edit_select', routes };
  }

  async handleDeleteRoute(chatId) {
    const routes = await Route.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '✈️ У вас нет обычных маршрутов', this.getMainMenuKeyboard());
      return;
    }

    let message = '🗑 Выберите маршрут для удаления:\n\n';
    const keyboard = {
      reply_markup: {
        keyboard: [],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination} ${DateUtils.formatDateDisplay(route.departure_date)}`;
      message += `${routeText}\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    keyboard.reply_markup.keyboard.push(['◀️ Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);
    this.userStates[chatId] = { type: 'regular', step: 'delete_confirm', routes };
  }

  async handleCheckPrice(chatId, routeId) {
    await this.bot.sendMessage(chatId, '🔄 Проверяю цену...\n⏳ Это может занять 10-15 секунд...');

    try {
      const route = await Route.findById(routeId);

      if (!route || route.chat_id !== chatId) {
        await this.bot.sendMessage(chatId, '❌ Маршрут не найден');
        return;
      }

      const searchUrl = this.api.generateSearchLink({
        origin: route.origin,
        destination: route.destination,
        departure_date: route.departure_date,
        return_date: route.return_date,
        adults: route.adults,
        children: route.children,
        airline: route.airline,
        baggage: route.baggage,
        max_stops: route.max_stops
      });

      // Puppeteer
      const puppeteer = new PuppeteerPricer(false);
      const maxlayover_hours = route.max_layover_hours || 5;
      const result = await puppeteer.getPriceFromUrl(searchUrl, 1, 1, route.airline, maxlayover_hours);
      await puppeteer.close();

      if (result && result.price) {
        const passengersText = Formatters.formatPassengers(route.adults, route.children);
        const baggageText = route.baggage ? '🧳 С багажом' : '🎒 Без багажа';

        let message = `💰 <b>ТЕКУЩАЯ ЦЕНА</b>\n\n`;
        message += `✈️ ${route.origin} → ${route.destination}\n`;
        message += `💵 <b>${Formatters.formatPrice(result.price, route.currency)}</b>\n\n`;
        message += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n`;
        message += `👥 ${passengersText}\n`;
        message += `${baggageText}\n`;

        if (route.airline) {
          message += `✈️ ${route.airline}\n`;
        }
        message += `⏱ Макс. пересадка: ${maxlayover_hours || 5}ч\n\n`;
        message += `🎯 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;

        if (result.price <= route.threshold_price) {
          const savings = route.threshold_price - result.price;
          message += `\n🎉 <b>ЦЕНА НИЖЕ ПОРОГА!</b>\n`;
          message += `💰 Экономия: ${Formatters.formatPrice(savings, route.currency)}`;
        }

        const keyboard = {
          inline_keyboard: [[
            { text: '🔗 Открыть поиск', url: searchUrl }
          ]]
        };

        if (result.screenshot && fs.existsSync(result.screenshot)) {
          await this.bot.sendPhoto(chatId, result.screenshot, {
            caption: message,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } else {
          await this.bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        }
      } else {
        await this.bot.sendMessage(chatId, '❌ Не удалось получить цену. Попробуйте позже.');
      }
    } catch (error) {
      console.error('Ошибка проверки цены:', error);
      await this.bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  }
}

module.exports = RouteHandlers;
