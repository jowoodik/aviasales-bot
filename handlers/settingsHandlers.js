const PriceAnalytics = require('../services/PriceAnalytics');
const Route = require('../models/Route');
const FlexibleRoute = require('../models/FlexibleRoute');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const db = require('../config/database');

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

  async handleStats(chatId) {
    try {
      const baseStats = await this.getBaseStats(chatId);

      let message = '📊 СТАТИСТИКА\n\n';

      if (baseStats) {
        message += `🎯 Ваши маршруты:\n`;
        message += `✈️ Обычных: ${baseStats.routes}\n`;
        message += `🔍 Гибких: ${baseStats.flexible}\n`;
        message += `🔔 Отправлено алертов: ${baseStats.alerts}\n`;
        if (baseStats.savings > 0) {
          message += `💰 Сэкономлено: ${baseStats.savings.toLocaleString('ru-RU')} ₽\n`;
        }
      }

      message += `\nВыберите действие:`;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['📊 Общая аналитика'],
            ['✈️ По обычному маршруту', '🔍 По гибкому маршруту'],
            ['📈 Тренды цен'],
            ['◀️ Главное меню']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'stats_menu' };
    } catch (error) {
      console.error('Ошибка статистики:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }

  async handleStatsMenuStep(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.step !== 'stats_menu') return false;

    if (text === '📊 Общая аналитика') {
      await this.handleGeneralAnalytics(chatId);
      return true;
    }

    if (text === '✈️ По обычному маршруту') {
      await this.handleRegularRouteStats(chatId);
      return true;
    }

    if (text === '🔍 По гибкому маршруту') {
      await this.handleFlexibleRouteStats(chatId);
      return true;
    }

    if (text === '📈 Тренды цен') {
      await this.handlePriceTrendsMenu(chatId);
      return true;
    }

    if (text === '◀️ Главное меню') {
      delete this.userStates[chatId];
      await this.bot.sendMessage(chatId, 'Главное меню:', this.getMainMenuKeyboard());
      return true;
    }

    return false;
  }

  async handleGeneralAnalytics(chatId) {
    try {
      const userStats = await PriceAnalytics.getUserStats(chatId);
      const hourAnalysis = await PriceAnalytics.analyzeByHour(chatId);
      const weekdayAnalysis = await PriceAnalytics.compareWeekdaysVsWeekends(chatId);

      let message = '📊 ОБЩАЯ АНАЛИТИКА\n\n';

      if (userStats && userStats.total_prices > 0) {
        message += `📈 Найдено цен: ${userStats.total_prices}\n`;
        message += `💎 Лучшая: ${Math.floor(userStats.best_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя: ${Math.floor(userStats.avg_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      if (hourAnalysis.length > 0) {
        const bestHours = hourAnalysis
          .filter(h => h.count >= 3)
          .sort((a, b) => a.avg_price - b.avg_price)
          .slice(0, 3);

        if (bestHours.length > 0) {
          message += `⏰ Лучшее время для поиска:\n`;
          bestHours.forEach((h, i) => {
            const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            const timeRange = `${h.hour_of_day}:00-${(h.hour_of_day + 1)}:00`;
            message += `${emoji} ${timeRange} → ${Math.floor(h.avg_price).toLocaleString('ru-RU')} ₽\n`;
          });
          message += `\n`;
        }
      }

      if (weekdayAnalysis.length === 2) {
        message += `📅 Будни vs Выходные:\n`;
        weekdayAnalysis.forEach(day => {
          const icon = day.period === 'Будни' ? '💼' : '🏖';
          message += `${icon} ${day.period}: ${Math.floor(day.avg_price).toLocaleString('ru-RU')} ₽\n`;
        });

        const weekday = weekdayAnalysis.find(d => d.period === 'Будни');
        const weekend = weekdayAnalysis.find(d => d.period === 'Выходные');
        if (weekday && weekend) {
          const diff = Math.abs(weekday.avg_price - weekend.avg_price);
          const cheaper = weekday.avg_price < weekend.avg_price ? 'будни' : 'выходные';
          message += `\n💡 В ${cheaper} дешевле на ${Math.floor(diff).toLocaleString('ru-RU')} ₽\n`;
        }
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
      console.error('Ошибка общей аналитики:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки аналитики');
    }
  }

  async handleRegularRouteStats(chatId) {
    try {
      const routes = await Route.findByUser(chatId);

      if (!routes || routes.length === 0) {
        await this.bot.sendMessage(chatId, '✈️ У вас нет обычных маршрутов');
        await this.handleStats(chatId);
        return;
      }

      let message = '✈️ Выберите маршрут для просмотра статистики:\n\n';
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
        await this.bot.sendMessage(chatId, '🔍 У вас нет гибких маршрутов');
        await this.handleStats(chatId);
        return;
      }

      let message = '🔍 Выберите гибкий маршрут для просмотра статистики:\n\n';
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
        const airline = route.airline;
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
      const stats = await PriceAnalytics.getRouteStats(route.origin, route.destination, chatId);
      const hourAnalysis = await PriceAnalytics.analyzeByHourForRoute(route.origin, route.destination, chatId);
      const dayAnalysis = await PriceAnalytics.analyzeByDayOfWeekForRoute(route.origin, route.destination, chatId);

      let message = `📊 СТАТИСТИКА МАРШРУТА\n\n`;
      message += `✈️ ${route.origin} → ${route.destination}\n`;
      message += `📅 ${DateUtils.formatDateDisplay(route.departure_date)} - ${DateUtils.formatDateDisplay(route.return_date)}\n\n`;

      if (stats && stats.total_checks > 0) {
        message += `📈 Проверок: ${stats.total_checks}\n`;
        message += `💎 Лучшая цена: ${Math.floor(stats.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя цена: ${Math.floor(stats.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📈 Макс. цена: ${Math.floor(stats.max_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      if (hourAnalysis.length > 0) {
        const bestHour = hourAnalysis.sort((a, b) => a.avg_price - b.avg_price)[0];
        message += `⏰ Лучшее время: ${bestHour.hour_of_day}:00-${bestHour.hour_of_day + 1}:00\n`;
        message += `   Средняя цена: ${Math.floor(bestHour.avg_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      if (dayAnalysis.length > 0) {
        const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const bestDay = dayAnalysis.sort((a, b) => a.avg_price - b.avg_price)[0];
        message += `📅 Лучший день: ${days[bestDay.day_of_week]}\n`;
        message += `   Средняя цена: ${Math.floor(bestDay.avg_price).toLocaleString('ru-RU')} ₽\n`;
      }

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['📈 Посмотреть тренд'],
            ['◀️ Назад к статистике']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'route_stats_detail', route };
    } catch (error) {
      console.error('Ошибка статистики маршрута:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }

  async showFlexibleRouteStatistics(chatId, route) {
    try {
      const stats = await PriceAnalytics.getRouteStats(route.origin, route.destination, chatId);

      let message = `📊 СТАТИСТИКА ГИБКОГО МАРШРУТА\n\n`;
      message += `🔍 ${route.origin} → ${route.destination}\n`;
      message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
      message += `🛬 Пребывание: ${route.min_days}-${route.max_days} дней\n\n`;

      if (stats && stats.total_checks > 0) {
        message += `📈 Проверок: ${stats.total_checks}\n`;
        message += `💎 Лучшая цена: ${Math.floor(stats.min_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя цена: ${Math.floor(stats.avg_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📈 Макс. цена: ${Math.floor(stats.max_price).toLocaleString('ru-RU')} ₽\n`;
      } else {
        message += `📊 Недостаточно данных для статистики`;
      }

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['📈 Посмотреть тренд'],
            ['◀️ Назад к статистике']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'flex_stats_detail', route };
    } catch (error) {
      console.error('Ошибка статистики гибкого маршрута:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  }

  async showPriceTrend(chatId, route, isFlexible = false) {
    try {
      const trend = await PriceAnalytics.getPriceTrend(route.origin, route.destination, 30);

      if (!trend || trend.length === 0) {
        await this.bot.sendMessage(chatId, '📈 Недостаточно данных для построения тренда');
        return;
      }

      let message = `📈 ТРЕНД ЦЕН (30 ДНЕЙ)\n\n`;
      message += `${route.origin} → ${route.destination}\n\n`;

      trend.slice(-10).forEach(day => {
        const date = new Date(day.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        const avgPrice = Math.floor(day.avg_price);
        const minPrice = Math.floor(day.min_price);
        message += `${date}: ${avgPrice.toLocaleString('ru-RU')} ₽`;
        if (minPrice < avgPrice) {
          message += ` (мин: ${minPrice.toLocaleString('ru-RU')} ₽)`;
        }
        message += `\n`;
      });

      const avgAll = trend.reduce((sum, d) => sum + d.avg_price, 0) / trend.length;
      message += `\n📊 Средняя за период: ${Math.floor(avgAll).toLocaleString('ru-RU')} ₽`;

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
      console.error('Ошибка тренда:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки тренда');
    }
  }

  async handlePriceTrendsMenu(chatId) {
    try {
      const routes = await Route.findByUser(chatId);
      const flexRoutes = await FlexibleRoute.findByUser(chatId);

      if ((!routes || routes.length === 0) && (!flexRoutes || flexRoutes.length === 0)) {
        await this.bot.sendMessage(chatId, '📈 У вас нет маршрутов для просмотра трендов');
        return;
      }

      let message = '📈 Выберите маршрут для просмотра тренда:\n\n';
      const keyboard = {
        reply_markup: {
          keyboard: [],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      const allRoutes = [];

      if (routes && routes.length > 0) {
        routes.forEach((route, index) => {
          const routeText = `${allRoutes.length + 1}. ✈️ ${route.origin}→${route.destination} ${DateUtils.formatDateDisplay(route.departure_date)}`;
          message += `${routeText}\n`;
          keyboard.reply_markup.keyboard.push([routeText]);
          allRoutes.push({ ...route, isFlexible: false });
        });
      }

      if (flexRoutes && flexRoutes.length > 0) {
        flexRoutes.forEach((route, index) => {
          const depStart = DateUtils.formatDateDisplay(route.departure_start).substring(0, 5);
          const depEnd = DateUtils.formatDateDisplay(route.departure_end).substring(0, 5);
          const airline = route.airline;
          const routeText = `${allRoutes.length + 1}. 🔍 ${route.origin}→${route.destination} ${airline} ${depStart}-${depEnd}`;
          message += `${routeText}\n`;
          keyboard.reply_markup.keyboard.push([routeText]);
          allRoutes.push({ ...route, isFlexible: true });
        });
      }

      keyboard.reply_markup.keyboard.push(['◀️ Назад к статистике']);

      await this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'trend_select', routes: allRoutes };
    } catch (error) {
      console.error('Ошибка:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки маршрутов');
    }
  }

  async getBaseStats(chatId) {
    return new Promise((resolve) => {
      db.get(`
                SELECT
                    (SELECT COUNT(*) FROM routes WHERE chat_id = ?) as routes,
                    (SELECT COUNT(*) FROM flexible_routes WHERE chat_id = ?) as flexible,
                    (SELECT COALESCE(total_alerts, 0) FROM user_stats WHERE chat_id = ?) as alerts,
                    (SELECT COALESCE(total_savings, 0) FROM user_stats WHERE chat_id = ?) as savings
            `, [chatId, chatId, chatId, chatId], (err, row) => {
        resolve(row || { routes: 0, flexible: 0, alerts: 0, savings: 0 });
      });
    });
  }

  handleSettings(chatId) {
    db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, settings) => {
      const s = settings || {
        quiet_hours_start: 23,
        quiet_hours_end: 8,
        check_frequency: 2,
        notify_on_drop: 1,
        notify_on_new_min: 1,
        notify_on_check: 0
      };

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['🔕 Тихие часы', '⏰ Частота проверок'],
            ['🔔 Уведомления'],
            ['◀️ Главное меню']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };

      const message =
        `⚙️ НАСТРОЙКИ\n\n` +
        `🔕 Тихие часы: ${s.quiet_hours_start}:00 - ${s.quiet_hours_end}:00\n` +
        `⏰ Частота проверок: каждые ${s.check_frequency} ч\n` +
        `🔔 Уведомления:\n` +
        `  ${s.notify_on_drop ? '✅' : '⬜'} Цена ниже порога\n` +
        `  ${s.notify_on_new_min ? '✅' : '⬜'} Новый минимум\n` +
        `  ${s.notify_on_check ? '✅' : '⬜'} Каждая проверка\n\n` +
        `Выберите что изменить:`;

      this.bot.sendMessage(chatId, message, keyboard);
      this.userStates[chatId] = { step: 'settings_menu', settings: s };
    });
  }

  handleSettingsStep(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.step !== 'settings_menu') return false;

    if (text === '🔕 Тихие часы') {
      this.bot.sendMessage(
        chatId,
        `🔕 Настройка тихих часов\n\n` +
        `Текущие: ${state.settings.quiet_hours_start}:00 - ${state.settings.quiet_hours_end}:00\n\n` +
        `Введите новые часы в формате: ЧЧ-ЧЧ\n` +
        `Например: 23-08 (с 23:00 до 08:00)`,
        { reply_markup: { remove_keyboard: true } }
      );
      state.step = 'settings_quiet';
      return true;
    }

    if (text === '⏰ Частота проверок') {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['Каждые 2 часа', 'Каждые 4 часа'],
            ['Каждые 6 часов'],
            ['◀️ Отмена']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };
      this.bot.sendMessage(chatId, '⏰ Выберите частоту проверок:', keyboard);
      state.step = 'settings_frequency';
      return true;
    }

    if (text === '🔔 Уведомления') {
      const keyboard = {
        reply_markup: {
          keyboard: [
            [`${state.settings.notify_on_drop ? '✅' : '⬜'} Цена ниже порога`],
            [`${state.settings.notify_on_new_min ? '✅' : '⬜'} Новый минимум`],
            [`${state.settings.notify_on_check ? '✅' : '⬜'} Каждая проверка`],
            ['◀️ Назад']
          ],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      };
      this.bot.sendMessage(chatId, '🔔 Переключите нужные уведомления:', keyboard);
      state.step = 'settings_notify';
      return true;
    }

    return false;
  }

  handleQuietHours(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.step !== 'settings_quiet') return false;

    const match = text.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!match) {
      this.bot.sendMessage(chatId, '❌ Неверный формат. Используйте: ЧЧ-ЧЧ (например, 23-08)');
      return true;
    }

    const start = parseInt(match[1]);
    const end = parseInt(match[2]);

    if (start < 0 || start > 23 || end < 0 || end > 23) {
      this.bot.sendMessage(chatId, '❌ Часы должны быть от 0 до 23');
      return true;
    }

    db.run(
      `INSERT INTO user_settings (chat_id, quiet_hours_start, quiet_hours_end)
       VALUES (?, ?, ?)
           ON CONFLICT(chat_id) DO
      UPDATE SET quiet_hours_start = ?, quiet_hours_end = ?`,
      [chatId, start, end, start, end],
      (err) => {
        if (!err) {
          this.bot.sendMessage(chatId, `✅ Тихие часы обновлены: ${start}:00 - ${end}:00`);
        }
        delete this.userStates[chatId];
      }
    );
    return true;
  }

  handleFrequency(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.step !== 'settings_frequency') return false;

    if (text === '◀️ Отмена') {
      delete this.userStates[chatId];
      this.bot.sendMessage(chatId, 'Отменено');
      return true;
    }

    let freq = 2;
    if (text.includes('4')) freq = 4;
    else if (text.includes('6')) freq = 6;

    db.run(
      `INSERT INTO user_settings (chat_id, check_frequency)
             VALUES (?, ?)
             ON CONFLICT(chat_id) DO
             UPDATE SET check_frequency = ?`,
      [chatId, freq, freq],
      (err) => {
        if (!err) {
          this.bot.sendMessage(
            chatId,
            `✅ Частота проверок: каждые ${freq} часа\n\n⚠️ Требуется перезапуск бота`
          );
        }
        delete this.userStates[chatId];
      }
    );
    return true;
  }

  handleNotifications(chatId, text) {
    const state = this.userStates[chatId];
    if (!state || state.step !== 'settings_notify') return false;

    if (text === '◀️ Назад') {
      this.handleSettings(chatId);
      return true;
    }

    let field = '';
    let value = 0;

    if (text.includes('Цена ниже порога')) {
      field = 'notify_on_drop';
      value = text.includes('✅') ? 0 : 1;
    } else if (text.includes('Новый минимум')) {
      field = 'notify_on_new_min';
      value = text.includes('✅') ? 0 : 1;
    } else if (text.includes('Каждая проверка')) {
      field = 'notify_on_check';
      value = text.includes('✅') ? 0 : 1;
    }

    if (field) {
      db.run(
        `INSERT INTO user_settings (chat_id, ${field})
                 VALUES (?, ?)
                 ON CONFLICT(chat_id) DO
                 UPDATE SET ${field} = ?`,
        [chatId, value, value],
        (err) => {
          if (err) {
            console.error('Ошибка обновления настроек:', err);
            this.bot.sendMessage(chatId, '❌ Ошибка сохранения настроек');
            return;
          }

          db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, freshSettings) => {
            if (err || !freshSettings) {
              console.error('Ошибка чтения настроек:', err);
              this.bot.sendMessage(chatId, '❌ Ошибка чтения настроек');
              return;
            }

            state.settings = freshSettings;

            const keyboard = {
              reply_markup: {
                keyboard: [
                  [`${freshSettings.notify_on_drop ? '✅' : '⬜'} Цена ниже порога`],
                  [`${freshSettings.notify_on_new_min ? '✅' : '⬜'} Новый минимум`],
                  [`${freshSettings.notify_on_check ? '✅' : '⬜'} Каждая проверка`],
                  ['◀️ Назад']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
              }
            };

            this.bot.sendMessage(chatId, '✅ Обновлено!\n\n🔔 Переключите нужные уведомления:', keyboard);
          });
        }
      );
    }

    return true;
  }
}

module.exports = SettingsHandlers;
