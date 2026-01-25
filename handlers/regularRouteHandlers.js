const Route = require('../models/Route');
const AviasalesAPI = require('../services/AviasalesAPI');
const AviasalesPricer = require('../services/AviasalesPricer');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const fs = require('fs');

class RegularRouteHandlers {
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
          ['💎 Лучшее сейчас', '✏️ Редактировать'],
          ['📊 Статистика', '🗑 Удалить'],
          ['⚙️ Настройки', '✅ Проверить сейчас'],
          ['ℹ️ Помощь'],
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

    let message = '📋 Ваши маршруты:\n\n';

    routes.forEach((route, index) => {
      const status = route.is_paused ? '⏸' : '✅';
      const passengersText = Formatters.formatPassengers(route.adults, route.children);
      const baggageIcon = route.baggage ? '🧳' : '🎒';

      message += `${index + 1}. ${status} ${route.origin} → ${route.destination}\n`;
      message += `   ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n`;
      message += `   ${passengersText} ${baggageIcon}\n`;
      message += `   💰 ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;
      if (route.airline) {
        message += `   ✈️ ${route.airline}\n`;
      }
      message += `\n`;
    });

    const keyboard = {
      inline_keyboard: []
    };

    routes.forEach((route, index) => {
      keyboard.inline_keyboard.push([
        { text: `${index + 1}. ${route.origin}→${route.destination}`, callback_data: `check_price_${route.id}` }
      ]);
      keyboard.inline_keyboard.push([
        { text: '⚖️ Сравнение', callback_data: `compare_${route.id}` }
      ]);
    });

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  async handleAddRoute(chatId) {
    this.userStates[chatId] = {
      type: 'regular',
      step: 'origin',
      data: {}
    };

    const keyboard = {
      reply_markup: {
        keyboard: [
          ['SVX (Екатеринбург)', 'MOW (Москва)'],
          ['LED (Санкт-Петербург)', 'DXB (Дубай)'],
          ['DPS (Бали)'],
          ['🔙 Отмена']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    this.bot.sendMessage(
      chatId,
      '📍 Введите город вылета (например, SVX, MOW и т.д.):',
      keyboard
    );
  }

  handleRouteStep(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.type !== 'regular') return false;

    const { step, data } = state;

    if (step === 'origin') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      data.origin = Formatters.parseAirportCode(text);
      if (!data.origin) {
        this.bot.sendMessage(chatId, '❌ Неверный код аэропорта. Попробуйте еще раз:');
        return true;
      }

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['SVX (Екатеринбург)', 'MOW (Москва)'],
            ['LED (Санкт-Петербург)', 'DXB (Дубай)'],
            ['DPS (Бали)'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        `✅ Вылет: ${data.origin}\n\nТеперь введите город назначения:`,
        keyboard
      );

      state.step = 'destination';
      return true;
    }

    if (step === 'destination') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      data.destination = Formatters.parseAirportCode(text);
      if (!data.destination) {
        this.bot.sendMessage(chatId, '❌ Неверный код аэропорта. Попробуйте еще раз:');
        return true;
      }

      this.bot.sendMessage(
        chatId,
        `✅ Маршрут: ${data.origin} → ${data.destination}\n\nВведите дату вылета (ДД-ММ-ГГГГ), например: 25-02-2026`,
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'departure_date';
      return true;
    }

    if (step === 'departure_date') {
      const date = DateUtils.convertDateFormat(text);
      if (!date) {
        this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД-ММ-ГГГГ, например: 25-02-2026');
        return true;
      }

      data.departure_date = date;
      this.bot.sendMessage(chatId, `✅ Дата вылета: ${DateUtils.formatDateDisplay(date)}`);
      state.step = 'return_date';
      return true;
    }

    if (step === 'return_date') {
      const date = DateUtils.convertDateFormat(text);
      if (!date) {
        this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД-ММ-ГГГГ');
        return true;
      }

      if (date <= data.departure_date) {
        this.bot.sendMessage(chatId, '❌ Дата возврата должна быть позже вылета.');
        return true;
      }

      data.return_date = date;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['1', '2'],
            ['3', '4'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        `✅ Дата возврата: ${DateUtils.formatDateDisplay(date)}\n\nКоличество взрослых?`,
        keyboard
      );
      state.step = 'adults';
      return true;
    }

    if (step === 'adults') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      const adults = parseInt(text);
      if (isNaN(adults) || adults < 1 || adults > 9) {
        this.bot.sendMessage(chatId, '❌ Введите число от 1 до 9.');
        return true;
      }

      data.adults = adults;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['0 (без детей)'],
            ['1', '2'],
            ['3', '4'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, `✅ Взрослых: ${adults}\n\nКоличество детей?`, keyboard);
      state.step = 'children';
      return true;
    }

    if (step === 'children') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      let children = text.includes('без') ? 0 : parseInt(text);
      if (isNaN(children) || children < 0 || children > 8) {
        this.bot.sendMessage(chatId, '❌ Введите число от 0 до 8.');
        return true;
      }

      data.children = children;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['✅ Да'],
            ['❌ Нет'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, '🧳 Нужен багаж?', keyboard);
      state.step = 'baggage';
      return true;
    }

    if (step === 'baggage') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      data.baggage = text.includes('Да') ? 1 : 0;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['🌐 Аэрофлот (SU)'],
            ['Etihad (EY)', 'Emirates (EK)'],
            ['S7 (S7)'],
            ['🌍 Любая'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        'Авиакомпания:',
        keyboard
      );
      state.step = 'airline';
      return true;
    }

    if (step === 'airline') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      if (text.includes('Аэрофлот')) data.airline = 'SU';
      else if (text.includes('Etihad')) data.airline = 'EY';
      else if (text.includes('Emirates')) data.airline = 'EK';
      else if (text.includes('S7')) data.airline = 'S7';
      else if (text.includes('Любая')) data.airline = null;
      else data.airline = Formatters.parseAirportCode(text);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['0 (прямые)'],
            ['1 (макс. 1)'],
            ['2 (макс. 2)'],
            ['🌍 Любое'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        'Макс. количество пересадок?',
        keyboard
      );
      state.step = 'max_stops';
      return true;
    }

    if (step === 'max_stops') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      if (text.includes('0') || text.includes('прямые')) {
        data.max_stops = 0;
        data.max_layover_hours = 0;
      } else if (text.includes('1')) {
        data.max_stops = 1;
      } else if (text.includes('2')) {
        data.max_stops = 2;
      } else if (text.includes('🌍')) {
        data.max_stops = 99;
      } else {
        data.max_stops = 99;
      }

      if (data.max_stops === 0) {
        this.bot.sendMessage(
          chatId,
          'Введите пороговую цену (в рублях), например: 50000',
          { reply_markup: { remove_keyboard: true } }
        );
        state.step = 'threshold';
        return true;
      }

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['5 ч'],
            ['10 ч'],
            ['15 ч'],
            ['24 ч'],
            ['🔙 Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(
        chatId,
        'Макс. время пересадки (в часах), например: 5?',
        keyboard
      );
      state.step = 'max_layover';
      return true;
    }

    if (step === 'max_layover') {
      if (text === '🔙 Отмена') {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
        return true;
      }

      const hours = parseInt(text.replace(/\D/g, ''));
      if (isNaN(hours) || hours <= 0 || hours > 48) {
        this.bot.sendMessage(chatId, '❌ Некорректное значение. Введите от 1 до 48 часов.');
        return true;
      }

      data.max_layover_hours = hours;

      this.bot.sendMessage(
        chatId,
        `✅ Макс. время пересадки: ${hours} ч\n\nВведите пороговую цену (в рублях), например: 50000`,
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'threshold';
      return true;
    }

    if (step === 'threshold') {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        this.bot.sendMessage(chatId, '❌ Некорректная цена.');
        return true;
      }

      data.threshold_price = price;

      Route.create(chatId, {
        ...data,
        max_stops: data.max_stops || 99,
        max_layover_hours: data.max_layover_hours || 5
      }).then(() => {
        const stopsText = data.max_stops === 0 ? '✈️ Прямой рейс' :
          data.max_stops === 1 ? '🔄 Макс. 1 пересадка' :
            data.max_stops === 2 ? '🔄 Макс. 2 пересадки' :
              '🔄 Любое кол-во пересадок';

        const layoverText = data.max_stops === 0 ? '' : ` (⏱ до ${data.max_layover_hours} ч)`;

        const summary =
          '✅ Маршрут добавлен!\n\n' +
          `📍 ${data.origin} → ${data.destination}\n` +
          `📅 ${DateUtils.formatDateDisplay(data.departure_date)} → ${DateUtils.formatDateDisplay(data.return_date)}\n` +
          `👥 ${Formatters.formatPassengers(data.adults, data.children)}\n` +
          `🧳 ${data.baggage ? 'С багажом' : 'Без багажа'}\n` +
          `✈️ ${data.airline || 'Любая авиакомпания'}\n` +
          `${stopsText}${layoverText}\n` +
          `💰 ${Formatters.formatPrice(price, 'RUB')}\n\n` +
          '⏰ Бот начнет автоматическую проверку каждые 2 часа!';

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
      this.bot.sendMessage(chatId, '📋 У вас нет маршрутов для редактирования.', this.getMainMenuKeyboard());
      return;
    }

    let message = '✏️ Выберите маршрут для редактирования:\n\n';

    const keyboard = {
      reply_markup: {
        keyboard: [
          ['🔙 Отмена']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    routes.forEach((route, index) => {
      const depDate = DateUtils.formatDateDisplay(route.departure_date).substring(0, 5);
      const retDate = DateUtils.formatDateDisplay(route.return_date).substring(0, 5);
      const airline = route.airline ? `(${route.airline})` : '';
      const routeText = `${index + 1}. ${route.origin}→${route.destination} ${airline} ${depDate}-${retDate}`;
      message += routeText + '\n';
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    keyboard.reply_markup.keyboard.push(['🔙 Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);

    this.userStates[chatId] = {
      type: 'regular',
      step: 'edit_select',
      routes
    };
  }

  async handleDeleteRoute(chatId) {
    const routes = await Route.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '📋 У вас нет маршрутов для удаления.', this.getMainMenuKeyboard());
      return;
    }

    let message = '🗑 Выберите маршрут для удаления:\n\n';

    const keyboard = {
      reply_markup: {
        keyboard: [
          ['🔙 Отмена']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination} ${DateUtils.formatDateDisplay(route.departure_date)}`;
      message += routeText + '\n';
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    this.bot.sendMessage(chatId, message, keyboard);

    this.userStates[chatId] = {
      type: 'regular',
      step: 'delete_confirm',
      routes
    };
  }

  async handleCheckPrice(chatId, routeId) {
    await this.bot.sendMessage(chatId, '🔍 Проверяю цены на Aviasales...\n⏳ Это может занять 10-15 секунд...');

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

      const aviasalesPricer = new AviasalesPricer(false);
      const maxlayover_hours = route.max_stops === 0 ? null : route.max_layover_hours;
      const result = await aviasalesPricer.getPriceFromUrl(searchUrl, 1, 1, route.airline, maxlayover_hours, route.max_stops);
      await aviasalesPricer.close();

      if (result && result.price) {
        const passengersText = Formatters.formatPassengers(route.adults, route.children);
        const baggageText = route.baggage ? '✅ С багажом' : '❌ Без багажа';

        let message = `🔍 Результат проверки:\n\n`;
        message += `📍 ${route.origin} → ${route.destination}\n`;
        message += `💰 ${Formatters.formatPrice(result.price, route.currency)}\n`;
        message += `✅ Проверено через Aviasales\n\n`;
        message += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n`;
        message += `👥 ${passengersText}\n`;
        message += `🧳 ${baggageText}\n`;
        if (route.airline) {
          message += `✈️ ${route.airline}\n`;
        }
        message += `⏱ Макс. пересадка: ${maxLayoverHours || 5} ч\n\n`;
        message += `💵 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;

        if (result.price <= route.threshold_price) {
          const savings = route.threshold_price - result.price;
          message += `\n🔥 ЦЕНА УПАЛА!\n`;
          message += `📉 Экономия: ${Formatters.formatPrice(savings, route.currency)}\n`;
        }

        const keyboard = {
          inline_keyboard: [[
            { text: '🔗 Посмотреть на Aviasales', url: result.search_link || searchUrl }
          ]]
        };

        if (result.screenshot && fs.existsSync(result.screenshot)) {
          await this.bot.sendPhoto(chatId, result.screenshot, {
            contentType: 'image/png',
            caption: message,
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
        } else {
          await this.bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        }
      } else {
        await this.bot.sendMessage(chatId, '❌ Не удалось найти цены. Попробуйте позже.');
      }
    } catch (error) {
      console.error('Ошибка проверки цены:', error);
      await this.bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  }
}

module.exports = RegularRouteHandlers;
