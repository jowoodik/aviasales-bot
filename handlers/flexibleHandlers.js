const FlexibleRoute = require('../models/FlexibleRoute');
const FlexibleResult = require('../models/FlexibleResult');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');

function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const utcDate = new Date(dateString + 'Z');
  const options = {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Yekaterinburg',
    hour12: false
  };
  return utcDate.toLocaleString('ru-RU', options);
}

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
          ['✅ Проверить сейчас', '🎯 Проверить один'],
          ['ℹ️ Помощь']
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
      '🔍 Гибкий поиск!\n\nВведите город вылета (например, SVX, MOW и т.д.):',
      keyboard
    );
  }

  handleFlexibleStep(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.type !== 'flexible') return false;

    switch (state.step) {
      case 'flex_origin':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        state.origin = Formatters.parseAirportCode(text);
        if (!state.origin) {
          this.bot.sendMessage(chatId, '❌ Неверный код аэропорта. Попробуйте еще раз:');
          return true;
        }

        state.step = 'flex_destination';

        const destKeyboard = {
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

        this.bot.sendMessage(chatId, `✅ Вылет: ${state.origin}\n\nТеперь введите город назначения:`, destKeyboard);
        return true;

      case 'flex_destination':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        state.destination = Formatters.parseAirportCode(text);
        if (!state.destination) {
          this.bot.sendMessage(chatId, '❌ Неверный код аэропорта. Попробуйте еще раз:');
          return true;
        }

        state.step = 'flex_departure_start';

        this.bot.sendMessage(
          chatId,
          `✅ Маршрут: ${state.origin} → ${state.destination}\n\n` +
          `Введите начало диапазона вылета (ДД-ММ-ГГГГ), например: 25-02-2026`,
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
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_min_days':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

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
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_max_days':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        const maxDays = parseInt(text);
        if (isNaN(maxDays) || maxDays < state.min_days || maxDays > 365) {
          this.bot.sendMessage(chatId, `❌ Введите от ${state.min_days} до 365 дней`);
          return true;
        }

        state.max_days = maxDays;
        state.step = 'flex_adults';
        this.bot.sendMessage(chatId, 'Количество взрослых:', {
          reply_markup: {
            keyboard: [
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_adults':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        const adults = parseInt(text);
        if (isNaN(adults) || adults < 1 || adults > 9) {
          this.bot.sendMessage(chatId, '❌ Введите от 1 до 9');
          return true;
        }

        state.adults = adults;
        state.step = 'flex_children';
        this.bot.sendMessage(chatId, 'Количество детей:', {
          reply_markup: {
            keyboard: [
              ['0 (без детей)'],
              ['1', '2', '3'],
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_children':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

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
              ['🌐 Аэрофлот (SU)'],
              ['Etihad (EY)', 'Emirates (EK)'],
              ['🌍 Любая'],
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_airline':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        if (text.includes('Аэрофлот')) state.airline = 'SU';
        else if (text.includes('Etihad')) state.airline = 'EY';
        else if (text.includes('Emirates')) state.airline = 'EK';
        else state.airline = null;

        state.step = 'flex_baggage';
        this.bot.sendMessage(chatId, '🧳 Нужен багаж?', {
          reply_markup: {
            keyboard: [
              ['✅ Да'],
              ['❌ Нет'],
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_baggage':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        state.baggage = text.includes('Да') ? 1 : 0;
        state.step = 'flex_max_stops';
        this.bot.sendMessage(chatId, '🔄 Сколько пересадок допустимо?', {
          reply_markup: {
            keyboard: [
              ['0 (только прямые)'],
              ['1 пересадка'],
              ['2 пересадки'],
              ['🌍 Любое количество'],
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_max_stops':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        if (text.includes('0') || text.includes('прямые')) {
          state.max_stops = 0;
          state.max_layover_hours = 0; // Нет пересадок = не нужно время
        } else if (text.includes('1')) {
          state.max_stops = 1;
        } else if (text.includes('2')) {
          state.max_stops = 2;
        } else if (text.includes('Любое')) {
          state.max_stops = 99;
        } else {
          state.max_stops = 99;
        }

        // Если выбраны прямые рейсы, пропускаем вопрос о времени пересадки
        if (state.max_stops === 0) {
          state.step = 'flex_threshold';
          this.bot.sendMessage(
            chatId,
            '✅ Только прямые рейсы\n\n💰 Введите пороговую цену в рублях (например, 50000):',
            { reply_markup: { remove_keyboard: true } }
          );
          return true;
        }

        // Если пересадки допустимы, спрашиваем о времени
        state.step = 'flex_max_layover';
        this.bot.sendMessage(chatId, '⏱️ Максимальное время пересадки в часах:', {
          reply_markup: {
            keyboard: [
              ['5 часов', '10 часов'],
              ['15 часов', '24 часа'],
              ['🔙 Отмена']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        });
        return true;

      case 'flex_max_layover':
        if (text === '🔙 Отмена') {
          delete this.userStates[chatId];
          this.bot.sendMessage(chatId, 'Отменено', this.getMainMenuKeyboard());
          return true;
        }

        const hours = parseInt(text.replace(/\D/g, ''));
        if (isNaN(hours) || hours <= 0 || hours > 48) {
          this.bot.sendMessage(chatId, '❌ Неверное значение. Введите число от 1 до 48:');
          return true;
        }

        state.max_layover_hours = hours;
        state.step = 'flex_threshold';
        this.bot.sendMessage(
          chatId,
          `✅ Макс. пересадка: ${hours} часов\n\n💰 Введите пороговую цену в рублях (например, 50000):`,
          { reply_markup: { remove_keyboard: true } }
        );
        return true;

      case 'flex_threshold':
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
          this.bot.sendMessage(chatId, '❌ Неверная цена. Введите число:');
          return true;
        }

        state.threshold_price = price;

        FlexibleRoute.create(chatId, {
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
          max_stops: state.max_stops !== undefined ? state.max_stops : 99,
          max_layover_hours: state.max_layover_hours !== undefined ? state.max_layover_hours : 5,
          threshold_price: state.threshold_price,
          currency: 'RUB'
        })
          .then(() => {
            const airlineName = Formatters.getAirlineName(state.airline);
            const stopsText = state.max_stops === 0 ? 'Только прямые' :
              state.max_stops === 1 ? 'До 1 пересадки' :
                state.max_stops === 2 ? 'До 2 пересадок' :
                  'Любое количество';
            const passengersText = Formatters.formatPassengers(state.adults, state.children);
            const layoverText = state.max_stops > 0 ? `\n⏱ Макс. пересадка: ${state.max_layover_hours}ч` : '';

            this.bot.sendMessage(
              chatId,
              `✅ Гибкий маршрут добавлен!\n\n` +
              `✈️ ${state.origin} → ${state.destination}\n` +
              `📅 Вылет: ${DateUtils.formatDateDisplay(state.departure_start)} - ${DateUtils.formatDateDisplay(state.departure_end)}\n` +
              `📆 Пребывание: ${state.min_days}-${state.max_days} дней\n` +
              `👥 ${passengersText}\n` +
              `🏢 ${airlineName}\n` +
              `${state.baggage ? '🧳 С багажом' : '🎒 Без багажа'}\n` +
              `🔄 ${stopsText}${layoverText}\n` +
              `💰 ${Formatters.formatPrice(state.threshold_price)}\n\n` +
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

  // Остальные методы остаются без изменений...
  async handleCheckNow(chatId) {
    try {
      await this.bot.sendMessage(chatId, '🔍 Запускаю проверку ВСЕХ маршрутов...\n⏳ Это может занять несколько минут.');

      // Проверяем гибкие маршруты
      const FlexibleMonitor = require('../services/FlexibleMonitor');
      const flexMonitor = new FlexibleMonitor(process.env.TRAVELPAYOUTS_TOKEN, this.bot);
      await flexMonitor.checkAllRoutes();
      await flexMonitor.sendReport(chatId);
      await flexMonitor.close();

      // Проверяем обычные маршруты
      const PriceMonitor = require('../services/PriceMonitor');
      const priceMonitor = new PriceMonitor(process.env.TRAVELPAYOUTS_TOKEN, this.bot);
      await priceMonitor.checkPrices();
      await priceMonitor.sendReport(chatId);
      await priceMonitor.close();

      await this.bot.sendMessage(chatId, '✅ Проверка всех маршрутов завершена!', this.getMainMenuKeyboard());
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
          if (best.found_at) {
            list += `   🕐 ${formatTimeAgo(best.found_at)}\n`;
          }
        }
        list += '\n';
      }

      this.bot.sendMessage(chatId, list);
    } catch (error) {
      this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
    }
  }

  async handleShowTopResults(chatId) {
    const Route = require('../models/Route');
    const routes = await Route.findByUser(chatId);
    const flexRoutes = await FlexibleRoute.findByUser(chatId);

    if ((!routes || routes.length === 0) && (!flexRoutes || flexRoutes.length === 0)) {
      this.bot.sendMessage(chatId, '🔍 У вас нет маршрутов для просмотра лучших вариантов', this.getMainMenuKeyboard());
      return;
    }

    let message = '📊 Выберите маршрут для просмотра лучших вариантов:\n\n';
    const keyboard = {
      reply_markup: {
        keyboard: [],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    const allRoutes = [];

    // Добавляем обычные маршруты
    routes.forEach((route, index) => {
      const depDate = DateUtils.formatDateDisplay(route.departure_date).substring(0, 5);
      const retDate = DateUtils.formatDateDisplay(route.return_date).substring(0, 5);
      const routeText = `${allRoutes.length + 1}. ✈️ ${route.origin}→${route.destination} ${depDate}-${retDate}`;
      message += `${routeText}\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
      allRoutes.push({ ...route, type: 'regular' });
    });

    // Добавляем гибкие маршруты
    flexRoutes.forEach((route, index) => {
      const depStart = DateUtils.formatDateDisplay(route.departure_start).substring(0, 5);
      const depEnd = DateUtils.formatDateDisplay(route.departure_end).substring(0, 5);
      const airline = route.airline;
      const routeText = `${allRoutes.length + 1}. 🔍 ${route.origin}→${route.destination} ${airline} ${depStart}-${depEnd} ${route.min_days}-${route.max_days}д`;
      message += `${routeText}\n`;
      keyboard.reply_markup.keyboard.push([routeText]);
      allRoutes.push({ ...route, type: 'flexible' });
    });

    keyboard.reply_markup.keyboard.push(['◀️ Отмена']);

    this.bot.sendMessage(chatId, message, keyboard);
    this.userStates[chatId] = { step: 'show_top_results', routes: allRoutes };
  }

  async sendTopResultsWithScreenshots(chatId, route) {
    if (route.type === 'regular') {
      await this.showRegularTopResults(chatId, route);
    } else {
      await this.showFlexibleTopResults(chatId, route);
    }
  }

  async showRegularTopResults(chatId, route) {
    const BestPrice = require('../models/BestPrice'); // Нужно создать модель
    const bestPrices = await BestPrice.findByRouteId(route.id, 3);

    if (!bestPrices || bestPrices.length === 0) {
      this.bot.sendMessage(chatId, '❌ Пока нет сохраненных лучших цен для этого маршрута', this.getMainMenuKeyboard());
      return;
    }

    let headerMessage = `📊 ЛУЧШИЕ ЦЕНЫ (ОБЫЧНЫЙ МАРШРУТ)\n\n`;
    headerMessage += `${route.origin} → ${route.destination}\n`;
    headerMessage += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}\n\n`;
    headerMessage += `🏆 Найдено ${bestPrices.length} лучших цен:\n`;

    await this.bot.sendMessage(chatId, headerMessage, { parse_mode: 'HTML' });

    for (let i = 0; i < bestPrices.length; i++) {
      const bp = bestPrices[i];
      const icon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}️⃣`;

      let message = `${icon} ${bp.price.toLocaleString('ru-RU')} ₽\n\n`;
      message += `✈️ ${bp.airline}\n`;
      if (bp.found_at) {
        message += `🕐 Найдено: ${formatTimeAgo(bp.found_at)}\n`;
      }

      if (bp.price <= route.threshold_price) {
        const savings = route.threshold_price - bp.price;
        message += `\n🔥 Ниже порога!\n`;
        message += `📉 Экономия: ${savings.toLocaleString('ru-RU')} ₽\n`;
      }

      const keyboard = {
        inline_keyboard: [[
          { text: '🔗 Купить билет', url: bp.search_link }
        ]]
      };

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const summaryMessage = `\n💵 Ваш порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽`;
    await this.bot.sendMessage(chatId, summaryMessage, this.getMainMenuKeyboard());
  }

  async showFlexibleTopResults(chatId, route) {
    const FlexibleResult = require('../models/FlexibleResult');
    const results = await FlexibleResult.getTopResults(route.id, 5);

    if (!results || results.length === 0) {
      this.bot.sendMessage(chatId, '❌ Пока нет результатов поиска', this.getMainMenuKeyboard());
      return;
    }

    let headerMessage = `📊 ЛУЧШИЕ ВАРИАНТЫ (ГИБКИЙ ПОИСК)\n\n`;
    headerMessage += `${route.origin} → ${route.destination}\n`;
    headerMessage += `Диапазон вылета: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
    headerMessage += `Пребывание: ${route.min_days}-${route.max_days} дней\n\n`;
    headerMessage += `🏆 Найдено ${results.length} вариантов:\n`;

    await this.bot.sendMessage(chatId, headerMessage, { parse_mode: 'HTML' });

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const icon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}️⃣`;

      let message = `${icon} ${r.total_price.toLocaleString('ru-RU')} ₽\n\n`;
      message += `✈️ ${r.airline}\n`;
      message += `📅 ${DateUtils.formatDateDisplay(r.departure_date)} → ${DateUtils.formatDateDisplay(r.return_date)}\n`;
      message += `📆 В стране: ${r.days_in_country} дней\n`;
      if (r.found_at) {
        message += `🕐 Найдено: ${formatTimeAgo(r.found_at)}\n`;
      }

      if (r.total_price <= route.threshold_price) {
        const savings = route.threshold_price - r.total_price;
        message += `\n🔥 Ниже порога!\n`;
        message += `📉 Экономия: ${savings.toLocaleString('ru-RU')} ₽\n`;
      }

      const keyboard = {
        inline_keyboard: [[
          { text: '🔗 Купить билет', url: r.search_link }
        ]]
      };

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

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const summaryMessage = `\n💵 Ваш порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽`;
    await this.bot.sendMessage(chatId, summaryMessage, this.getMainMenuKeyboard());
  }
}

module.exports = FlexibleHandlers;
