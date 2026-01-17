const db = require('../config/database');
const Route = require('../models/Route');
const FlexibleRoute = require('../models/FlexibleRoute');
const PriceAnalytics = require('../services/PriceAnalytics');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');

class SettingsHandlers {
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

      let message = `📊 СТАТИСТИКА ГИБКОГО МАРШРУТА #${route.id}\n\n`;
      message += `🔍 ${route.origin} → ${route.destination}\n`;
      message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_date)} - ${DateUtils.formatDateDisplay(route.return_date)}\n\n`;

      if (stats && stats.total_checks > 0) {
        message += `📊 Всего проверок: ${stats.total_checks}\n`;
        message += `💎 Лучшая цена: ${Math.floor(stats.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя цена: ${Math.floor(stats.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📈 Максимальная: ${Math.floor(stats.max_price).toLocaleString('ru-RU')} ₽\n\n`;
      } else {
        message += `📊 Недостаточно данных\n\n`;
      }

      // 🔥 Лучшее время - по MIN цене
      if (hourAnalysis.length > 0) {
        const bestHour = hourAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `⏰ Лучшее время: ${bestHour.hour_of_day}:00-${bestHour.hour_of_day + 1}:00\n`;
        message += `   Минимальная: ${Math.floor(bestHour.min_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      // 🔥 Лучший день недели - по MIN цене
      if (dayAnalysis.length > 0) {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const bestDay = dayAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `📅 Лучший день недели: ${days[bestDay.day_of_week]}\n`;
        message += `   Минимальная: ${Math.floor(bestDay.min_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      // Лучшие дни
      if (dailyStats.minDays && dailyStats.minDays.length > 0) {
        message += `📅 Лучшие дни (мин. цены):\n`;
        dailyStats.minDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📅';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.min_price).toLocaleString('ru-RU')} ₽\n`;
        });
        message += `\n`;
      }

      // Худшие дни
      if (dailyStats.maxDays && dailyStats.maxDays.length > 0) {
        message += `📈 Худшие дни (макс. цены):\n`;
        dailyStats.maxDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '🔥' : i === 1 ? '📈' : '📈';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.max_price).toLocaleString('ru-RU')} ₽\n`;
        });
      }

      const keyboard = {
        reply_markup: {
          keyboard: [['◀️ Назад к статистике']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'stats_back' };
    } catch (error) {
      console.error('Ошибка статистики маршрута:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }

  async showFlexibleRouteStatistics(chatId, route) {
    try {
      const stats = await PriceAnalytics.getRouteStatsById(route.id, chatId);
      const hourAnalysis = await PriceAnalytics.analyzeByHourForRoute(route.id, chatId);
      const dayAnalysis = await PriceAnalytics.analyzeByDayOfWeekForRoute(route.id, chatId);
      const dailyStats = await PriceAnalytics.getDailyPriceStats(route.id, chatId);

      let message = `📊 СТАТИСТИКА ГИБКОГО МАРШРУТА #${route.id}\n\n`;
      message += `🔍 ${route.origin} → ${route.destination}\n`;
      message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
      message += `🛬 Пребывание: ${route.min_days}-${route.max_days} дней\n\n`;

      if (stats && stats.total_checks > 0) {
        message += `📊 Всего проверок: ${stats.total_checks}\n`;
        message += `💎 Лучшая цена: ${Math.floor(stats.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя цена: ${Math.floor(stats.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📈 Максимальная: ${Math.floor(stats.max_price).toLocaleString('ru-RU')} ₽\n\n`;
      } else {
        message += `📊 Недостаточно данных\n\n`;
      }

      // 🔥 Лучшее время - по MIN цене
      if (hourAnalysis.length > 0) {
        const bestHour = hourAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `⏰ Лучшее время: ${bestHour.hour_of_day}:00-${bestHour.hour_of_day + 1}:00\n`;
        message += `   Минимальная: ${Math.floor(bestHour.min_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      // 🔥 Лучший день недели - по MIN цене
      if (dayAnalysis.length > 0) {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const bestDay = dayAnalysis.sort((a, b) => a.min_price - b.min_price)[0];
        message += `📅 Лучший день недели: ${days[bestDay.day_of_week]}\n`;
        message += `   Минимальная: ${Math.floor(bestDay.min_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      // Лучшие дни
      if (dailyStats.minDays && dailyStats.minDays.length > 0) {
        message += `📅 Лучшие дни (мин. цены):\n`;
        dailyStats.minDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📅';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.min_price).toLocaleString('ru-RU')} ₽\n`;
        });
        message += `\n`;
      }

      // Худшие дни
      if (dailyStats.maxDays && dailyStats.maxDays.length > 0) {
        message += `📈 Худшие дни (макс. цены):\n`;
        dailyStats.maxDays.slice(0, 5).forEach((day, i) => {
          const emoji = i === 0 ? '🔥' : i === 1 ? '📈' : '📈';
          message += `${emoji} ${day.day_of_month}.${day.month}: ${Math.floor(day.max_price).toLocaleString('ru-RU')} ₽\n`;
        });
      }

      const keyboard = {
        reply_markup: {
          keyboard: [['◀️ Назад к статистике']],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'stats_back' };
    } catch (error) {
      console.error('Ошибка статистики гибкого маршрута:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
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
}

module.exports = SettingsHandlers;
