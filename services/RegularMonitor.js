const Route = require('../models/Route');
const AviasalesAPI = require('./AviasalesAPI');
const AviasalesPricer = require('./AviasalesPricer');
const NotificationService = require('./NotificationService');
const db = require('../config/database');
const DateUtils = require('../utils/dateUtils');
const fs = require('fs');
const PriceAnalytics = require('./PriceAnalytics');

class RegularMonitor {
  constructor(aviasalesToken, bot, debug = false) {
    this.api = new AviasalesAPI(aviasalesToken);
    this.aviasalesPricer = new AviasalesPricer(debug);
    this.notificationService = new NotificationService(bot);
    this.bot = bot;
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      alerts: 0,
      startTime: null,
      routes: []
    };
  }

  async checkPrices() {
    this.stats.startTime = Date.now();
    console.log('\n========================================');
    console.log('⏰ ПРОВЕРКА ОБЫЧНЫХ МАРШРУТОВ (Aviasales)');
    console.log(new Date().toLocaleString('ru-RU'));
    console.log('========================================\n');

    await this.checkExpiredRoutes();

    const routes = await Route.findActive();
    console.log(`📋 Найдено активных маршрутов: ${routes.length}\n`);

    this.stats.total = routes.length;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const canNotify = await this.notificationService.canSendNotification(route.chat_id);

      console.log(`\n[${i + 1}/${routes.length}] 🔍 ${route.origin} → ${route.destination}`);
      console.log(`   📅 ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}`);
      console.log(`   👥 ${route.adults} взр., ${route.children} дет. | 🧳 ${route.baggage ? 'Да' : 'Нет'}`);
      console.log(`   💵 Порог: ${route.threshold_price.toLocaleString('ru-RU')} ${route.currency}`);

      const routeStats = {
        origin: route.origin,
        destination: route.destination,
        chatId: route.chat_id,
        success: false,
        bestPrice: null,
        alert: false,
        screenshot: null
      };

      try {
        const searchUrl = this.api.generateSearchLink({
          origin: route.origin,
          destination: route.destination,
          departure_date: route.departure_date,
          return_date: route.return_date,
          adults: route.adults,
          children: route.children,
          airline: route.airline,
          baggage: route.baggage,
          max_stops: route.max_stops
        });

        const priceResult = await this.aviasalesPricer.getPriceFromUrl(
          searchUrl,
          i + 1,
          routes.length,
          route.airline,
          route.max_stops === 0 ? null : route.max_layover_hours,
          route.baggage,  // 🔥 ПАРАМЕТР БАГАЖА
          route.max_stops
        );

        if (priceResult && priceResult.price) {
          const totalPrice = priceResult.price;
          console.log(`   ✅ Найдена цена: ${totalPrice.toLocaleString('ru-RU')} ${route.currency}`);

          routeStats.success = true;
          routeStats.bestPrice = totalPrice;
          routeStats.screenshot = priceResult.screenshot;
          this.stats.success++;

          const alert = await this.processPrice(route, totalPrice, searchUrl, canNotify, priceResult.screenshot);
          if (alert) {
            routeStats.alert = true;
            this.stats.alerts++;
          }
        } else {
          console.log(`   ❌ Билеты не найдены`);
          this.stats.failed++;
        }
      } catch (error) {
        console.error(`   ❌ Ошибка: ${error.message}`);
        this.stats.failed++;
      }

      this.stats.routes.push(routeStats);
      this.updateUserStats(route.chat_id);

      if (i < routes.length - 1) {
        console.log(`   ⏳ Ожидание 5 сек...`);
        await this.sleep(5000);
      }
    }

    console.log('\n========================================');
    console.log('✅ Проверка обычных маршрутов завершена');
    console.log('========================================\n');

    return this.stats;
  }

  async checkExpiredRoutes() {
    return new Promise((resolve) => {
      const today = new Date().toISOString().split('T')[0];
      db.all(
        `SELECT * FROM routes WHERE auto_delete = 1 AND date(departure_date, '-3 days') = date(?)`,
        [today],
        (err, routes) => {
          if (!err && routes && routes.length > 0) {
            routes.forEach(route => {
              const msg =
                `⚠️ НАПОМИНАНИЕ\n\n` +
                `Маршрут ${route.origin} → ${route.destination}\n` +
                `Вылет через 3 дня: ${DateUtils.formatDateDisplay(route.departure_date)}\n\n` +
                `Маршрут будет автоматически удален после вылета.`;
              this.notificationService.bot.sendMessage(route.chat_id, msg);
            });
          }
        }
      );

      Route.deleteExpired().then(changes => {
        if (changes > 0) {
          console.log(`🗑️ Автоматически удалено ${changes} прошедших маршрутов`);
        }
        resolve();
      });
    });
  }

  async processPrice(route, totalPrice, searchLink, canNotify, screenshot) {
    db.run(
      `INSERT INTO price_history (route_id, price, airline) VALUES (?, ?, ?)`,
      [route.id, totalPrice, route.airline || 'Multi']
    );

    await PriceAnalytics.savePrice({
      routeId: route.id,  // 🔥 ДОБАВЛЯЕМ route.id
      routeType: 'regular',
      origin: route.origin,
      destination: route.destination,
      price: totalPrice,
      airline: route.airline || 'Multi',
      chatId: route.chat_id
    });

    return new Promise((resolve) => {
      db.get(
        'SELECT MIN(price) as min_price FROM best_prices WHERE route_id = ?',
        [route.id],
        async (err, row) => {
          const isNewMin = !row || !row.min_price || totalPrice < row.min_price;

          if (isNewMin) {
            await this.saveBestPrice(route.id, totalPrice, route.airline || 'Multi', searchLink);
          }

          let alertSent = false;

          if (canNotify) {
            db.get(
              'SELECT * FROM user_settings WHERE chat_id = ?',
              [route.chat_id],
              async (err, settings) => {
                const userSettings = settings || { notify_on_drop: 1, notify_on_new_min: 1 };

                if (totalPrice <= route.threshold_price && userSettings.notify_on_drop) {
                  console.log(`   🔥 ЦЕНА УПАЛА! ${totalPrice} <= ${route.threshold_price}`);
                  const ticket = {
                    estimated_total: totalPrice,
                    base_price: Math.floor(totalPrice / (route.adults + route.children * 0.75)),
                    airline: route.airline || 'Multi',
                    transfers: route.max_stops,
                    search_link: searchLink
                  };

                  await this.sendRegularAlertWithScreenshot(route, ticket, 'drop', screenshot);

                  const savings = route.threshold_price - totalPrice;
                  this.updateSavings(route.chat_id, savings);
                  alertSent = true;
                } else if (isNewMin && userSettings.notify_on_new_min) {
                  console.log(`   ⭐ НОВЫЙ МИНИМУМ! ${totalPrice} (было: ${row?.min_price || 'N/A'})`);
                  const ticket = {
                    estimated_total: totalPrice,
                    base_price: Math.floor(totalPrice / (route.adults + route.children * 0.75)),
                    airline: route.airline || 'Multi',
                    transfers: route.max_stops,
                    search_link: searchLink
                  };

                  await this.sendRegularAlertWithScreenshot(route, ticket, 'new_min', screenshot);
                  alertSent = true;
                }

                resolve(alertSent);
              }
            );
          } else {
            console.log(`   ⏸️ Уведомления отключены (cooldown)`);
            resolve(false);
          }
        }
      );
    });
  }

  async sendRegularAlertWithScreenshot(route, ticket, type, screenshot = null) {
    const Formatters = require('../utils/formatters');
    const passengersText = Formatters.formatPassengers(route.adults, route.children);
    const baggageText = route.baggage ? '✅ С багажом' : '❌ Без багажа';
    const totalPrice = ticket.estimated_total;

    let header = type === 'drop' ? '🔥 ЦЕНА УПАЛА!' : '⭐ НОВЫЙ МИНИМУМ!';
    let message = `${header}\n\n`;
    message += `📍 Маршрут: ${route.origin} → ${route.destination}\n`;
    message += `💰 ${Formatters.formatPrice(totalPrice, route.currency)}\n`;
    message += `✅ Проверено через Aviasales\n\n`;
    message += `✈️ Авиакомпания: ${ticket.airline}\n`;
    message += `👥 Пассажиры: ${passengersText}\n`;
    message += `🧳 Багаж: ${baggageText}\n`;
    message += `🔄 Пересадок: ${ticket.transfers || 0}\n\n`;
    message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_date)}\n`;
    message += `🔙 Возврат: ${DateUtils.formatDateDisplay(route.return_date)}\n`;

    if (type === 'drop') {
      const savings = route.threshold_price - totalPrice;
      message += `\n💵 Ваш порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;
      message += `📉 Экономия: ${Formatters.formatPrice(savings, route.currency)}\n`;
    }

    const keyboard = {
      inline_keyboard: [[
        { text: '🔗 Купить билет', url: ticket.search_link }
      ]]
    };

    try {
      if (screenshot && fs.existsSync(screenshot)) {
        await this.bot.sendPhoto(route.chat_id, screenshot, {
          contentType: 'image/png',
          caption: message,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(route.chat_id, message, {
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
      }

      await this.notificationService.recordNotification(route.chat_id);
    } catch (error) {
      console.error('Ошибка отправки уведомления:', error.message);
    }
  }

  async saveBestPrice(routeId, price, airline, searchLink) {
    return new Promise((resolve) => {
      db.run(
        'INSERT INTO best_prices (route_id, price, airline, search_link) VALUES (?, ?, ?, ?)',
        [routeId, price, airline, searchLink],
        () => {
          db.run(
            `DELETE FROM best_prices
             WHERE route_id = ?
               AND id NOT IN (
                 SELECT id FROM best_prices
                 WHERE route_id = ?
                 ORDER BY price ASC
                 LIMIT 3
                 )`,
            [routeId, routeId],
            () => resolve()
          );
        }
      );
    });
  }

  async sendReport(chatId) {
    const elapsed = ((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(1);
    let report = `📊 ОТЧЕТ О ПРОВЕРКЕ\n\n`;
    report += `⏱️ Время: ${elapsed} мин\n`;
    report += `📋 Всего маршрутов: ${this.stats.total}\n`;
    report += `✅ Успешно: ${this.stats.success}\n`;
    report += `❌ Ошибок: ${this.stats.failed}\n`;
    report += `🔥 Отправлено алертов: ${this.stats.alerts}\n\n`;

    if (this.stats.routes.length > 0) {
      report += `Детали:\n`;
      for (const route of this.stats.routes) {
        const emoji = route.success ? '✅' : '❌';
        report += `\n${emoji} ${route.origin} → ${route.destination}\n`;
        if (route.success && route.bestPrice) {
          report += `   💰 ${route.bestPrice.toLocaleString('ru-RU')} ₽`;
          if (route.alert) {
            report += ` 🔥 алерт отправлен`;
          }
          report += `\n`;
        } else {
          report += `   ⚠️ Не удалось получить данные\n`;
        }
      }
    }

    try {
      await this.bot.sendMessage(chatId, report, { parse_mode: 'HTML' });

      for (const route of this.stats.routes) {
        if (route.screenshot && fs.existsSync(route.screenshot)) {
          try {
            await this.bot.sendPhoto(chatId, route.screenshot, {
              contentType: 'image/png',
              caption: `📸 ${route.origin} → ${route.destination}: ${route.bestPrice?.toLocaleString('ru-RU')} ₽`,
            });
          } catch (e) {
            console.error(`Ошибка отправки скриншота: ${e.message}`);
          }
        }
      }
    } catch (error) {
      console.error('Ошибка отправки отчета:', error.message);
    }
  }

  updateUserStats(chatId) {
    db.run(
      `INSERT INTO user_stats (chat_id, last_check)
       VALUES (?, datetime('now'))
           ON CONFLICT(chat_id)
       DO UPDATE SET last_check = datetime('now')`,
      [chatId]
    );
  }

  updateSavings(chatId, savings) {
    db.run(
      `UPDATE user_stats
       SET total_alerts = total_alerts + 1,
           total_savings = total_savings + ?
       WHERE chat_id = ?`,
      [savings, chatId]
    );
  }

  async generateDailyReport(chatId) {
    const query = `
        SELECT r.origin, r.destination, r.airline, r.departure_date, r.adults, r.children, r.baggage,
               MIN(ph.price) as min_price,
               MAX(ph.price) as max_price,
               AVG(ph.price) as avg_price,
               COUNT(*) as checks
        FROM routes r
                 JOIN price_history ph ON r.id = ph.route_id
        WHERE r.chat_id = ? AND DATE(ph.checked_at) = DATE('now')
        GROUP BY r.id
    `;

    db.all(query, [chatId], (err, routesData) => {
      const flexQuery = `
          SELECT fr.origin, fr.destination,
                 fres.total_price as best_price,
                 fres.departure_date,
                 fres.return_date
          FROM flexible_routes fr
                   JOIN flexible_results fres ON fr.id = fres.route_id
          WHERE fr.chat_id = ?
          ORDER BY fres.total_price ASC
              LIMIT 5
      `;

      db.all(flexQuery, [chatId], (err, flexibleData) => {
        this.notificationService.sendDailyReport(chatId, routesData, flexibleData);
      });
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RegularMonitor;
