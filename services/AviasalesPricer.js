const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class AviasalesPricer {
  constructor(debug = false, marker = '12345') {
    this.maxConcurrent = 2;
    this.debug = debug;
    this.marker = marker;

    // API конфигурация
    this.baseURL = 'https://tickets-api.aviasales.ru';
    this.maxPollingAttempts = 60;
    this.pollingInterval = 1000;

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    this.cleanupOldScreenshots();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 🔥 НОВЫЙ МЕТОД: Установка куки через Puppeteer
  async setCookie() {
    console.log('\n🍪 ========================================');
    console.log('🍪 УСТАНОВКА КУКИ');
    console.log('🍪 ========================================');
    console.log('🌐 Запуск браузера для получения куки...');

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
      console.log('✅ Браузер запущен');

      page = await browser.newPage();

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

  // Форматирование куков в строку
  formatCookies(cookiesObj) {
    return Object.entries(cookiesObj)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
  }

  // Получение заголовков для API
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

  // Запуск поиска через API
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
        min: 55,
        max: maxMinutes
      };
      console.log(`⏱ Макс. время пересадки: ${max_layover_hours}ч`);
    }

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

  // Получение результатов через API
  async getResults(searchData, cookiesObj, airline = null) {
    const { search_id, results_url, filters_state } = searchData;

    console.log('\n⏳ Ожидание результатов (макс 60 сек)...');

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
          console.log('\n✅ Загрузка завершена (last_update_timestamp = 0)');

          const cheapestPrice = this.extractCheapestPriceFromAllTickets(data.tickets, airline);

          if (cheapestPrice) {
            return cheapestPrice;
          } else {
            throw new Error('Загрузка завершена, но билеты не найдены');
          }
        }

        if (data.last_update_timestamp) {
          last_update_timestamp = data.last_update_timestamp;
        }

        if (attempt % 10 === 0) {
          console.log(`\n📊 Промежуточный статус (попытка ${attempt}):`);
          console.log(`   last_update_timestamp: ${data.last_update_timestamp}`);
          console.log(`   tickets: ${data.tickets?.length || 0}`);
          console.log(`   soft_tickets: ${data.soft_tickets?.length || 0}`);
        }

        await this.sleep(this.pollingInterval);

      } catch (error) {
        if (error.response && error.response.status === 304) {
          await this.sleep(this.pollingInterval);
          continue;
        }

        console.error(`❌ Ошибка (попытка ${attempt}):`, error.message);

        if (attempt >= this.maxPollingAttempts) {
          throw error;
        }

        await this.sleep(this.pollingInterval);
      }
    }

    throw new Error('Превышено время ожидания (60 сек)');
  }

  // Извлечение минимальной цены из билетов
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
        if (airline && !this.proposalMatchesAirline(proposal, ticket, airline)) {
          continue;
        }

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

  // Проверка соответствия авиакомпании
  proposalMatchesAirline(proposal, ticket, airline) {
    const segments = ticket.segments || [];

    for (const segment of segments) {
      const flights = segment.flights || [];

      for (const flightId of flights) {
        const flightTerms = proposal.flight_terms?.[flightId];
        if (flightTerms) {
          const carrier = flightTerms.marketing_carrier_designator?.airline_id;
          if (carrier && carrier !== airline) {
            return false;
          }
        }
      }
    }

    return true;
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

  // 🔥 ГИБРИДНЫЙ МЕТОД: получение цены с передачей куки
  async getPriceFromUrl(url, cookiesObj, index, total, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const startTime = Date.now();

    console.log('='.repeat(80));
    console.log(`[${index}/${total}] 🚀 НАЧАЛО ПРОВЕРКИ (ГИБРИДНЫЙ РЕЖИМ)`);
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
      // Парсим URL для извлечения параметров
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const searchPath = pathParts[pathParts.length - 1];

      // 🔥 ИСПРАВЛЕННАЯ РЕГУЛЯРКА: парсим маршрут из пути (например: SVX1003DPS0704410)
      // Формат: ORIGIN(3)DDMM(4)DESTINATION(3)DDMM(4)ADULTS(1)CHILDREN(1)INFANTS(1)
      const match = searchPath.match(/^([A-Z]{3})(\d{4})([A-Z]{3})(\d{4})?(\d)(\d)?(\d)?$/);

      if (!match) {
        throw new Error(`Не удалось распарсить URL: ${searchPath}`);
      }

      const [, origin, depDate, destination, retDate, adults, children, infants] = match;

      // Форматируем даты
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
        max_stops: max_stops,
        max_layover_hours: maxLayoverHours
      };

      console.log(`[${index}/${total}] 📋 Параметры поиска:`, params);

      // 1. Запускаем поиск через API
      const searchData = await this.startSearch(params, cookiesObj);

      // 2. Получаем результаты через API
      const result = await this.getResults(searchData, cookiesObj, airline);

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

  // 🔥 ГЛАВНЫЙ МЕТОД: пакетная проверка с установкой куки один раз
  async getPricesFromUrls(urls, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const total = urls.length;
    const results = new Array(total).fill(null);

    console.log(`🚀 Начинаю обработку ${total} URL по ${this.maxConcurrent} параллельно`);
    console.log('\n🍪 ========================================');
    console.log('🍪 УСТАНОВКА КУКИ ДЛЯ ВСЕЙ ПАЧКИ');
    console.log('🍪 ========================================');

    // 🔥 УСТАНАВЛИВАЕМ КУКУ ОДИН РАЗ ДЛЯ ВСЕЙ ПАЧКИ
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
            cookiesObj, // 🔥 Передаем куку
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