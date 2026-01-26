const puppeteer = require('puppeteer');
const axios = require('axios');
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

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    this.cleanupOldScreenshots();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async setCookie() {
    console.log('Получение куки с aviasales.ru...');

    let browser = null;
    let page = null;

    try {
      browser = await puppeteer.launch({
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
      });

      page = await browser.newPage();

      await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
      );

      await page.goto('https://www.aviasales.ru/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      await this.sleep(3000);

      const pageCookies = await page.cookies();

      const cookiesObj = {};
      pageCookies.forEach(cookie => {
        cookiesObj[cookie.name] = cookie.value;
      });

      cookiesObj.currency = cookiesObj.currency || 'rub';
      cookiesObj.marker = this.marker;

      await page.close();
      await browser.close();

      console.log(`Куки получены: ${Object.keys(cookiesObj).length} штук\n`);

      return cookiesObj;

    } catch (error) {
      console.error('ОШИБКА получения куки:', error.message);

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

    try {
      const response = await axios.post(
          `${this.baseURL}/search/v2/start`,
          requestBody,
          {
            headers: this.getHeaders(cookiesObj),
            timeout: 30000
          }
      );

      const data = response.data;
      console.log(`${prefix}  > Поиск запущен, search_id: ${data.search_id.substring(0, 12)}...`);

      return {
        search_id: data.search_id,
        results_url: data.results_url,
        filters_state: data.filters_state || filters_state,
        polling_interval_ms: data.polling_interval_ms || 1000
      };

    } catch (error) {
      if (error.response) {
        console.error(`${prefix}  > ОШИБКА: HTTP ${error.response.status}`);
      } else {
        console.error(`${prefix}  > ОШИБКА: ${error.message}`);
      }
      throw error;
    }
  }

  async getResults(searchData, cookiesObj, airline = null, prefix = '') {
    const { search_id, results_url, filters_state } = searchData;

    console.log(`${prefix}  > Ожидание результатов (макс ${this.maxPollingAttempts} попыток)...`);

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

        const response = await axios.post(
            `https://${results_url}/search/v3.2/results`,
            requestBody,
            {
              headers: this.getHeaders(cookiesObj),
              timeout: 10000
            }
        );

        const data = response.data[0];

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

        await this.sleep(this.pollingInterval);

      } catch (error) {
        if (error.response && error.response.status === 304) {
          await this.sleep(this.pollingInterval);
          continue;
        }

        if (attempt >= this.maxPollingAttempts) {
          console.error(`${prefix}  > ОШИБКА: Превышено максимальное количество попыток`);
          return null;
        }

        await this.sleep(this.pollingInterval);
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

      // Формируем красивое описание
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

      console.log(`${prefix} ========================================`);

      const searchData = await this.startSearch(params, cookiesObj, prefix);
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
    console.log(`Параллельных потоков: ${this.maxConcurrent}`);
    console.log('========================================');
    console.log('');

    const cookiesObj = await this.setCookie();

    if (!cookiesObj) {
      console.error('КРИТИЧЕСКАЯ ОШИБКА: Не удалось получить куки');
      console.log('');
      return results;
    }

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

        console.log(`ПРОГРЕСС: Обработано ${completedCount} из ${total} билетов`);
        console.log('');

        if (nextUrlIndex < total) {
          const pause = Math.floor(Math.random() * 3000) + 5000;
          await this.sleep(pause);
        }

        return result;
      } catch (error) {
        console.error(`[${index + 1}/${total}] КРИТИЧЕСКАЯ ОШИБКА`);
        console.log('');
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

    console.log('');
    console.log('========================================');
    console.log('ОБРАБОТКА ЗАВЕРШЕНА');
    console.log(`Успешно: ${validResults.length} из ${total}`);
    console.log(`Общее время: ${elapsed} секунд`);
    console.log('========================================');
    console.log('');

    return results;
  }
}

module.exports = AviasalesPricer;