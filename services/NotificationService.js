const db = require('../config/database');
const RouteResult = require('../models/RouteResult');
const Formatters = require('../utils/formatters');
const airportResolver = require('../utils/AirportCodeResolver');

class NotificationService {
  constructor(bot) {
    this.bot = bot;
  }

  // ============================================
  // ПРИОРИТЕТЫ
  // ============================================

  classifyPriority(routeData) {
    const { currentPrice, userBudget, avgPrice, historicalMin, priceDropPercent } = routeData;
    const reasons = [];

    // CRITICAL
    if (userBudget && currentPrice <= userBudget) {
      reasons.push('Цена в рамках бюджета');
    }
    if (historicalMin && currentPrice <= historicalMin) {
      reasons.push('Исторический минимум');
    }
    if (avgPrice && avgPrice > 0) {
      const discountFromAvg = ((avgPrice - currentPrice) / avgPrice) * 100;
      if (discountFromAvg >= 50) {
        reasons.push(`Скидка ${Math.round(discountFromAvg)}% от средней`);
      }
    }
    if (reasons.length > 0) {
      return { priority: 'CRITICAL', reasons };
    }

    // HIGH
    const highReasons = [];
    if (userBudget && currentPrice > userBudget) {
      const overPercent = ((currentPrice - userBudget) / userBudget) * 100;
      if (overPercent <= 15) {
        highReasons.push(`Превышение бюджета ${Math.round(overPercent)}%`);
      }
    }
    if (avgPrice && avgPrice > 0) {
      const discountFromAvg = ((avgPrice - currentPrice) / avgPrice) * 100;
      if (discountFromAvg >= 30 && discountFromAvg < 50) {
        highReasons.push(`Скидка ${Math.round(discountFromAvg)}% от средней`);
      }
    }
    if (priceDropPercent && priceDropPercent >= 15) {
      highReasons.push(`Падение ${Math.round(priceDropPercent)}% за 24ч`);
    }
    if (highReasons.length > 0) {
      return { priority: 'HIGH', reasons: highReasons };
    }

    // MEDIUM
    const mediumReasons = [];
    if (userBudget && currentPrice > userBudget) {
      const overPercent = ((currentPrice - userBudget) / userBudget) * 100;
      if (overPercent > 15 && overPercent <= 30) {
        mediumReasons.push(`Превышение бюджета ${Math.round(overPercent)}%`);
      }
    }
    if (avgPrice && avgPrice > 0) {
      const discountFromAvg = ((avgPrice - currentPrice) / avgPrice) * 100;
      if (discountFromAvg >= 15 && discountFromAvg < 30) {
        mediumReasons.push(`Скидка ${Math.round(discountFromAvg)}% от средней`);
      }
    }
    if (priceDropPercent && priceDropPercent >= 10 && priceDropPercent < 15) {
      mediumReasons.push(`Падение ${Math.round(priceDropPercent)}% за 24ч`);
    }
    if (mediumReasons.length > 0) {
      return { priority: 'MEDIUM', reasons: mediumReasons };
    }

    return { priority: 'LOW', reasons: ['Обычная проверка'] };
  }

  // ============================================
  // АНАЛИТИКА МАРШРУТОВ
  // ============================================

  getRouteAnalytics(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT AVG(price) as avgPrice, MIN(price) as minPrice, COUNT(*) as dataPoints
         FROM price_analytics WHERE route_id = ?`,
        [routeId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || { avgPrice: null, minPrice: null, dataPoints: 0 });
        }
      );
    });
  }

  getPriceDropPercent(routeId, currentPrice) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT MIN(price) as recentMin
         FROM price_analytics
         WHERE route_id = ? AND found_at > datetime('now', '-2 days')`,
        [routeId],
        (err, row) => {
          if (err) return reject(err);
          if (!row || !row.recentMin || row.recentMin <= 0) {
            resolve(0);
            return;
          }
          const drop = ((row.recentMin - currentPrice) / row.recentMin) * 100;
          resolve(Math.max(0, drop));
        }
      );
    });
  }

  getRouteCheckStats(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT total_combinations, successful_checks, failed_checks, check_timestamp
         FROM route_check_stats
         WHERE route_id = ?
         ORDER BY check_timestamp DESC LIMIT 1`,
        [routeId],
        (err, currentCheck) => {
          if (err) return reject(err);

          db.get(
            `SELECT SUM(total_combinations) as totalAllCombinations
             FROM route_check_stats WHERE route_id = ?`,
            [routeId],
            (err2, totals) => {
              if (err2) return reject(err2);
              resolve({
                current: currentCheck || { total_combinations: 0, successful_checks: 0, failed_checks: 0 },
                totalAllCombinations: totals?.totalAllCombinations || 0
              });
            }
          );
        }
      );
    });
  }

  // ============================================
  // МАРШРУТИЗАЦИЯ УВЕДОМЛЕНИЙ
  // ============================================

  _checkPriorityCooldown(chatId, routeId, priority, hours) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as cnt FROM notification_log
         WHERE chat_id = ? AND route_id = ? AND priority = ?
           AND sent_at > datetime('now', '-' || ? || ' hours')`,
        [chatId, routeId, priority, hours],
        (err, row) => {
          if (err) return reject(err);
          resolve((row?.cnt || 0) > 0);
        }
      );
    });
  }

  _getCriticalCountToday(chatId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as cnt FROM notification_log
         WHERE chat_id = ? AND priority = 'CRITICAL'
           AND sent_at > datetime('now', 'start of day')`,
        [chatId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row?.cnt || 0);
        }
      );
    });
  }

  _logNotification(chatId, routeId, priority, price, messageType, silent) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO notification_log (chat_id, route_id, priority, price, message_type, disable_notification)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [chatId, routeId, priority, price, messageType, silent ? 1 : 0],
        (err) => {
          if (err) {
            console.error('Ошибка записи notification_log:', err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  _addToDigestQueue(chatId, routeId, priority, price, analytics, bestResultId) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO daily_digest_queue (chat_id, route_id, priority, price, avg_price, historical_min, best_result_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [chatId, routeId, priority, price, analytics?.avgPrice || null, analytics?.minPrice || null, bestResultId || null],
        (err) => {
          if (err) {
            console.error('Ошибка записи в digest queue:', err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  _isNightTime(timezone, settings) {
    if (!settings || !settings.night_mode) return false;

    const tz = timezone || 'Asia/Yekaterinburg';
    const now = new Date();
    const userLocalTime = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false
    }).format(now);
    const currentHour = parseInt(userLocalTime);

    // Ночь: 23:00 - 08:00
    return currentHour >= 23 || currentHour < 8;
  }

  async _getUserTimezone(chatId) {
    return new Promise((resolve) => {
      db.get(
        'SELECT timezone FROM user_settings WHERE chat_id = ?',
        [chatId],
        (err, row) => {
          if (err) return resolve('Asia/Yekaterinburg');
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

  _formatTimeForUser(date, timezone) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  _pluralizeDays(days) {
    if (days % 10 === 1 && days % 100 !== 11) return 'день';
    if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) return 'дня';
    return 'дней';
  }

  // ============================================
  // ЦЕНТРАЛЬНЫЙ РОУТЕР УВЕДОМЛЕНИЙ
  // ============================================

  async processAndRouteNotification({ chatId, routeId, route, priority, reasons, currentPrice, analytics, bestResult, checkStats, userSettings, subscriptionType }) {
    const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
    const isNight = this._isNightTime(timezone, userSettings);
    const notificationsEnabled = userSettings?.notifications_enabled !== 0;
    const isFree = subscriptionType === 'free';
    const bestResultId = bestResult?.id || null;

    // CRITICAL
    if (priority === 'CRITICAL') {
      if (isNight) {
        // Ночью CRITICAL приходит беззвучно
        const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
        await this._sendInstantAlert(chatId, routeId, block, priority, currentPrice, timezone, true);
        return { action: 'sent_silent', priority };
      }

      if (isFree) {
        const critToday = await this._getCriticalCountToday(chatId);
        if (critToday >= 3) {
          await this._addToDigestQueue(chatId, routeId, priority, currentPrice, analytics, bestResultId);
          return { action: 'digest', priority };
        }
      }

      const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
      await this._sendInstantAlert(chatId, routeId, block, priority, currentPrice, timezone, false);
      return { action: 'sent', priority };
    }

    // HIGH
    if (priority === 'HIGH') {
      if (!notificationsEnabled) {
        return { action: 'skipped', priority, reason: 'notifications_disabled' };
      }
      if (isNight) {
        await this._addToDigestQueue(chatId, routeId, priority, currentPrice, analytics, bestResultId);
        return { action: 'digest', priority };
      }

      if (isFree) {
        await this._addToDigestQueue(chatId, routeId, priority, currentPrice, analytics, bestResultId);
        return { action: 'digest', priority };
      }

      // Plus: раз в 3 часа
      const onCooldown = await this._checkPriorityCooldown(chatId, routeId, 'HIGH', 3);
      if (onCooldown) {
        await this._addToDigestQueue(chatId, routeId, priority, currentPrice, analytics, bestResultId);
        return { action: 'digest', priority };
      }

      const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
      await this._sendInstantAlert(chatId, routeId, block, priority, currentPrice, timezone, true);
      return { action: 'sent_silent', priority };
    }

    // MEDIUM
    if (priority === 'MEDIUM') {
      if (!notificationsEnabled) {
        return { action: 'skipped', priority, reason: 'notifications_disabled' };
      }
      if (isNight) {
        await this._addToDigestQueue(chatId, routeId, priority, currentPrice, analytics, bestResultId);
        return { action: 'digest', priority };
      }
      await this._addToDigestQueue(chatId, routeId, priority, currentPrice, analytics, bestResultId);
      return { action: 'digest', priority };
    }

    // LOW
    return { action: 'silent', priority };
  }

  async _sendInstantAlert(chatId, routeId, block, priority, price, timezone, silent) {
    try {
      const time = this._formatTimeForUser(new Date(), timezone);
      const header = priority === 'CRITICAL' ? `🚨 Отличные новости! • ${time}` : `📊 Проверка завершена • ${time}`;
      const footer = priority === 'CRITICAL' ? '\nОтличные цены! Не упусти 🎯' : '\nПродолжаю мониторинг 🔍';

      const message = `${header}\n\n${block.text}${footer}`;

      const sendOpts = {
        parse_mode: 'Markdown',
        disable_notification: silent
      };

      if (block.searchLink) {
        sendOpts.reply_markup = {
          inline_keyboard: [[
            { text: '🔗 Купить билет →', url: block.searchLink }
          ]]
        };
      }

      await this.bot.sendMessage(chatId, message, sendOpts);
      await this._logNotification(chatId, routeId, priority, price, 'instant', silent);

      console.log(`${silent ? '🔕' : '🔔'} Алерт [${priority}] отправлен пользователю ${chatId}`);
    } catch (error) {
      console.error(`Ошибка отправки алерта [${priority}]:`, error.message);
    }
  }

  // ============================================
  // ФОРМАТИРОВАНИЕ БЛОКА МАРШРУТА
  // ============================================

  formatSingleRouteBlock(route, bestResult, analytics, checkStats) {
    const currentPrice = bestResult?.total_price;
    const userBudget = route.threshold_price;

    if (!currentPrice) {
      const routeName = airportResolver.formatRoute(route.origin, route.destination);
      let text = `📊 ${routeName}\n`;
      text += `❌ Цены не найдены\n`;
      text += `Ваш бюджет: ${Formatters.formatPrice(userBudget)}\n`;

      if (checkStats) {
        if (route.is_flexible) {
          text += `\nСейчас выполнено ${checkStats.current.successful_checks} проверок. Всего проверок ${checkStats.totalAllCombinations}`;
        } else if (checkStats.totalAllCombinations > 0) {
          text += `\nВсего выполнено ${checkStats.totalAllCombinations} проверок`;
        }
      }

      return { text, searchLink: null };
    }

    const diff = userBudget - currentPrice;
    const routeName = airportResolver.formatRoute(route.origin, route.destination);

    // Эмодзи заголовка
    let emoji;
    if (diff > 0 && diff / userBudget > 0.2) {
      emoji = '🎉';
    } else if (diff >= 0) {
      emoji = '✅';
    } else if (analytics && analytics.avgPrice && currentPrice < analytics.avgPrice) {
      emoji = '📉';
    } else {
      emoji = '📊';
    }

    let text = `${emoji} ${routeName}\n`;
    text += `💰 ${Formatters.formatPrice(currentPrice)}`;

    // Контекст бюджета
    if (diff > 0) {
      text += ` — на ${Formatters.formatPrice(diff)} ниже бюджета!\n`;
    } else if (diff === 0) {
      text += ` — точно в бюджете!\n`;
    } else {
      text += ` — превышение на ${Formatters.formatPrice(Math.abs(diff))}, продолжаем искать\n`;
    }

    text += `\nВаш бюджет: ${Formatters.formatPrice(userBudget)}\n`;

    // Средняя цена (только при >= 5 data points)
    if (analytics && analytics.dataPoints >= 5 && analytics.avgPrice) {
      const savingsFromAvg = analytics.avgPrice - currentPrice;
      if (savingsFromAvg > 0) {
        const savingsPct = Math.round((savingsFromAvg / analytics.avgPrice) * 100);
        text += `Средняя цена: ${Formatters.formatPrice(analytics.avgPrice)} • Экономия: ${Formatters.formatPrice(savingsFromAvg)} (${savingsPct}%)\n`;
      } else {
        text += `Средняя цена: ${Formatters.formatPrice(analytics.avgPrice)}\n`;
      }
    }

    // Исторический минимум
    if (analytics && analytics.minPrice && currentPrice <= analytics.minPrice) {
      text += `🔥 Исторический минимум за всё время!\n`;
    }

    // Детали билета
    text += '\n';
    if (bestResult) {
      const depDate = bestResult.departure_date ? this._formatShortDateRu(bestResult.departure_date) : null;
      const retDate = bestResult.return_date ? this._formatShortDateRu(bestResult.return_date) : null;

      let detailsLine = '📅 ';
      if (depDate && retDate) {
        detailsLine += `${depDate}–${retDate}`;
      } else if (depDate) {
        detailsLine += depDate;
      }

      // Авиакомпания
      const airlineName = Formatters.getAirlineName(route.airline);
      if (airlineName && airlineName !== 'Любая') {
        detailsLine += ` • ${airlineName}`;
      }
      text += detailsLine + '\n';

      // Пассажиры, багаж, пересадки
      let paramsLine = '';
      const adults = route.adults || 1;
      const children = route.children || 0;
      paramsLine += `${adults} взр`;
      if (children > 0) paramsLine += ` + ${children} реб`;

      if (route.baggage) paramsLine += ' • Багаж';

      if (route.max_stops === 0) {
        paramsLine += ' • Прямой';
      } else if (route.max_stops !== null && route.max_stops !== undefined) {
        paramsLine += ` • до ${route.max_stops} пересад.`;
      }

      text += paramsLine + '\n';
    }

    // Статистика проверок
    if (checkStats) {
      text += '\n';
      if (route.is_flexible) {
        text += `Сейчас выполнено ${checkStats.current.successful_checks + checkStats.current.failed_checks} проверок. Всего проверок ${checkStats.totalAllCombinations}`;
      } else if (checkStats.totalAllCombinations > 0) {
        text += `Всего выполнено ${checkStats.totalAllCombinations} проверок`;
      }
    }

    const searchLink = bestResult?.search_link || null;
    return { text, searchLink };
  }

  _formatShortDateRu(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }

  // ============================================
  // СВОДНЫЙ ОТЧЕТ
  // ============================================

  async sendConsolidatedReport(chatId, routeBlocks, timezone, disableNotification = true) {
    try {
      if (!routeBlocks || routeBlocks.length === 0) return;

      const time = this._formatTimeForUser(new Date(), timezone);
      const hasCritical = routeBlocks.some(b => b.priority === 'CRITICAL');
      const hasFinds = routeBlocks.some(b => b.block.searchLink);

      const header = hasCritical ? `🚨 Отличные новости! • ${time}` : `📊 Проверка завершена • ${time}`;
      const footer = hasFinds ? '\nОтличные цены! Не упусти 🎯' : '\nПродолжаю мониторинг 🔍';
      const separator = '\n━━━━━━━━━━━━━━━━━━━━━━━\n';

      // Собираем сообщение
      let message = header + '\n\n';
      const inlineButtons = [];

      for (let i = 0; i < routeBlocks.length; i++) {
        const { block, route } = routeBlocks[i];
        if (i > 0) message += separator;
        message += block.text;

        if (block.searchLink) {
          const routeName = airportResolver.formatRoute(route.origin, route.destination);
          inlineButtons.push([
            { text: `🔗 ${routeName} — Смотреть →`, url: block.searchLink }
          ]);
        }
      }

      message += footer;

      // Разбиваем если > 4000 символов
      const chunks = this._splitMessage(message, 4000);

      for (let i = 0; i < chunks.length; i++) {
        const opts = {
          parse_mode: 'Markdown',
          disable_notification: disableNotification
        };

        // Кнопки только к последнему чанку
        if (i === chunks.length - 1 && inlineButtons.length > 0) {
          opts.reply_markup = { inline_keyboard: inlineButtons.slice(0, 10) };
        }

        await this.bot.sendMessage(chatId, chunks[i], opts);
      }

      // Логируем
      await this._logNotification(chatId, null, 'report', null, 'report', disableNotification);

      console.log(`📊 Сводный отчет отправлен пользователю ${chatId} (${routeBlocks.length} маршрутов)`);
    } catch (error) {
      console.error('Ошибка отправки сводного отчета:', error.message);
    }
  }

  _splitMessage(text, maxLength) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    const separator = '━━━━━━━━━━━━━━━━━━━━━━━';
    const parts = text.split(separator);

    let current = '';
    for (const part of parts) {
      const addition = current ? separator + part : part;
      if ((current + addition).length > maxLength && current) {
        chunks.push(current.trim());
        current = part;
      } else {
        current += addition;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks.length > 0 ? chunks : [text.substring(0, maxLength)];
  }

  // ============================================
  // ДАЙДЖЕСТ
  // ============================================

  async sendDigestForUser(chatId) {
    try {
      const items = await this._getPendingDigestItems(chatId);
      if (items.length === 0) return;

      await airportResolver.load();
      const timezone = await this._getUserTimezone(chatId);
      const routeBlocks = [];

      for (const item of items) {
        const route = await this._getRouteById(item.route_id);
        if (!route) continue;

        const bestResults = await RouteResult.getTopResults(item.route_id, 1);
        const bestResult = bestResults[0] || null;
        const analytics = { avgPrice: item.avg_price, minPrice: item.historical_min, dataPoints: 5 };
        const checkStats = await this.getRouteCheckStats(item.route_id);

        const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats);
        routeBlocks.push({ block, route, priority: item.priority });
      }

      if (routeBlocks.length > 0) {
        await this.sendConsolidatedReport(chatId, routeBlocks, timezone, true);
      }

      await this._markDigestProcessed(chatId);
      console.log(`📬 Дайджест отправлен пользователю ${chatId} (${items.length} элементов)`);
    } catch (error) {
      console.error(`Ошибка отправки дайджеста для ${chatId}:`, error.message);
    }
  }

  _getPendingDigestItems(chatId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM daily_digest_queue
         WHERE chat_id = ? AND processed = 0
         ORDER BY
           CASE priority
             WHEN 'CRITICAL' THEN 1
             WHEN 'HIGH' THEN 2
             WHEN 'MEDIUM' THEN 3
             WHEN 'LOW' THEN 4
           END, created_at DESC`,
        [chatId],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  _markDigestProcessed(chatId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE daily_digest_queue SET processed = 1 WHERE chat_id = ? AND processed = 0',
        [chatId],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  _getRouteById(routeId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM unified_routes WHERE id = ?', [routeId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  // ============================================
  // ПОЛУЧЕНИЕ СТАТИСТИКИ (обновлённый)
  // ============================================

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
          (SELECT total_combinations FROM route_check_stats WHERE route_id = r.id ORDER BY check_timestamp DESC LIMIT 1) as totalCombinations,
          (SELECT successful_checks FROM route_check_stats WHERE route_id = r.id ORDER BY check_timestamp DESC LIMIT 1) as successfulChecks,
          (SELECT failed_checks FROM route_check_stats WHERE route_id = r.id ORDER BY check_timestamp DESC LIMIT 1) as failedChecks,
          (SELECT check_timestamp FROM route_check_stats WHERE route_id = r.id ORDER BY check_timestamp DESC LIMIT 1) as lastCheckTime
        FROM unified_routes r
          LEFT JOIN route_results rr ON r.id = rr.route_id
        WHERE r.chat_id = ? AND r.is_paused = 0
        GROUP BY r.id
        ORDER BY r.id
      `, [chatId], async (err, rows) => {
        if (err) return reject(err);

        const stats = [];
        for (const row of (rows || [])) {
          stats.push({
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
          });
        }

        resolve(stats);
      });
    });
  }

  // ============================================
  // BROADCAST (без изменений)
  // ============================================

  async sendBroadcastMessages(chatIds, messageText, broadcastId, batchSize = 25) {
    const BroadcastService = require('./BroadcastService');

    console.log(`📢 Начало отправки рассылки #${broadcastId} для ${chatIds.length} пользователей`);

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < chatIds.length; i += batchSize) {
      const batch = chatIds.slice(i, i + batchSize);
      const startTime = Date.now();

      const promises = batch.map(async (chatId) => {
        try {
          await this.bot.sendMessage(chatId, messageText, {
            parse_mode: 'HTML',
            disable_web_page_preview: false
          });
          await BroadcastService.logBroadcastSent(broadcastId, chatId);
          sent++;
          return { success: true, chatId };
        } catch (error) {
          console.error(`❌ Ошибка отправки broadcast пользователю ${chatId}:`, error.message);
          failed++;
          if (error.response && (error.response.body.error_code === 403 || error.response.body.error_code === 400)) {
            await BroadcastService.logBroadcastSent(broadcastId, chatId);
          }
          return { success: false, chatId, error: error.message };
        }
      });

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 1000 - elapsed);

      if (i + batchSize < chatIds.length && delay > 0) {
        console.log(`⏳ Отправлено ${sent + failed}/${chatIds.length}, пауза ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.log(`✅ Рассылка #${broadcastId} завершена: успешно ${sent}, ошибок ${failed}`);
    await BroadcastService.checkAndMarkComplete(broadcastId);
    return { sent, failed };
  }
}

module.exports = NotificationService;
