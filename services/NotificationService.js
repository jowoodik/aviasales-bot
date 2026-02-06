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
        const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats, priority);
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

      const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats, priority);
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

      const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats, priority);
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

  // ============================================
  // ОТПРАВКА АЛЕРТА С INLINE-КНОПКАМИ
  // ============================================

  async _sendInstantAlert(chatId, routeId, block, priority, price, timezone, silent) {
    try {
      const time = this._formatTimeForUser(new Date(), timezone);
      let header, footer;

      if (priority === 'CRITICAL') {
        header = `🔥🔥🔥 <b>СУПЕР ЦЕНА!</b> 🔥🔥🔥\n\n`;
        footer = '\n\n⚡️ <b>Цена может вырасти в ближайшие часы</b>';
      } else if (priority === 'HIGH') {
        header = `📊 <b>Хорошая цена найдена</b> • ${time}\n\n`;
        footer = '\n\n💡 Продолжаю искать варианты в бюджете';
      } else {
        header = `📊 <b>Проверка завершена</b> • ${time}\n\n`;
        footer = '\n\nПродолжаю мониторинг 🔍';
      }

      const message = `${header}${block.text}${footer}`;

      const sendOpts = {
        parse_mode: 'HTML',
        disable_notification: silent,
        disable_web_page_preview: true
      };

      // Добавляем inline-кнопку если есть ссылка
      if (block.searchLink) {
        const buttonText = priority === 'CRITICAL' ? '🎫 КУПИТЬ СЕЙЧАС' : '🎫 Посмотреть билет';
        sendOpts.reply_markup = {
          inline_keyboard: [[
            { text: buttonText, url: block.searchLink }
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
  // ФОРМАТИРОВАНИЕ БЛОКА МАРШРУТА (ОБНОВЛЕНО)
  // ============================================

  formatSingleRouteBlock(route, bestResult, analytics, checkStats, priority = 'MEDIUM') {
    const currentPrice = bestResult?.total_price;
    const userBudget = route.threshold_price;

    // Обработка отсутствия цен
    if (!currentPrice) {
      const routeName = airportResolver.formatRoute(route.origin, route.destination);
      let text = `<b>${routeName}</b>\n`;
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

    const routeName = airportResolver.formatRoute(route.origin, route.destination);

    // ========== CRITICAL: Максимально продающий формат ==========
    if (priority === 'CRITICAL') {
      const depDate = bestResult.departure_date ? this._formatShortDateForProgressBar(bestResult.departure_date) : null;
      const retDate = bestResult.return_date ? this._formatShortDateForProgressBar(bestResult.return_date) : null;

      let text = `<b>${routeName}</b>\n`;

      // Даты
      if (depDate && retDate) {
        const depDateObj = new Date(bestResult.departure_date);
        const retDateObj = new Date(bestResult.return_date);
        const days = Math.round((retDateObj - depDateObj) / (1000 * 60 * 60 * 24));
        text += `📅 ${depDate}–${retDate} (${days} ${this._pluralizeDays(days)})\n`;
      } else if (depDate) {
        text += `📅 ${depDate}\n`;
      }

      // Пассажиры
      const adults = route.adults || 1;
      const children = route.children || 0;
      if (adults > 1 || children > 0) {
        text += `👥 ${adults} ${adults === 1 ? 'взрослый' : 'взрослых'}`;
        if (children > 0) text += ` + ${children} ${children === 1 ? 'ребенок' : 'детей'}`;
        text += '\n';
      }

      text += '\n';

      // Главное - цена крупно
      text += `💎 <b>${Formatters.formatPrice(currentPrice)}</b> за всех\n\n`;

      // Экономия (если есть средняя цена)
      if (analytics && analytics.avgPrice && analytics.dataPoints >= 5) {
        const savings = analytics.avgPrice - currentPrice;
        const savingsPercent = Math.round((savings / analytics.avgPrice) * 100);

        if (savings > 0) {
          text += `<b>💰 Экономия ${Formatters.formatPrice(savings)} (-${savingsPercent}%)</b>\n`;
        }
      }

      // Сравнение с бюджетом
      if (currentPrice <= userBudget) {
        text += `🎯 Ваш бюджет: ${Formatters.formatPrice(userBudget)} ✅\n`;
      } else {
        const over = currentPrice - userBudget;
        const overPercent = Math.round((over / userBudget) * 100);
        text += `🎯 Ваш бюджет: ${Formatters.formatPrice(userBudget)} (+${overPercent}%)\n`;
      }

      // Средняя цена
      if (analytics && analytics.avgPrice && analytics.dataPoints >= 5) {
        text += `📊 Обычная цена: ${Formatters.formatPrice(analytics.avgPrice)}\n`;
      }

      text += '\n';

      // Детали рейса
      const airlineName = Formatters.getAirlineName(route.airline);
      text += '✈️ ';
      if (airlineName && airlineName !== 'Любая') {
        text += `${airlineName}`;
      }

      if (route.max_stops === 0) {
        text += ' • Прямой';
      } else if (route.max_stops === 1) {
        text += ' • 1 пересадка';
      }

      if (route.baggage) {
        text += ' • 🧳';
      }

      return { text, searchLink: bestResult?.search_link || null };
    }

    // ========== HIGH: Нейтральный информативный формат ==========
    if (priority === 'HIGH') {
      const depDate = bestResult.departure_date ? this._formatShortDateForProgressBar(bestResult.departure_date) : null;
      const retDate = bestResult.return_date ? this._formatShortDateForProgressBar(bestResult.return_date) : null;

      let text = `<b>${routeName}</b>\n`;

      // Даты
      if (depDate && retDate) {
        const depDateObj = new Date(bestResult.departure_date);
        const retDateObj = new Date(bestResult.return_date);
        const days = Math.round((retDateObj - depDateObj) / (1000 * 60 * 60 * 24));
        text += `📅 ${depDate}–${retDate} (${days} ${this._pluralizeDays(days)})\n`;
      } else if (depDate) {
        text += `📅 ${depDate}\n`;
      }

      // Пассажиры компактно
      const adults = route.adults || 1;
      const children = route.children || 0;
      text += `👥 ${adults}`;
      if (children > 0) text += `+${children}`;

      // Пересадки, багаж
      if (route.max_stops === 0) {
        text += ' • Прямой';
      } else if (route.max_stops === 1) {
        text += ' • 1 пересадка';
      }
      if (route.baggage) text += ' • 🧳';
      text += '\n\n';

      // Цена
      text += `💰 <b>${Formatters.formatPrice(currentPrice)}</b> за всех\n\n`;

      // Сравнения
      const budgetDiff = currentPrice - userBudget;
      const budgetPercent = Math.round((budgetDiff / userBudget) * 100);
      text += `Ваш бюджет: ${Formatters.formatPrice(userBudget)}`;
      if (budgetDiff > 0) {
        text += ` (+${budgetPercent}%)`;
      } else {
        text += ` ✅`;
      }
      text += '\n';

      if (analytics && analytics.avgPrice && analytics.dataPoints >= 5) {
        const avgDiff = currentPrice - analytics.avgPrice;
        const avgPercent = Math.round((avgDiff / analytics.avgPrice) * 100);
        text += `Средняя цена: ${Formatters.formatPrice(analytics.avgPrice)}`;
        if (avgDiff < 0) {
          text += ` (${avgPercent}%)`;
        }
        text += '\n';
      }

      text += '\n';

      // Авиакомпания
      const airlineName = Formatters.getAirlineName(route.airline);
      if (airlineName && airlineName !== 'Любая') {
        text += `✈️ ${airlineName}`;
      }

      return { text, searchLink: bestResult?.search_link || null };
    }

    // ========== MEDIUM/LOW: Минимальный формат ==========
    const depDate = bestResult.departure_date ? this._formatShortDateForProgressBar(bestResult.departure_date) : null;
    const retDate = bestResult.return_date ? this._formatShortDateForProgressBar(bestResult.return_date) : null;

    let text = `<b>${routeName}</b>\n`;

    if (depDate && retDate) {
      text += `📅 ${depDate}–${retDate}\n`;
    } else if (depDate) {
      text += `📅 ${depDate}\n`;
    }

    const adults = route.adults || 1;
    const children = route.children || 0;
    text += `👥 ${adults}`;
    if (children > 0) text += `+${children}`;
    text += '\n\n';

    // Цена
    text += `Цена: ${Formatters.formatPrice(currentPrice)}\n`;

    // Сравнение с бюджетом
    const budgetDiff = currentPrice - userBudget;
    if (budgetDiff > userBudget * 0.5) {
      // Если превышение больше 50%
      const times = Math.round(currentPrice / userBudget * 10) / 10;
      text += `Ваш бюджет: ${Formatters.formatPrice(userBudget)} (превышение в ${times} раза)\n`;
    } else {
      const budgetPercent = Math.round((budgetDiff / userBudget) * 100);
      text += `Ваш бюджет: ${Formatters.formatPrice(userBudget)} (+${budgetPercent}%)\n`;
    }

    // Сравнение со средней ценой (если есть достаточно данных)
    if (analytics && analytics.avgPrice && analytics.dataPoints >= 5) {
      const avgDiff = currentPrice - analytics.avgPrice;
      const avgPercent = Math.round((avgDiff / analytics.avgPrice) * 100);

      text += `Средняя цена: ${Formatters.formatPrice(analytics.avgPrice)}`;

      if (avgDiff < 0) {
        // Цена ниже средней - показываем как выгоду
        text += ` (${avgPercent}%)`;
      } else if (avgDiff > 0) {
        // Цена выше средней - тоже показываем для полноты информации
        text += ` (+${avgPercent}%)`;
      }
      text += '\n';
    }

    return { text, searchLink: bestResult?.search_link || null };
  }

  _formatShortDateForProgressBar(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  }

  _formatShortDateRu(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }

  // ============================================
  // СВОДНЫЙ ОТЧЕТ С INLINE-КНОПКАМИ
  // ============================================

  async sendConsolidatedReport(chatId, routeBlocks, timezone, disableNotification = true) {
    try {
      if (!routeBlocks || routeBlocks.length === 0) return;

      const time = this._formatTimeForUser(new Date(), timezone);
      const hasCritical = routeBlocks.some(b => b.priority === 'CRITICAL');
      const hasFinds = routeBlocks.some(b => b.block.searchLink !== null);

      // Функция для генерации линии с самолетом
      const generatePlaneLine = (position, totalSteps) => {
        const LINE_LENGTH = 20;
        const planePos = Math.round((position / totalSteps) * LINE_LENGTH);
        const left = '─'.repeat(planePos);
        const right = '─'.repeat(LINE_LENGTH - planePos);
        return `<b>${left}✈${right}</b>`;
      };

      const total = routeBlocks.length;

      // Header
      const headerTitle = hasCritical ? `🔥 <b>Отличные новости!</b> • ${time}` : `📊 <b>Проверка завершена</b> • ${time}`;
      const header = `${headerTitle}\n\n${generatePlaneLine(0, total)}\n\n`;

      // Footer
      const footerTitle = hasFinds ? '<b>Отличные цены! Не упусти 🎯</b>' : '<i>Продолжаю мониторинг 🔍</i>';
      const footer = `\n\n${generatePlaneLine(total, total)}\n\n${footerTitle}`;

      // Сборка сообщения
      let message = header;

      for (let i = 0; i < total; i++) {
        const { block } = routeBlocks[i];

        if (i > 0) {
          message += `\n\n${generatePlaneLine(i, total)}\n\n`;
        }

        message += block.text;
      }

      message += footer;

      // Разбиваем если > 4000 символов
      const chunks = this._splitMessage(message, 4000);

      // Собираем кнопки (максимум 10)
      const buttons = [];
      for (const rb of routeBlocks) {
        if (rb.block.searchLink && buttons.length < 10) {
          const routeName = airportResolver.formatRoute(rb.route.origin, rb.route.destination);
          buttons.push([{
            text: `🔗 ${routeName} — Смотреть →`,
            url: rb.block.searchLink
          }]);
        }
      }

      // Отправляем чанки
      for (let i = 0; i < chunks.length; i++) {
        const opts = {
          parse_mode: 'HTML',
          disable_notification: disableNotification,
          disable_web_page_preview: true
        };

        // Кнопки только к последнему чанку
        if (i === chunks.length - 1 && buttons.length > 0) {
          opts.reply_markup = { inline_keyboard: buttons };
        }

        await this.bot.sendMessage(chatId, chunks[i], opts);
      }

      await this._logNotification(chatId, null, 'report', null, 'report', disableNotification);

      console.log(`📊 Сводный отчет отправлен пользователю ${chatId} (${routeBlocks.length} маршрутов)`);
    } catch (error) {
      console.error('Ошибка отправки сводного отчета:', error.message);
    }
  }

  _splitMessage(text, maxLength) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    const separator = '───────── ✈ ─────────';
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

        const block = this.formatSingleRouteBlock(route, bestResult, analytics, checkStats, item.priority);
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
  // ПОЛУЧЕНИЕ СТАТИСТИКИ
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
  // BROADCAST
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
          await BroadcastService.logBroadcastSent(broadcastId, chatId, 'success');
          sent++;
          return { success: true, chatId };
        } catch (error) {
          console.error(`❌ Ошибка отправки broadcast пользователю ${chatId}:`, error.message);
          await BroadcastService.logBroadcastSent(broadcastId, chatId, 'error: '+ error.message);
          failed++;
          return { success: false, chatId, error: error.message };
        }
      });

      await Promise.all(promises);

      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 1000 - elapsed);

      if (i + batchSize < chatIds.length && delay > 0) {
        console.log(`⏳ Отправлено успешно ${sent} | отправлено с ошибкой ${failed} | всего${chatIds.length}, пауза ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.log(`✅ Рассылка #${broadcastId} завершена: успешно ${sent}, ошибок ${failed}`);
    await BroadcastService.checkAndMarkComplete(broadcastId);
    return { sent, failed };
  }
}

module.exports = NotificationService;
