const puppeteer = require('puppeteer');
const got = require('got');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
const AviasalesAPI = require('./AviasalesAPI');

class AviasalesPricer {
  constructor(debug = false, marker = '696196') {
    this.maxConcurrent = 7;
    this.debug = debug;
    this.marker = marker;
    this.aviasalesAPI = new AviasalesAPI(process.env.TRAVELPAYOUTS_TOKEN);

    // API конфигурация
    this.baseURL = 'https://tickets-api.aviasales.ru';
    this.maxPollingAttempts = 7;
    this.pollingInterval = 6000;

    // ПРОКСИ-РОТАЦИЯ
    this.proxyList = [
      'http://bkczhupt:ww4ng38q6a84@142.111.48.253:7030',
      // 'http://bkczhupt:ww4ng38q6a84@23.95.150.145:6114',
      // 'http://bkczhupt:ww4ng38q6a84@198.23.239.134:6540',
      // 'http://bkczhupt:ww4ng38q6a84@107.172.163.27:6543',
      'http://bkczhupt:ww4ng38q6a84@198.105.121.200:6462',
      'http://bkczhupt:ww4ng38q6a84@64.137.96.74:6641',
      'http://bkczhupt:ww4ng38q6a84@84.247.60.125:6095',
      'http://bkczhupt:ww4ng38q6a84@216.10.27.159:6837',
      'http://bkczhupt:ww4ng38q6a84@23.26.71.145:5628',
      'http://bkczhupt:ww4ng38q6a84@23.27.208.120:5830'
    ];
    this.workingProxies = [];
    this.currentProxyIndex = 0;
    this.proxyCheckTimeout = 2000;

    // 🔥 Флаги инициализации
    this.proxiesInitialized = false;
    this.cookiesInitialized = false;

    // массив разных наборов кук
    this.cookiesList = [];

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    this.cleanupOldScreenshots();
  }

  // КОМПАКТНАЯ ПРОВЕРКА ПРОКСИ
  async testProxy(proxyUrl) {
    let httpsAgent = null;

    try {
      httpsAgent = new HttpsProxyAgent(proxyUrl, {
        keepAlive: false,
        timeout: this.proxyCheckTimeout,
        maxFreeSockets: 0,
        maxSockets: 1,
        scheduling: 'lifo'
      });

      const startTime = Date.now();

      const requestPromise = got.get('https://api.ipify.org?format=json', {
        agent: {
          https: httpsAgent
        },
        timeout: {
          request: this.proxyCheckTimeout
        },
        responseType: 'json',
        retry: {
          limit: 0
        }
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Таймаут ${this.proxyCheckTimeout}мс превышен`));
        }, this.proxyCheckTimeout);
      });

      const response = await Promise.race([requestPromise, timeoutPromise]);
      const elapsed = Date.now() - startTime;
      const ip = response.body.ip;

      return { success: true, elapsed, ip };

    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      if (httpsAgent) {
        try {
          httpsAgent.destroy();
        } catch (e) {}
      }
    }
  }

  async initProxies() {
    // 🔥 Проверяем только один раз
    if (this.proxiesInitialized) {
      console.log('✅ Прокси уже проверены, пропускаем...\n');
      return this.workingProxies.length > 0;
    }

    console.log('\n🔍 ПРОВЕРКА ПРОКСИ');
    console.log(`Проверка ${this.proxyList.length} прокси (таймаут ${this.proxyCheckTimeout}мс)...\n`);

    this.workingProxies = [];

    for (let i = 0; i < this.proxyList.length; i++) {
      const proxy = this.proxyList[i];

      const result = await this.testProxy(proxy);

      if (result.success) {
        this.workingProxies.push(proxy);
        console.log(`✅ Прокси ${i + 1}/${this.proxyList.length}: OK (${result.elapsed}мс, IP: ${result.ip})`);
      } else {
        console.log(`❌ Прокси ${i + 1}/${this.proxyList.length}: ОШИБКА (${result.error})`);
      }

      // 🔥 убрал паузу между проверками прокси
    }

    console.log(`\n✅ Рабочих прокси: ${this.workingProxies.length}/${this.proxyList.length}\n`);

    if (this.workingProxies.length === 0) {
      console.warn('⚠️ НЕТ РАБОЧИХ ПРОКСИ! Работа без прокси.\n');
    }

    this.proxiesInitialized = true;
    return this.workingProxies.length > 0;
  }

  getNextProxy() {
    if (this.workingProxies.length === 0) {
      return null;
    }

    const proxy = this.workingProxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.workingProxies.length;
    return proxy;
  }

  parseProxy(proxyUrl) {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port),
      auth: {
        username: url.username,
        password: url.password
      }
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async setCookie() {
    console.log('\n🍪 ========================================');
    console.log('🍪 УСТАНОВКА КУКИ');
    console.log('🍪 ========================================');
    console.log('🌐 Запуск браузера для получения куки...');

    let browser = null;
    let page = null;

    try {
      const proxyUrl = this.getNextProxy();

      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-blink-features=AutomationControlled'
        ]
      };

      if (proxyUrl) {
        const proxyObj = this.parseProxy(proxyUrl);
        const proxyServer = `http://${proxyObj.host}:${proxyObj.port}`;
        launchOptions.args.push(`--proxy-server=${proxyServer}`);
        console.log('✅ Использую прокси для браузера');
      }

      browser = await puppeteer.launch(launchOptions);
      console.log('✅ Браузер запущен');

      page = await browser.newPage();

      if (proxyUrl) {
        const proxyObj = this.parseProxy(proxyUrl);
        await page.authenticate({
          username: proxyObj.auth.username,
          password: proxyObj.auth.password
        });
        console.log('✅ Авторизация на прокси выполнена');
      }

      await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      console.log('🔍 Открытие aviasales.ru...');

      await page.goto('https://www.aviasales.ru/', {
        waitUntil: 'networkidle0',
        timeout: 60000
      });

      console.log('✅ Страница загружена, ждем куки и токены...');

      await this.sleep(3000); // 🔥 сократил с 5 до 3 сек

      try {
        await page.evaluate(() => {
          window.scrollTo(0, 100);
        });
        await this.sleep(500); // 🔥 сократил с 1 до 0.5 сек
      } catch (e) {}

      const pageCookies = await page.cookies();

      const cookiesObj = {};
      pageCookies.forEach(cookie => {
        cookiesObj[cookie.name] = cookie.value;
      });

      cookiesObj.currency = cookiesObj.currency || 'rub';
      cookiesObj.marker = this.marker;

      console.log('🍪 Получено куков:', Object.keys(cookiesObj).length);
      console.log('🍪 Куки:', Object.keys(cookiesObj).join(', '));

      if (!cookiesObj['aws-waf-token']) {
        console.warn('⚠️ ВНИМАНИЕ: Отсутствует aws-waf-token! Может быть 403 ошибка.');
      }
      if (!cookiesObj['nuid']) {
        console.warn('⚠️ ВНИМАНИЕ: Отсутствует nuid!');
      }

      await page.close();
      await browser.close();

      console.log('✅ Куки успешно установлены');
      console.log('🍪 ========================================\n');

      return cookiesObj;

    } catch (error) {
      console.error('❌ Ошибка установки куки:', error.message);

      if (page) {
        try {
          await page.close();
        } catch (e) {}
      }

      if (browser) {
        try {
          await browser.close();
        } catch (e) {}
      }

      return null;
    }
  }

  // 🔥 создаем несколько наборов кук ТОЛЬКО ОДИН РАЗ
  async initCookiesSets(count) {
    // 🔥 Если уже инициализированы, пропускаем
    if (this.cookiesInitialized) {
      console.log(`✅ Куки уже получены (${this.cookiesList.length} наборов), пропускаем...\n`);
      return;
    }

    this.cookiesList = [];

    console.log(`\n🍪 ПОЛУЧЕНИЕ ${count} НАБОРОВ КУК\n`);

    for (let i = 0; i < count; i++) {
      console.log(`🍪 Набор кук #${i + 1}/${count}...`);
      const cookiesObj = await this.setCookie();

      if (!cookiesObj) {
        console.error(`❌ Не удалось получить куки #${i + 1}`);
        continue;
      }

      this.cookiesList.push(cookiesObj);

      // 🔥 убрал паузу между получением кук
    }

    console.log(`\n✅ Готово: получено ${this.cookiesList.length}/${count} наборов кук\n`);

    if (this.cookiesList.length === 0) {
      throw new Error('Не удалось получить ни одного набора кук');
    }

    this.cookiesInitialized = true;
  }

  formatCookies(cookiesObj) {
    return Object.entries(cookiesObj)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
  }

  async startSearch(params, cookiesObj, prefix = '') {
    const {
      origin,
      destination,
      departure_date,
      return_date,
      adults = 1,
      children = 0,
      infants = 0,
      trip_class = 'Y',
      airline = null,
      baggage = false,
      baggage_weight = '20',
      max_stops = null,
      max_layover_hours = null
    } = params;

    console.log(`${prefix}  > Запуск поиска через API...`);

    const filters_state = {};

    if (airline) {
      filters_state.airlines = [airline];
    }

    if (baggage) {
      filters_state.baggage = true;
      filters_state.baggage_weight = String(baggage_weight);
    }

    if (max_stops !== null && max_stops !== undefined) {
      filters_state.transfers_count = [String(max_stops)];
    }

    if (max_layover_hours !== null && max_layover_hours !== undefined) {
      const maxMinutes = max_layover_hours * 60;
      filters_state.transfers_duration = {
        min: 0,
        max: maxMinutes
      };
    }

    filters_state.sort = 'price_asc';

    const requestBody = {
      search_params: {
        directions: [
          {
            origin: origin,
            destination: destination,
            date: departure_date,
            is_origin_airport: false,
            is_destination_airport: false
          }
        ],
        passengers: {
          adults: adults,
          children: children,
          infants: infants
        },
        trip_class: trip_class
      },
      client_features: {
        direct_flights: true,
        brand_ticket: false,
        top_filters: true,
        badges: false,
        tour_tickets: true,
        assisted: true
      },
      market_code: 'ru',
      marker: this.marker,
      citizenship: 'RU',
      currency_code: 'rub',
      languages: { ru: 1 },
      experiment_groups: {},
      debug: { override_experiment_groups: {} },
      brand: 'AS',
      filters: {},
      subscription_ticket_signatures: []
    };

    if (return_date) {
      requestBody.search_params.directions.push({
        origin: destination,
        destination: origin,
        date: return_date,
        is_origin_airport: false,
        is_destination_airport: false
      });
    }

    if (Object.keys(filters_state).length > 0) {
      requestBody.filters_state = filters_state;
    }

    let httpsAgent = null;

    try {
      const proxyUrl = this.getNextProxy();

      console.log(`${prefix}  > Используется прокси: ${proxyUrl ? proxyUrl.substring(0, 50) + '...' : 'без прокси'}`);

      const gotOptions = {
        headers: {
          'accept': 'application/json',
          'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/json',
          'origin': 'https://www.aviasales.ru',
          'referer': 'https://www.aviasales.ru/',
          'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'x-client-type': 'web',
          'cookie': this.formatCookies(cookiesObj)
        },
        json: requestBody,
        responseType: 'json',
        timeout: {
          request: 30000
        },
        http2: false,
        retry: {
          limit: 0
        }
      };

      if (proxyUrl) {
        httpsAgent = new HttpsProxyAgent(proxyUrl, {
          keepAlive: false,
          timeout: 30000,
          maxFreeSockets: 0,
          maxSockets: 5,
          scheduling: 'lifo'
        });

        gotOptions.agent = {
          https: httpsAgent
        };
      }

      const response = await got.post(`${this.baseURL}/search/v2/start`, gotOptions);
      const data = response.body;

      console.log(`${prefix}  > Поиск запущен, search_id: ${data.search_id.substring(0, 12)}...`);

      return {
        search_id: data.search_id,
        results_url: data.results_url,
        filters_state: data.filters_state || filters_state,
        polling_interval_ms: data.polling_interval_ms || 1000
      };

    } catch (error) {
      console.error(`${prefix}  > ОШИБКА: ${error.message}`);

      if (error.response && error.response.statusCode === 403) {
        console.error(`${prefix}  > 🚫 CloudFront блокирует запрос (403)`);
        if (this.debug) {
          console.error(`${prefix}  > Ответ:`, error.response.body);
        }
      }

      throw error;
    } finally {
      if (httpsAgent) {
        try {
          httpsAgent.destroy();
        } catch (e) {}
      }
    }
  }

  async getResults(searchData, cookiesObj, airline = null, prefix = '') {
    const { search_id, results_url, filters_state } = searchData;

    console.log(`${prefix}  > Ожидание результатов (макс ${this.maxPollingAttempts} попыток)...`);

    let attempt = 0;
    let last_update_timestamp = null;

    while (attempt < this.maxPollingAttempts) {
      attempt++;
      let httpsAgent = null;

      try {
        const requestBody = {
          limit: 10,
          price_per_person: false,
          search_by_airport: false,
          filters_state: filters_state || {},
          search_id: search_id
        };

        if (last_update_timestamp !== null) {
          requestBody.last_update_timestamp = last_update_timestamp;
        }

        const proxyUrl = this.getNextProxy();

        const gotOptions = {
          headers: {
            'accept': 'application/json',
            'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'content-type': 'application/json',
            'origin': 'https://www.aviasales.ru',
            'referer': 'https://www.aviasales.ru/',
            'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'x-client-type': 'web',
            'cookie': this.formatCookies(cookiesObj)
          },
          json: requestBody,
          responseType: 'json',
          timeout: {
            request: 10000
          },
          http2: false,
          retry: {
            limit: 0
          }
        };

        if (proxyUrl) {
          httpsAgent = new HttpsProxyAgent(proxyUrl, {
            keepAlive: false,
            timeout: 10000,
            maxFreeSockets: 0,
            maxSockets: 5,
            scheduling: 'lifo'
          });

          gotOptions.agent = {
            https: httpsAgent
          };
        }

        const response = await got.post(`https://${results_url}/search/v3.2/results`, gotOptions);
        const data = response.body[0];

        if (data.last_update_timestamp === 0) {
          console.log(`${prefix}  > Загрузка завершена, анализ билетов...`);
          const cheapestPrice = this.extractCheapestPriceFromAllTickets(data.tickets, airline, prefix);

          if (cheapestPrice) {
            return cheapestPrice;
          } else {
            console.log(`${prefix}  > Билеты не найдены под заданные фильтры`);
            return null;
          }
        }

        if (data.last_update_timestamp) {
          last_update_timestamp = data.last_update_timestamp;
        }

        await this.sleep(this.pollingInterval); // 🔥 НЕ ТРОГАЛ - оставил 6000мс

      } catch (error) {
        if (error.response && error.response.statusCode === 304) {
          await this.sleep(this.pollingInterval); // 🔥 НЕ ТРОГАЛ
          continue;
        }

        if (attempt >= this.maxPollingAttempts) {
          console.error(`${prefix}  > ОШИБКА: Превышено максимальное количество попыток`);
          return null;
        }

        await this.sleep(this.pollingInterval); // 🔥 НЕ ТРОГАЛ
      } finally {
        if (httpsAgent) {
          try {
            httpsAgent.destroy();
          } catch (e) {}
        }
      }
    }

    console.error(`${prefix}  > ОШИБКА: Таймаут ожидания результатов`);
    return null;
  }

  extractCheapestPriceFromAllTickets(tickets, airline = null, prefix = '') {
    if (!tickets || tickets.length === 0) {
      return null;
    }

    let minPrice = Infinity;
    let bestProposal = null;
    let bestTicket = null;

    for (const ticket of tickets) {
      if (!ticket.proposals || ticket.proposals.length === 0) {
        continue;
      }

      for (const proposal of ticket.proposals) {
        const price = proposal.unified_price?.value || proposal.price?.value;

        if (price && price < minPrice) {
          minPrice = price;
          bestProposal = proposal;
          bestTicket = ticket;
        }
      }
    }

    if (!bestProposal) {
      return null;
    }

    const currency = bestProposal.unified_price?.currency_code || bestProposal.price?.currency_code;

    console.log(`${prefix}  > Найдена минимальная цена: ${minPrice.toLocaleString('ru-RU')} ${currency}`);

    return {
      price: minPrice,
      currency: currency,
      ticket_id: bestTicket.id,
      proposal_id: bestProposal.id
    };
  }

  cleanupOldScreenshots() {
    const tempDir = path.join(__dirname, '../temp');
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    fs.readdir(tempDir, (err, files) => {
      if (err) return;

      files.forEach(file => {
        const filePath = path.join(tempDir, file);

        fs.stat(filePath, (err, stats) => {
          if (err) return;

          if (now - stats.mtimeMs > maxAge) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    });
  }

  async getPriceFromUrl(url, cookiesObj, index, total, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const startTime = Date.now();
    const prefix = `[${index}/${total}]`;

    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const searchPath = pathParts[pathParts.length - 1];

      const match = searchPath.match(/^([A-Z]{3})(\d{4})([A-Z]{3})(\d{4})?(\d)(\d)?(\d)?$/);

      if (!match) {
        throw new Error(`Не удалось распарсить URL: ${searchPath}`);
      }

      const [, origin, depDate, destination, retDate, adults, children, infants] = match;

      const formatDate = (ddmm) => {
        if (!ddmm || ddmm === '0000') return null;
        const day = ddmm.substring(0, 2);
        const month = ddmm.substring(2, 4);
        const year = new Date().getFullYear();
        return `${year}-${month}-${day}`;
      };

      const depDateFormatted = formatDate(depDate);
      const retDateFormatted = formatDate(retDate);

      const params = {
        origin: origin,
        destination: destination,
        departure_date: depDateFormatted,
        return_date: retDateFormatted,
        adults: parseInt(adults) || 1,
        children: parseInt(children || '0'),
        infants: parseInt(infants || '0'),
        airline: airline,
        baggage: baggage,
        max_stops: max_stops === 99 ? null : max_stops,
        max_layover_hours: maxLayoverHours
      };

      console.log('');
      console.log(`${prefix} ========================================`);
      console.log(`${prefix} Маршрут: ${origin} -> ${destination}`);
      console.log(`${prefix} Вылет: ${depDateFormatted}${retDateFormatted ? ', Обратно: ' + retDateFormatted : ''}`);
      console.log(`${prefix} Пассажиры: ${params.adults} взр${params.children > 0 ? ', ' + params.children + ' дет' : ''}${params.infants > 0 ? ', ' + params.infants + ' млад' : ''}`);

      if (airline || max_stops !== null || maxLayoverHours || baggage) {
        const filters = [];
        if (airline) filters.push(`авиакомпания ${airline}`);
        if (max_stops !== null && max_stops !== 99) filters.push(`макс пересадок: ${max_stops}`);
        if (maxLayoverHours) filters.push(`макс время пересадки: ${maxLayoverHours}ч`);
        if (baggage) filters.push(`с багажом`);
        console.log(`${prefix} Фильтры: ${filters.join(', ')}`);
      }

      if (this.aviasalesAPI) {
        const aviasalesUrl = this.aviasalesAPI.generateSearchLink(params);
        console.log(`${prefix} Ссылка: ${aviasalesUrl}`);
      }

      console.log(`${prefix} ========================================`);

      const searchData = await this.startSearch(params, cookiesObj, prefix);

      // 🔥 убрал паузу перед получением результатов

      const result = await this.getResults(searchData, cookiesObj, airline, prefix);

      if (!result) {
        console.log(`${prefix} РЕЗУЛЬТАТ: Билеты не найдены`);
        console.log('');
        return null;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${prefix} РЕЗУЛЬТАТ: ${result.price.toLocaleString('ru-RU')} ${result.currency}`);
      console.log(`${prefix} Время обработки: ${elapsed} секунд`);
      console.log('');

      return {
        price: result.price,
        currency: result.currency
      };

    } catch (error) {
      console.error(`${prefix} КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
      console.log('');
      return null;
    }
  }

  async getPricesFromUrls(urls, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const total = urls.length;
    const results = new Array(total).fill(null);

    console.log('');
    console.log('========================================');
    console.log(`НАЧАЛО ОБРАБОТКИ: ${total} билетов`);
    console.log(`Размер пачки: ${this.maxConcurrent}`);
    console.log('========================================');
    console.log('');

    // 🔥 Инициализируем прокси только один раз
    await this.initProxies();

    // 🔥 Инициализируем куки только один раз
    const cookiesCount = Math.min(this.maxConcurrent, total);
    await this.initCookiesSets(cookiesCount);

    const startTime = Date.now();
    let completedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    const batchSize = this.maxConcurrent;
    const totalBatches = Math.ceil(total / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, total);
      const batchUrls = urls.slice(batchStart, batchEnd);

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🔄 ПАЧКА ${batchIndex + 1}/${totalBatches}: билеты ${batchStart + 1}-${batchEnd}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      const batchPromises = [];

      for (let i = 0; i < batchUrls.length; i++) {
        const globalIndex = batchStart + i;
        const workerCookies = this.cookiesList[i % this.cookiesList.length];

        // 🔥 убрал задержку между запуском воркеров в пачке

        const workerPromise = (async () => {
          try {
            const result = await this.getPriceFromUrl(
                batchUrls[i],
                workerCookies,
                globalIndex + 1,
                total,
                airline,
                maxLayoverHours,
                baggage,
                max_stops
            );

            results[globalIndex] = result;
            completedCount++;

            if (result && result.price) {
              successCount++;
            } else {
              failedCount++;
            }

            console.log(`ПРОГРЕСС: Обработано ${completedCount} из ${total} билетов (✅ ${successCount} успешно, ❌ ${failedCount} ошибок)`);
            console.log('');

            return result;
          } catch (error) {
            console.error(`[${globalIndex + 1}/${total}] КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
            console.log('');
            results[globalIndex] = null;
            completedCount++;
            failedCount++;
            return null;
          }
        })();

        batchPromises.push(workerPromise);
      }

      console.log(`⏳ Ожидание завершения пачки ${batchIndex + 1}/${totalBatches}...\n`);
      await Promise.allSettled(batchPromises);

      console.log(`\n✅ Пачка ${batchIndex + 1}/${totalBatches} завершена\n`);

      // 🔥 убрал паузу между пачками
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('========================================');
    console.log('ОБРАБОТКА ЗАВЕРШЕНА');
    console.log(`✅ Успешно: ${successCount} из ${total}`);
    console.log(`❌ Ошибок: ${failedCount} из ${total}`);
    console.log(`⏱ Общее время: ${elapsed} секунд`);
    console.log('========================================');
    console.log('');

    return {
      results,
      stats: {
        total,
        success: successCount,
        failed: failedCount,
        elapsed: parseFloat(elapsed)
      }
    };
  }
}

module.exports = AviasalesPricer;
