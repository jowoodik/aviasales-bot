const db = require('../config/database');
const TimezoneUtils = require('../utils/timezoneUtils');
const ActivityService = require('../services/ActivityService');

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
      ['⚙️ Настройки', '📊 Моя подписка'],
      ['ℹ️ Помощь']
    ];

    // Админу добавляем кнопку проверки
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
    // Логируем открытие настроек
    ActivityService.logEvent(chatId, 'settings').catch(err => console.error('Activity log error:', err));

    try {
      const settings = await this._getUserSettings(chatId);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['🌍 Таймзона'],
            ['🔔 Уведомления'],
            ['🌙 Ночной режим'],
            ['📊 Дайджест'],
            ['🏠 Главное меню']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      const timezone = settings.timezone || 'Asia/Yekaterinburg';
      const offset = TimezoneUtils.getTimezoneOffset(timezone);
      const notifyStatus = settings.notifications_enabled !== 0 ? '✅ Включены' : '❌ Отключены';
      const nightModeStatus = settings.night_mode !== 0 ? '✅ Включен' : '❌ Отключен';
      const digestStatus = settings.digest_enabled !== 0 ? '✅ Включен' : '❌ Отключен';

      this.bot.sendMessage(
          chatId,
          `⚙️ *НАСТРОЙКИ*\n\n` +
          `🌍 Таймзона: ${timezone} (UTC${offset >= 0 ? '+' : ''}${offset})\n` +
          `🔔 Уведомления: ${notifyStatus}\n` +
          `🌙 Ночной режим: ${nightModeStatus}\n` +
          `📊 Дайджест: ${digestStatus}\n\n` +
          `Выберите раздел для настройки:`,
          { parse_mode: 'Markdown', ...keyboard }
      );
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
    }
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
          `Таймзона используется для ночного режима и времени дайджеста.\n\n` +
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
        state?.step === 'timezone_menu' ||
        state?.step === 'timezone_input' ||
        state?.step === 'notifications_menu' ||
        state?.step === 'night_mode_menu' ||
        state?.step === 'digest_menu'
    )) {
      if (state.step === 'timezone_menu' ||
          state.step === 'notifications_menu' || state.step === 'night_mode_menu' ||
          state.step === 'digest_menu') {
        this.handleSettings(chatId);
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

    // Таймзона
    if (text === '🌍 Таймзона') {
      const newState = await this.handleTimezone(chatId);
      if (newState) userStates[chatId] = newState;
      return true;
    }

    // Уведомления
    if (text === '🔔 Уведомления') {
      const newState = await this.handleNotifications(chatId);
      if (newState) userStates[chatId] = newState;
      return true;
    }

    // Ночной режим
    if (text === '🌙 Ночной режим') {
      const newState = await this.handleNightMode(chatId);
      if (newState) userStates[chatId] = newState;
      return true;
    }

    // Дайджест
    if (text === '📊 Дайджест') {
      const newState = await this.handleDigest(chatId);
      if (newState) userStates[chatId] = newState;
      return true;
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

    // Обработка действий в меню уведомлений
    if (state?.step === 'notifications_menu') {
      const result = await this.handleNotificationsAction(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    // Обработка действий в меню ночного режима
    if (state?.step === 'night_mode_menu') {
      const result = await this.handleNightModeAction(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    // Обработка действий в меню дайджеста
    if (state?.step === 'digest_menu') {
      const result = await this.handleDigestAction(chatId, text, state);
      if (result) {
        if (result.deleteState) delete userStates[chatId];
        else if (result.newState) userStates[chatId] = result.newState;
        return result.handled;
      }
    }

    return false;
  }

  /**
   * НАСТРОЙКА УВЕДОМЛЕНИЙ
   */
  async handleNotifications(chatId) {
    try {
      const settings = await this._getUserSettings(chatId);
      const subscription = await this._getUserSubscription(chatId);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['🔔 Включить уведомления'],
            ['🔕 Отключить уведомления'],
            ['◀️ Назад']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      const status = settings.notifications_enabled !== 0 ? '✅ Включены' : '❌ Отключены';

      let message = `🔔 *УВЕДОМЛЕНИЯ*\n\n`;
      message += `Текущий статус: ${status}\n\n`;

      message += `📬 *СИСТЕМА ПРИОРИТЕТОВ:*\n\n`;

      message += `🔥 *КРИТИЧЕСКИЕ (всегда приходят):*\n`;
      message += `• Цена в рамках вашего бюджета\n`;
      message += `• Исторический минимум цены\n`;
      message += `• Супер-скидка 50%+ от средней\n\n`;

      if (subscription === 'free') {
        message += `→ Бесплатная: до 3 в день, остальные в дайджест\n\n`;
      } else {
        message += `→ Plus: неограниченно, со звуком\n\n`;
      }

      message += `📊 *ХОРОШИЕ ЦЕНЫ:*\n`;
      message += `• Превышение бюджета до 15%\n`;
      message += `• Скидка 30-49% от средней\n`;
      message += `• Падение цены 15%+ за 24ч\n\n`;

      if (subscription === 'free') {
        message += `→ Бесплатная: только в дайджесте\n\n`;
      } else {
        message += `→ Plus: раз в 3 часа (беззвучно)\n\n`;
      }

      message += `📋 *СРЕДНИЕ И НИЗКИЕ:*\n`;
      message += `• Превышение бюджета 15-30%\n`;
      message += `• Небольшие скидки\n`;
      message += `→ Только в дайджесте\n\n`;

      message += `⚠️ *ВАЖНО:*\n`;
      message += `Даже при отключении уведомлений вы получите критические находки — они исчезают быстро, важно не упустить!\n\n`;

      message += `_Дайджест и ночной режим настраиваются отдельно_`;

      this.bot.sendMessage(
          chatId,
          message,
          { parse_mode: 'Markdown', ...keyboard }
      );

      return { step: 'notifications_menu' };

    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
      return null;
    }
  }

  async handleNotificationsAction(chatId, text, state) {
    if (!state || state.step !== 'notifications_menu') {
      return false;
    }

    if (text === '◀️ Назад') {
      this.handleSettings(chatId);
      return { handled: true, deleteState: true };
    }

    let newValue = null;
    if (text.includes('Включить уведомления')) {
      newValue = 1;
    } else if (text.includes('Отключить уведомления')) {
      newValue = 0;
    }

    if (newValue !== null) {
      await this._updateNotificationsEnabled(chatId, newValue);
      const status = newValue ? 'включены' : 'отключены';
      this.bot.sendMessage(
          chatId,
          `✅ Уведомления ${status}.`,
          this.getMainMenuKeyboard(chatId)
      );
      return { handled: true, deleteState: true };
    }

    return false;
  }

  /**
   * НОЧНОЙ РЕЖИМ
   */
  async handleNightMode(chatId) {
    try {
      const settings = await this._getUserSettings(chatId);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['🌙 Включить ночной режим'],
            ['☀️ Отключить ночной режим'],
            ['◀️ Назад']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      const status = settings.night_mode !== 0 ? '✅ Включен' : '❌ Отключен';

      this.bot.sendMessage(
          chatId,
          `🌙 *НОЧНОЙ РЕЖИМ*\n\n` +
          `Текущий статус: ${status}\n\n` +
          `При включённом ночном режиме (23:00-08:00):\n` +
          `• Критические находки приходят беззвучно\n` +
          `• Остальные уведомления откладываются до утра`,
          { parse_mode: 'Markdown', ...keyboard }
      );

      return { step: 'night_mode_menu' };

    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
      return null;
    }
  }

  async handleNightModeAction(chatId, text, state) {
    if (!state || state.step !== 'night_mode_menu') {
      return false;
    }

    if (text === '◀️ Назад') {
      this.handleSettings(chatId);
      return { handled: true, deleteState: true };
    }

    let newValue = null;
    if (text.includes('Включить ночной режим')) {
      newValue = 1;
    } else if (text.includes('Отключить ночной режим')) {
      newValue = 0;
    }

    if (newValue !== null) {
      await this._updateNightMode(chatId, newValue);
      const status = newValue ? 'включён' : 'отключён';
      this.bot.sendMessage(
          chatId,
          `✅ Ночной режим ${status}.`,
          this.getMainMenuKeyboard(chatId)
      );
      return { handled: true, deleteState: true };
    }

    return false;
  }

  /**
   * ДАЙДЖЕСТ
   */
  async handleDigest(chatId) {
    try {
      const settings = await this._getUserSettings(chatId);
      const subscription = await this._getUserSubscription(chatId);

      const keyboard = {
        reply_markup: {
          keyboard: [
            ['📊 Включить дайджест'],
            ['🔕 Отключить дайджест'],
            ['◀️ Назад']
          ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      };

      const status = settings.digest_enabled !== 0 ? '✅ Включен' : '❌ Отключен';

      let message = `📊 *ДАЙДЖЕСТ*\n\n`;
      message += `Текущий статус: ${status}\n\n`;

      message += `📬 *ЧТО ТАКОЕ ДАЙДЖЕСТ?*\n`;
      message += `Сводка по всем маршрутам с ценами, которые не требуют срочной реакции.\n\n`;

      message += `⏰ *КОГДА ПРИХОДИТ:*\n`;
      if (subscription === 'free') {
        message += `• Бесплатная: 1 раз в день в 10:00\n\n`;
      } else {
        message += `• Plus: 2 раза в день (10:00 и 18:00)\n\n`;
      }

      message += `📋 *ЧТО ВКЛЮЧАЕТ:*\n`;
      message += `• Хорошие цены (HIGH)\n`;
      message += `• Средние цены (MEDIUM)\n`;
      message += `• Критические находки ночью\n`;
      message += `• Критические для Free после лимита 3/день\n\n`;

      message += `🔕 *Звук:* Всегда беззвучно\n\n`;

      message += `💡 *Совет:*\nНе отключайте дайджест — так вы не пропустите выгодные предложения!`;

      this.bot.sendMessage(
          chatId,
          message,
          { parse_mode: 'Markdown', ...keyboard }
      );

      return { step: 'digest_menu' };

    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      this.bot.sendMessage(chatId, '❌ Ошибка загрузки настроек');
      return null;
    }
  }

  async handleDigestAction(chatId, text, state) {
    if (!state || state.step !== 'digest_menu') {
      return false;
    }

    if (text === '◀️ Назад') {
      this.handleSettings(chatId);
      return { handled: true, deleteState: true };
    }

    let newValue = null;
    if (text.includes('Включить дайджест')) {
      newValue = 1;
    } else if (text.includes('Отключить дайджест')) {
      newValue = 0;
    }

    if (newValue !== null) {
      await this._updateDigestEnabled(chatId, newValue);
      const status = newValue ? 'включён' : 'отключён';
      this.bot.sendMessage(
          chatId,
          `✅ Дайджест ${status}.`,
          this.getMainMenuKeyboard(chatId)
      );
      return { handled: true, deleteState: true };
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
                  'INSERT INTO user_settings (chat_id, quiet_hours_start, quiet_hours_end, timezone, notify_on_check, night_mode, notifications_enabled, digest_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                  [chatId, 23, 7, 'Asia/Yekaterinburg', 0, 1, 1, 1],
                  (err) => {
                    if (err) reject(err);
                    else resolve({
                      chat_id: chatId,
                      quiet_hours_start: 23,
                      quiet_hours_end: 7,
                      timezone: 'Asia/Yekaterinburg',
                      notify_on_check: 0,
                      night_mode: 1,
                      notifications_enabled: 1,
                      digest_enabled: 1
                    });
                  }
              );
            }
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

  _updateNotificationsEnabled(chatId, value) {
    return new Promise((resolve, reject) => {
      db.run(
          'UPDATE user_settings SET notifications_enabled = ? WHERE chat_id = ?',
          [value, chatId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });
  }

  _updateNightMode(chatId, value) {
    return new Promise((resolve, reject) => {
      db.run(
          'UPDATE user_settings SET night_mode = ? WHERE chat_id = ?',
          [value, chatId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });
  }

  _updateDigestEnabled(chatId, value) {
    return new Promise((resolve, reject) => {
      db.run(
          'UPDATE user_settings SET digest_enabled = ? WHERE chat_id = ?',
          [value, chatId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });
  }

  _getUserSubscription(chatId) {
    return new Promise((resolve, reject) => {
      db.get(`
            SELECT subscription_type 
            FROM user_subscriptions 
            WHERE chat_id = ? AND is_active = 1
            AND (valid_to IS NULL OR valid_to > datetime('now'))
        `, [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row?.subscription_type || 'free');
      });
    });
  }

}

module.exports = SettingsHandlers;
