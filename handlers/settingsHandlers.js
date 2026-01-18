const db = require('../config/database');
const Route = require('../models/Route');
const FlexibleRoute = require('../models/FlexibleRoute');
const PriceAnalytics = require('../services/PriceAnalytics');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const ChartGenerator = require('../services/ChartGenerator');

class SettingsHandlers {
  constructor(bot, userStates) {
    this.bot = bot;
    this.userStates = userStates;
    this.chartGenerator = new ChartGenerator();
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

  async handleStats(chatId) {
    try {
      const routes = await Route.findByUser(chatId);
      const flexRoutes = await FlexibleRoute.findByUser(chatId);

      if ((!routes || routes.length === 0) && (!flexRoutes || flexRoutes.length === 0)) {
        await this.bot.sendMessage(
          chatId,
          '📊 У вас нет маршрутов для просмотра статистики',
          this.getMainMenuKeyboard()
        );
        return;
      }

      let message = '📊 СТАТИСТИКА\n\nВыберите тип маршрута:';

      // 🔥 КНОПКИ ПОД ПОЛЕМ ВВОДА (reply_markup)
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['✈️ Статистика обычных маршрутов'],
            ['🔍 Статистика гибких маршрутов'],
            ['◀️ Главное меню']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'stats_select_type' };
    } catch (error) {
      console.error('Ошибка статистики:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }

  async handleStatsTypeSelect(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.step !== 'stats_select_type') return false;

    if (text === '✈️ Статистика обычных маршрутов') {
      await this.handleRegularRouteStats(chatId);
      return true;
    }

    if (text === '🔍 Статистика гибких маршрутов') {
      await this.handleFlexibleRouteStats(chatId);
      return true;
    }

    if (text === '◀️ Главное меню') {
      delete this.userStates[chatId];
      await this.bot.sendMessage(chatId, 'Главное меню:', this.getMainMenuKeyboard());
      return true;
    }

    return false;
  }

  async handleRegularRouteStats(chatId) {
    try {
      const routes = await Route.findByUser(chatId);

      if (!routes || routes.length === 0) {
        await this.bot.sendMessage(
          chatId,
          '✈️ У вас нет обычных маршрутов',
          this.getMainMenuKeyboard()
        );
        return;
      }

      let message = '📊 ВЫБЕРИТЕ ОБЫЧНЫЙ МАРШРУТ\n\n';

      const keyboard = {
        reply_markup: {
          keyboard: [],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      routes.forEach((route, index) => {
        // 🔥 ПОДРОБНОЕ НАЗВАНИЕ КАК ВЕЗДЕ
        const depDate = DateUtils.formatDateDisplay(route.departure_date).substring(0, 5);
        const retDate = DateUtils.formatDateDisplay(route.return_date).substring(0, 5);
        const airline = route.airline || 'Все';
        const routeText = `${index + 1}. ${route.origin}→${route.destination} ${airline} ${depDate}-${retDate}`;

        message += `${routeText}\n`;
        keyboard.reply_markup.keyboard.push([routeText]);
      });

      keyboard.reply_markup.keyboard.push(['◀️ Назад к статистике']);

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'route_stats_select', routes };
    } catch (error) {
      console.error('Ошибка:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки маршрутов');
    }
  }

  async handleFlexibleRouteStats(chatId) {
    try {
      const routes = await FlexibleRoute.findByUser(chatId);

      if (!routes || routes.length === 0) {
        await this.bot.sendMessage(
          chatId,
          '🔍 У вас нет гибких маршрутов',
          this.getMainMenuKeyboard()
        );
        return;
      }

      let message = '📊 ВЫБЕРИТЕ ГИБКИЙ МАРШРУТ\n\n';

      const keyboard = {
        reply_markup: {
          keyboard: [],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      routes.forEach((route, index) => {
        // 🔥 ПОДРОБНОЕ НАЗВАНИЕ КАК ВЕЗДЕ
        const depStart = DateUtils.formatDateDisplay(route.departure_start).substring(0, 5);
        const depEnd = DateUtils.formatDateDisplay(route.departure_end).substring(0, 5);
        const airline = route.airline || 'Все';
        const routeText = `${index + 1}. ${route.origin}→${route.destination} ${airline} ${depStart}-${depEnd} ${route.min_days}-${route.max_days}д`;

        message += `${routeText}\n`;
        keyboard.reply_markup.keyboard.push([routeText]);
      });

      keyboard.reply_markup.keyboard.push(['◀️ Назад к статистике']);

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'flex_stats_select', routes };
    } catch (error) {
      console.error('Ошибка:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки маршрутов');
    }
  }

  async showRouteStatistics(chatId, route) {
    try {
      const stats = await PriceAnalytics.getRouteStatsById(route.id, chatId);
      const hourAnalysis = await PriceAnalytics.analyzeByHourForRoute(route.id, chatId);
      const dayAnalysis = await PriceAnalytics.analyzeByDayOfWeekForRoute(route.id, chatId);
      const dailyStats = await PriceAnalytics.getDailyPriceStats(route.id, chatId);

      let message = `📊 СТАТИСТИКА МАРШРУТА #${route.id}\n\n`;
      message += `📍 ${route.origin} → ${route.destination}\n`;
      message += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} - ${DateUtils.formatDateDisplay(route.return_date)}\n\n`;

      if (stats && stats.total_checks > 0) {
        message += `📈 Проверок: ${stats.total_checks}\n`;
        message += `💰 Мин. цена: ${Math.floor(stats.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя: ${Math.floor(stats.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📈 Макс. цена: ${Math.floor(stats.max_price).toLocaleString('ru-RU')} ₽\n`;
      } else {
        message += `⚠️ Недостаточно данных\n`;
      }

      // Лучший час для покупки (MIN)
      if (hourAnalysis.length > 0) {
        const bestHour = hourAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `\n⏰ Лучший час для покупки:\n`;
        message += `   ${bestHour.hour_of_day}:00-${bestHour.hour_of_day + 1}:00\n`;
        message += `   ${Math.floor(bestHour.min_price).toLocaleString('ru-RU')} ₽ - MIN\n`;
      }

      // Лучший день недели (MIN)
      if (dayAnalysis.length > 0) {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const bestDay = dayAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `\n📅 Лучший день для покупки:\n`;
        message += `   ${days[bestDay.day_of_week]}\n`;
        message += `   ${Math.floor(bestDay.min_price).toLocaleString('ru-RU')} ₽\n`;
      }

      // Топ-5 дней с минимальными ценами
      if (dailyStats.minDays && dailyStats.minDays.length > 0) {
        message += `\n💚 Топ-5 дней с MIN ценами:\n`;
        dailyStats.minDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.min_price).toLocaleString('ru-RU')} ₽\n`;
        });
        message += `\n`;
      }

      // Топ-5 дней с максимальными ценами
      if (dailyStats.maxDays && dailyStats.maxDays.length > 0) {
        message += `💔 Топ-5 дней с MAX ценами:\n`;
        dailyStats.maxDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '💀' : '  ';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.max_price).toLocaleString('ru-RU')} ₽\n`;
        });
      }

      await this.bot.sendMessage(chatId, message);

      // График динамики цен (min/max)
      try {
        await this.bot.sendMessage(chatId, '⏳ Генерирую график цен...');

        const chartBuffer = await this.chartGenerator.generateRegularRoutePriceChart(route, chatId);

        if (chartBuffer) {
          await this.bot.sendPhoto(chatId, chartBuffer, {
            caption: `📊 График изменения цен`,
            contentType: 'image/png'
          });
        }
      } catch (chartError) {
        console.error('Ошибка генерации графика:', chartError);
      }

      // 🔥 Тепловая карта (МИНИМАЛЬНЫЕ ЦЕНЫ)
      try {
        await this.bot.sendMessage(chatId, '⏳ Генерирую тепловую карту...');

        const heatmapBuffer = await this.chartGenerator.generateHeatmapChart(route, chatId, 'regular');

        if (!heatmapBuffer) {
          await this.bot.sendMessage(chatId, '⚠️ Недостаточно данных для тепловой карты');
        } else {
          await this.bot.sendPhoto(chatId, heatmapBuffer, {
            caption: `🔥 Тепловая карта: лучшие часы и дни для покупки (мин. цены)`,
            contentType: 'image/png'
          });
        }
      } catch (heatmapError) {
        console.error('Ошибка генерации тепловой карты:', heatmapError);
      }

      // Кнопки возврата
      await this.bot.sendMessage(chatId, 'Графики готовы!', {
        reply_markup: {
          keyboard: [
            ['◀️ Назад к статистике'],
            ['◀️ Главное меню']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });

      this.userStates[chatId] = { step: 'stats_back' };

    } catch (error) {
      console.error('Ошибка показа статистики:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики', this.getMainMenuKeyboard());
    }
  }

  async showFlexibleRouteStatistics(chatId, route) {
    try {
      const stats = await PriceAnalytics.getRouteStatsById(route.id, chatId);
      const hourAnalysis = await PriceAnalytics.analyzeByHourForRoute(route.id, chatId);
      const dayAnalysis = await PriceAnalytics.analyzeByDayOfWeekForRoute(route.id, chatId);
      const dailyStats = await PriceAnalytics.getDailyPriceStats(route.id, chatId);

      let message = `📊 СТАТИСТИКА ГИБКОГО МАРШРУТА\n\n`;
      message += `📍 ${route.origin} → ${route.destination}\n`;
      message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
      message += `🛫 Пребывание: ${route.min_days}-${route.max_days} дней\n`;
      message += `✈️ ${route.airline || 'EY'}\n\n`;

      if (stats && stats.total_checks > 0) {
        message += `📈 Проверок: ${stats.total_checks}\n`;
        message += `💰 Мин. цена: ${Math.floor(stats.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя: ${Math.floor(stats.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📈 Макс. цена: ${Math.floor(stats.max_price).toLocaleString('ru-RU')} ₽\n`;
      } else {
        message += `⚠️ Недостаточно данных\n`;
      }

      if (hourAnalysis.length > 0) {
        const bestHour = hourAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `\n⏰ Лучший час для покупки:\n`;
        message += `   ${bestHour.hour_of_day}:00-${bestHour.hour_of_day + 1}:00\n`;
        message += `   ${Math.floor(bestHour.min_price).toLocaleString('ru-RU')} ₽ - MIN\n`;
      }

      if (dayAnalysis.length > 0) {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const bestDay = dayAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `\n📅 Лучший день для покупки:\n`;
        message += `   ${days[bestDay.day_of_week]}\n`;
        message += `   ${Math.floor(bestDay.min_price).toLocaleString('ru-RU')} ₽\n`;
      }

      if (dailyStats.minDays && dailyStats.minDays.length > 0) {
        message += `\n💚 Топ-5 дней с MIN ценами:\n`;
        dailyStats.minDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.min_price).toLocaleString('ru-RU')} ₽\n`;
        });
        message += `\n`;
      }

      if (dailyStats.maxDays && dailyStats.maxDays.length > 0) {
        message += `💔 Топ-5 дней с MAX ценами:\n`;
        dailyStats.maxDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '💀' : '  ';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.max_price).toLocaleString('ru-RU')} ₽\n`;
        });
      }

      await this.bot.sendMessage(chatId, message);

      // График динамики цен
      try {
        await this.bot.sendMessage(chatId, '⏳ Генерирую график цен...');

        const chartBuffer = await this.chartGenerator.generateFlexibleRoutePriceChart(route, chatId);

        if (chartBuffer) {
          await this.bot.sendPhoto(chatId, chartBuffer, {
            caption: `📊 График изменения цен (гибкий поиск)`,
            contentType: 'image/png'
          });
        }
      } catch (chartError) {
        console.error('Ошибка генерации графика:', chartError);
      }

      // 🔥 Тепловая карта
      try {
        await this.bot.sendMessage(chatId, '⏳ Генерирую тепловую карту...');

        const heatmapBuffer = await this.chartGenerator.generateHeatmapChart(route, chatId, 'flexible');

        if (!heatmapBuffer) {
          await this.bot.sendMessage(chatId, '⚠️ Недостаточно данных для тепловой карты');
        } else {
          await this.bot.sendPhoto(chatId, heatmapBuffer, {
            caption: `🔥 Тепловая карта: лучшие часы и дни для покупки`,
            contentType: 'image/png'
          });
        }
      } catch (heatmapError) {
        console.error('Ошибка генерации тепловой карты:', heatmapError);
      }

      // Кнопки возврата
      await this.bot.sendMessage(chatId, 'Графики готовы!', {
        reply_markup: {
          keyboard: [
            ['◀️ Назад к статистике'],
            ['◀️ Главное меню']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });

      this.userStates[chatId] = { step: 'stats_back' };

    } catch (error) {
      console.error('Ошибка показа статистики:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики', this.getMainMenuKeyboard());
    }
  }

  async handleSettings(chatId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, settings) => {
        if (err) {
          this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
          reject(err);
          return;
        }

        const s = settings || {
          notify_on_drop: 1,
          notify_on_new_min: 1,
          quiet_hours_start: null,
          quiet_hours_end: null,
          check_frequency: 2
        };

        const message =
          '⚙️ НАСТРОЙКИ\n\n' +
          `🔔 Уведомления при падении цены: ${s.notify_on_drop ? '✅ Вкл' : '❌ Выкл'}\n` +
          `⭐ Уведомления о новом минимуме: ${s.notify_on_new_min ? '✅ Вкл' : '❌ Выкл'}\n` +
          `🌙 Тихие часы: ${s.quiet_hours_start && s.quiet_hours_end ? `${s.quiet_hours_start}:00 - ${s.quiet_hours_end}:00` : 'Не установлены'}\n` +
          `⏰ Частота проверки: каждые ${s.check_frequency} часа\n\n` +
          'Что изменить?';

        const keyboard = {
          reply_markup: {
            keyboard: [
              ['🔔 Уведомления'],
              ['🌙 Тихие часы'],
              ['⏰ Частота проверки'],
              ['◀️ Главное меню']
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        };

        this.bot.sendMessage(chatId, message, keyboard);
        this.userStates[chatId] = { step: 'settings_menu' };
        resolve();
      });
    });
  }

  handleSettingsStep(chatId, text) {
    if (text === '🔔 Уведомления') {
      this.handleNotifications(chatId, null);
      return true;
    }

    if (text === '🌙 Тихие часы') {
      this.handleQuietHours(chatId, null);
      return true;
    }

    if (text === '⏰ Частота проверки') {
      this.handleFrequency(chatId, null);
      return true;
    }

    if (text === '◀️ Главное меню') {
      delete this.userStates[chatId];
      this.bot.sendMessage(chatId, 'Главное меню:', this.getMainMenuKeyboard());
      return true;
    }

    return false;
  }

  handleNotifications(chatId, text) {
    if (!text) {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['✅ Включить все'],
            ['❌ Выключить все'],
            ['◀️ Назад к настройкам']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, '🔔 Управление уведомлениями:', keyboard);
      this.userStates[chatId] = { step: 'settings_notify' };
      return true;
    }

    if (text === '✅ Включить все') {
      db.run(
        'UPDATE user_settings SET notify_on_drop = 1, notify_on_new_min = 1 WHERE chat_id = ?',
        [chatId],
        () => {
          this.bot.sendMessage(chatId, '✅ Все уведомления включены', this.getMainMenuKeyboard());
          delete this.userStates[chatId];
        }
      );
      return true;
    }

    if (text === '❌ Выключить все') {
      db.run(
        'UPDATE user_settings SET notify_on_drop = 0, notify_on_new_min = 0 WHERE chat_id = ?',
        [chatId],
        () => {
          this.bot.sendMessage(chatId, '❌ Все уведомления выключены', this.getMainMenuKeyboard());
          delete this.userStates[chatId];
        }
      );
      return true;
    }

    if (text === '◀️ Назад к настройкам') {
      this.handleSettings(chatId);
      return true;
    }

    return false;
  }

  handleQuietHours(chatId, text) {
    if (!text) {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['22:00 - 08:00'],
            ['23:00 - 09:00'],
            ['❌ Отключить тихие часы'],
            ['◀️ Назад к настройкам']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, '🌙 Установите тихие часы (время Екатеринбурга):', keyboard);
      this.userStates[chatId] = { step: 'settings_quiet' };
      return true;
    }

    if (text === '❌ Отключить тихие часы') {
      db.run(
        'UPDATE user_settings SET quiet_hours_start = NULL, quiet_hours_end = NULL WHERE chat_id = ?',
        [chatId],
        () => {
          this.bot.sendMessage(chatId, '✅ Тихие часы отключены', this.getMainMenuKeyboard());
          delete this.userStates[chatId];
        }
      );
      return true;
    }

    if (text === '◀️ Назад к настройкам') {
      this.handleSettings(chatId);
      return true;
    }

    const match = text.match(/(\d{2}):00 - (\d{2}):00/);
    if (match) {
      const start = parseInt(match[1]);
      const end = parseInt(match[2]);

      db.run(
        'UPDATE user_settings SET quiet_hours_start = ?, quiet_hours_end = ? WHERE chat_id = ?',
        [start, end, chatId],
        () => {
          this.bot.sendMessage(
            chatId,
            `✅ Тихие часы установлены: ${start}:00 - ${end}:00`,
            this.getMainMenuKeyboard()
          );
          delete this.userStates[chatId];
        }
      );
      return true;
    }

    return false;
  }

  handleFrequency(chatId, text) {
    if (!text) {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['⏰ Каждый час'],
            ['⏰ Каждые 2 часа'],
            ['⏰ Каждые 3 часа'],
            ['⏰ Каждые 6 часов'],
            ['◀️ Назад к настройкам']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      this.bot.sendMessage(chatId, '⏰ Как часто проверять цены?', keyboard);
      this.userStates[chatId] = { step: 'settings_frequency' };
      return true;
    }

    if (text === '◀️ Назад к настройкам') {
      this.handleSettings(chatId);
      return true;
    }

    const match = text.match(/(\d+)/);
    if (match) {
      const hours = parseInt(match[1]);

      db.run(
        'UPDATE user_settings SET check_frequency = ? WHERE chat_id = ?',
        [hours, chatId],
        () => {
          this.bot.sendMessage(
            chatId,
            `✅ Частота проверки установлена: каждые ${hours} часа`,
            this.getMainMenuKeyboard()
          );
          delete this.userStates[chatId];
        }
      );
      return true;
    }

    return false;
  }

  handleStatsMenuStep(chatId, text) {
    return false;
  }

  /**
   * 🔥 НОВЫЙ МЕТОД: Обработка запроса графика
   */
  async handleChartRequest(chatId, text) {
    const state = this.userStates[chatId];

    if (text === '📊 График цен') {
      await this.showChartMenu(chatId);
      return true;
    }

    if (state && state.step === 'chart_type_select') {
      if (text === '✈️ Обычный маршрут') {
        await this.handleRegularRouteChartSelect(chatId);
        return true;
      }

      if (text === '🔍 Гибкий маршрут') {
        await this.handleFlexibleRouteChartSelect(chatId);
        return true;
      }

      if (text === '◀️ Главное меню') {
        delete this.userStates[chatId];
        await this.bot.sendMessage(chatId, 'Главное меню:', this.getMainMenuKeyboard());
        return true;
      }
    }

    if (state && state.step === 'chart_route_select') {
      return await this.handleRouteChartGeneration(chatId, text);
    }

    if (state && state.step === 'chart_flex_route_select') {
      return await this.handleFlexRouteChartGeneration(chatId, text);
    }

    return false;
  }

  /**
   * Меню выбора типа графика
   */
  async showChartMenu(chatId) {
    const routes = await Route.findByUser(chatId);
    const flexRoutes = await FlexibleRoute.findByUser(chatId);

    if ((!routes || routes.length === 0) && (!flexRoutes || flexRoutes.length === 0)) {
      await this.bot.sendMessage(
        chatId,
        '📊 У вас нет маршрутов для построения графиков',
        this.getMainMenuKeyboard()
      );
      return;
    }

    const keyboard = {
      reply_markup: {
        keyboard: [
          ['✈️ Обычный маршрут'],
          ['🔍 Гибкий маршрут'],
          ['◀️ Главное меню']
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    };

    await this.bot.sendMessage(
      chatId,
      '📊 ГРАФИКИ ЦЕН\n\nВыберите тип маршрута:',
      keyboard
    );

    this.userStates[chatId] = { step: 'chart_type_select' };
  }

  /**
   * Выбор обычного маршрута для графика
   */
  async handleRegularRouteChartSelect(chatId) {
    try {
      const routes = await Route.findByUser(chatId);

      if (!routes || routes.length === 0) {
        await this.bot.sendMessage(
          chatId,
          '✈️ У вас нет обычных маршрутов',
          this.getMainMenuKeyboard()
        );
        return;
      }

      let message = '📊 ВЫБЕРИТЕ МАРШРУТ ДЛЯ ГРАФИКА\n\n';
      const keyboard = {
        reply_markup: {
          keyboard: [],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      routes.forEach((route, index) => {
        const depDate = DateUtils.formatDateDisplay(route.departure_date).substring(0, 5);
        const retDate = DateUtils.formatDateDisplay(route.return_date).substring(0, 5);
        const airline = route.airline || 'Все';
        const routeText = `${index + 1}. ${route.origin}→${route.destination} ${airline} ${depDate}-${retDate}`;

        message += `${routeText}\n`;
        keyboard.reply_markup.keyboard.push([routeText]);
      });

      keyboard.reply_markup.keyboard.push(['◀️ Назад']);

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'chart_route_select', routes };

    } catch (error) {
      console.error('Ошибка:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки маршрутов');
    }
  }

  /**
   * Выбор гибкого маршрута для графика
   */
  async handleFlexibleRouteChartSelect(chatId) {
    try {
      const routes = await FlexibleRoute.findByUser(chatId);

      if (!routes || routes.length === 0) {
        await this.bot.sendMessage(
          chatId,
          '🔍 У вас нет гибких маршрутов',
          this.getMainMenuKeyboard()
        );
        return;
      }

      let message = '📊 ВЫБЕРИТЕ ГИБКИЙ МАРШРУТ\n\n';
      const keyboard = {
        reply_markup: {
          keyboard: [],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      routes.forEach((route, index) => {
        const depStart = DateUtils.formatDateDisplay(route.departure_start).substring(0, 5);
        const depEnd = DateUtils.formatDateDisplay(route.departure_end).substring(0, 5);
        const airline = route.airline || 'Все';
        const routeText = `${index + 1}. ${route.origin}→${route.destination} ${airline} ${depStart}-${depEnd}`;

        message += `${routeText}\n`;
        keyboard.reply_markup.keyboard.push([routeText]);
      });

      keyboard.reply_markup.keyboard.push(['◀️ Назад']);

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'chart_flex_route_select', routes };

    } catch (error) {
      console.error('Ошибка:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки маршрутов');
    }
  }

  /**
   * Генерация графика для обычного маршрута
   */
  async handleRouteChartGeneration(chatId, text) {
    const state = this.userStates[chatId];

    if (text === '◀️ Назад') {
      await this.showChartMenu(chatId);
      return true;
    }

    const match = text.match(/^(\d+)\./);
    if (!match) return false;

    const index = parseInt(match[1]) - 1;
    const route = state.routes[index];

    if (!route) {
      await this.bot.sendMessage(chatId, '❌ Маршрут не найден');
      return true;
    }

    try {
      await this.bot.sendMessage(chatId, '⏳ Генерирую график...');

      const chartBuffer = await this.chartGenerator.generateRegularRoutePriceChart(route, chatId);

      if (!chartBuffer) {
        await this.bot.sendMessage(
          chatId,
          '⚠️ Недостаточно данных для построения графика.\nНужно минимум 2 проверки цен.',
          this.getMainMenuKeyboard()
        );
        delete this.userStates[chatId];
        return true;
      }

      const caption = `📊 График цен\n${route.origin} → ${route.destination}\n` +
        `📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}`;

      await this.bot.sendPhoto(chatId, chartBuffer, {
        caption: caption,
        contentType: 'image/png'
      });

      await this.bot.sendMessage(chatId, '✅ График готов!', this.getMainMenuKeyboard());
      delete this.userStates[chatId];

    } catch (error) {
      console.error('Ошибка генерации графика:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при создании графика');
    }

    return true;
  }

  /**
   * Генерация графика для гибкого маршрута
   */
  async handleFlexRouteChartGeneration(chatId, text) {
    const state = this.userStates[chatId];

    if (text === '◀️ Назад') {
      await this.showChartMenu(chatId);
      return true;
    }

    const match = text.match(/^(\d+)\./);
    if (!match) return false;

    const index = parseInt(match[1]) - 1;
    const route = state.routes[index];

    if (!route) {
      await this.bot.sendMessage(chatId, '❌ Маршрут не найден');
      return true;
    }

    try {
      await this.bot.sendMessage(chatId, '⏳ Генерирую график...');

      const chartBuffer = await this.chartGenerator.generateFlexibleRoutePriceChart(route, chatId);

      if (!chartBuffer) {
        await this.bot.sendMessage(
          chatId,
          '⚠️ Недостаточно данных для построения графика.\nНужно минимум 2 проверки цен.',
          this.getMainMenuKeyboard()
        );
        delete this.userStates[chatId];
        return true;
      }

      const caption = `📊 График цен (гибкий поиск)\n${route.origin} → ${route.destination}\n` +
        `📅 ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n` +
        `🛫 ${route.min_days}-${route.max_days} дней`;

      await this.bot.sendPhoto(chatId, chartBuffer, {
        caption: caption,
        contentType: 'image/png'
      });

      await this.bot.sendMessage(chatId, '✅ График готов!', this.getMainMenuKeyboard());
      delete this.userStates[chatId];

    } catch (error) {
      console.error('Ошибка генерации графика:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка при создании графика');
    }

    return true;
  }
}

module.exports = SettingsHandlers;
