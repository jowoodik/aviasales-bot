const FlexibleRoute = require('../models/FlexibleRoute');
const FlexibleResult = require('../models/FlexibleResult');
const AviasalesAPI = require('./AviasalesAPI');
const NotificationService = require('./NotificationService');
const DateUtils = require('../utils/dateUtils');
const PuppeteerPricer = require('./PuppeteerPricer');
const fs = require('fs');
const PriceAnalytics = require('./PriceAnalytics');

class FlexibleMonitor {
  constructor(aviasalesToken, bot, debug = false) {
    this.api = new AviasalesAPI(aviasalesToken);
    this.notificationService = new NotificationService(bot);
    this.puppeteerPricer = new PuppeteerPricer(debug);
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

    // Перебираем все даты вылета в диапазоне
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const departureDate = new Date(d).toISOString().split('T')[0];

      // Для каждой даты вылета пробуем все варианты пребывания
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
    console.log('🔍 ПРОВЕРКА ГИБКИХ МАРШРУТОВ (Puppeteer)');
    console.log(new Date().toLocaleString('ru-RU'));
    console.log('========================================\n');

    const routes = await FlexibleRoute.findActive();
    console.log(`📋 Найдено маршрутов: ${routes.length}\n`);
    this.stats.total = routes.length;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];

      console.log(`\n[${i + 1}/${routes.length}] 🔍 ${route.origin} → ${route.destination}`);
      console.log(` 📅 Диапазон: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}`);
      console.log(` 🛫 Пребывание: ${route.min_days}-${route.max_days} дней`);
      !!route.max_layover_hours && console.log(` ⏱️ Макс. пересадка: ${route.max_layover_hours} ч`);
      console.log(` 💰 Порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽`);

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
        console.error(` ❌ Ошибка: ${error.message}`);
        this.stats.failed++;
      }

      this.stats.routes.push(routeStats);
      await FlexibleRoute.updateLastCheck(route.id);
      this.puppeteerPricer.cleanCache();

      // 🔥 ОБНОВЛЕНО: Пауза между маршрутами увеличена с 10 до 30-60 сек
      if (i < routes.length - 1) {
        const pause = Math.floor(Math.random() * 30000 + 30000); // 30-60 сек
        const pauseSec = (pause / 1000).toFixed(0);
        console.log(`\n ⏳ Ожидание ${pauseSec} сек перед следующим маршрутом...`);
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
    console.log(` ${route.origin} → ${route.destination}`);

    const combinations = this.generateDateCombinations(route);
    console.log(` 🔍 Комбинаций для проверки: ${combinations.length}`);

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

    // 🔥 ИСПРАВЛЕНО: Передаем max_layover_hours
    const priceResults = await this.puppeteerPricer.getPricesFromUrls(
      urls,
      route.airline,
      route.max_stops === 0 ? null : route.max_layover_hours
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

        // Сохраняем в аналитику
        await PriceAnalytics.savePrice({
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
      console.log(` ❌ Не найдено результатов`);
      return {
        success: false,
        bestPrice: null,
        alert: false,
        screenshot: null
      };
    }

    // Сортируем по цене
    results.sort((a, b) => a.total_price - b.total_price);
    const topResults = results.slice(0, 5);

    console.log(` ✅ Найдено ${results.length} вариантов`);
    console.log(` 💰 Лучшая цена: ${topResults[0].total_price.toLocaleString('ru-RU')} ₽`);

    // Сохраняем результаты
    await FlexibleResult.saveResults(route.id, topResults);

    // Проверяем нужно ли отправлять уведомление
    const previousBest = await FlexibleResult.getBestPrice(route.id);
    const currentBest = topResults[0].total_price;
    let alertSent = false;

    if (canNotify) {
      if (!previousBest || currentBest < previousBest) {
        console.log(` 🔥 Новый минимум! ${currentBest} < ${previousBest || 'N/A'}`);
        await this.notificationService.sendFlexibleAlert(
          route,
          topResults,
          'drop',
          true,
          topResults[0].screenshot_path
        );
        alertSent = true;
      } else if (currentBest <= route.threshold_price) {
        console.log(` 📉 Цена ниже порога: ${currentBest} <= ${route.threshold_price}`);
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
        report += `\n${emoji} ${route.origin} → ${route.destination}\n`;
        if (route.success && route.bestPrice) {
          report += ` 💰 ${route.bestPrice.toLocaleString('ru-RU')} ₽`;
          if (route.alert) {
            report += ` (алерт отправлен)`;
          }
          report += `\n`;
        } else {
          report += ` ℹ️ Не удалось получить данные с сайта\n`;
        }
      }
    }

    try {
      await this.bot.sendMessage(chatId, report, { parse_mode: 'HTML' });

      // Отправляем скриншоты лучших предложений
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

  async checkSingleRoute(route) {
    this.stats.startTime = Date.now();
    console.log('\n========================================');
    console.log('🎯 ПРОВЕРКА ОДНОГО МАРШРУТА');
    console.log(new Date().toLocaleString('ru-RU'));
    console.log('========================================\n');

    console.log(`🔍 ${route.origin} → ${route.destination}`);
    console.log(` 📅 Диапазон: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}`);
    console.log(` 🛫 Пребывание: ${route.min_days}-${route.max_days} дней`);
    console.log(` ⏱️ Макс. пересадка: ${route.max_layover_hours || 5} ч`);
    console.log(` 💰 Порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽`);

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
      console.error(` ❌ Ошибка: ${error.message}`);
      this.stats.failed++;
    }

    this.stats.routes.push(routeStats);
    await FlexibleRoute.updateLastCheck(route.id);
    this.puppeteerPricer.cleanCache();

    console.log('\n========================================');
    console.log('✅ Проверка завершена');
    console.log('========================================\n');

    return routeStats;
  }

  // 🔥 НОВЫЙ МЕТОД: Отчет для одного маршрута
  async sendSingleReport(chatId, route) {
    const elapsed = ((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(1);
    const routeStats = this.stats.routes[0]; // Единственный проверенный маршрут

    let report = `📊 ОТЧЕТ О ПРОВЕРКЕ\n`;
    report += `Маршрут: ${route.origin} → ${route.destination}\n\n`;
    report += `⏱ Время: ${elapsed} мин\n`;

    if (routeStats.success && routeStats.bestPrice) {
      report += `✅ Успешно\n`;
      report += `💰 Лучшая цена: ${routeStats.bestPrice.toLocaleString('ru-RU')} ₽\n`;

      if (routeStats.bestPrice <= route.threshold_price) {
        const savings = route.threshold_price - routeStats.bestPrice;
        report += `🔥 Ниже порога на ${savings.toLocaleString('ru-RU')} ₽!\n`;
      }

      if (routeStats.alert) {
        report += `📬 Алерт отправлен\n`;
      }
    } else {
      report += `❌ Не удалось получить данные с сайта\n`;
    }

    try {
      await this.bot.sendMessage(chatId, report, { parse_mode: 'HTML' });

      // Отправляем скриншот если есть
      if (routeStats.screenshot && require('fs').existsSync(routeStats.screenshot)) {
        try {
          await this.bot.sendPhoto(chatId, routeStats.screenshot, {
            contentType: 'image/png',
            caption: `📸 ${route.origin} → ${route.destination}: ${routeStats.bestPrice?.toLocaleString('ru-RU')} ₽`,
          });
        } catch (e) {
          console.error(`Ошибка отправки скриншота: ${e.message}`);
        }
      }
    } catch (error) {
      console.error('Ошибка отправки отчета:', error.message);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    if (this.puppeteerPricer) {
      await this.puppeteerPricer.close();
    }
  }
}

module.exports = FlexibleMonitor;
