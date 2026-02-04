const db = require('../config/database');
const RouteResult = require('../models/RouteResult');

class NotificationService {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * 🔥 ИСПРАВЛЕНО: Проверка тихих часов с учетом timezone пользователя
   * Теперь время берется в timezone клиента, а не UTC с сервера
   */
  async _canSendNotification(chatId) {
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

            // Если тихие часы отключены (null значения)
            if (settings.quiet_hours_start === null || settings.quiet_hours_end === null) {
              resolve(true);
              return;
            }

            // 🔥 ИСПРАВЛЕНО: Получаем текущий час в timezone пользователя
            const timezone = settings.timezone || 'Asia/Yekaterinburg';
            const now = new Date();

            // Конвертируем UTC время в локальное время пользователя
            const userLocalTime = new Intl.DateTimeFormat('en-US', {
              timeZone: timezone,
              hour: 'numeric',
              hour12: false
            }).format(now);

            const currentHour = parseInt(userLocalTime);

            // Проверяем, находится ли текущее время в тихих часах
            if (settings.quiet_hours_start > settings.quiet_hours_end) {
              // Например, 23 до 7 (через полночь)
              if (currentHour >= settings.quiet_hours_start || currentHour < settings.quiet_hours_end) {
                console.log(`⏸ Тихие часы для ${chatId}: текущий час ${currentHour} в диапазоне ${settings.quiet_hours_start}-${settings.quiet_hours_end} (${timezone})`);
                resolve(false);
                return;
              }
            } else {
              // Например, 1 до 6 (обычный диапазон в пределах одних суток)
              if (currentHour >= settings.quiet_hours_start && currentHour < settings.quiet_hours_end) {
                console.log(`⏸ Тихие часы для ${chatId}: текущий час ${currentHour} в диапазоне ${settings.quiet_hours_start}-${settings.quiet_hours_end} (${timezone})`);
                resolve(false);
                return;
              }
            }

            resolve(true);
          }
      );
    });
  }

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

  _pluralizeDays(days) {
    if (days % 10 === 1 && days % 100 !== 11) {
      return 'день';
    } else if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) {
      return 'дня';
    } else {
      return 'дней';
    }
  }

  /**
   * Форматирование даты в читаемый вид
   */
  _formatDate(dateStr) {
    if (!dateStr) return 'не указана';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  /**
   * 🔥 ОБНОВЛЕННАЯ ФУНКЦИЯ: Отправка отчета о проверке
   * Теперь включает детальную статистику по комбинациям
   */
  async sendCheckReport(chatId, stats) {
    try {
      // Проверяем тихие часы
      const canSend = await this._canSendNotification(chatId);
      if (!canSend) {
        console.log(`⏸ Пропускаем отчет для ${chatId} (тихие часы)`);
        return;
      }

      const timezone = await this._getUserTimezone(chatId);
      const now = new Date();

      let report = `📊 *ОТЧЕТ О ПРОВЕРКЕ*\n\n🕐 ${this._formatDateTimeForUser(now, timezone)} (${timezone})\n\n`;

      if (!stats || stats.length === 0) {
        report += 'Нет активных маршрутов для проверки.\n';
      } else {
        // Обрабатываем каждый маршрут
        for (const stat of stats) {
          report += `✈️ *${stat.origin} → ${stat.destination}*\n`;

          if (stat.lastCheckTime) {
            const checkTime = new Date(stat.lastCheckTime);
            report += `🕐 Проверено: ${this._formatDateTimeForUser(checkTime, timezone)}\n`;
          } else {
            report += `🕐 Не проверялось\n`;
          }

          // Лучшая найденная цена
          if (stat.bestPrice) {
            report += `💰 Лучшая цена: ${stat.bestPrice.toLocaleString('ru-RU')} ₽\n`;

            // 🔥 ИСПРАВЛЕННАЯ ЛОГИКА: Проверка порога
            if (stat.thresholdPrice && stat.foundCheaper) {
              const savings = stat.thresholdPrice - stat.bestPrice;
              report += `🔥 *Цена ниже порога!* (экономия ${savings.toLocaleString('ru-RU')} ₽)\n`;
            } else if (stat.thresholdPrice) {
              const diff = stat.bestPrice - stat.thresholdPrice;
              report += `📊 До порога: ${diff.toLocaleString('ru-RU')} ₽\n`;
            }
          } else {
            report += `❌ Цены не найдены\n`;
          }

          // 🔥 НОВОЕ: Статистика комбинаций для гибких маршрутов
          if (stat.isFlexible && stat.totalCombinations > 0) {
            report += `📋 Проверено: ${stat.successfulChecks}/${stat.totalCombinations} комбинаций\n`;

            if (stat.failedChecks > 0) {
              report += `⚠️ Не найдено: ${stat.failedChecks}/${stat.totalCombinations}\n`;

              // 🔥 НОВОЕ: Показываем примеры неудачных комбинаций
              if (stat.failedCombinations && stat.failedCombinations.length > 0) {
                report += `\n_Примеры комбинаций без билетов:_\n`;
                const maxShow = Math.min(3, stat.failedCombinations.length);

                for (let i = 0; i < maxShow; i++) {
                  const failed = stat.failedCombinations[i];
                  const depDate = this._formatDate(failed.departure_date);
                  const retDate = this._formatDate(failed.return_date);

                  if (failed.return_date) {
                    report += `  • ${depDate} — ${retDate}`;
                    if (failed.days_in_country) {
                      report += ` (${failed.days_in_country} ${this._pluralizeDays(failed.days_in_country)})`;
                    }
                  } else {
                    report += `  • ${depDate} (в одну сторону)`;
                  }

                  // Показываем причину, если это ошибка
                  if (failed.status === 'error' && failed.error_reason) {
                    report += ` - _${failed.error_reason}_`;
                  }

                  report += `\n`;
                }

                if (stat.failedCombinations.length > maxShow) {
                  report += `  _...и еще ${stat.failedCombinations.length - maxShow}_\n`;
                }
                report += `\n`;
              }
            }
          }

          report += `\n`;
        }

        // 🔥 ОБНОВЛЕННАЯ ОБЩАЯ СТАТИСТИКА
        const totalRoutes = stats.length;
        const routesWithPrice = stats.filter(s => s.bestPrice).length;
        const routesWithCheaperPrice = stats.filter(s => s.foundCheaper).length;
        const totalCombinations = stats.reduce((sum, s) => sum + (s.totalCombinations || 0), 0);
        const totalSuccessful = stats.reduce((sum, s) => sum + (s.successfulChecks || 0), 0);
        const totalFailed = stats.reduce((sum, s) => sum + (s.failedChecks || 0), 0);

        report += `📈 *ИТОГО:*\n`;
        report += `• Маршрутов проверено: ${totalRoutes}\n`;
        report += `• Найдены цены: ${routesWithPrice}/${totalRoutes}\n`;

        if (routesWithCheaperPrice > 0) {
          report += `• 🔥 Цены ниже порога: ${routesWithCheaperPrice}\n`;
        }

        if (totalCombinations > 0) {
          report += `• Комбинаций проверено: ${totalSuccessful}/${totalCombinations}\n`;
          if (totalFailed > 0) {
            report += `• Комбинаций без результата: ${totalFailed}/${totalCombinations}\n`;
          }
        }
      }

      await this.bot.sendMessage(chatId, report, { parse_mode: 'Markdown', disable_notification: true });

      // 👉 Исправленный блок: отправляем кнопки для всех маршрутов с найденными ценами
      for (const stat of stats) {
        if (stat.bestPrice) {
          try {
            const bestResults = await RouteResult.getTopResults(stat.routeId, 1);
            const bestResult = bestResults[0];

            if (bestResult && bestResult.search_link) {
              const inlineKeyboard = {
                inline_keyboard: [[
                  { text: `🔗 Купить билет ${stat.origin} → ${stat.destination}`, url: bestResult.search_link }
                ]]
              };

              await this.bot.sendMessage(
                  chatId,
                  `💰 Лучшее предложение для *${stat.origin} → ${stat.destination}*: ${stat.bestPrice.toLocaleString('ru-RU')} ₽`,
                  { parse_mode: 'Markdown', reply_markup: inlineKeyboard, disable_notification: true }
              );
            }
          } catch (e) {
            console.error('Ошибка получения лучшего результата для маршрута', stat.routeId, e);
          }
        }
      }

      await this.recordNotification(chatId);

      console.log(`✅ Отчет отправлен пользователю ${chatId}`);
    } catch (error) {
      console.error('Ошибка отправки отчета:', error);
    }
  }

  /**
   * 🔥 НОВАЯ ФУНКЦИЯ: Отправка алерта о найденной цене ниже порога
   */
  async sendPriceAlert(chatId, route, ticket, combination) {
    try {
      const canSend = await this._canSendNotification(chatId);
      if (!canSend) {
        console.log(`⏸ Пропускаем алерт для ${chatId} (тихие часы)`);
        return;
      }

      let message = `🔥 *ЦЕНА НИЖЕ ПОРОГА!*\n\n`;
      message += `📍 ${route.origin} → ${route.destination}\n`;
      message += `💰 Цена: *${ticket.price.toLocaleString('ru-RU')} ${ticket.currency}*\n`;
      message += `📊 Ваш порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽\n`;

      const savings = route.threshold_price - ticket.price;
      if (savings > 0) {
        message += `💵 Экономия: ${savings.toLocaleString('ru-RU')} ₽\n\n`;
      }

      // Даты
      message += `📅 Вылет: ${this._formatDate(combination.departure_date)}\n`;
      if (combination.return_date) {
        message += `🔙 Возврат: ${this._formatDate(combination.return_date)}\n`;
        if (combination.days_in_country) {
          message += `🛫 В стране: ${combination.days_in_country} ${this._pluralizeDays(combination.days_in_country)}\n`;
        }
      }

      // Параметры маршрута
      if (route.airline) {
        message += `✈️ Авиакомпания: ${route.airline}\n`;
      }
      if (route.baggage) {
        message += `🧳 С багажом\n`;
      }

      const keyboard = {
        inline_keyboard: [[
          { text: '🔗 Купить билет', url: ticket.link }
        ]]
      };

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

      await this.recordNotification(chatId);

      console.log(`🔥 Алерт о низкой цене отправлен пользователю ${chatId}`);
    } catch (error) {
      console.error('Ошибка отправки алерта:', error.body);
    }
  }

  /**
   * 🔥 ОБНОВЛЕННАЯ ФУНКЦИЯ: Получение статистики по маршрутам пользователя
   * Теперь включает детальную информацию о комбинациях и причинах ошибок
   */
  async getUserRoutesStats(chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
      SELECT
        r.id,
        r.origin,
        r.destination,
        r.threshold_price as thresholdPrice,
        r.is_flexible as isFlexible,
        MIN(rr.total_price) as bestPrice,
        COUNT(DISTINCT rr.id) as checksCount,
        -- Статистика последней проверки
        (SELECT total_combinations
         FROM route_check_stats
         WHERE route_id = r.id
         ORDER BY check_timestamp DESC
          LIMIT 1) as totalCombinations,
        (SELECT successful_checks 
         FROM route_check_stats 
         WHERE route_id = r.id 
         ORDER BY check_timestamp DESC 
         LIMIT 1) as successfulChecks,
        (SELECT failed_checks 
         FROM route_check_stats 
         WHERE route_id = r.id 
         ORDER BY check_timestamp DESC 
         LIMIT 1) as failedChecks,
        (SELECT check_timestamp 
         FROM route_check_stats 
         WHERE route_id = r.id 
         ORDER BY check_timestamp DESC 
         LIMIT 1) as lastCheckTime
      FROM unified_routes r
        LEFT JOIN route_results rr ON r.id = rr.route_id
      WHERE r.chat_id = ? AND r.is_paused = 0
      GROUP BY r.id
      ORDER BY r.id
    `, [chatId], async (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // Обрабатываем результаты и добавляем информацию о неудачных комбинациях
        const stats = [];

        for (const row of rows) {
          const stat = {
            routeId: row.id,
            origin: row.origin,
            destination: row.destination,
            isFlexible: row.isFlexible === 1,
            bestPrice: row.bestPrice,
            thresholdPrice: row.thresholdPrice,
            foundCheaper: row.bestPrice && row.thresholdPrice && row.bestPrice <= row.thresholdPrice,
            totalCombinations: row.totalCombinations || 0,
            successfulChecks: row.successfulChecks || 0,
            failedChecks: row.failedChecks || 0,
            lastCheckTime: row.lastCheckTime
          };

          // 🔥 НОВОЕ: Получаем информацию о неудачных комбинациях
          if (stat.failedChecks > 0) {
            stat.failedCombinations = await this._getFailedCombinations(row.id, 5);
          }

          stats.push(stat);
        }

        resolve(stats);
      });
    });
  }

  /**
   * 🔥 НОВАЯ ФУНКЦИЯ: Отправка broadcast сообщения с rate limiting
   * Telegram API limit: 30 messages/second, используем 25 для безопасности
   *
   * @param {Array} chatIds - Массив chat_id для отправки
   * @param {String} messageText - Текст сообщения
   * @param {Number} broadcastId - ID рассылки
   * @param {Number} batchSize - Количество сообщений в секунду (по умолчанию 25)
   */
  async sendBroadcastMessages(chatIds, messageText, broadcastId, batchSize = 25) {
    const BroadcastService = require('./BroadcastService');

    console.log(`📢 Начало отправки рассылки #${broadcastId} для ${chatIds.length} пользователей`);

    let sent = 0;
    let failed = 0;

    // Разбиваем на батчи по batchSize
    for (let i = 0; i < chatIds.length; i += batchSize) {
      const batch = chatIds.slice(i, i + batchSize);
      const startTime = Date.now();

      // Отправляем батч параллельно
      const promises = batch.map(async (chatId) => {
        try {
          await this.bot.sendMessage(chatId, messageText, {
            parse_mode: 'HTML',
            disable_web_page_preview: false
          });

          // Логируем успешную отправку
          await BroadcastService.logBroadcastSent(broadcastId, chatId);
          sent++;

          return { success: true, chatId };
        } catch (error) {
          console.error(`❌ Ошибка отправки broadcast пользователю ${chatId}:`, error.message);
          failed++;

          // Если пользователь заблокировал бота, все равно помечаем как отправленное
          if (
              error.response &&
              (error.response.body.error_code === 403 ||
                  error.response.body.error_code === 400)
          ) {
            await BroadcastService.logBroadcastSent(broadcastId, chatId);
          }

          return { success: false, chatId, error: error.message };
        }
      });

      await Promise.all(promises);

      // Вычисляем время до конца секунды
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 1000 - elapsed);

      // Если не последний батч, ждем до конца секунды
      if (i + batchSize < chatIds.length && delay > 0) {
        console.log(`⏳ Отправлено ${sent + failed}/${chatIds.length}, пауза ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.log(
        `✅ Рассылка #${broadcastId} завершена: успешно ${sent}, ошибок ${failed}`
    );

    // Проверяем, завершена ли рассылка полностью
    await BroadcastService.checkAndMarkComplete(broadcastId);

    return { sent, failed };
  }


  /**
   * 🔥 НОВАЯ ФУНКЦИЯ: Получение неудачных комбинаций для маршрута
   */
  async _getFailedCombinations(routeId, limit = 5) {
    return new Promise((resolve, reject) => {
      db.all(`
      SELECT 
        departure_date,
        return_date,
        days_in_country,
        status,
        error_reason
      FROM combination_check_results
      WHERE route_id = ? 
        AND status IN ('not_found', 'error')
        AND check_timestamp = (
          SELECT MAX(check_timestamp) 
          FROM combination_check_results 
          WHERE route_id = ?
        )
      ORDER BY departure_date
      LIMIT ?
    `, [routeId, routeId, limit], (err, rows) => {
        if (err) {
          console.error('Ошибка получения неудачных комбинаций:', err);
          resolve([]);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async _getUserTimezone(chatId) {
    return new Promise((resolve, reject) => {
      db.get(
          'SELECT timezone FROM user_settings WHERE chat_id = ?',
          [chatId],
          (err, row) => {
            if (err) return reject(err);
            resolve(row?.timezone || 'Asia/Yekaterinburg');
          }
      );
    });
  }

  _formatDateTimeForUser(date, timezone) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  }
}

module.exports = NotificationService;