const db = require('../config/database');
const Formatters = require('../utils/formatters');
const airportResolver = require('../utils/AirportCodeResolver');

class NotificationService {
  constructor(bot) {
    this.bot = bot;
    this.blockedUsers = new Set(); // chat_id пользователей, заблокировавших бота или не найденных
  }

  async classifyPriority(routeData) {
    const { currentPrice, userBudget, historicalMin, routeId, tripId } = routeData;
    const reasons = [];
    let score = 0;

    // Получаем статистику для расчета скоринга
    const stats = tripId
      ? await this.getTripStatistics(tripId)
      : await this.getRouteStatistics(routeId);
    const { avgPrice, stdPrice, dataPoints } = stats;

    // 1. Базовый скоринг (объективная оценка цены)

    // 1.1 Относительно минимума
    if (historicalMin) {
      if (currentPrice < historicalMin) {
        score += 5;
        reasons.push(`+5 новый минимум (было ${historicalMin.toLocaleString('ru-RU')} ₽)`);
      } else if (currentPrice < historicalMin * 1.02) {
        score += 4;
        reasons.push(`+4 около минимума (${historicalMin.toLocaleString('ru-RU')} ₽)`);
      } else if (currentPrice < historicalMin * 1.05) {
        score += 3;
        reasons.push(`+3 близко к минимуму`);
      } else if (currentPrice < historicalMin * 1.10) {
        score += 2;
        reasons.push(`+2 в топ 10%`);
      }
    }

    // 1.2 Статистическое отклонение (если достаточно данных)
    if (avgPrice && stdPrice && dataPoints >= 10) {
      const zScore = (avgPrice - currentPrice) / stdPrice;
      if (zScore > 1.0) {
        score += 3;
        reasons.push(`+3 сильно ниже среднего (z=${zScore.toFixed(1)})`);
      } else if (zScore > 0.5) {
        score += 2;
        reasons.push(`+2 ниже среднего (z=${zScore.toFixed(1)})`);
      } else if (zScore > 0) {
        score += 1;
        reasons.push(`+1 чуть ниже среднего`);
      }
    }

    // 2. Бонус за соответствие бюджету
    if (userBudget) {
      if (currentPrice < userBudget * 0.85) {
        score += 3;
        reasons.push(`+3 на 15%+ ниже бюджета`);
      } else if (currentPrice < userBudget) {
        score += 2;
        reasons.push(`+2 в рамках бюджета`);
      }
    }

    // 3. ПРИОРИТЕТЫ

    // CRITICAL - СТРОГО: цена ниже бюджета И объективно выгодная
    if (userBudget && currentPrice < userBudget && score >= 7) {
      reasons.unshift(`🔥 Цена ${currentPrice.toLocaleString('ru-RU')} ₽ ниже бюджета ${userBudget.toLocaleString('ru-RU')} ₽`);
      return { priority: 'CRITICAL', score, reasons };
    }

    // HIGH - хорошая цена (квота проверяется в _canSendNotification)
    if (score >= 4) {
      reasons.unshift(`Хорошая цена ${currentPrice.toLocaleString('ru-RU')} ₽ (скор: ${score})`);
      return { priority: 'HIGH', score, reasons };
    }

    // LOW - всё остальное
    reasons.unshift(`Обычная цена ${currentPrice.toLocaleString('ru-RU')} ₽`);
    return { priority: 'LOW', score, reasons };
  }

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

  getRouteStatistics(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
          `SELECT
        AVG(price) as avgPrice,
        MIN(price) as minPrice,
        COUNT(*) as dataPoints,
        (SELECT AVG((price - avg_price) * (price - avg_price))
         FROM price_analytics, (SELECT AVG(price) as avg_price FROM price_analytics WHERE route_id = ?)
         WHERE route_id = ?) as variance
       FROM price_analytics
       WHERE route_id = ?`,
          [routeId, routeId, routeId],
          (err, row) => {
            if (err) return reject(err);

            if (!row || !row.dataPoints) {
              return resolve({ avgPrice: null, minPrice: null, stdPrice: null, dataPoints: 0 });
            }

            const stdPrice = row.variance ? Math.sqrt(row.variance) : null;

            resolve({
              avgPrice: row.avgPrice,
              minPrice: row.minPrice,
              stdPrice: stdPrice,
              dataPoints: row.dataPoints
            });
          }
      );
    });
  }

  getTripStatistics(tripId) {
    return new Promise((resolve, reject) => {
      db.get(
          `SELECT
        AVG(total_price) as avgPrice,
        MIN(total_price) as minPrice,
        COUNT(*) as dataPoints,
        (SELECT AVG((total_price - avg_price) * (total_price - avg_price))
         FROM trip_results, (SELECT AVG(total_price) as avg_price FROM trip_results WHERE trip_id = ?)
         WHERE trip_id = ?) as variance
       FROM trip_results
       WHERE trip_id = ?`,
          [tripId, tripId, tripId],
          (err, row) => {
            if (err) return reject(err);

            if (!row || !row.dataPoints) {
              return resolve({ avgPrice: null, minPrice: null, stdPrice: null, dataPoints: 0 });
            }

            const stdPrice = row.variance ? Math.sqrt(row.variance) : null;

            resolve({
              avgPrice: row.avgPrice,
              minPrice: row.minPrice,
              stdPrice: stdPrice,
              dataPoints: row.dataPoints
            });
          }
      );
    });
  }

  async _canSendNotification(chatId, routeId, priority, currentPrice, tripId = null) {
    const idColumn = tripId ? 'trip_id' : 'route_id';
    const idValue = tripId || routeId;
    const now = Date.now();

    // Начало сегодняшнего дня
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    // === CRITICAL ===
    if (priority === 'CRITICAL') {
      const lastUrgent = await new Promise((resolve, reject) => {
        db.get(
            `SELECT price, sent_at FROM notification_log
         WHERE chat_id = ? AND ${idColumn} = ? AND priority = 'CRITICAL'
         ORDER BY sent_at DESC LIMIT 1`,
            [chatId, idValue],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
        );
      });

      if (!lastUrgent) {
        return { canSend: true, reason: 'Первое CRITICAL' };
      }

      const hoursSince = (now - new Date(lastUrgent.sent_at).getTime()) / (1000 * 60 * 60);

      // Можно отправить если прошло 6ч ИЛИ цена упала
      if (hoursSince >= 6) {
        return { canSend: true, reason: `Прошло ${hoursSince.toFixed(1)}ч с последнего CRITICAL` };
      }

      if (lastUrgent.price > currentPrice) {
        return { canSend: true, reason: `Цена упала: ${lastUrgent.price} → ${currentPrice}` };
      }

      return {
        canSend: false,
        reason: `CRITICAL < 6ч назад (${hoursSince.toFixed(1)}ч), цена не упала`
      };
    }

    // === HIGH (максимум 2 в день) ===
    if (priority === 'HIGH') {
      // Считаем сколько HIGH отправлено сегодня
      const highCountToday = await new Promise((resolve, reject) => {
        db.get(
            `SELECT COUNT(*) as count FROM notification_log
         WHERE chat_id = ? AND ${idColumn} = ?
         AND priority = 'HIGH'
         AND sent_at >= ?`,
            [chatId, idValue, todayStartISO],
            (err, row) => {
              if (err) return reject(err);
              resolve(row ? row.count : 0);
            }
        );
      });

      // Квота исчерпана
      if (highCountToday >= 2) {
        return {
          canSend: false,
          reason: `Квота HIGH исчерпана (${highCountToday}/2 сегодня)`
        };
      }

      // Проверяем таймаут от ЛЮБОГО уведомления
      const lastAny = await new Promise((resolve, reject) => {
        db.get(
            `SELECT sent_at FROM notification_log
         WHERE chat_id = ? AND ${idColumn} = ?
         ORDER BY sent_at DESC LIMIT 1`,
            [chatId, idValue],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
        );
      });

      if (!lastAny) {
        return { canSend: true, reason: 'Первое HIGH за день' };
      }

      const hoursSince = (now - new Date(lastAny.sent_at).getTime()) / (1000 * 60 * 60);

      // HIGH: минимум 8 часов между уведомлениями
      if (hoursSince >= 8) {
        return {
          canSend: true,
          reason: `Прошло ${hoursSince.toFixed(1)}ч (HIGH ${highCountToday + 1}/2)`
        };
      }

      return {
        canSend: false,
        reason: `Последнее < 8ч назад (${hoursSince.toFixed(1)}ч)`
      };
    }

    // === LOW (для набора минимума 3 уведомления в день) ===
    if (priority === 'LOW') {
      // Считаем общее количество уведомлений сегодня
      const totalToday = await new Promise((resolve, reject) => {
        db.get(
            `SELECT COUNT(*) as count FROM notification_log
         WHERE chat_id = ? AND ${idColumn} = ?
         AND sent_at >= ?`,
            [chatId, idValue, todayStartISO],
            (err, row) => {
              if (err) return reject(err);
              resolve(row ? row.count : 0);
            }
        );
      });

      // Если уже есть 3+ уведомления сегодня - LOW не отправляем
      if (totalToday >= 3) {
        return {
          canSend: false,
          reason: `Уже ${totalToday} уведомлений сегодня`
        };
      }

      // Проверяем таймаут
      const lastAny = await new Promise((resolve, reject) => {
        db.get(
            `SELECT sent_at FROM notification_log
         WHERE chat_id = ? AND ${idColumn} = ?
         ORDER BY sent_at DESC LIMIT 1`,
            [chatId, idValue],
            (err, row) => {
              if (err) return reject(err);
              resolve(row);
            }
        );
      });

      if (!lastAny) {
        return { canSend: true, reason: 'Первое LOW за день' };
      }

      const hoursSince = (now - new Date(lastAny.sent_at).getTime()) / (1000 * 60 * 60);

      // LOW: минимум 6 часов между уведомлениями
      if (hoursSince >= 6) {
        return {
          canSend: true,
          reason: `Прошло ${hoursSince.toFixed(1)}ч (уведомление ${totalToday + 1}/3+)`
        };
      }

      return {
        canSend: false,
        reason: `Последнее < 6ч назад (${hoursSince.toFixed(1)}ч)`
      };
    }

    return { canSend: false, reason: 'Неизвестный приоритет' };
  }

  async processNoResults(chatId, routeId, tripId = null) {
    const idColumn = tripId ? 'trip_id' : 'route_id';
    const idValue = tripId || routeId;

    const lastNotif = await new Promise((resolve, reject) => {
      db.get(
        `SELECT sent_at FROM notification_log
         WHERE chat_id = ? AND ${idColumn} = ?
         ORDER BY sent_at DESC LIMIT 1`,
        [chatId, idValue],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });

    if (!lastNotif) {
      return { shouldSend: true, reason: 'Первое уведомление о отсутствии цен' };
    }

    const hoursSince = (Date.now() - new Date(lastNotif.sent_at).getTime()) / (1000 * 60 * 60);

    if (hoursSince >= 48) {
      return { shouldSend: true, reason: `Прошло ${hoursSince.toFixed(1)} часов с последнего уведомления` };
    }

    return { shouldSend: false, reason: `Уведомление о отсутствии цен < 48ч назад (${hoursSince.toFixed(1)}ч)` };
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

  async processAndRouteNotification({ chatId, routeId, tripId, route, priority, reasons, currentPrice, analytics, bestResult, checkStats, userSettings, subscriptionType }) {
    // 1. Проверка возможности отправки
    const checkResult = await this._canSendNotification(chatId, routeId, priority, currentPrice, tripId);

    if (!checkResult.canSend) {
      console.log(`    ⏭️  Пропуск уведомления [${priority}] для ${tripId ? 'трипа' : 'маршрута'} ${tripId || routeId}: ${checkResult.reason}`);
      return {
        action: 'skipped',
        priority,
        reason: checkResult.reason
      };
    }

    // 2. Определение message_type
    let messageType;
    if (priority === 'CRITICAL') {
      messageType = 'URGENT';
    } else if (priority === 'HIGH' || priority === 'LOW') {
      messageType = 'DAILY';
    }

    // 3. Определение звука
    let disableNotification = false;

    if (priority === 'LOW') {
      disableNotification = true; // LOW всегда без звука
    } else {
      // CRITICAL/HIGH - проверяем настройки и время
      if (userSettings?.notifications_enabled === 0) {
        disableNotification = true;
      }

      // Получаем час в таймзоне пользователя
      const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
      const hour = parseInt(new Date().toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
      }));

      if (hour >= 23 || hour < 8) {
        disableNotification = true;
      }
    }

    // 4. Логирование
    await this._logNotification(chatId, routeId, priority, currentPrice, messageType, disableNotification, tripId);

    console.log(`    ${disableNotification ? '🔕' : '🔔'} Уведомление [${priority}/${messageType}] для маршрута ${routeId}: ${checkResult.reason}`);

    // 5. Возвращаем результат
    return {
      action: disableNotification ? 'sent_silent' : 'sent',
      priority,
      messageType,
      reason: checkResult.reason
    };
  }

  async formatSingleRouteBlock(route, bestResult, analytics, checkStats, priority = 'MEDIUM') {
    await airportResolver.load();

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

      return {
        text,
        searchLink: null,
        routeId: route.id,
        resultId: null,
        price: null
      };
    }

    const routeName = airportResolver.formatRoute(route.origin, route.destination);

    // ========== CRITICAL: Максимально продающий формат ==========
    if (priority === 'CRITICAL') {
      const depDate = bestResult.departure_date ? this._formatShortDateForProgressBar(bestResult.departure_date) : null;
      const retDate = bestResult.return_date ? this._formatShortDateForProgressBar(bestResult.return_date) : null;

      // Главное - цена крупно
      let text = `💎 <b>${Formatters.formatPrice(currentPrice)}</b> за всех\n\n`;
      text += `<b>${routeName}</b>\n\n`;

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
        text += `👥 ${adults}`;
        if (children > 0) text += ` + ${children}`;
      }

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

      text += '\n\n';

      // Средняя цена
      if (analytics && analytics.avgPrice && analytics.dataPoints >= 5) {
        text += `📊 Средняя цена: ${Formatters.formatPrice(analytics.avgPrice)}\n`;
      }

      // Экономия (если есть средняя цена)
      if (analytics && analytics.avgPrice && analytics.dataPoints >= 5) {
        const savings = analytics.avgPrice - currentPrice;
        const savingsPercent = Math.round((savings / analytics.avgPrice) * 100);

        if (savings > 0) {
          text += `<b>💰 Экономия ${Formatters.formatPrice(savings)} (-${savingsPercent}% к средней цене)</b>\n`;
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

      return {
      text,
      searchLink: bestResult?.search_link || null,
      routeId: route.id,
      resultId: bestResult?.id || null,
      price: bestResult?.total_price || null,
      origin: route.origin,
      destination: route.destination
    };
    }

    // ========== HIGH: Нейтральный информативный формат ==========
    if (priority === 'HIGH') {
      const depDate = bestResult.departure_date ? this._formatShortDateForProgressBar(bestResult.departure_date) : null;
      const retDate = bestResult.return_date ? this._formatShortDateForProgressBar(bestResult.return_date) : null;

      // Цена
      let text = `💰 <b>${Formatters.formatPrice(currentPrice)}</b> за всех\n`;
      text += `<b>${routeName}</b>\n\n`;

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

      // Авиакомпания
      const airlineName = Formatters.getAirlineName(route.airline);
      if (airlineName && airlineName !== 'Любая') {
        text += `• ✈️ ${airlineName}`;
      }

      text += '\n\n';

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

      return {
      text,
      searchLink: bestResult?.search_link || null,
      routeId: route.id,
      resultId: bestResult?.id || null,
      price: bestResult?.total_price || null,
      origin: route.origin,
      destination: route.destination
    };
    }

    // ========== LOW: Минимальный формат ==========
    const depDate = bestResult.departure_date ? this._formatShortDateForProgressBar(bestResult.departure_date) : null;
    const retDate = bestResult.return_date ? this._formatShortDateForProgressBar(bestResult.return_date) : null;

    // Цена
    let text = `<b>${routeName}</b>\n\n`;
    text += `Цена: ${Formatters.formatPrice(currentPrice)}\n`;

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

    return {
      text,
      searchLink: bestResult?.search_link || null,
      routeId: route.id,
      resultId: bestResult?.id || null,
      price: bestResult?.total_price || null,
      origin: route.origin,
      destination: route.destination
    };
  }

  formatNoResultsBlock(route, analytics, checkStats, timezone) {
    const time = this._formatTimeForUser(new Date(), timezone);
    const routeName = airportResolver.formatRoute(route.origin, route.destination);

    let text = `🔍 Цены не найдены • ${time}\n\n`;
    text += `<b>${routeName}</b>\n`;
    text += `❌ Цены не найдены\n`;
    text += `Ваш бюджет: ${route.threshold_price.toLocaleString('ru-RU')} ₽\n\n`;

    if (checkStats && checkStats.current) {
      if (route.is_flexible) {
        text += `Сейчас выполнено ${checkStats.current.successful_checks} проверок. Всего проверок ${checkStats.totalAllCombinations}\n\n`;
      } else if (checkStats.totalAllCombinations > 0) {
        text += `Всего выполнено ${checkStats.totalAllCombinations} проверок\n\n`;
      }
    }

    text += `Продолжаю мониторинг 🔍`;

    return {
      text,
      searchLink: null
    };
  }

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

  async _sendInstantAlert(chatId, routeId, block, priority, price, timezone, silent) {
    try {
      const time = this._formatTimeForUser(new Date(), timezone);
      let header, footer;

      if (priority === 'CRITICAL') {
        header = `🔥🔥🔥 <b>Цена ниже бюджета</b>\n\n`;
        footer = '\n\n⚡️ <b>Цена может вырасти в ближайшие часы</b>';
      } else if (priority === 'HIGH') {
        header = `📊 <b>Самая низкая цена</b> • ${time}\n\n`;
        footer = '\n\n💡 Продолжаю искать варианты в бюджете';
      } else {
        header = `🔍 <b>Продолжаем поиск</b> • ${time}\n\n`;
        footer = '\n\nПродолжаю мониторинг 🔎';
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
        // Используем callback_data для отслеживания кликов
        // Формат: aff:routeId:resultId:price
        const callbackData = `aff:${block.routeId}:${block.resultId || 0}:${Math.round(block.price || 0)}`;
        sendOpts.reply_markup = {
          inline_keyboard: [[
            { text: buttonText, callback_data: callbackData }
          ]]
        };
      }

      await this.bot.sendMessage(chatId, message, sendOpts);

      console.log(`${silent ? '🔕' : '🔔'} Алерт [${priority}] отправлен пользователю ${chatId}`);
    } catch (error) {
      console.error(`Ошибка отправки алерта [${priority}]:`, error.message);
      if (this._isUserBlockedError(error)) {
        this.blockedUsers.add(chatId);
      }
    }
  }

  _formatShortDateForProgressBar(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
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

  _logNotification(chatId, routeId, priority, price, messageType, silent, tripId = null) {
    return new Promise((resolve, reject) => {
      db.run(
          `INSERT INTO notification_log (chat_id, route_id, priority, price, message_type, sent_at, disable_notification, trip_id)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
          [chatId, routeId, priority, price, messageType, silent ? 1 : 0, tripId],
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

  // ========================================
  // TRIP-СПЕЦИФИЧНЫЕ МЕТОДЫ
  // ========================================

  getTripAnalytics(tripId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT AVG(total_price) as avgPrice, MIN(total_price) as minPrice, COUNT(*) as dataPoints
         FROM trip_results WHERE trip_id = ?`,
        [tripId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || { avgPrice: null, minPrice: null, dataPoints: 0 });
        }
      );
    });
  }

  formatTripBlock(trip, legs, bestCombo, analytics, priority) {
    const currentPrice = bestCombo.totalPrice;
    const userBudget = trip.threshold_price;

    // Цена
    let text = '';
    if (priority === 'CRITICAL') {
      text += `💎 <b>${Formatters.formatPrice(currentPrice)}</b> за всё путешествие\n\n`;
    } else if (priority === 'HIGH') {
      text += `💰 <b>${Formatters.formatPrice(currentPrice)}</b> за всё путешествие\n\n`;
    } else {
      text += `<b>${Formatters.formatPrice(currentPrice)}</b> за всё путешествие\n\n`;
    }

    // Маршрут
    text += `🗺️ <b>${trip.name}</b>\n\n`;

    // Общие даты
    if (bestCombo.legs.length > 0) {
      const firstDate = bestCombo.legs[0].departureDate;
      const lastDate = bestCombo.legs[bestCombo.legs.length - 1].departureDate;
      const firstDateObj = new Date(firstDate);
      const lastDateObj = new Date(lastDate);
      const totalDays = Math.round((lastDateObj - firstDateObj) / (1000 * 60 * 60 * 24));

      text += `📅 ${this._formatShortDateForProgressBar(firstDate)} – ${this._formatShortDateForProgressBar(lastDate)}`;
      if (totalDays > 0) text += ` (${totalDays} ${this._pluralizeDays(totalDays)})`;
      text += '\n';
    }

    text += '\n';

    // Ноги с ценами (с учётом RT пар, как в routeHandlers)
    const comboLegs = bestCombo.legs;
    let hasRoundTrip = false;

    for (const cl of comboLegs) {
      const leg = legs.find(l => l.leg_order === cl.legOrder);
      if (!leg) continue;

      const depDate = this._formatShortDateForProgressBar(cl.departureDate);

      if (cl.coveredByRoundTrip) {
        // Return-нога RT пары — цена 0, включена в другой билет
        text += `  ${cl.legOrder}. ${depDate} ${leg.origin}→${leg.destination} — 0 ₽ (включено в билет ${cl.coveredByRoundTrip})\n`;
        hasRoundTrip = true;
      } else if (cl.isRoundTrip) {
        // Outbound-нога RT пары — показываем дату возврата
        const returnLeg = comboLegs.find(l => l.coveredByRoundTrip === cl.legOrder);
        if (returnLeg) {
          const retDate = this._formatShortDateForProgressBar(returnLeg.departureDate);
          text += `  ${cl.legOrder}. ${depDate}-${retDate} ${leg.origin}↔${leg.destination} — ${Formatters.formatPrice(cl.price)} (туда-обратно)\n`;
          hasRoundTrip = true;
        } else {
          text += `  ${cl.legOrder}. ${depDate} ${leg.origin}→${leg.destination} — ${Formatters.formatPrice(cl.price)}\n`;
        }
      } else {
        // One-way нога
        text += `  ${cl.legOrder}. ${depDate} ${leg.origin}→${leg.destination} — ${Formatters.formatPrice(cl.price)}\n`;
      }
    }

    text += '\n';

    // Бюджет
    if (currentPrice <= userBudget) {
      const savings = userBudget - currentPrice;
      text += `🔥 <b>НИЖЕ БЮДЖЕТА!</b> Экономия: ${Formatters.formatPrice(savings)}\n`;
      text += `🎯 Бюджет: ${Formatters.formatPrice(userBudget)} ✅\n`;
    } else {
      const over = currentPrice - userBudget;
      const overPercent = Math.round((over / userBudget) * 100);
      text += `🎯 Бюджет: ${Formatters.formatPrice(userBudget)} (+${overPercent}%)\n`;
    }

    // Средняя цена
    if (analytics && analytics.avgPrice && analytics.dataPoints >= 3) {
      text += `📊 Средняя: ${Formatters.formatPrice(analytics.avgPrice)}\n`;
    }

    // Примечание о RT билетах
    if (hasRoundTrip) {
      const allRoundTrip = comboLegs.every(l => l.isRoundTrip || l.coveredByRoundTrip);
      if (allRoundTrip) {
        text += `\n💡 Бот нашел билеты туда-обратно — они дешевле, чем два билета в одну сторону!`;
      } else {
        text += `\n💡 Часть маршрута найдена по билетам туда-обратно (дешевле одного направления).`;
      }
    }

    return {
      text,
      legs: comboLegs,
      tripId: trip.id,
      totalPrice: currentPrice
    };
  }

  formatTripPartialResultsBlock(trip, legs, pricesByLeg, timezone) {
    const time = this._formatTimeForUser(new Date(), timezone);

    let text = `🔍 Неполные результаты • ${time}\n\n`;
    text += `🗺️ <b>${trip.name}</b>\n\n`;

    for (const leg of legs) {
      const legPrices = pricesByLeg.get(leg.leg_order);
      const idx = leg.leg_order;

      if (legPrices && legPrices.size > 0) {
        // Найти минимальную цену по всем датам
        let minPrice = Infinity;
        for (const [, data] of legPrices) {
          if (data.price < minPrice) minPrice = data.price;
        }
        text += `${idx}️⃣ ${leg.origin}→${leg.destination} — от ${Formatters.formatPrice(minPrice)} ✅\n`;
      } else {
        text += `${idx}️⃣ ${leg.origin}→${leg.destination} — ❌ не найдено\n`;
      }
    }

    text += `\nПолная комбинация не найдена.\n`;
    text += `Бюджет: ${Formatters.formatPrice(trip.threshold_price)}\n\n`;
    text += `Продолжаю мониторинг 🔍`;

    return { text, searchLink: null };
  }

  formatTripNoResultsBlock(trip, legs, timezone) {
    const time = this._formatTimeForUser(new Date(), timezone);

    let text = `🔍 Цены не найдены • ${time}\n\n`;
    text += `🗺️ <b>${trip.name}</b>\n`;
    text += `❌ Ни одна комбинация не вернула цены\n`;
    text += `Бюджет: ${Formatters.formatPrice(trip.threshold_price)}\n\n`;
    text += `Продолжаю мониторинг 🔍`;

    return { text, searchLink: null };
  }

  async _sendTripAlert(chatId, tripId, block, priority, price, timezone, silent) {
    try {
      const time = this._formatTimeForUser(new Date(), timezone);
      let header, footer;

      if (priority === 'CRITICAL') {
        header = `🔥🔥🔥 <b>Цена ниже бюджета</b>\n\n`;
        footer = '\n\n⚡️ <b>Цена может вырасти в ближайшие часы</b>';
      } else if (priority === 'HIGH') {
        header = `📊 <b>Самая низкая цена</b> • ${time}\n\n`;
        footer = '\n\n💡 Продолжаю искать варианты в бюджете';
      } else {
        header = `🔍 <b>Продолжаем поиск</b> • ${time}\n\n`;
        footer = '\n\nПродолжаю мониторинг 🔎';
      }

      const message = `${header}${block.text}${footer}`;

      const sendOpts = {
        parse_mode: 'HTML',
        disable_notification: silent,
        disable_web_page_preview: true
      };

      // Кнопки по ногам (по 2 в ряду, с учётом RT пар)
      if (block.legs && block.legs.length > 0) {
        const rows = [];
        for (let i = 0; i < block.legs.length; i += 2) {
          const row = [];
          const l1 = block.legs[i];

          let btn1Text;
          if (l1.coveredByRoundTrip) {
            btn1Text = `🎫 ${l1.origin}→${l1.destination} (вкл.)`;
          } else if (l1.isRoundTrip) {
            btn1Text = `🎫 ${l1.origin}↔${l1.destination} ${Formatters.formatPrice(l1.price)}`;
          } else {
            btn1Text = `🎫 ${l1.origin}→${l1.destination} ${Formatters.formatPrice(l1.price)}`;
          }

          row.push({
            text: btn1Text,
            callback_data: `trip_aff:${tripId}:${l1.legOrder}:${Math.round(l1.price)}`
          });

          if (i + 1 < block.legs.length) {
            const l2 = block.legs[i + 1];

            let btn2Text;
            if (l2.coveredByRoundTrip) {
              btn2Text = `🎫 ${l2.origin}→${l2.destination} (вкл.)`;
            } else if (l2.isRoundTrip) {
              btn2Text = `🎫 ${l2.origin}↔${l2.destination} ${Formatters.formatPrice(l2.price)}`;
            } else {
              btn2Text = `🎫 ${l2.origin}→${l2.destination} ${Formatters.formatPrice(l2.price)}`;
            }

            row.push({
              text: btn2Text,
              callback_data: `trip_aff:${tripId}:${l2.legOrder}:${Math.round(l2.price)}`
            });
          }
          rows.push(row);
        }
        sendOpts.reply_markup = { inline_keyboard: rows };
      }

      await this.bot.sendMessage(chatId, message, sendOpts);
      console.log(`${silent ? '🔕' : '🔔'} Trip алерт [${priority}] отправлен пользователю ${chatId}`);
    } catch (error) {
      console.error(`Ошибка отправки trip алерта [${priority}]:`, error.message);
      if (this._isUserBlockedError(error)) {
        this.blockedUsers.add(chatId);
      }
    }
  }

  _isUserBlockedError(error) {
    const msg = error.message || '';
    return msg.includes('403 Forbidden: bot was blocked by the user') ||
           msg.includes('400 Bad Request: chat not found');
  }

  async cleanupBlockedUsers() {
    if (this.blockedUsers.size === 0) return;

    console.log(`\n🧹 Очистка ${this.blockedUsers.size} заблокированных пользователей...`);

    for (const chatId of this.blockedUsers) {
      try {
        // Архивируем все маршруты пользователя
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE unified_routes SET is_archived = 1 WHERE chat_id = ? AND is_archived = 0',
            [chatId],
            function (err) {
              if (err) return reject(err);
              if (this.changes > 0) {
                console.log(`  📦 Архивировано ${this.changes} маршрутов пользователя ${chatId}`);
              }
              resolve();
            }
          );
        });

        // Архивируем все трипы пользователя
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE trips SET is_archived = 1 WHERE chat_id = ? AND is_archived = 0',
            [chatId],
            function (err) {
              if (err) return reject(err);
              if (this.changes > 0) {
                console.log(`  📦 Архивировано ${this.changes} трипов пользователя ${chatId}`);
              }
              resolve();
            }
          );
        });

        // Удаляем пользователя из user_settings
        await new Promise((resolve, reject) => {
          db.run(
            'DELETE FROM user_settings WHERE chat_id = ?',
            [chatId],
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
        });

        console.log(`  🗑️  Пользователь ${chatId} удалён из user_settings`);
      } catch (error) {
        console.error(`  ❌ Ошибка очистки пользователя ${chatId}:`, error);
      }
    }

    console.log(`🧹 Очистка заблокированных пользователей завершена`);
    this.blockedUsers.clear();
  }
}

module.exports = NotificationService;
