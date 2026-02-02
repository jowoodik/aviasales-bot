const puppeteer = require('puppeteer');
const got = require('got');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const AviasalesAPI = require('./AviasalesAPI');

class AviasalesPricer {
  constructor(debug = false, marker = '696196') {
    this.maxConcurrent = 7;
    this.debug = debug;
    this.marker = marker;
    this.aviasalesAPI = new AviasalesAPI(process.env.TRAVELPAYOUTS_TOKEN);

    // API конфигурация
    this.baseURL = 'https://tickets-api.aviasales.ru';
    this.maxPollingAttempts = 10;
    this.pollingInterval = 4000;

    // ПРОКСИ-РОТАЦИЯ
    this.proxyList = [
      'http://PEesVANV:hiBzhNjR@45.132.129.28:63986',
      'http://PEesVANV:hiBzhNjR@85.142.0.133:62806',
      'http://PEesVANV:hiBzhNjR@85.142.1.182:62672',
      'http://PEesVANV:hiBzhNjR@85.142.5.72:62916',
      'http://PEesVANV:hiBzhNjR@85.142.7.101:64414',
      'http://PEesVANV:hiBzhNjR@85.142.46.30:64626',
      'http://PEesVANV:hiBzhNjR@85.142.81.248:64954',
    ];
    this.workingProxies = [];
    this.currentProxyIndex = 0;
    this.proxyCheckTimeout = 2000;

    // 🔥 Флаги инициализации
    this.proxiesInitialized = false;
    this.cookiesInitialized = false;

    // 🔥 TTL для кук (30 минут)
    this.cookiesTTL = 30 * 60 * 1000;
    this.cookiesInitializedAt = null;

    // массив разных наборов кук
    this.cookiesList = [];

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    this.cleanupOldScreenshots();
  }

  // 🆕 УТИЛИТА: Очистка JSON от trailing commas (исправление ошибок парсинга)
  cleanJsonTrailingCommas(jsonString) {
    try {
      // Удаляем запятые перед закрывающими скобками
      let cleaned = jsonString
          .replace(/,(\s*[\]}])/g, '$1')  // Убираем запятые перед ] и }
          .replace(/,(\s*$)/gm, '');       // Убираем запятые в конце строк

      return cleaned;
    } catch (error) {
      console.error('⚠️ Ошибка очистки JSON:', error.message);
      return jsonString;
    }
  }

  // 🆕 УТИЛИТА: Безопасный парсинг JSON с автоисправлением
  safeJsonParse(jsonString, context = 'unknown') {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn(`⚠️ JSON парсинг (${context}): первая попытка failed, пробую очистку...`);
      try {
        const cleaned = this.cleanJsonTrailingCommas(jsonString);
        return JSON.parse(cleaned);
      } catch (error2) {
        console.error(`❌ JSON парсинг (${context}): не удалось даже после очистки`);
        throw error2;
      }
    }
  }


  // 🆕 ИСПРАВЛЕННЫЙ МЕТОД: Формирование расширенной ссылки для шаринга
  buildEnhancedSearchLink(params, ticket, proposal, price) {
    try {
      const { origin, destination, departure_date, return_date, adults = 1, children = 0, infants = 0 } = params;

      // Формируем базовый путь /search/ORIGIN{DDMM}DEST{DDMM}{A}{C}{I}
      const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const [year, month, day] = dateStr.split('-');
        return day + month;
      };

      const depDate = formatDate(departure_date);
      const retDate = return_date ? formatDate(return_date) : '';

      const searchPath = origin + depDate + destination + retDate + adults + (children || '') + (infants || '');

      // Текущая дата в формате DDMMYYYY
      const now = new Date();
      const searchDate = String(now.getDate()).padStart(2, '0') +
          String(now.getMonth() + 1).padStart(2, '0') +
          now.getFullYear();

      // Базовые параметры
      const queryParams = {
        expected_price: Math.round(price),
        expected_price_currency: 'rub',
        expected_price_source: 'share',
        marker: this.marker,
        search_date: searchDate,
        search_label: encodeURIComponent('Купибилет'),
        utm_source: 'ticket_sharing'
      };

      // UUID для трекинга
      queryParams.expected_price_uuid = uuidv4();

      // 🔥 ИСПРАВЛЕНО: static_fare_key из proposal.minimum_fare.fare_key
      if (proposal && proposal.minimum_fare && proposal.minimum_fare.fare_key) {
        queryParams.static_fare_key = encodeURIComponent(proposal.minimum_fare.fare_key);
      } else {
        console.error('      ⚠️ minimum_fare.fare_key не найден в proposal');
      }

      // 🔥 ИСПРАВЛЕНО: Параметр 't'
      const tParam = this.buildTParameter(ticket, price);
      if (tParam) {
        queryParams.t = tParam;
      } else {
        console.error('      ⚠️ Не удалось сформировать параметр t');
      }

      // Формируем итоговый URL
      const queryString = Object.entries(queryParams)
          .map(([key, value]) => {
            if (value !== undefined && value !== null) {
              return key + '=' + encodeURIComponent(value);
            }
            return '';
          })
          .filter(param => param !== '')
          .join('&');

      return 'https://www.aviasales.ru/search/' + searchPath + '?' + queryString;
    } catch (error) {
      console.error('      ❌ Ошибка формирования расширенной ссылки:', error.message);
      console.error('      Stack:', error.stack);

      // Fallback на простую ссылку
      return this.aviasalesAPI ? this.aviasalesAPI.generateSearchLink(params) : null;
    }
  }

  // 🆕 ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Группировка flights по направлениям (специально для EK)
  groupFlightsByDirection(flights) {
    if (!flights || flights.length === 0) return [];

    // 🔥 ИСПРАВЛЕНО: Сортируем по времени вылета
    const sortedFlights = [...flights].sort((a, b) =>
        a.departure_unix_timestamp - b.departure_unix_timestamp
    );

    const groups = [];
    let currentGroup = [];

    for (let i = 0; i < sortedFlights.length; i++) {
      const flight = sortedFlights[i];

      if (currentGroup.length === 0) {
        // Начинаем новую группу
        currentGroup.push(flight);
      } else {
        const lastFlight = currentGroup[currentGroup.length - 1];

        // 🔥 ИСПРАВЛЕНО: Более гибкая проверка стыковки
        // Проверяем, является ли это продолжением маршрута
        if (flight.origin === lastFlight.destination) {
          // Проверяем разумное время пересадки (до 24 часов)
          const layoverHours = (flight.departure_unix_timestamp - lastFlight.arrival_unix_timestamp) / 3600;

          if (layoverHours >= 0 && layoverHours <= 24) {
            // Это стыковочный рейс
            currentGroup.push(flight);
          } else {
            // Это новое направление
            groups.push(currentGroup);
            currentGroup = [flight];
          }
        } else if (flight.destination === lastFlight.origin) {
          // 🔥 НОВОЕ: Обратное направление (например, DPS->DXB после DXB->DPS)
          groups.push(currentGroup);
          currentGroup = [flight];
        } else {
          // Новое направление (не стыкуется)
          groups.push(currentGroup);
          currentGroup = [flight];
        }
      }
    }

    // Добавляем последнюю группу
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    // 🔥 ДЕБАГ: Выводим информацию о группах
    groups.forEach((group, idx) => {
      if (group.length > 0) {
        const first = group[0];
        const last = group[group.length - 1];
      }
    });

    return groups;
  }

  buildTParameter(ticket, price) {
    try {
      // Валидация
      if (!ticket.segments || !Array.isArray(ticket.segments) || ticket.segments.length === 0) {
        console.log(' ⚠️ buildTParameter: Нет segments у билета');
        return null;
      }

      if (!ticket.signature) {
        console.log(' ⚠️ buildTParameter: Нет signature у билета');
        return null;
      }

      if (!ticket.flights || !Array.isArray(ticket.flights) || ticket.flights.length === 0) {
        console.log(' ⚠️ buildTParameter: Нет flights у билета');
        return null;
      }

      // ✅ ИСПРАВЛЕНО: Используем ВСЕ рейсы, а не только EK
      const allFlights = ticket.flights;

      // Группируем flights по направлениям (segments)
      const groups = this.groupFlightsByDirection(allFlights);

      if (groups.length === 0) {
        console.log(' ⚠️ Не удалось сгруппировать flights');
        return null;
      }

      const flightParts = [];

      for (const group of groups) {
        if (group.length === 0) continue;

        const firstFlight = group[0];
        const lastFlight = group[group.length - 1];

        // Получаем код авиакомпании
        const airlineCode = firstFlight.operating_carrier_designator?.carrier ||
            firstFlight.marketing_carrier_designator?.carrier;

        const depTimestamp = firstFlight.departure_unix_timestamp;
        const arrTimestamp = lastFlight.arrival_unix_timestamp;

        // Количество остановок
        const stops = String(group.length - 1).padStart(5, '0');

        // Длительность в минутах
        const durationMinutes = Math.floor((arrTimestamp - depTimestamp) / 60);
        const durationStr = String(durationMinutes).padStart(3, '0');

        // Маршрут
        const route = firstFlight.origin + lastFlight.destination;

        flightParts.push(airlineCode + depTimestamp + arrTimestamp + stops + durationStr + route);
      }

      if (flightParts.length === 0) return null;

      // Итоговый параметр t: {flights}_{signature}_{price}
      const result = flightParts.join('') + '_' + ticket.signature + '_' + Math.round(price);

      console.log(' ✅ Сформирован параметр t');
      return result;

    } catch (error) {
      console.error(' ⚠️ Ошибка формирования t параметра:', error.message);
      return null;
    }
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
          reject(new Error('Таймаут ' + this.proxyCheckTimeout + 'мс превышен'));
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
    if (this.proxiesInitialized) {
      console.log('✅ Прокси уже проверены, пропускаем...\n');
      return this.workingProxies.length > 0;
    }

    console.log('\n🔍 ПРОВЕРКА ПРОКСИ');
    console.log('Проверка ' + this.proxyList.length + ' прокси (таймаут ' + this.proxyCheckTimeout + 'мс)...\n');

    this.workingProxies = [];

    for (let i = 0; i < this.proxyList.length; i++) {
      const proxy = this.proxyList[i];
      const result = await this.testProxy(proxy);

      if (result.success) {
        this.workingProxies.push(proxy);
        console.log('✅ Прокси ' + (i + 1) + '/' + this.proxyList.length + ': OK (' + result.elapsed + 'мс, IP: ' + result.ip + ')');
      } else {
        console.log('❌ Прокси ' + (i + 1) + '/' + this.proxyList.length + ': ОШИБКА (' + result.error + ')');
      }
    }

    console.log('\n✅ Рабочих прокси: ' + this.workingProxies.length + '/' + this.proxyList.length + '\n');

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

  async setCookie(attempt = 1, maxAttempts = 3) {
    console.log('🍪 ========================================');
    console.log('🍪 УСТАНОВКА КУКИ (попытка ' + attempt + '/' + maxAttempts + ')');
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
        const proxyServer = 'http://' + proxyObj.host + ':' + proxyObj.port;
        launchOptions.args.push('--proxy-server=' + proxyServer);
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
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      console.log('✅ DOM загружен');

      await this.sleep(3000);

      try {
        await page.evaluate(() => {
          window.scrollTo(0, 100);
        });
        await this.sleep(500);
        await page.evaluate(() => {
          window.scrollTo(0, 0);
        });
      } catch (e) {}

      console.log('⏳ Ожидание критической куки nuid...');
      let nuidReceived = false;
      try {
        await page.waitForFunction(
            () => document.cookie.includes('nuid='),
            { timeout: 15000 }
        );
        nuidReceived = true;
        console.log('✅ Кука nuid получена!');
      } catch (timeoutError) {
        console.warn('⚠️ Таймаут ожидания nuid (15 сек)');
      }

      if (nuidReceived) {
        await this.sleep(2000);
      }

      const pageCookies = await page.cookies();
      const cookiesObj = {};
      pageCookies.forEach(cookie => {
        cookiesObj[cookie.name] = cookie.value;
      });

      cookiesObj.currency = cookiesObj.currency || 'rub';
      cookiesObj.marker = this.marker;

      console.log('🍪 Получено куков:', Object.keys(cookiesObj).length);
      console.log('🍪 Куки:', Object.keys(cookiesObj).join(', '));

      const requiredCookies = ['nuid'];
      const missingCookies = requiredCookies.filter(key => !cookiesObj[key]);

      if (missingCookies.length > 0) {
        console.error('❌ ОТСУТСТВУЮТ КРИТИЧЕСКИЕ КУКИ: ' + missingCookies.join(', '));
        await page.close();
        await browser.close();

        if (attempt < maxAttempts) {
          console.log('🔄 Повторная попытка получения кук (' + (attempt + 1) + '/' + maxAttempts + ') через 3 сек...');
          await this.sleep(3000);
          return this.setCookie(attempt + 1, maxAttempts);
        } else {
          console.error('❌ НЕ УДАЛОСЬ ПОЛУЧИТЬ КРИТИЧЕСКИЕ КУКИ ЗА ' + maxAttempts + ' ПОПЫТОК');
          console.error('❌ Этот набор кук будет пропущен или вызовет 403 ошибки');
          return null;
        }
      }

      if (!cookiesObj['aws-waf-token']) {
        console.warn('⚠️ Отсутствует aws-waf-token (может вызвать 403, но не критично)');
      }

      await page.close();
      await browser.close();

      console.log('✅ Все критические куки получены успешно');
      console.log('🍪 ========================================\n');

      return cookiesObj;
    } catch (error) {
      console.error('❌ Критическая ошибка при установке куки:', error.message);

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

      if (attempt < maxAttempts) {
        console.log('🔄 Повторная попытка после ошибки (' + (attempt + 1) + '/' + maxAttempts + ') через 3 сек...');
        await this.sleep(3000);
        return this.setCookie(attempt + 1, maxAttempts);
      }

      console.error('❌ ВСЕ ' + maxAttempts + ' ПОПЫТКИ ИСЧЕРПАНЫ');
      return null;
    }
  }

  async initCookiesSets(count) {
    const now = Date.now();

    if (this.cookiesInitialized && this.cookiesInitializedAt) {
      const elapsed = now - this.cookiesInitializedAt;
      const elapsedMinutes = Math.floor(elapsed / 60000);

      if (elapsed < this.cookiesTTL) {
        console.log('✅ Куки актуальны (получены ' + elapsedMinutes + ' мин назад, TTL: 30 мин)');
        console.log('   Наборов: ' + this.cookiesList.length + ', пропускаем...\n');
        return;
      }

      console.log('⚠️ Куки устарели (прошло ' + elapsedMinutes + ' мин, TTL: 30 мин)');
      console.log('🔄 Регенерация кук...\n');
      this.cookiesInitialized = false;
      this.cookiesInitializedAt = null;
      this.cookiesList = [];
    }

    console.log('\n🍪 ПОЛУЧЕНИЕ ' + count + ' НАБОРОВ КУК\n');

    for (let i = 0; i < count; i++) {
      console.log('🍪 Набор кук #' + (i + 1) + '/' + count + '...');
      const cookiesObj = await this.setCookie();

      if (!cookiesObj) {
        console.error('❌ Не удалось получить куки #' + (i + 1));
        continue;
      }

      this.cookiesList.push(cookiesObj);
    }

    console.log('\n✅ Готово: получено ' + this.cookiesList.length + '/' + count + ' наборов кук\n');

    if (this.cookiesList.length === 0) {
      throw new Error('Не удалось получить ни одного набора кук');
    }

    this.cookiesInitialized = true;
    this.cookiesInitializedAt = Date.now();
    console.log('🕐 Куки действительны до: ' + new Date(this.cookiesInitializedAt + this.cookiesTTL).toLocaleString('ru-RU') + '\n');
  }

  formatCookies(cookiesObj) {
    return Object.entries(cookiesObj)
        .map(([key, value]) => key + '=' + value)
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

    console.log(prefix + ' > Запуск поиска через API...');

    const filters_state = {};

    if (airline) {
      filters_state.airlines = [airline];
    }

    if (baggage) {
      filters_state.baggage = true;
      filters_state.baggage_weight = String(baggage_weight);
    }

    if (max_stops !== null && max_stops !== undefined) {
      filters_state.transfers_count = Array.from({ length: max_stops + 1 }, (_, i) => String(i));
    }

    if (max_layover_hours !== null && max_layover_hours !== undefined) {
      const maxMinutes = max_layover_hours * 60;
      filters_state.transfers_duration = {
        min: 90,
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
      console.log(prefix + ' > Используется прокси: ' + (proxyUrl ? proxyUrl.substring(0, 50) + '...' : 'без прокси'));

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

      const response = await got.post(this.baseURL + '/search/v2/start', gotOptions);
      const data = response.body;

      console.log(prefix + ' > Поиск запущен, search_id: ' + data.search_id.substring(0, 12) + '...');

      return {
        search_id: data.search_id,
        results_url: data.results_url,
        filters_state: data.filters_state || filters_state,
        polling_interval_ms: data.polling_interval_ms || 1000
      };
    } catch (error) {
      console.error(prefix + ' > ОШИБКА: ' + error.message);

      if (error.response && error.response.statusCode === 403) {
        console.error(prefix + ' > 🚫 CloudFront блокирует запрос (403)');
        if (this.debug) {
          console.error(prefix + ' > Ответ:', error.response.body);
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

  async getResults(searchData, cookiesObj, params, airline = null, prefix = '') {
    const { search_id, results_url, filters_state } = searchData;
    console.log(prefix + ' > Ожидание результатов (макс ' + this.maxPollingAttempts + ' попыток)...');

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

        const response = await got.post('https://' + results_url + '/search/v3.2/results', gotOptions);
        const data = response.body[0];

        if (data.last_update_timestamp === 0) {
          console.log(prefix + ' > Загрузка завершена, анализ билетов...');

          // 🔥 ИЗМЕНЕНО: передаем params для формирования ссылки
          const cheapestPrice = this.extractCheapestPriceFromAllTickets(
              data.tickets,
              data.flight_legs,
              params,
              airline,
              prefix
          );

          if (cheapestPrice) {
            return cheapestPrice;
          } else {
            console.log(prefix + ' > Билеты не найдены под заданные фильтры');
            return null;
          }
        }

        if (data.last_update_timestamp) {
          last_update_timestamp = data.last_update_timestamp;
        }

        await this.sleep(this.pollingInterval);
      } catch (error) {
        if (error.response && error.response.statusCode === 304) {
          await this.sleep(this.pollingInterval);
          continue;
        }

        if (attempt >= this.maxPollingAttempts) {
          console.error(prefix + ' > ОШИБКА: Превышено максимальное количество попыток');
          return null;
        }

        await this.sleep(this.pollingInterval);
      } finally {
        if (httpsAgent) {
          try {
            httpsAgent.destroy();
          } catch (e) {}
        }
      }
    }

    console.error(prefix + ' > ОШИБКА: Таймаут ожидания результатов');
    return null;
  }

  // 🔥 ИСПРАВЛЕННАЯ ВЕРСИЯ: возвращаем полные данные билета и proposal
  // 🔥 ИСПРАВЛЕННАЯ ВЕРСИЯ: правильно работаем со структурой response[0]
  extractCheapestPriceFromAllTickets(tickets, flightLegs, params, airline = null, prefix = '') {
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
    console.log(prefix + ' > Найдена минимальная цена: ' + minPrice.toLocaleString('ru-RU') + ' ' + currency);

    // 🔥 ИСПРАВЛЕНО: Собираем flights из flightLegs по segments
    if (bestTicket.segments && flightLegs) {
      // Собираем все flight_legs из всех segments
      const allFlightIndices = [];
      bestTicket.segments.forEach(segment => {
        if (segment.flights && Array.isArray(segment.flights)) {
          allFlightIndices.push(...segment.flights);
        }
      });

      // Получаем flight_legs по индексам
      bestTicket.flights = allFlightIndices
          .map(index => flightLegs[index])
          .filter(flight => flight); // Убираем undefined

    } else {
      bestTicket.flights = [];
    }

    // 🔥 НОВОЕ: Формируем расширенную ссылку
    const enhancedSearchLink = this.buildEnhancedSearchLink(params, bestTicket, bestProposal, minPrice);

    if (enhancedSearchLink) {
      console.log(prefix + ' > 🔗 Сформирована расширенная ссылка');
    }

    return {
      price: minPrice,
      currency: currency,
      ticket_id: bestTicket.id,
      proposal_id: bestProposal.id,
      enhancedSearchLink: enhancedSearchLink
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
    const prefix = '[' + index + '/' + total + ']';

    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const searchPath = pathParts[pathParts.length - 1];

      const match = searchPath.match(/^([A-Z]{3})(\d{4})([A-Z]{3})(\d{4})?(\d)(\d)?(\d)?$/);

      if (!match) {
        throw new Error('Не удалось распарсить URL: ' + searchPath);
      }

      const [, origin, depDate, destination, retDate, adults, children, infants] = match;

      const formatDate = (ddmm) => {
        if (!ddmm || ddmm === '0000') return null;
        const day = ddmm.substring(0, 2);
        const month = ddmm.substring(2, 4);
        const year = new Date().getFullYear();
        return year + '-' + month + '-' + day;
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
      console.log(prefix + ' ========================================');
      console.log(prefix + ' Маршрут: ' + origin + ' -> ' + destination);
      console.log(prefix + ' Вылет: ' + depDateFormatted + (retDateFormatted ? ', Обратно: ' + retDateFormatted : ''));
      console.log(prefix + ' Пассажиры: ' + params.adults + ' взр' + (params.children > 0 ? ', ' + params.children + ' дет' : '') + (params.infants > 0 ? ', ' + params.infants + ' млад' : ''));

      if (airline || max_stops !== null || maxLayoverHours || baggage) {
        const filters = [];
        if (airline) filters.push('авиакомпания ' + airline);
        if (max_stops !== null && max_stops !== 99) filters.push('макс пересадок: ' + max_stops);
        if (maxLayoverHours) filters.push('макс время пересадки: ' + maxLayoverHours + 'ч');
        if (baggage) filters.push('с багажом');
        console.log(prefix + ' Фильтры: ' + filters.join(', '));
      }

      if (this.aviasalesAPI) {
        const aviasalesUrl = this.aviasalesAPI.generateSearchLink(params);
        console.log(prefix + ' Ссылка: ' + aviasalesUrl);
      }

      console.log(prefix + ' ========================================');

      const searchData = await this.startSearch(params, cookiesObj, prefix);

      // 🔥 ИЗМЕНЕНО: передаем params в getResults
      const result = await this.getResults(searchData, cookiesObj, params, airline, prefix);

      if (!result) {
        console.log(prefix + ' РЕЗУЛЬТАТ: Билеты не найдены');
        console.log('');
        return null;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(prefix + ' РЕЗУЛЬТАТ: ' + result.price.toLocaleString('ru-RU') + ' ' + result.currency);
      console.log(prefix + ' Время обработки: ' + elapsed + ' секунд');
      console.log('');

      return {
        price: result.price,
        currency: result.currency,
        enhancedSearchLink: result.enhancedSearchLink // 🔥 НОВОЕ ПОЛЕ
      };
    } catch (error) {
      console.error(prefix + ' КРИТИЧЕСКАЯ ОШИБКА: ' + error.message);
      console.log('');
      return null;
    }
  }

  async getPricesFromUrls(urls, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const total = urls.length;
    const results = new Array(total).fill(null);

    console.log('');
    console.log('========================================');
    console.log('НАЧАЛО ОБРАБОТКИ: ' + total + ' билетов');
    console.log('Размер пачки: ' + this.maxConcurrent);
    console.log('========================================');
    console.log('');

    await this.initProxies();

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

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔄 ПАЧКА ' + (batchIndex + 1) + '/' + totalBatches + ': билеты ' + (batchStart + 1) + '-' + batchEnd);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const batchPromises = [];

      for (let i = 0; i < batchUrls.length; i++) {
        const globalIndex = batchStart + i;
        const workerCookies = this.cookiesList[i % this.cookiesList.length];

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

            console.log('ПРОГРЕСС: Обработано ' + completedCount + ' из ' + total + ' билетов (✅ ' + successCount + ' успешно, ❌ ' + failedCount + ' ошибок)');
            console.log('');

            return result;
          } catch (error) {
            console.error('[' + (globalIndex + 1) + '/' + total + '] КРИТИЧЕСКАЯ ОШИБКА: ' + error.message);
            console.log('');
            results[globalIndex] = null;
            completedCount++;
            failedCount++;
            return null;
          }
        })();

        batchPromises.push(workerPromise);
      }

      console.log('⏳ Ожидание завершения пачки ' + (batchIndex + 1) + '/' + totalBatches + '...\n');
      await Promise.allSettled(batchPromises);
      console.log('\n✅ Пачка ' + (batchIndex + 1) + '/' + totalBatches + ' завершена\n');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('========================================');
    console.log('ОБРАБОТКА ЗАВЕРШЕНА');
    console.log('✅ Успешно: ' + successCount + ' из ' + total);
    console.log('❌ Ошибок: ' + failedCount + ' из ' + total);
    console.log('⏱ Общее время: ' + elapsed + ' секунд');
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