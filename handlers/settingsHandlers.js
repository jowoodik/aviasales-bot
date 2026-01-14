const PriceAnalytics = require('../services/PriceAnalytics');
const db = require('../config/database');

class SettingsHandlers {
  constructor(bot, userStates) {
    this.bot = bot;
    this.userStates = userStates;
  }

  async handleStats(chatId) {
    try {
      // Общая статистика пользователя
      const userStats = await PriceAnalytics.getUserStats(chatId);
      // Анализ по времени суток
      const hourAnalysis = await PriceAnalytics.analyzeByHour(chatId);
      // Будни vs Выходные
      const weekdayAnalysis = await PriceAnalytics.compareWeekdaysVsWeekends(chatId);
      // Получаем базовую статистику
      const baseStats = await this.getBaseStats(chatId);

      let message = '📊 УМНАЯ АНАЛИТИКА ЦЕН\n\n';

      // Базовая статистика
      if (baseStats) {
        message += `🎯 Ваши маршруты:\n`;
        message += `✈️ Обычных: ${baseStats.routes}\n`;
        message += `🔍 Гибких: ${baseStats.flexible}\n`;
        message += `🔔 Отправлено алертов: ${baseStats.alerts}\n`;
        if (baseStats.savings > 0) {
          message += `💰 Сэкономлено: ${baseStats.savings.toLocaleString('ru-RU')} ₽\n`;
        }
        message += `\n`;
      }

      // Статистика проверок
      if (userStats && userStats.total_prices > 0) {
        message += `📈 Найдено цен: ${userStats.total_prices}\n`;
        message += `💎 Лучшая: ${Math.floor(userStats.best_price).toLocaleString('ru-RU')} ₽\n`;
        message += `📊 Средняя: ${Math.floor(userStats.avg_price).toLocaleString('ru-RU')} ₽\n\n`;
      }

      // 🔥 Анализ по времени суток
      if (hourAnalysis.length > 0) {
        const bestHours = hourAnalysis
          .filter(h => h.count >= 3)
          .sort((a, b) => a.avg_price - b.avg_price)
          .slice(0, 3);

        if (bestHours.length > 0) {
          message += `⏰ Лучшее время для поиска:\n`;
          bestHours.forEach((h, i) => {
            const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
            const timeRange = `${h.hour_of_day}:00-${h.hour_of_day + 1}:00`;
            message += `${emoji} ${timeRange} → ${Math.floor(h.avg_price).toLocaleString('ru-RU')} ₽ (среднее)\n`;
          });
          message += `\n`;
        }
      }

      // 🔥 Будни vs Выходные
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
        message += `\n`;
      }

      // Кнопка для детальной аналитики
      const keyboard = {
        inline_keyboard: [
          [{ text: '📊 Детальная аналитика', callback_data: 'detailed_analytics' }],
          [{ text: '📈 Тренды цен', callback_data: 'price_trends' }]
        ]
      };

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Ошибка статистики:', error);
      await this.bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
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

  // 🔥 ИСПРАВЛЕННЫЙ МЕТОД
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
      // 🔥 ШАГ 1: Обновляем базу данных
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

          // 🔥 ШАГ 2: Получаем СВЕЖИЕ данные из БД
          db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, freshSettings) => {
            if (err || !freshSettings) {
              console.error('Ошибка чтения настроек:', err);
              this.bot.sendMessage(chatId, '❌ Ошибка чтения настроек');
              return;
            }

            // 🔥 ШАГ 3: Обновляем state
            state.settings = freshSettings;

            // 🔥 ШАГ 4: Формируем клавиатуру с АКТУАЛЬНЫМИ данными
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

            // 🔥 ШАГ 5: Отправляем сообщение с обновленной клавиатурой
            this.bot.sendMessage(chatId, '✅ Обновлено!\n\n🔔 Переключите нужные уведомления:', keyboard);
          });
        }
      );
    }

    return true;
  }
}

module.exports = SettingsHandlers;
