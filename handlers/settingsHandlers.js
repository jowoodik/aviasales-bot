const db = require('../config/database');
const TimezoneUtils = require('../utils/timezoneUtils');

class SettingsHandlers {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Получить главное меню клавиатуру (из RouteHandlers)
   */
  getMainMenuKeyboard(chatId) {
    const keyboard = [
      ['📋 Мои маршруты'],
      ['⚙️ Настройки', 'ℹ️ Помощь']
    ];

    if (chatId === 341508411) {
      keyboard.push(['✅ Проверить сейчас']);
    }

    return {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        persistent: true
      }
    };
  }

  /**
   * ГЛАВНОЕ МЕНЮ НАСТРОЕК
   */
  async handleSettings(chatId) {
    try {
      const settings = await this._getUserSettings(chatId);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['🌙 Тихие часы'],
            ['🌍 Таймзона'],
            ['🏠 Главное меню']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      const startHour = settings.quiet_hours_start !== null ? String(settings.quiet_hours_start).padStart(2, '0') : 'не настроено';
      const endHour = settings.quiet_hours_end !== null ? String(settings.quiet_hours_end).padStart(2, '0') : 'не настроено';
      const timezone = settings.timezone || 'Asia/Yekaterinburg';
      const offset = TimezoneUtils.getTimezoneOffset(timezone);

      this.bot.sendMessage(
          chatId,
          `⚙️ *НАСТРОЙКИ*\n\n` +
          `🌙 Тихие часы: ${settings.quiet_hours_start !== null ? `${startHour}:00 - ${endHour}:00` : 'Отключены'}\n` +
          `🌍 Таймзона: ${timezone} (UTC${offset >= 0 ? '+' : ''}${offset})\n\n` +
          `Выберите раздел для настройки:`,
          { parse_mode: 'Markdown', ...keyboard }
      );
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
    }
  }

  /**
   * НАСТРОЙКА ТИХИХ ЧАСОВ
   */
  async handleQuietHours(chatId) {
    try {
      const settings = await this._getUserSettings(chatId);

      const startHour = settings.quiet_hours_start !== null ? settings.quiet_hours_start : 23;
      const endHour = settings.quiet_hours_end !== null ? settings.quiet_hours_end : 7;

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['⏰ Изменить начало'],
            ['⏰ Изменить конец'],
            ['🔕 Отключить тихие часы'],
            ['◀️ Назад']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      this.bot.sendMessage(
          chatId,
          `🌙 *ТИХИЕ ЧАСЫ*\n\n` +
          `В это время бот не будет отправлять уведомления о найденных билетах.\n\n` +
          `Текущие настройки: ${String(startHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00\n\n` +
          `Что хотите изменить?`,
          { parse_mode: 'Markdown', ...keyboard }
      );

      return { step: 'quiet_hours_menu', settings };

    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
      return null;
    }
  }

  handleQuietHoursAction(chatId, text, state) {
    if (!state || state.step !== 'quiet_hours_menu') {
      return false;
    }

    if (text.includes('Изменить начало')) {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['22:00', '23:00', '00:00'],
            ['01:00', '02:00', '03:00'],
            ['◀️ Отмена']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      this.bot.sendMessage(
          chatId,
          '⏰ Введите начало тихих часов (час от 0 до 23):\n\nНапример: 23',
          keyboard
      );
      return { handled: true, newState: { step: 'quiet_hours_start', settings: state.settings } };
    }

    if (text.includes('Изменить конец')) {
      const keyboard = {
        reply_markup: {
          keyboard: [
            ['06:00', '07:00', '08:00'],
            ['09:00', '10:00'],
            ['◀️ Отмена']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      this.bot.sendMessage(
          chatId,
          '⏰ Введите конец тихих часов (час от 0 до 23):\n\nНапример: 7',
          keyboard
      );
      return { handled: true, newState: { step: 'quiet_hours_end', settings: state.settings } };
    }

    if (text.includes('Отключить')) {
      this._updateQuietHours(chatId, null, null);
      this.bot.sendMessage(
          chatId,
          '✅ Тихие часы отключены. Бот будет отправлять уведомления в любое время.',
          this.getMainMenuKeyboard(chatId)
      );
      return { handled: true, deleteState: true };
    }

    return false;
  }

  async handleQuietHoursStart(chatId, text, state) {
    if (!state || state.step !== 'quiet_hours_start') {
      return false;
    }

    if (text === '◀️ Отмена') {
      await this.handleQuietHours(chatId);
      return { handled: true, deleteState: true };
    }

    const hour = parseInt(text.replace(/:/g, ''));
    if (isNaN(hour) || hour < 0 || hour > 23) {
      this.bot.sendMessage(chatId, '❌ Введите число от 0 до 23');
      return { handled: true, keepState: true };
    }

    const settings = state.settings;
    const endHour = settings.quiet_hours_end !== null ? settings.quiet_hours_end : 7;

    await this._updateQuietHours(chatId, hour, endHour);

    this.bot.sendMessage(
        chatId,
        `✅ Начало тихих часов установлено на ${String(hour).padStart(2, '0')}:00\n` +
        `Текущие настройки: ${String(hour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`,
        this.getMainMenuKeyboard(chatId)
    );

    return { handled: true, deleteState: true };
  }

  async handleQuietHoursEnd(chatId, text, state) {
    if (!state || state.step !== 'quiet_hours_end') {
      return false;
    }

    if (text === '◀️ Отмена') {
      await this.handleQuietHours(chatId);
      return { handled: true, deleteState: true };
    }

    const hour = parseInt(text.replace(/:/g, ''));
    if (isNaN(hour) || hour < 0 || hour > 23) {
      this.bot.sendMessage(chatId, '❌ Введите число от 0 до 23');
      return { handled: true, keepState: true };
    }

    const settings = state.settings;
    const startHour = settings.quiet_hours_start !== null ? settings.quiet_hours_start : 23;

    await this._updateQuietHours(chatId, startHour, hour);

    this.bot.sendMessage(
        chatId,
        `✅ Конец тихих часов установлен на ${String(hour).padStart(2, '0')}:00\n` +
        `Текущие настройки: ${String(startHour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:00`,
        this.getMainMenuKeyboard(chatId)
    );

    return { handled: true, deleteState: true };
  }

  /**
   * НАСТРОЙКА ТАЙМЗОНЫ
   */
  async handleTimezone(chatId) {
    try {
      const settings = await this._getUserSettings(chatId);
      const currentTimezone = settings.timezone || 'Asia/Yekaterinburg';
      const offset = TimezoneUtils.getTimezoneOffset(currentTimezone);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['Europe/Moscow (UTC+3)'],
            ['Asia/Yekaterinburg (UTC+5)'],
            ['Asia/Novosibirsk (UTC+7)'],
            ['Asia/Vladivostok (UTC+10)'],
            ['✏️ Ввести вручную'],
            ['◀️ Назад']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      this.bot.sendMessage(
          chatId,
          `🌍 *ТАЙМЗОНА*\n\n` +
          `Ваша таймзона: ${currentTimezone} (UTC${offset >= 0 ? '+' : ''}${offset})\n\n` +
          `Таймзона используется для корректного отображения времени уведомлений и тихих часов.\n\n` +
          `Выберите вашу таймзону:`,
          { parse_mode: 'Markdown', ...keyboard }
      );

      return { step: 'timezone_menu' };

    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
      return null;
    }
  }

  async handleTimezoneAction(chatId, text, state) {
    if (!state || state.step !== 'timezone_menu') {
      return false;
    }

    if (text === '◀️ Назад') {
      this.handleSettings(chatId);
      return { handled: true, deleteState: true };
    }

    if (text.includes('Ввести вручную')) {
      this.bot.sendMessage(
          chatId,
          `✏️ Введите таймзону в формате:\n\n` +
          `Europe/Moscow\n` +
          `Asia/Tokyo\n` +
          `America/New_York\n\n` +
          `Список всех таймзон:\n` +
          `https://en.wikipedia.org/wiki/List_of_tz_database_time_zones\n\n` +
          `Введите таймзону или /cancel для отмены:`,
          { reply_markup: { remove_keyboard: true } }
      );
      return { handled: true, newState: { step: 'timezone_input' } };
    }

    // Парсим таймзону из текста
    const match = text.match(/([A-Za-z]+\/[A-Za-z_]+)/);
    if (match) {
      const timezone = match[1];

      if (TimezoneUtils.isValidTimezone(timezone)) {
        await this._updateTimezone(chatId, timezone);
        const offset = TimezoneUtils.getTimezoneOffset(timezone);

        this.bot.sendMessage(
            chatId,
            `✅ Таймзона установлена: ${timezone} (UTC${offset >= 0 ? '+' : ''}${offset})`,
            this.getMainMenuKeyboard(chatId)
        );

        return { handled: true, deleteState: true };
      } else {
        this.bot.sendMessage(chatId, '❌ Неверная таймзона. Попробуйте еще раз.');
        return { handled: true, keepState: true };
      }
    }

    return false;
  }

  async handleTimezoneInput(chatId, text, state) {
    if (!state || state.step !== 'timezone_input') {
      return false;
    }

    if (text === '/cancel') {
      await this.handleTimezone(chatId);
      return { handled: true, deleteState: true };
    }

    const timezone = text.trim();

    if (!TimezoneUtils.isValidTimezone(timezone)) {
      this.bot.sendMessage(
          chatId,
          `❌ Неверная таймзона: ${timezone}\n\n` +
          `Используйте формат: Europe/Moscow, Asia/Tokyo и т.д.\n\n` +
          `Список всех таймзон:\n` +
          `https://en.wikipedia.org/wiki/List_of_tz_database_time_zones\n\n` +
          `Попробуйте еще раз или /cancel для отмены:`
      );
      return { handled: true, keepState: true };
    }

    await this._updateTimezone(chatId, timezone);
    const offset = TimezoneUtils.getTimezoneOffset(timezone);

    this.bot.sendMessage(
        chatId,
        `✅ Таймзона установлена: ${timezone} (UTC${offset >= 0 ? '+' : ''}${offset})`,
        this.getMainMenuKeyboard(chatId)
    );

    return { handled: true, deleteState: true };
  }

  /**
   * ГЛАВНЫЙ ОБРАБОТЧИК СООБЩЕНИЙ
   */
  async handleMessage(chatId, text, userStates) {
    const state = userStates[chatId];

    if (text === '◀️ Назад' && (
        state?.step === 'quiet_hours_menu' ||
        state?.step === 'quiet_hours_start' ||
        state?.step === 'quiet_hours_end' ||
        state?.step === 'timezone_menu' ||
        state?.step === 'timezone_input'
    )) {
      if (state.step === 'quiet_hours_menu' || state.step === 'timezone_menu') {
        this.handleSettings(chatId);
      } else if (state.step === 'quiet_hours_start' || state.step === 'quiet_hours_end') {
        await this.handleQuietHours(chatId);
      } else if (state.step === 'timezone_input') {
        await this.handleTimezone(chatId);
      }
      delete userStates[chatId];
      return true;
    }

    // Обработка кнопки "Назад" из главного меню настроек
    if (text === '◀️ Назад' && (!state || state.step === undefined)) {
      this.bot.sendMessage(
          chatId,
          '◀️ Возврат в главное меню',
          this.getMainMenuKeyboard(chatId)
      );
      delete userStates[chatId];
      return true;
    }

    // Тихие часы
    if (text === '🌙 Тихие часы') {
      const newState = await this.handleQuietHours(chatId);
      if (newState) userStates[chatId] = newState;
      return true;
    }

    // Таймзона
    if (text === '🌍 Таймзона') {
      const newState = await this.handleTimezone(chatId);
      if (newState) userStates[chatId] = newState;
      return true;
    }

    // Обработка действий в меню тихих часов
    if (state?.step === 'quiet_hours_menu') {
      const result = this.handleQuietHoursAction(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    // Обработка ввода начала тихих часов
    if (state?.step === 'quiet_hours_start') {
      const result = await this.handleQuietHoursStart(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (!result.keepState && result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    // Обработка ввода конца тихих часов
    if (state?.step === 'quiet_hours_end') {
      const result = await this.handleQuietHoursEnd(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (!result.keepState && result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    // Обработка действий в меню таймзоны
    if (state?.step === 'timezone_menu') {
      const result = await this.handleTimezoneAction(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    // Обработка ввода таймзоны вручную
    if (state?.step === 'timezone_input') {
      const result = await this.handleTimezoneInput(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (!result.keepState && result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    return false;
  }

  /**
   * ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
   */
  _getUserSettings(chatId) {
    return new Promise((resolve, reject) => {
      db.get(
          'SELECT * FROM user_settings WHERE chat_id = ?',
          [chatId],
          (err, row) => {
            if (err) {
              reject(err);
            } else if (row) {
              resolve(row);
            } else {
              // Создаем настройки по умолчанию
              db.run(
                  'INSERT INTO user_settings (chat_id, quiet_hours_start, quiet_hours_end, timezone) VALUES (?, ?, ?, ?)',
                  [chatId, 23, 7, 'Asia/Yekaterinburg'],
                  (err) => {
                    if (err) reject(err);
                    else resolve({
                      chat_id: chatId,
                      quiet_hours_start: 23,
                      quiet_hours_end: 7,
                      timezone: 'Asia/Yekaterinburg'
                    });
                  }
              );
            }
          }
      );
    });
  }

  _updateQuietHours(chatId, startHour, endHour) {
    return new Promise((resolve, reject) => {
      db.run(
          `UPDATE user_settings
           SET quiet_hours_start = ?, quiet_hours_end = ?
           WHERE chat_id = ?`,
          [startHour, endHour, chatId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });
  }

  _updateTimezone(chatId, timezone) {
    return new Promise((resolve, reject) => {
      db.run(
          'UPDATE user_settings SET timezone = ? WHERE chat_id = ?',
          [timezone, chatId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });
  }
}

module.exports = SettingsHandlers;
