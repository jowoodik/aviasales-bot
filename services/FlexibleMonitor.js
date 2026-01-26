const FlexibleRoute = require('../models/FlexibleRoute');
const FlexibleResult = require('../models/FlexibleResult');
const AviasalesAPI = require('./AviasalesAPI');
const NotificationService = require('./NotificationService');
const DateUtils = require('../utils/dateUtils');
const AviasalesPricer = require('./AviasalesPricer');
const fs = require('fs');
const PriceAnalytics = require('./PriceAnalytics');

class FlexibleMonitor {
  constructor(aviasalesToken, bot, debug = false) {
    this.api = new AviasalesAPI(aviasalesToken);
    this.notificationService = new NotificationService(bot);
    this.aviasalesPricer = new AviasalesPricer(debug);
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

  generateDateCombinations(route) {
    const combinations = [];
    const startDate = new Date(route.departure_start);
    const endDate = new Date(route.departure_end);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const departureDate = new Date(d).toISOString().split('T')[0];

      for (let days = route.min_days; days <= route.max_days; days++) {
        const returnDate = new Date(d);
        returnDate.setDate(returnDate.getDate() + days);

        combinations.push({
          departure: departureDate,
          return: returnDate.toISOString().split('T')[0],
          days: days
        });
      }
    }

    return combinations;
  }

  async checkAllRoutes() {
    this.stats.startTime = Date.now();
    console.log('\n========================================');
    console.log('🔍 ПРОВЕРКА ГИБКИХ МАРШРУТОВ (Aviasales)');
    console.log(new Date().toLocaleString('ru-RU'));
    console.log('========================================\n');

    const routes = await FlexibleRoute.findActive();
    console.log(`📋 Найдено маршрутов: ${routes.length}\n`);

    this.stats.total = routes.length;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      console.log(`\n[${i + 1}/${routes.length}] 🔍 ${route.origin} → ${route.destination}`);
      console.log(`   📅 Диапазон: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}`);
      console.log(`   🛫 Пребывание: ${route.min_days}-${route.max_days} дней`);
      !!route.max_layover_hours && console.log(`   ⏱️ Макс. пересадка: ${route.max_layover_hours} ч`);
      console.log(`   💰 Порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽`);

      const canNotify = await this.notificationService.canSendNotification(route.chat_id);

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
        const result = await this.analyzeRoute(route, canNotify);

        if (result && result.success) {
          routeStats.success = true;
          routeStats.bestPrice = result.bestPrice;
          routeStats.alert = result.alert;
          routeStats.screenshot = result.screenshot;
          this.stats.success++;

          if (result.alert) {
            this.stats.alerts++;
          }
        } else {
          this.stats.failed++;
        }
      } catch (error) {
        console.error(`   ❌ Ошибка: ${error.message}`);
        this.stats.failed++;
      }

      this.stats.routes.push(routeStats);
      await FlexibleRoute.updateLastCheck(route.id);

      if (i < routes.length - 1) {
        const pause = Math.floor(Math.random() * 30000 + 30000); // 30-60 сек
        const pauseSec = (pause / 1000).toFixed(0);
        console.log(`\n   ⏳ Ожидание ${pauseSec} сек перед следующим маршрутом...`);
        await this.sleep(pause);
      }
    }

    console.log('\n========================================');
    console.log('✅ Проверка завершена');
    console.log('========================================\n');

    return this.stats;
  }

  async analyzeRoute(route, canNotify) {
    console.log(`\n📊 Анализ гибкого маршрута`);
    console.log(`   ${route.origin} → ${route.destination}`);

    const combinations = this.generateDateCombinations(route);
    console.log(`   🔍 Комбинаций для проверки: ${combinations.length}`);

    const urls = combinations.map(c => this.api.generateSearchLink({
      origin: route.origin,
      destination: route.destination,
      departure_date: c.departure,
      return_date: c.return,
      adults: route.adults,
      children: route.children,
      airline: route.airline,
      baggage: route.baggage,
      max_stops: route.max_stops
    }));

    const priceResults = await this.aviasalesPricer.getPricesFromUrls(
      urls,
      route.airline,
      route.max_stops === 0 ? null : route.max_layover_hours,
      route.baggage,  // 🔥 ПАРАМЕТР БАГАЖА
      route.max_stops
    );

    const results = [];
    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      const priceResult = priceResults[i];

      if (priceResult && priceResult.price) {
        results.push({
          departure_date: combo.departure,
          return_date: combo.return,
          days_in_country: combo.days,
          total_price: priceResult.price,
          airline: route.airline || 'Multi',
          search_link: urls[i],
          screenshot_path: priceResult.screenshot
        });

        await PriceAnalytics.savePrice({
          routeId: route.id,
          routeType: 'flexible',
          origin: route.origin,
          destination: route.destination,
          price: priceResult.price,
          airline: route.airline || 'Multi',
          chatId: route.chat_id
        });
      }
    }

    if (results.length === 0) {
      console.log(`   ❌ Не найдено результатов`);
      return {
        success: false,
        bestPrice: null,
        alert: false,
        screenshot: null
      };
    }

    results.sort((a, b) => a.total_price - b.total_price);
    const topResults = results.slice(0, 5);

    console.log(`   ✅ Найдено ${results.length} вариантов`);
    console.log(`   💰 Лучшая цена: ${topResults[0].total_price.toLocaleString('ru-RU')} ₽`);

    await FlexibleResult.saveResults(route.id, topResults);

    const previousBest = await FlexibleResult.getBestPrice(route.id);
    const currentBest = topResults[0].total_price;

    let alertSent = false;

    if (canNotify) {
      if (!previousBest || currentBest < previousBest) {
        console.log(`   🔥 Новый минимум! ${currentBest} < ${previousBest || 'N/A'}`);
        await this.notificationService.sendFlexibleAlert(
          route,
          topResults,
          'drop',
          true,
          topResults[0].screenshot_path
        );
        alertSent = true;
      } else if (currentBest <= route.threshold_price) {
        console.log(`   📉 Цена ниже порога: ${currentBest} <= ${route.threshold_price}`);
        await this.notificationService.sendFlexibleAlert(
          route,
          topResults,
          'drop',
          true,
          topResults[0].screenshot_path
        );
        alertSent = true;
      }
    }

    return {
      success: true,
      bestPrice: currentBest,
      alert: alertSent,
      screenshot: topResults[0].screenshot_path
    };
  }

  async sendReport(chatId) {
    const elapsed = ((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(1);
    let report = `📊 ОТЧЕТ О ПРОВЕРКЕ\n`;
    report += `Тип: 🔄 Гибкие маршруты\n\n`;
    report += `⏱ Время: ${elapsed} мин\n`;
    report += `📋 Всего маршрутов: ${this.stats.total}\n`;
    report += `✅ Успешно: ${this.stats.success}\n`;
    report += `❌ Не удалось получить данные: ${this.stats.failed}\n`;
    report += `🔥 Отправлено алертов: ${this.stats.alerts}\n`;

    if (this.stats.routes.length > 0) {
      report += `\nДетали:\n`;
      for (const route of this.stats.routes) {
        const emoji = route.success ? '✅' : '⚠️';

        // 🔥 ЗАГОЛОВОК МАРШРУТА
        report += `\n${emoji} ${route.origin} → ${route.destination}\n`;

        // 🔥 ДОБАВЛЯЕМ ПОЛНУЮ ИНФОРМАЦИЮ О МАРШРУТЕ

        // Даты
        report += `   📅 ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}\n`;
        report += `   ⏳ ${route.min_days}-${route.max_days} дней\n`;

        // Пассажиры
        const passengersStr = `${route.adults} взр${route.children > 0 ? `, ${route.children} дет` : ''}`;
        report += `   👥 ${passengersStr}\n`;

        // Авиакомпания
        if (route.airline) {
          report += `   ✈️ ${route.airline}\n`;
        }

        // Багаж
        if (route.baggage === 1 || route.baggage === true) {
          report += `   🧳 Багаж: 20 кг\n`;
        }

        // Пересадки
        if (route.max_stops === 0) {
          report += `   🛫 Прямые\n`;
        } else if (route.max_stops !== 99 && route.max_stops !== null) {
          report += `   🛫 До ${route.max_stops} пересадок\n`;
          if (route.max_layover_hours) {
            report += `   ⏱ Макс. пересадка: ${route.max_layover_hours}ч\n`;
          }
        }

        // Цена и алерт
        if (route.success && route.bestPrice) {
          report += `   💰 ${route.bestPrice.toLocaleString('ru-RU')} ₽`;
          if (route.alert) {
            report += ` 🔥 (алерт!)`;
          }
          report += `\n`;

          // Порог
          if (route.threshold_price) {
            report += `   💵 Порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽\n`;
          }
        } else {
          report += `   ℹ️ Не удалось получить данные\n`;
        }
      }
    }

    try {
      await this.bot.sendMessage(chatId, report, { parse_mode: 'HTML' });

      for (const route of this.stats.routes) {
        if (route.screenshot && fs.existsSync(route.screenshot)) {
          try {
            // 🔥 УЛУЧШЕННАЯ ПОДПИСЬ К СКРИНШОТУ
            let caption = `📸 ${route.origin} → ${route.destination}\n`;
            caption += `💰 ${route.bestPrice?.toLocaleString('ru-RU')} ₽\n`;

            if (route.airline) {
              caption += `✈️ ${route.airline}\n`;
            }

            const passengersStr = `${route.adults} взр${route.children > 0 ? `, ${route.children} дет` : ''}`;
            caption += `👥 ${passengersStr}`;

            await this.bot.sendPhoto(chatId, route.screenshot, {
              contentType: 'image/png',
              caption: caption,
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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FlexibleMonitor;
