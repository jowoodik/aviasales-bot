const Route = require('../models/Route');
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
          ['✅ Проверить сейчас', 'ℹ️ Помощь']
        ],
        resize_keyboard: true,
        persistent: true
      }
    };
  }

  async handleListRoutes(chatId) {
    const routes = await Route.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '📋 У вас нет сохраненных маршрутов', this.getMainMenuKeyboard());
      return;
    }

    let message = '📋 <b>ВАШИ МАРШРУТЫ</b>\n\n';

    routes.forEach((route, index) => {
      const status = route.is_paused ? '⏸️' : '✅';
      const passengersText = Formatters.formatPassengers(route.adults, route.children);
      const baggageIcon = route.baggage ? '🧳' : '';

      message += `${index + 1}. ${status} <b>${route.origin} → ${route.destination}</b>\n`;
      message += `   📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n`;
      message += `   👥 ${passengersText} ${baggageIcon}\n`;
      message += `   💰 Порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;

      if (route.airline) {
        message += `   ✈️ ${route.airline}\n`;
      }

      message += `\n`;
    });

    // 🔥 НОВОЕ: Кнопки для получения актуальной цены
    const keyboard = {
      inline_keyboard: []
    };

    routes.forEach((route, index) => {
      keyboard.inline_keyboard.push([
        {
          text: `📸 Цена №${index + 1} (${route.origin}-${route.destination})`,
          callback_data: `check_price_${route.id}`
        }
      ]);
    });

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  async handleAddRoute(chatId) {
    this.bot.sendMessage(
      chatId,
      '✈️ Добавление маршрута\n\n' +
      'Введите код аэропорта вылета (например, SVX для Екатеринбурга):',
      { reply_markup: { remove_keyboard: true } }
    );

    this.userStates[chatId] = {
      type: 'regular',
      step: 'origin',
      data: {}
    };
  }

  handleRouteStep(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.type !== 'regular') return false;

    const { step, data } = state;

    if (step === 'origin') {
      if (text.length !== 3) {
        this.bot.sendMessage(chatId, '❌ Код должен быть из 3 букв. Попробуйте снова:');
        return true;
      }
      data.origin = text.toUpperCase();
      this.bot.sendMessage(chatId, `✅ Откуда: ${data.origin}\n\nВведите код аэропорта назначения:`);
      state.step = 'destination';
      return true;
    }

    if (step === 'destination') {
      if (text.length !== 3) {
        this.bot.sendMessage(chatId, '❌ Код должен быть из 3 букв. Попробуйте снова:');
        return true;
      }
      data.destination = text.toUpperCase();
      this.bot.sendMessage(
        chatId,
        `✅ Куда: ${data.destination}\n\n` +
        `Введите дату вылета (ДД.ММ.ГГГГ):`
      );
      state.step = 'departure_date';
      return true;
    }

    if (step === 'departure_date') {
      const date = DateUtils.parseDate(text);
      if (!date) {
        this.bot.sendMessage(chatId, '❌ Неверный формат. Используйте ДД.ММ.ГГГГ (например, 25.02.2026):');
        return true;
      }
      data.departure_date = date;
      this.bot.sendMessage(chatId, `✅ Вылет: ${DateUtils.formatDateDisplay(date)}\n\nВведите дату возврата:`);
      state.step = 'return_date';
      return true;
    }

    if (step === 'return_date') {
      const date = DateUtils.parseDate(text);
      if (!date) {
        this.bot.sendMessage(chatId, '❌ Неверный формат. Используйте ДД.ММ.ГГГГ:');
        return true;
      }
      if (date <= data.departure_date) {
        this.bot.sendMessage(chatId, '❌ Дата возврата должна быть позже даты вылета:');
        return true;
      }
      data.return_date = date;

      const keyboard = {
        reply_markup: {
          keyboard: [['1 взрослый'], ['2 взрослых'], ['1+1 (взр+реб)'], ['2+2 (взр+реб)']],
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
      const match = text.match(/(\d+)\+?(\d+)?/);
      if (!match) {
        this.bot.sendMessage(chatId, '❌ Неверный формат. Выберите из предложенных:');
        return true;
      }

      data.adults = parseInt(match[1]) || 1;
      data.children = parseInt(match[2]) || 0;

      const keyboard = {
        reply_markup: {
          keyboard: [['✅ С багажом'], ['❌ Без багажа']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, 'Багаж:', keyboard);
      state.step = 'baggage';
      return true;
    }

    if (step === 'baggage') {
      data.baggage = text.includes('✅') ? 1 : 0;

      this.bot.sendMessage(
        chatId,
        'Укажите код авиакомпании (например, S7, SU) или "любая":',
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'airline';
      return true;
    }

    if (step === 'airline') {
      data.airline = text.toLowerCase() === 'любая' ? null : text.toUpperCase();

      this.bot.sendMessage(chatId, 'Введите порог цены в рублях (например, 50000):');
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
          `✅ Маршрут добавлен!\n\n` +
          `${data.origin} → ${data.destination}\n` +
          `📅 ${DateUtils.formatDateDisplay(data.departure_date)} → ${DateUtils.formatDateDisplay(data.return_date)}\n` +
          `👥 ${Formatters.formatPassengers(data.adults, data.children)}\n` +
          `🧳 ${data.baggage ? 'С багажом' : 'Без багажа'}\n` +
          `✈️ ${data.airline || 'Любая авиакомпания'}\n` +
          `💰 Порог: ${Formatters.formatPrice(price, 'RUB')}\n\n` +
          `Бот будет проверять цены каждые 2 часа`;

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
      this.bot.sendMessage(chatId, '❌ У вас нет маршрутов для редактирования', this.getMainMenuKeyboard());
      return;
    }

    let message = '✏️ Выберите маршрут для редактирования:\n\n';
    const keyboard = { reply_markup: { keyboard: [], one_time_keyboard: true, resize_keyboard: true } };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination} (${DateUtils.formatDateDisplay(route.departure_date)})`;
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
      this.bot.sendMessage(chatId, '❌ У вас нет маршрутов для удаления', this.getMainMenuKeyboard());
      return;
    }

    let message = '🗑 Выберите маршрут для удаления:\n\n';
    const keyboard = { reply_markup: { keyboard: [], one_time_keyboard: true, resize_keyboard: true } };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination} (${DateUtils.formatDateDisplay(route.departure_date)})`;
      message += `${routeText}\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    keyboard.reply_markup.keyboard.push(['◀️ Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);
    this.userStates[chatId] = { type: 'regular', step: 'delete_confirm', routes };
  }

  async handleShowHistory(chatId) {
    const routes = await Route.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '❌ У вас нет маршрутов', this.getMainMenuKeyboard());
      return;
    }

    let message = '📈 Выберите маршрут для просмотра истории:\n\n';
    const keyboard = { reply_markup: { keyboard: [], one_time_keyboard: true, resize_keyboard: true } };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination}`;
      message += `${routeText}\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    keyboard.reply_markup.keyboard.push(['◀️ Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);
    this.userStates[chatId] = { type: 'regular', step: 'history_select', routes };
  }

  // 🔥 НОВЫЙ МЕТОД: Проверка цены по требованию со скриншотом
  async handleCheckPrice(chatId, routeId) {
    await this.bot.sendMessage(chatId, '🔍 Проверяю актуальную цену...\n⏳ Это займет 10-15 секунд');

    try {
      const route = await Route.findById(routeId);

      if (!route || route.chat_id !== chatId) {
        await this.bot.sendMessage(chatId, '❌ Маршрут не найден');
        return;
      }

      // Генерируем ссылку
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

      // Получаем цену через Puppeteer
      const puppeteer = new PuppeteerPricer(false);
      const result = await puppeteer.getPriceFromUrl(searchUrl, 1, 1, route.airline);
      await puppeteer.close();

      if (result && result.price) {
        const passengersText = Formatters.formatPassengers(route.adults, route.children);
        const baggageText = route.baggage ? '✅ С багажом' : '❌ Без багажа';

        let message = `💰 <b>АКТУАЛЬНАЯ ЦЕНА</b>\n\n`;
        message += `📍 ${route.origin} → ${route.destination}\n`;
        message += `💵 <b>${Formatters.formatPrice(result.price, route.currency)}</b>\n`;
        message += `✅ <i>Проверено через браузер</i>\n\n`;
        message += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n`;
        message += `👥 ${passengersText}\n`;
        message += `🧳 ${baggageText}\n`;

        if (route.airline) {
          message += `✈️ ${route.airline}\n`;
        }

        message += `\n💵 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;

        if (result.price <= route.threshold_price) {
          const savings = route.threshold_price - result.price;
          message += `\n🔥 <b>ЦЕНА НИЖЕ ПОРОГА!</b>\n`;
          message += `📉 Экономия: ${Formatters.formatPrice(savings, route.currency)}`;
        }

        const keyboard = {
          inline_keyboard: [[
            { text: '🔗 Купить билет', url: searchUrl }
          ]]
        };

        // Отправляем со скриншотом
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
        await this.bot.sendMessage(chatId, '❌ Не удалось получить цену. Попробуйте позже');
      }
    } catch (error) {
      console.error('Ошибка проверки цены:', error);
      await this.bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  }
}

module.exports = RouteHandlers;
