const puppeteer = require('puppeteer');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');

class AviasalesPricer {
  constructor(debug = false, marker = '696196') {
    this.maxConcurrent = 7;
    this.debug = debug;
    this.marker = marker;

    // API конфигурация
    this.baseURL = 'https://tickets-api.aviasales.ru';
    this.maxPollingAttempts = 7;
    this.pollingInterval = 4000;

    // 🔥 ПРОКСИ-РОТАЦИЯ
    this.proxyList = [
      'http://bkczhupt:ww4ng38q6a84@142.111.48.253:7030',
      'http://bkczhupt:ww4ng38q6a84@23.95.150.145:6114',
      'http://bkczhupt:ww4ng38q6a84@198.23.239.134:6540',
      'http://bkczhupt:ww4ng38q6a84@107.172.163.27:6543',
      'http://bkczhupt:ww4ng38q6a84@198.105.121.200:6462',
      'http://bkczhupt:ww4ng38q6a84@64.137.96.74:6641',
      'http://bkczhupt:ww4ng38q6a84@84.247.60.125:6095',
      'http://bkczhupt:ww4ng38q6a84@216.10.27.159:6837',
      'http://bkczhupt:ww4ng38q6a84@23.26.71.145:5628',
      'http://bkczhupt:ww4ng38q6a84@23.27.208.120:5830'
    ];
    this.workingProxies = [];  // 🔥 Список рабочих прокси
    this.currentProxyIndex = 0;
    this.proxyCheckTimeout = 5000;  // 🔥 Таймаут проверки: 5 секунд

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    this.cleanupOldScreenshots();
  }

  // 🔥 НОВЫЙ МЕТОД: Проверка прокси
  async testProxy(proxyUrl) {
    try {
      const httpsAgent = new HttpsProxyAgent(proxyUrl);

      const startTime = Date.now();
      await axios.get('https://api.ipify.org?format=json', {
        httpsAgent: httpsAgent,
        timeout: this.proxyCheckTimeout
      });
      const elapsed = Date.now() - startTime;

      console.log(`✅ Прокси работает (${elapsed}мс):`, proxyUrl.substring(0, 50) + '...');
      return true;
    } catch (error) {
      console.error(`❌ Прокси не работает:`, proxyUrl.substring(0, 50) + '...', '-', error.message);
      return false;
    }
  }

  // 🔥 НОВЫЙ МЕТОД: Проверка всех прокси при старте
  async initProxies() {
    console.log('\n🔍 ========================================');
    console.log('🔍 ПРОВЕРКА ПРОКСИ');
    console.log('🔍 ========================================');
    console.log(`🔍 Проверка ${this.proxyList.length} прокси (таймаут ${this.proxyCheckTimeout}мс)...\n`);

    this.workingProxies = [];

    for (const proxy of this.proxyList) {
      const isWorking = await this.testProxy(proxy);
      if (isWorking) {
        this.workingProxies.push(proxy);
      }
    }

    console.log(`\n✅ Рабочих прокси: ${this.workingProxies.length}/${this.proxyList.length}`);
    console.log('🔍 ========================================\n');

    if (this.workingProxies.length === 0) {
      console.warn('⚠️ НЕТ РАБОЧИХ ПРОКСИ! Работа без прокси.');
    }

    return this.workingProxies.length > 0;
  }

  // 🔥 ОБНОВЛЕННЫЙ МЕТОД: Получение следующего прокси (только из рабочих)
  getNextProxy() {
    if (this.workingProxies.length === 0) {
      return null;
    }

    const proxy = this.workingProxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.workingProxies.length;
    console.log(`🔄 Прокси #${this.currentProxyIndex}/${this.workingProxies.length}`);
    return proxy;
  }

  // 🔥 НОВЫЙ МЕТОД: Парсинг прокси URL (для Puppeteer)
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

  // 🔥 ОБНОВЛЕННЫЙ МЕТОД: Установка куки через Puppeteer с прокси
  async setCookie() {
    console.log('\n🍪 ========================================');
    console.log('🍪 УСТАНОВКА КУКИ');
    console.log('🍪 ========================================');
    console.log('🌐 Запуск браузера для получения куки...');

    let browser = null;
    let page = null;

    try {
      // 🔥 Получаем следующий прокси
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

      // 🔥 Добавляем прокси если есть рабочие
      if (proxyUrl) {
        const proxyObj = this.parseProxy(proxyUrl);
        const proxyServer = `http://${proxyObj.host}:${proxyObj.port}`;
        launchOptions.args.push(`--proxy-server=${proxyServer}`);
        console.log('✅ Использую прокси для браузера');
      }

      browser = await puppeteer.launch(launchOptions);
      console.log('✅ Браузер запущен');

      page = await browser.newPage();

      // 🔥 Авторизация прокси если используется
      if (proxyUrl) {
        const proxyObj = this.parseProxy(proxyUrl);
        await page.authenticate({
          username: proxyObj.auth.username,
          password: proxyObj.auth.password
        });
        console.log('✅ Авторизация на прокси выполнена');
      }

      await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
      );

      console.log('🔍 Открытие aviasales.ru...');

      await page.goto('https://www.aviasales.ru/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log('✅ DOM загружен, ждем куки...');
      await this.sleep(3000);

      const pageCookies = await page.cookies();

      const cookiesObj = {};
      pageCookies.forEach(cookie => {
        cookiesObj[cookie.name] = cookie.value;
      });

      cookiesObj.currency = cookiesObj.currency || 'rub';
      cookiesObj.marker = this.marker;

      console.log('🍪 Получено куков:', Object.keys(cookiesObj).length);
      console.log('🍪 Куки:', Object.keys(cookiesObj).join(', '));

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

  formatCookies(cookiesObj) {
    return Object.entries(cookiesObj)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
  }

  getHeaders(cookiesObj) {
    return {
      'accept': 'application/json',
      'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': 'application/json',
      'origin': 'https://www.aviasales.ru',
      'referer': 'https://www.aviasales.ru/',
      'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'x-client-type': 'web',
      'cookie': this.formatCookies(cookiesObj)
    };
  }

  async startSearch(params, cookiesObj) {
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

    console.log('\n🚀 Запуск поиска через API...');
    console.log(`📍 Маршрут: ${origin} → ${destination}`);
    console.log(`📅 Даты: ${departure_date} — ${return_date || 'в одну сторону'}`);
    console.log(`👥 Пассажиры: ${adults} взр, ${children} дет, ${infants} млад`);

    const filters_state = {};

    if (airline) {
      filters_state.airlines = [airline];
      console.log(`✈️ Авиакомпания: ${airline}`);
    }

    if (baggage) {
      filters_state.baggage = true;
      filters_state.baggage_weight = String(baggage_weight);
      console.log(`🧳 Багаж: ${baggage_weight} кг`);
    }

    if (max_stops !== null && max_stops !== undefined) {
      filters_state.transfers_count = [String(max_stops)];
      console.log(`✈️ Макс. пересадок: ${max_stops}`);
    }

    if (max_layover_hours !== null && max_layover_hours !== undefined) {
      const maxMinutes = max_layover_hours * 60;
      filters_state.transfers_duration = {
        min: 0,
        max: maxMinutes
      };
      console.log(`⏱ Макс. время пересадки: ${max_layover_hours}ч`);
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

    try {
      const proxyUrl = this.getNextProxy();

      const config = {
        headers: this.getHeaders(cookiesObj),
        timeout: 30000
      };

      if (proxyUrl) {
        const httpsAgent = new HttpsProxyAgent(proxyUrl);
        config.httpsAgent = httpsAgent;
      }

      const response = await axios.post(
          `${this.baseURL}/search/v2/start`,
          requestBody,
          config
      );

      const data = response.data;

      console.log(`✅ Поиск запущен! search_id: ${data.search_id}`);

      return {
        search_id: data.search_id,
        results_url: data.results_url,
        filters_state: data.filters_state || filters_state,
        polling_interval_ms: data.polling_interval_ms || 1000
      };

    } catch (error) {
      if (error.response) {
        console.error('❌ HTTP ошибка:', error.response.status);
        console.error('📄 Ответ:', error.response.data);
      } else {
        console.error('❌ Ошибка запуска поиска:', error.message);
      }
      throw error;
    }
  }

  async getResults(searchData, cookiesObj, airline = null) {
    const { search_id, results_url, filters_state } = searchData;

    console.log('\n⏳ Ожидание результатов...');

    let attempt = 0;
    let last_update_timestamp = null;

    while (attempt < this.maxPollingAttempts) {
      attempt++;

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

        console.log(`\n📡 Запрос ${attempt}/${this.maxPollingAttempts}...`);

        const proxyUrl = this.getNextProxy();

        const config = {
          headers: this.getHeaders(cookiesObj),
          timeout: 10000
        };

        if (proxyUrl) {
          const httpsAgent = new HttpsProxyAgent(proxyUrl);
          config.httpsAgent = httpsAgent;
        }

        const response = await axios.post(
            `https://${results_url}/search/v3.2/results`,
            requestBody,
            config
        );

        const data = response.data[0];

        console.log(`📊 last_update_timestamp: ${data.last_update_timestamp}`);
        console.log(`📊 tickets: ${data.tickets?.length || 0}`);

        if (data.last_update_timestamp === 0) {
          console.log('\n✅ Загрузка завершена (last_update_timestamp = 0)');

          const cheapestPrice = this.extractCheapestPriceFromAllTickets(data.tickets, airline);

          if (cheapestPrice) {
            console.log('✅ Цена найдена!');
            return cheapestPrice;
          } else {
            console.log('⚠️ Билеты не найдены под заданные фильтры');
            return null;
          }
        }

        if (data.last_update_timestamp) {
          last_update_timestamp = data.last_update_timestamp;
        }

        await this.sleep(this.pollingInterval);

      } catch (error) {
        if (error.response && error.response.status === 304) {
          console.log('📡 304 Not Modified, продолжаем...');
          await this.sleep(this.pollingInterval);
          continue;
        }

        console.error(`❌ Ошибка (попытка ${attempt}):`, error.message);

        if (attempt >= this.maxPollingAttempts) {
          console.error('❌ Превышено максимальное количество попыток');
          return null;
        }

        await this.sleep(this.pollingInterval);
      }
    }

    console.error('❌ Превышено время ожидания');
    return null;
  }

  extractCheapestPriceFromAllTickets(tickets, airline = null) {
    if (!tickets || tickets.length === 0) {
      console.warn('⚠️ Билеты отсутствуют');
      return null;
    }

    let minPrice = Infinity;
    let bestProposal = null;
    let bestTicket = null;

    console.log(`\n🔍 Анализ ${tickets.length} билетов...`);

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
      console.warn('⚠️ Не найдено предложений с ценой');
      return null;
    }

    const currency = bestProposal.unified_price?.currency_code || bestProposal.price?.currency_code;

    console.log(`\n💰 Самая низкая цена: ${minPrice.toLocaleString('ru-RU')} ${currency}`);

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
      if (err) {
        console.warn('⚠️ Не удалось прочитать папку temp:', err.message);
        return;
      }

      let deletedCount = 0;

      files.forEach(file => {
        const filePath = path.join(tempDir, file);

        fs.stat(filePath, (err, stats) => {
          if (err) return;

          if (now - stats.mtimeMs > maxAge) {
            fs.unlink(filePath, (err) => {
              if (!err) {
                deletedCount++;
                if (deletedCount === 1) {
                  console.log(`🗑 Удаляю старые скриншоты (> 24ч)...`);
                }
              }
            });
          }
        });
      });
    });
  }

  async getPriceFromUrl(url, cookiesObj, index, total, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const startTime = Date.now();

    console.log('='.repeat(80));
    console.log(`[${index}/${total}] 🚀 НАЧАЛО ПРОВЕРКИ`);
    console.log(`[${index}/${total}] 🔗 ${url}`);
    if (airline) {
      console.log(`[${index}/${total}] ✈️ Авиакомпания: ${airline}`);
    }
    if (max_stops !== null && max_stops !== undefined) {
      console.log(`[${index}/${total}] 🔢 Макс. пересадок: ${max_stops}`);
    }
    if (maxLayoverHours !== null && maxLayoverHours !== undefined) {
      console.log(`[${index}/${total}] ⏱ Макс. время пересадки: ${maxLayoverHours}ч`);
    }
    if (baggage === true || baggage === 1) {
      console.log(`[${index}/${total}] 🧳 Багаж: 20 кг`);
    }
    console.log('='.repeat(80));

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

      const params = {
        origin: origin,
        destination: destination,
        departure_date: formatDate(depDate),
        return_date: formatDate(retDate),
        adults: parseInt(adults) || 1,
        children: parseInt(children || '0'),
        infants: parseInt(infants || '0'),
        airline: airline,
        baggage: baggage,
        max_stops: max_stops === 99 ? null : max_stops,
        max_layover_hours: maxLayoverHours
      };

      console.log(`[${index}/${total}] 📋 Параметры поиска:`, params);

      const searchData = await this.startSearch(params, cookiesObj);
      const result = await this.getResults(searchData, cookiesObj, airline);

      if (!result) {
        console.log(`[${index}/${total}] ⚠️ Билеты не найдены`);
        return null;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${index}/${total}] ✅ ЗАВЕРШЕНО за ${elapsed}с`);
      console.log(`[${index}/${total}] 💰 Цена: ${result.price.toLocaleString('ru-RU')} ${result.currency}`);

      return {
        price: result.price,
        currency: result.currency
      };

    } catch (error) {
      console.error(`[${index}/${total}] ❌ ОШИБКА:`, error.message);
      return null;
    }
  }

  async getPricesFromUrls(urls, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const total = urls.length;
    const results = new Array(total).fill(null);

    console.log(`🚀 Начинаю обработку ${total} URL по ${this.maxConcurrent} параллельно`);

    // 🔥 ПРОВЕРЯЕМ ПРОКСИ ПЕРЕД НАЧАЛОМ РАБОТЫ
    await this.initProxies();

    console.log('\n🍪 ========================================');
    console.log('🍪 УСТАНОВКА КУКИ ДЛЯ ВСЕЙ ПАЧКИ');
    console.log('🍪 ========================================');

    const cookiesObj = await this.setCookie();

    if (!cookiesObj) {
      console.error('❌ Не удалось установить куки, прерываем обработку');
      return results;
    }

    console.log('✅ Куки установлены для всей пачки проверок\n');

    const startTime = Date.now();
    let completedCount = 0;
    let nextUrlIndex = 0;

    const processUrl = async (index) => {
      try {
        const result = await this.getPriceFromUrl(
            urls[index],
            cookiesObj,
            index + 1,
            total,
            airline,
            maxLayoverHours,
            baggage,
            max_stops
        );

        results[index] = result;
        completedCount++;

        console.log(`\n📊 Прогресс: ${completedCount}/${total} завершено\n`);

        if (nextUrlIndex < total) {
          const pause = Math.floor(Math.random() * 3000) + 5000;
          console.log(`⏸ Пауза ${pause}мс перед следующим URL...`);
          await this.sleep(pause);
        }

        return result;
      } catch (error) {
        console.error(`❌ Критическая ошибка URL ${index + 1}:`, error);
        results[index] = null;
        completedCount++;
        return null;
      }
    };

    const workers = [];

    for (let i = 0; i < Math.min(this.maxConcurrent, total); i++) {
      const workerChain = (async () => {
        while (nextUrlIndex < total) {
          const currentIndex = nextUrlIndex++;
          await processUrl(currentIndex);
        }
      })();

      workers.push(workerChain);
    }

    await Promise.allSettled(workers);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validResults = results.filter(r => r !== null);
    console.log(`\n✅ Обработка завершена за ${elapsed}с. Успешно: ${validResults.length}/${total}\n`);

    return results;
  }
}

module.exports = AviasalesPricer;