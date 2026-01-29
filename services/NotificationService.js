const db = require('../config/database');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const fs = require('fs');

class NotificationService {
  constructor(bot) {
    this.bot = bot;
  }

  async canSendNotification(chatId) {
    return new Promise((resolve) => {
      const db = require('../config/database');
      db.get(
          'SELECT * FROM user_settings WHERE chat_id = ?',
          [chatId],
          (err, settings) => {
            if (err || !settings) {
              resolve(true);
              return;
            }

            const now = new Date();
            const currentHour = now.getHours();

            // Если тихие часы отключены (null значения)
            if (settings.quiet_hours_start === null || settings.quiet_hours_end === null) {
              resolve(true);
              return;
            }

            if (settings.quiet_hours_start > settings.quiet_hours_end) {
              // Например, 23 до 7 (через полночь)
              if (currentHour >= settings.quiet_hours_start || currentHour < settings.quiet_hours_end) {
                resolve(false);
                return;
              }
            } else {
              // Например, 23 до 7 (обычный диапазон)
              if (currentHour >= settings.quiet_hours_start && currentHour < settings.quiet_hours_end) {
                resolve(false);
                return;
              }
            }

            resolve(true);
          }
      );
    });
  }

  // 🔥 ДОБАВЛЯЕМ МЕТОД recordNotification
  async recordNotification(chatId) {
    return new Promise((resolve) => {
      db.run(
        'INSERT OR REPLACE INTO notification_cooldown (chat_id, last_notification) VALUES (?, ?)',
        [chatId, Date.now()],
        (err) => {
          if (err) console.error('Ошибка записи cooldown:', err);
          resolve();
        }
      );
    });
  }

  // 🔥 ДОБАВЛЯЕМ МЕТОД pluralizeDays
  pluralizeDays(days) {
    if (days % 10 === 1 && days % 100 !== 11) {
      return 'день';
    } else if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) {
      return 'дня';
    } else {
      return 'дней';
    }
  }

  /**
   * Отправка отчета о проверке (будет использоваться в scheduler.js)
   */
  async sendCheckReport(chatId, stats) {
    try {
      // Проверяем тихие часы
      const canSend = await this.canSendNotification(chatId);
      if (!canSend) {
        console.log(`⏸ Пропускаем отчет для ${chatId} (тихие часы)`);
        return;
      }

      let report = `📊 *ОТЧЕТ О ПРОВЕРКЕ*\n\n`;
      report += `🕐 ${new Date().toLocaleString('ru-RU')}\n\n`;

      if (!stats || stats.length === 0) {
        report += 'Нет активных маршрутов для проверки.\n';
      } else {
        let totalChecked = 0;
        let foundCheaper = 0;

        stats.forEach(stat => {
          totalChecked++;
          if (stat.foundCheaper) foundCheaper++;

          report += `✈️ ${stat.origin} → ${stat.destination}\n`;
          report += `💰 Лучшая цена: ${stat.bestPrice ? stat.bestPrice.toLocaleString('ru-RU') + ' ₽' : 'не найдена'}\n`;
          if (stat.foundCheaper) {
            report += `🔥 Найдена цена ниже порога!\n`;
          }
          report += `---\n`;
        });

        report += `\n📈 Итого:\n`;
        report += `• Проверено маршрутов: ${totalChecked}\n`;
        report += `• Найдено выгодных предложений: ${foundCheaper}\n`;
      }

      await this.bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
      await this.recordNotification(chatId);

    } catch (error) {
      console.error('Ошибка отправки отчета:', error);
    }
  }

  async sendRegularAlert(route, ticket, type) {
    const passengersText = Formatters.formatPassengers(route.adults, route.children);
    const baggageText = route.baggage ? '✅ С багажом' : '❌ Без багажа';
    const totalPrice = ticket.estimated_total;

    let header = '';
    if (type === 'drop') {
      header = '🔥 ЦЕНА УПАЛА!';
    } else if (type === 'new_min') {
      header = '⭐ НОВЫЙ МИНИМУМ!';
    }

    const message = `
${header}

📍 Маршрут: ${route.origin} → ${route.destination}
💰 Общая стоимость: ${Formatters.formatPrice(totalPrice, route.currency)}
(базовая: ${Formatters.formatPrice(ticket.base_price, route.currency)} за 1 взр.)

✈️ Авиакомпания: ${ticket.airline}
👥 Пассажиры: ${passengersText}
🧳 Багаж: ${baggageText}
🔄 Пересадок: ${ticket.transfers || 0}

📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_date)}
🔙 Возврат: ${DateUtils.formatDateDisplay(route.return_date)}

${type === 'drop' ? `💵 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n📉 Экономия: ${Formatters.formatPrice(route.threshold_price - totalPrice, route.currency)}\n\n` : ''}🔗 Забронировать: ${ticket.search_link}

⚠️ Примечание: Указана примерная стоимость. Точную цену смотрите на сайте.
`;

    await this.bot.sendMessage(route.chat_id, message);
  }

  async sendFlexibleAlert(route, results, reason, isAccurate = false, screenshot = null) {
    const best = results[0];

    let emoji = reason === 'drop' ? '🔥' : '📉';
    let title = reason === 'drop' ? 'ЦЕНА УПАЛА!' : 'Новый минимум';

    let message = `${emoji} <b>${title}</b>\n\n`;
    message += `📍 ${route.origin} → ${route.destination}\n`;
    message += `💰 <b>${best.total_price.toLocaleString('ru-RU')} ₽</b>\n`;

    if (isAccurate) {
      message += `✅ <i>Проверено через браузер</i>\n`;
    }

    message += `📅 ${DateUtils.formatDateDisplay(best.departure_date)} → ${DateUtils.formatDateDisplay(best.return_date)}\n`;
    message += `🛫 В стране: ${best.days_in_country} ${this.pluralizeDays(best.days_in_country)}\n`;

    if (results.length > 1) {
      message += `\n<b>Другие варианты:</b>\n`;
      for (let i = 1; i < Math.min(results.length, 3); i++) {
        const r = results[i];
        message += `• ${r.total_price.toLocaleString('ru-RU')} ₽ (${DateUtils.formatDateDisplay(r.departure_date)})\n`;
      }
    }

    const keyboard = {
      inline_keyboard: [[
        { text: '🔗 Купить билет', url: best.search_link }
      ]]
    };

    try {
      // Если есть скриншот - отправляем его с подписью
      if (screenshot && fs.existsSync(screenshot)) {
        await this.bot.sendPhoto(route.chat_id, screenshot, {
          contentType: 'image/png',
          caption: message,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else {
        // Иначе просто текст
        await this.bot.sendMessage(route.chat_id, message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      }

      await this.recordNotification(route.chat_id);
    } catch (error) {
      console.error('Ошибка отправки уведомления:', error.message);
    }
  }

  async sendDailyReport(chatId, routesData, flexibleData) {
    if ((!routesData || routesData.length === 0) && (!flexibleData || flexibleData.length === 0)) {
      this.bot.sendMessage(chatId, '📊 Нет данных за сегодня');
      return;
    }

    let report = '📊 ОТЧЕТ ЗА СУТКИ\n';
    report += `📅 ${new Date().toLocaleDateString('ru-RU')}\n\n`;

    if (routesData && routesData.length > 0) {
      report += '✈️ ОБЫЧНЫЕ МАРШРУТЫ:\n\n';
      routesData.forEach((row, index) => {
        const passengersText = row.children > 0 ? `${row.adults}+${row.children}` : `${row.adults}`;
        report += `${index + 1}. ${row.origin}→${row.destination}\n`;
        report += `   👥${passengersText} ${row.baggage ? '🧳' : ''}\n`;
        report += `   💰 ${row.min_price.toLocaleString('ru-RU')} - ${row.max_price.toLocaleString('ru-RU')} ₽\n`;
        report += `   📊 Проверок: ${row.checks}\n\n`;
      });
    }

    if (flexibleData && flexibleData.length > 0) {
      report += '🔍 ГИБКИЙ ПОИСК:\n\n';
      flexibleData.forEach((row, index) => {
        report += `${index + 1}. ${row.origin}→${row.destination}\n`;
        report += `   💰 Лучшая цена: ${row.best_price.toLocaleString('ru-RU')} ₽\n`;
        report += `   📅 ${DateUtils.formatDateDisplay(row.departure_date)}-${DateUtils.formatDateDisplay(row.return_date)}\n\n`;
      });
    }

    this.bot.sendMessage(chatId, report);
  }
}

module.exports = NotificationService;
