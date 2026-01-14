const FlexibleRoute = require('../models/FlexibleRoute');
const FlexibleResult = require('../models/FlexibleResult');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');

class FlexibleHandlers {
  constructor(bot, userStates) {
    this.bot = bot;
    this.userStates = userStates;
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

  handleAddFlexible(chatId) {
    this.userStates[chatId] = {
      step: 'flex_origin',
      type: 'flexible'
    };

    const keyboard = {
      reply_markup: {
        keyboard: [
          ['Екатеринбург (SVX)', 'Москва (MOW)'],
          ['Денпасар (DPS)', 'Дубай (DXB)'],
          ['Ввести свой код'],
          ['◀️ Главное меню']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    this.bot.sendMessage(
      chatId,
      '🔍 ГИБКИЙ ПОИСК\n\n' +
      'Найдем лучшие даты для вашей поездки!\n' +
      'Задайте диапазон дат вылета и пребывания.\n\n' +
      'Выберите аэропорт вылета:',
      keyboard
    );
  }

  async handleCheckNow(chatId) {
    try {
      await this.bot.sendMessage(chatId, '🔍 Запускаю проверку цен...\n⏳ Это может занять несколько минут.');

      const FlexibleMonitor = require('../services/FlexibleMonitor');
      const PriceMonitor = require('../services/PriceMonitor');

      // Проверяем гибкие маршруты
      const flexMonitor = new FlexibleMonitor(process.env.TRAVELPAYOUTS_TOKEN, this.bot);
      await flexMonitor.checkAllRoutes();
      await flexMonitor.sendReport(chatId);
      await flexMonitor.close();

      // Проверяем обычные маршруты
      const priceMonitor = new PriceMonitor(process.env.TRAVELPAYOUTS_TOKEN, this.bot);
      await priceMonitor.checkPrices();
      await priceMonitor.sendReport(chatId);
      await priceMonitor.close();

    } catch (error) {
      console.error('Ошибка проверки:', error);
      await this.bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  }

  async handleListFlexible(chatId) {
    try {
      const routes = await FlexibleRoute.findByChatId(chatId);

      if (!routes || routes.length === 0) {
        this.bot.sendMessage(chatId, '❌ У вас нет гибких маршрутов');
        return;
      }

      let list = '🔍 ГИБКИЕ МАРШРУТЫ\n\n';

      for (let i = 0; i < routes.length; i++) {
        const r = routes[i];
        const airlineName = Formatters.getAirlineName(r.airline);
        const passengersText = Formatters.formatPassengers(r.adults, r.children);
        const baggageIcon = r.baggage ? '🧳' : '🎒';
        const statusIcon = r.is_paused ? '⏸️' : '✅';

        list += `${statusIcon} ${i + 1}. ✈️ ${r.origin} → ${r.destination}\n`;
        list += `   🏢 ${airlineName} | 👥 ${passengersText} | ${baggageIcon}\n`;
        list += `   📅 Вылет: ${DateUtils.formatDateDisplay(r.departure_start)} - ${DateUtils.formatDateDisplay(r.departure_end)}\n`;
        list += `   📆 Пребывание: ${r.min_days}-${r.max_days} дней\n`;
        list += `   💰 Порог: ${Formatters.formatPrice(r.threshold_price, r.currency)}\n`;

        const topResults = await FlexibleResult.getTopResults(r.id, 1);
        if (topResults && topResults.length > 0) {
          const best = topResults[0];
          list += `   🏆 Лучшая: ${Formatters.formatPrice(best.total_price, r.currency)}\n`;
          list += `   📅 ${DateUtils.formatDateDisplay(best.departure_date)}-${DateUtils.formatDateDisplay(best.return_date)} (${best.days_in_country}д)\n`;
        }

        list += '\n';
      }

      this.bot.sendMessage(chatId, list);
    } catch (error) {
      this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
    }
  }

  async handleShowTopResults(chatId) {
    const routes = await FlexibleRoute.findByUser(chatId);

    if (!routes || routes.length === 0) {
      this.bot.sendMessage(chatId, '❌ У вас нет гибких маршрутов', this.getMainMenuKeyboard());
      return;
    }

    let message = '📊 Выберите маршрут для просмотра лучших вариантов:\n\n';
    const keyboard = { reply_markup: { keyboard: [], one_time_keyboard: true, resize_keyboard: true } };

    routes.forEach((route, index) => {
      const routeText = `${index + 1}. ${route.origin}→${route.destination}`;
      message += `${routeText}\n`;
      message += `   📅 ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
      message += `   🛫 ${route.min_days}-${route.max_days} дней\n\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
    });

    keyboard.reply_markup.keyboard.push(['◀️ Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);
    this.userStates[chatId] = { step: 'flex_show_results', routes };
  }

// 🔥 ДОБАВЬТЕ НОВЫЙ МЕТОД для отправки результатов со скриншотами
  async sendTopResultsWithScreenshots(chatId, route) {
    const FlexibleResult = require('../models/FlexibleResult');
    const results = await FlexibleResult.getTopResults(route.id, 5);

    if (!results || results.length === 0) {
      this.bot.sendMessage(chatId, '❌ Пока нет результатов поиска', this.getMainMenuKeyboard());
      return;
    }

    // Отправляем заголовок
    let headerMessage = `📊 <b>ЛУЧШИЕ ВАРИАНТЫ</b>\n\n`;
    headerMessage += `${route.origin} → ${route.destination}\n`;
    headerMessage += `Диапазон вылета: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
    headerMessage += `Пребывание: ${route.min_days}-${route.max_days} дней\n\n`;
    headerMessage += `🏆 Найдено ${results.length} вариантов:\n`;

    await this.bot.sendMessage(chatId, headerMessage, { parse_mode: 'HTML' });

    // Отправляем каждый результат со скриншотом
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const icon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}️⃣`;

      let message = `${icon} <b>${r.total_price.toLocaleString('ru-RU')} ₽</b>\n\n`;
      message += `✈️ ${r.airline}\n`;
      message += `📅 ${DateUtils.formatDateDisplay(r.departure_date)} → ${DateUtils.formatDateDisplay(r.return_date)}\n`;
      message += `📆 В стране: ${r.days_in_country} дней\n`;

      if (r.total_price <= route.threshold_price) {
        const savings = route.threshold_price - r.total_price;
        message += `\n🔥 <b>Ниже порога!</b>\n`;
        message += `📉 Экономия: ${savings.toLocaleString('ru-RU')} ₽\n`;
      }

      const keyboard = {
        inline_keyboard: [[
          { text: '🔗 Купить билет', url: r.search_link }
        ]]
      };

      // Отправляем со скриншотом если есть
      const fs = require('fs');
      if (r.screenshot_path && fs.existsSync(r.screenshot_path)) {
        await this.bot.sendPhoto(chatId, r.screenshot_path, {
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

      // Небольшая задержка между сообщениями
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Итоговое сообщение
    const summaryMessage = `\n💵 Ваш порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽`;
    await this.bot.sendMessage(chatId, summaryMessage, this.getMainMenuKeyboard());
  }

  async handleEditFlexible(chatId) {
    try {
      const routes = await FlexibleRoute.findByChatId(chatId);

      if (!routes || routes.length === 0) {
        this.bot.sendMessage(chatId, '❌ У вас нет гибких маршрутов для редактирования');
        return;
      }

      // Список с датами + авиакомпанией
      let keyboard = routes.map((r, i) => {
        const depStart = DateUtils.formatDateDisplay(r.departure_start).substring(0, 5);
        const depEnd = DateUtils.formatDateDisplay(r.departure_end).substring(0, 5);
        const airline = r.airline || 'Любая';
        return [`${i + 1}. ${r.origin}→${r.destination} ${airline} ${depStart}-${depEnd} ${r.min_days}-${r.max_days}д`];
      });
      keyboard.push(['◀️ Отмена']);

      this.bot.sendMessage(chatId, '✏️ Выберите гибкий маршрут для редактирования:', {
        reply_markup: {
          keyboard: keyboard,
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });

      this.userStates[chatId] = { step: 'flex_edit_select', routes: routes };
    } catch (error) {
      this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
    }
  }

  async handleDeleteFlexible(chatId) {
    try {
      const routes = await FlexibleRoute.findByChatId(chatId);

      if (!routes || routes.length === 0) {
        this.bot.sendMessage(chatId, '❌ У вас нет гибких маршрутов для удаления');
        return;
      }

      // Список с датами + авиакомпанией
      let keyboard = routes.map((r, i) => {
        const depStart = DateUtils.formatDateDisplay(r.departure_start).substring(0, 5);
        const depEnd = DateUtils.formatDateDisplay(r.departure_end).substring(0, 5);
        const airline = r.airline || 'Любая';
        return [`${i + 1}. ${r.origin}→${r.destination} ${airline} ${depStart}-${depEnd} ${r.min_days}-${r.max_days}д`];
      });
      keyboard.push(['◀️ Отмена']);

      this.bot.sendMessage(chatId, '🗑 Выберите гибкий маршрут для удаления:', {
        reply_markup: {
          keyboard: keyboard,
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });

      this.userStates[chatId] = { step: 'flex_delete_confirm', routes: routes };
    } catch (error) {
      this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
    }
  }

  handleFlexibleStep(chatId, text) {
    // Весь код остается БЕЗ ИЗМЕНЕНИЙ
    const state = this.userStates[chatId];
    if (!state || state.type !== 'flexible') return false;

    switch (state.step) {
      case 'flex_origin':
        if (text === 'Ввести свой код') {
          this.bot.sendMessage(chatId, 'Введите трехбуквенный код аэропорта:');
          return true;
        }

        state.origin = Formatters.parseAirportCode(text);
        if (!state.origin) {
          this.bot.sendMessage(chatId, '❌ Неверный код');
          return true;
        }

        state.step = 'flex_destination';

        const destKeyboard = {
          reply_markup: {
            keyboard: [
              ['Екатеринбург (SVX)', 'Москва (MOW)'],
              ['Денпасар (DPS)', 'Дубай (DXB)'],
              ['Ввести свой код'],
              ['◀️ Главное меню']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        };

        this.bot.sendMessage(chatId, 'Аэропорт назначения:', destKeyboard);
        return true;

      case 'flex_destination':
        if (text === 'Ввести свой код') {
          this.bot.sendMessage(chatId, 'Введите код:');
          return true;
        }

        state.destination = Formatters.parseAirportCode(text);
        if (!state.destination) {
          this.bot.sendMessage(chatId, '❌ Неверный код');
          return true;
        }

        state.step = 'flex_departure_start';
        this.bot.sendMessage(
          chatId,
          'Начало диапазона вылета (ДД-ММ-ГГГГ):\n\nНапример: 25-02-2026',
          { reply_markup: { remove_keyboard: true } }
        );
        return true;

      case 'flex_departure_start':
        const depStart = DateUtils.convertDateFormat(text);
        if (!depStart) {
          this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте: ДД-ММ-ГГГГ');
          return true;
        }
        state.departure_start = depStart;
        state.step = 'flex_departure_end';
        this.bot.sendMessage(
          chatId,
          'Конец диапазона вылета (ДД-ММ-ГГГГ):\n\nНапример: 10-03-2026'
        );
        return true;

      case 'flex_departure_end':
        const depEnd = DateUtils.convertDateFormat(text);
        if (!depEnd || new Date(depEnd) <= new Date(state.departure_start)) {
          this.bot.sendMessage(chatId, '❌ Дата должна быть позже начала диапазона');
          return true;
        }
        state.departure_end = depEnd;
        state.step = 'flex_min_days';

        this.bot.sendMessage(chatId, 'Минимум дней в стране:', {
          reply_markup: {
            keyboard: [
              ['20', '25', '27'],
              ['28', '29', '30'],
              ['◀️ Главное меню']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_min_days':
        const minDays = parseInt(text);
        if (isNaN(minDays) || minDays < 1 || minDays > 365) {
          this.bot.sendMessage(chatId, '❌ Введите от 1 до 365 дней');
          return true;
        }
        state.min_days = minDays;
        state.step = 'flex_max_days';

        this.bot.sendMessage(chatId, `Максимум дней в стране (не менее ${minDays}):`, {
          reply_markup: {
            keyboard: [
              ['28', '29', '30'],
              ['35', '45', '60'],
              ['90'],
              ['◀️ Главное меню']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_max_days':
        const maxDays = parseInt(text);
        if (isNaN(maxDays) || maxDays < state.min_days || maxDays > 365) {
          this.bot.sendMessage(chatId, `❌ Введите от ${state.min_days} до 365 дней`);
          return true;
        }
        state.max_days = maxDays;
        state.step = 'flex_adults';

        this.bot.sendMessage(chatId, 'Количество взрослых:', {
          reply_markup: {
            keyboard: [['1', '2', '3'], ['4', '5', '6'], ['◀️ Главное меню']],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_adults':
        const adults = parseInt(text);
        if (isNaN(adults) || adults < 1 || adults > 9) {
          this.bot.sendMessage(chatId, '❌ Введите от 1 до 9');
          return true;
        }
        state.adults = adults;
        state.step = 'flex_children';

        this.bot.sendMessage(chatId, 'Количество детей:', {
          reply_markup: {
            keyboard: [['0 (без детей)'], ['1', '2', '3'], ['◀️ Главное меню']],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_children':
        let children = text.includes('без') ? 0 : parseInt(text);
        if (isNaN(children) || children < 0 || children > 8) {
          this.bot.sendMessage(chatId, '❌ Введите от 0 до 8');
          return true;
        }
        state.children = children;
        state.step = 'flex_airline';

        this.bot.sendMessage(chatId, 'Авиакомпания:', {
          reply_markup: {
            keyboard: [
              ['Аэрофлот (SU)'],
              ['Etihad (EY)', 'Emirates (EK)'],
              ['Любая'],
              ['◀️ Главное меню']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_airline':
        if (text.includes('Аэрофлот')) state.airline = 'SU';
        else if (text.includes('Etihad')) state.airline = 'EY';
        else if (text.includes('Emirates')) state.airline = 'EK';
        else state.airline = null;

        state.step = 'flex_baggage';
        this.bot.sendMessage(chatId, 'Багаж?', {
          reply_markup: {
            keyboard: [['Да', 'Нет'], ['◀️ Главное меню']],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_baggage':
        state.baggage = text === 'Да' ? 1 : 0;
        state.step = 'flex_max_stops';

        this.bot.sendMessage(chatId, 'Пересадок:', {
          reply_markup: {
            keyboard: [
              ['Прямой рейс (0)'],
              ['До 1 пересадки', 'До 2 пересадок'],
              ['Любое количество'],
              ['◀️ Главное меню']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_max_stops':
        if (text.includes('0') || text.includes('Прямой')) state.max_stops = 0;
        else if (text.includes('1')) state.max_stops = 1;
        else if (text.includes('2')) state.max_stops = 2;
        else state.max_stops = 99;

        state.step = 'flex_threshold';
        this.bot.sendMessage(chatId, 'Порог цены (₽):', { reply_markup: { remove_keyboard: true } });
        return true;

      case 'flex_threshold':
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
          this.bot.sendMessage(chatId, '❌ Неверная цена');
          return true;
        }

        state.threshold_price = price;

        FlexibleRoute.create({
          chat_id: chatId,
          origin: state.origin,
          destination: state.destination,
          departure_start: state.departure_start,
          departure_end: state.departure_end,
          min_days: state.min_days,
          max_days: state.max_days,
          adults: state.adults,
          children: state.children,
          airline: state.airline,
          baggage: state.baggage,
          max_stops: state.max_stops,
          threshold_price: state.threshold_price,
          currency: 'RUB'
        })
          .then(() => {
            const airlineName = Formatters.getAirlineName(state.airline);
            const stopsText = Formatters.formatStops(state.max_stops);
            const passengersText = Formatters.formatPassengers(state.adults, state.children);

            this.bot.sendMessage(
              chatId,
              `✅ Гибкий маршрут добавлен!\n\n` +
              `✈️ ${state.origin} → ${state.destination}\n` +
              `📅 Вылет: ${DateUtils.formatDateDisplay(state.departure_start)} - ${DateUtils.formatDateDisplay(state.departure_end)}\n` +
              `📆 Пребывание: ${state.min_days}-${state.max_days} дней\n` +
              `👥 ${passengersText}\n` +
              `🏢 ${airlineName}\n` +
              `🧳 ${state.baggage ? 'Да' : 'Нет'}\n` +
              `🔄 ${stopsText}\n` +
              `💰 Порог: ${Formatters.formatPrice(state.threshold_price)}\n\n` +
              `🔍 Бот будет искать лучшие комбинации дат автоматически!`,
              this.getMainMenuKeyboard()
            );

            delete this.userStates[chatId];
          })
          .catch(error => {
            this.bot.sendMessage(chatId, '❌ Ошибка сохранения: ' + error.message);
            delete this.userStates[chatId];
          });
        return true;
    }

    return false;
  }
}

module.exports = FlexibleHandlers;
