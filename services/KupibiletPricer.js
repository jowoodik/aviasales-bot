const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class KupibiletPricer {
  constructor(debug = false) {
    this.browser = null;
    this.debug = debug;
    this.lastRequestTime = 0;
    this.minDelayBetweenRequests = 3000; // 3 секунды между запросами
    this.maxConcurrent = 3; // 🔥 3 браузера параллельно

    // Создаем папку для скриншотов
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
      console.log(`[Kupibilet] Создана папка для скриншотов: ${tempDir}`);
    }
    this.screenshotDir = tempDir;
  }

  log(message, index = null, total = null) {
    const prefix = index && total ? `[Kupibilet ${index}/${total}]` : '[Kupibilet]';
    console.log(`${prefix} ${message}`);
  }

  getRandomDelay(min = 500, max = 1500) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async randomWait(min = 500, max = 1500) {
    const delay = this.getRandomDelay(min, max);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async init() {
    if (this.browser) return;
    console.log('🚀 Запуск браузера (Kupibilet)...');
    this.browser = await puppeteer.launch({
      headless: !this.debug,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      ignoreHTTPSErrors: true,
      dumpio: this.debug
    });
    console.log('✅ Браузер запущен (Kupibilet)');
  }

  static generateSearchUrl(params) {
    const { origin, destination, departure_date, return_date, adults, children, airline, baggage, max_stops, max_layover_hours } = params;

    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const depDateFormatted = formatDate(departure_date);
    const retDateFormatted = formatDate(return_date);
    const adultsCount = adults || 1;
    const childrenCount = children || 0;
    const infants = 0;

    let url = 'https://www.kupibilet.ru/search?';
    const urlParams = [];

    // Пассажиры
    urlParams.push(`adult=${adultsCount}`);
    urlParams.push(`child=${childrenCount}`);
    urlParams.push(`infant=${infants}`);

    // Возраста детей
    if (childrenCount > 0) {
      const ages = Array(childrenCount).fill(10);
      urlParams.push(`childrenAges=[${ages.join(',')}]`);
    }

    // Класс обслуживания
    urlParams.push('cabinClass=Y');

    // Маршрут
    urlParams.push(`route[0]=iatax:${origin}_${depDateFormatted}_date_${depDateFormatted}_iatax:${destination}`);
    urlParams.push(`route[1]=iatax:${destination}_${retDateFormatted}_date_${retDateFormatted}_iatax:${origin}`);

    // Фильтры
    const filters = {};
    if (baggage === true || baggage === 1) {
      filters.baggages = { "WithBaggages": true };
    }
    if (max_stops === 0) {
      filters.transfers = { "NoTransfers": true };
    } else if (max_stops === 1) {
      filters.transfers = { "OneTransfer": true };
    } else if (max_stops === 2) {
      filters.transfers = { "TwoTransfers": true };
    }
    if (max_layover_hours && max_stops > 0) {
      const maxSeconds = max_layover_hours * 3600;
      filters.transferTimeRange = { "TransferTimeRange": [60, maxSeconds] };
    }
    if (airline) {
      filters.airlines = {};
      filters.airlines[`Airline-${airline}`] = true;
    }

    if (Object.keys(filters).length > 0) {
      urlParams.push(`filter=${encodeURIComponent(JSON.stringify(filters))}`);
    }

    urlParams.push('v=2');
    url += urlParams.join('&');
    return url;
  }

  /**
   * 🔥 ГЛАВНЫЙ МЕТОД - совместимость с PuppeteerPricer
   * Принимает URL (игнорируется), но использует параметры route
   */
  async getPriceFromUrl(urlIgnored, index, total, airline = null, maxLayoverHours = null, baggage = false, routeParams = null) {
    if (!routeParams) {
      console.error(`[${index}/${total}] ❌ ОШИБКА: routeParams не переданы в KupibiletPricer.getPriceFromUrl`);
      return null;
    }

    const startTime = Date.now();
    await this.init();
    const page = await this.browser.newPage();
    let screenshotPath = null;
    let searchUrl = null;

    try {
      this.log('='.repeat(80), index, total);
      this.log(`🎯 ${routeParams.origin} → ${routeParams.destination}`, index, total);
      this.log(`📅 ${routeParams.departure_date} → ${routeParams.return_date}`, index, total);
      if (airline) this.log(`✈️ ${airline}`, index, total);
      if (maxLayoverHours) this.log(`⏱ Макс. пересадка: ${maxLayoverHours}ч`, index, total);
      if (baggage) this.log(`🧳 Багаж: 20 кг`, index, total);
      this.log('='.repeat(80), index, total);

      // Антифрод настройки
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });

      await page.evaluateOnNewDocument(() => {
        delete Object.getPrototypeOf(navigator).webdriver;
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = function (parameters) {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery.apply(window.navigator.permissions, parameters);
        };
        window.chrome = { runtime: {}, loadTimes: function () {}, csi: function () {}, app: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU', 'ru', 'en-US', 'en'] });
      });

      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });

      // Блокировка рекламы
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('recaptcha') || url.includes('google-analytics') ||
          url.includes('googletagmanager') || url.includes('mc.yandex') ||
          url.includes('metrika')) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Антиспам задержка
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      if (timeSinceLastRequest < this.minDelayBetweenRequests) {
        const waitTime = this.minDelayBetweenRequests - timeSinceLastRequest;
        this.log(`⏳ Антиспам задержка ${Math.round(waitTime/1000)}с`, index, total);
        await this.sleep(waitTime);
      }

      const randomDelay = this.getRandomDelay(500, 1000);
      this.log(`⏳ Задержка ${randomDelay}мс`, index, total);
      await this.sleep(randomDelay);
      this.lastRequestTime = Date.now();

      // Генерируем URL для Kupibilet
      searchUrl = KupibiletPricer.generateSearchUrl({
        origin: routeParams.origin,
        destination: routeParams.destination,
        departure_date: routeParams.departure_date,
        return_date: routeParams.return_date,
        adults: routeParams.adults,
        children: routeParams.children,
        airline: airline,
        baggage: baggage,
        max_stops: routeParams.max_stops,
        max_layover_hours: maxLayoverHours
      });

      this.log(`🔗 ${searchUrl}`, index, total);
      this.log(`🌐 Загрузка страницы...`, index, total);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const jsWait = this.getRandomDelay(1000, 2500);
      this.log(`⏳ JavaScript инициализация ${jsWait}мс...`, index, total);
      await this.sleep(jsWait);

      // Поиск билетов
      this.log(`🔍 Поиск билетов...`, index, total);
      let found = false;
      let attempts = 0;
      const maxAttempts = 15;

      while (attempts < maxAttempts && !found) {
        try {
          await page.waitForSelector('[data-testid="serp-ticket-total-sum"]', {
            timeout: 3000,
            visible: true
          });
          found = true;
          this.log(`✅ Билеты найдены`, index, total);
        } catch (e) {
          attempts++;
          this.log(`⏳ Попытка ${attempts}/${maxAttempts}...`, index, total);
          await this.sleep(1000);
        }
      }

      if (!found) {
        throw new Error('Timeout: билеты не загрузились');
      }

      await this.randomWait(500, 1000);

      // Сортировка по цене
      this.log(`🔍 Поиск дропдауна сортировки...`, index, total);
      try {
        const sortDropdown = await page.$('[data-testid="sort-dropdown"]');
        if (!sortDropdown) {
          this.log(`⚠️ Дропдаун не найден`, index, total);
        } else {
          this.log(`✅ Открываю дропдаун...`, index, total);
          await page.evaluate(() => {
            const dropdown = document.querySelector('[data-testid="sort-dropdown"]');
            const firstDiv = dropdown.querySelector(':scope > div:first-child');
            firstDiv.click();
          });

          await page.waitForFunction(() => {
            const dropdown = document.querySelector('[data-testid="sort-dropdown"]');
            const divs = dropdown.querySelectorAll(':scope > div');
            return divs.length >= 2;
          }, { timeout: 3000 });

          await this.randomWait(300, 600);
          this.log(`🔍 Поиск "По цене" в меню...`, index, total);

          const sortSelected = await page.evaluate(() => {
            const list = document.querySelector('[data-testid="sort-dropdown-list"]');
            if (!list) return false;
            const items = list.querySelectorAll(':scope > div');
            for (let item of items) {
              if (item.textContent.trim() === 'По цене') {
                item.click();
                return true;
              }
            }
            return false;
          });

          if (sortSelected) {
            this.log(`✅ Выбрана сортировка "По цене"`, index, total);
            this.log(`⏳ Обновление списка...`, index, total);
            await this.sleep(1000);
            this.log(`✅ Список обновлен`, index, total);
          } else {
            this.log(`⚠️ Опция "По цене" не найдена в списке`, index, total);
          }
        }
      } catch (error) {
        this.log(`⚠️ Ошибка сортировки: ${error.message}`, index, total);
      }

      // Получение цены
      this.log(`💰 Извлечение цены...`, index, total);
      const priceData = await page.evaluate(() => {
        const priceElement = document.querySelector('[data-testid="serp-ticket-total-sum"]');
        if (priceElement) {
          const priceText = priceElement.textContent.trim();
          const cleanPrice = priceText.replace(/[^\d]/g, '');
          const num = parseInt(cleanPrice, 10);
          if (isNaN(num) || num < 1000 || num > 10000000) {
            return { error: 'Некорректная цена', rawText: priceText };
          }
          return { price: num, rawText: priceText };
        }
        return { error: 'Элемент цены не найден' };
      });

      if (priceData.error) {
        throw new Error(priceData.error);
      }

      // Скриншот успеха
      const timestamp = Date.now();
      const airlineStr = airline || 'all';
      screenshotPath = path.join(this.screenshotDir, `success_${airlineStr}_${timestamp}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.log('='.repeat(80), index, total);
      this.log(`✅ УСПЕХ! ${priceData.price.toLocaleString('ru-RU')} ₽`, index, total);
      this.log(`⏱️ ${elapsed}с`, index, total);
      this.log(`📸 ${screenshotPath}`, index, total);
      this.log('='.repeat(80), index, total);

      // Возвращаем в формате PuppeteerPricer: { price, screenshot }
      return {
        price: priceData.price,
        screenshot: screenshotPath
      };

    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.log(`❌ ОШИБКА (${elapsed}с): ${error.message}`, index, total);

      // Скриншот ошибки
      try {
        const timestamp = Date.now();
        const airlineStr = airline || 'all';
        screenshotPath = path.join(this.screenshotDir, `error_${airlineStr}_${timestamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        this.log(`📸 ${screenshotPath}`, index, total);
      } catch (e) {
        // ignore
      }

      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * 🔥 МЕТОД ДЛЯ МНОЖЕСТВЕННОЙ ОБРАБОТКИ - ПАРАЛЛЕЛЬНО ПО 3 БРАУЗЕРА
   */
  async getPricesFromUrls(urls, airline = null, maxLayoverHours = null, baggage = false, routeParamsArray = null) {
    if (!routeParamsArray || routeParamsArray.length !== urls.length) {
      console.error('❌ ОШИБКА: routeParamsArray должен быть массивом той же длины что и urls');
      return new Array(urls.length).fill(null);
    }

    const total = urls.length;
    const results = new Array(total).fill(null);
    this.log(`🚀 Начинаю параллельную обработку ${total} маршрутов (по ${this.maxConcurrent} одновременно)`);

    const startTime = Date.now();

    // 🔥 Обрабатываем батчами по maxConcurrent (3)
    for (let i = 0; i < total; i += this.maxConcurrent) {
      const batchSize = Math.min(this.maxConcurrent, total - i);
      const batchPromises = [];

      this.log(`📦 Батч ${Math.floor(i / this.maxConcurrent) + 1}: обработка ${batchSize} маршрутов параллельно`);

      // Создаем промисы для батча
      for (let j = 0; j < batchSize; j++) {
        const index = i + j;
        const promise = this.getPriceFromUrl(
          urls[index],
          index + 1,
          total,
          airline,
          maxLayoverHours,
          baggage,
          routeParamsArray[index]
        ).catch(error => {
          this.log(`❌ Ошибка на маршруте ${index + 1}: ${error.message}`);
          return null;
        });
        batchPromises.push(promise);
      }

      // Ждем завершения батча
      const batchResults = await Promise.all(batchPromises);

      // Сохраняем результаты
      for (let j = 0; j < batchSize; j++) {
        results[i + j] = batchResults[j];
      }

      // Пауза между батчами
      if (i + batchSize < total) {
        const pause = this.getRandomDelay(1000, 2500);
        this.log(`⏸️ Пауза ${Math.round(pause/1000)}с перед следующим батчем`);
        await this.sleep(pause);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validResults = results.filter(r => r !== null);
    this.log(`✅ Обработка завершена за ${elapsed}с. Успешно: ${validResults.length}/${total}`);

    return results;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Браузер закрыт (Kupibilet)');
    }
  }
}

module.exports = KupibiletPricer;
