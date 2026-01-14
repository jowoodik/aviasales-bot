const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class PuppeteerPricer {
  constructor(debug = false) {
    this.browser = null;
    this.cache = new Map();
    this.cacheTimeout = 60 * 60 * 1000;
    this.maxConcurrent = 2;
    this.debug = debug;

    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 🔥 ЖЕЛЕЗОБЕТОННЫЙ МЕТОД: Получает snapshot текущих цен
   */
  async getPricesSnapshot(page) {
    return await page.evaluate(() => {
      const prices = document.querySelectorAll('[data-test-id="price"]');
      return Array.from(prices).slice(0, 10).map(p => p.textContent.trim());
    });
  }

  /**
   * 🔥 ЖЕЛЕЗОБЕТОННЫЙ МЕТОД: Сравнивает два snapshot'а
   */
  arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    return arr1.every((val, index) => val === arr2[index]);
  }

  /**
   * 🔥 ЖЕЛЕЗОБЕТОННЫЙ МЕТОД: Ждет изменения списка результатов
   */
  async waitForResultsChange(page, beforeSnapshot, index, total, timeout = 30000) {
    console.log(`[${index}/${total}] ⏳ Ожидание изменения результатов...`);
    console.log(`[${index}/${total}] 📸 Было цен: ${beforeSnapshot.length}`);

    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < timeout) {
      attempts++;
      await this.sleep(500);

      const currentSnapshot = await this.getPricesSnapshot(page);

      // Проверяем, изменились ли результаты
      if (!this.arraysEqual(beforeSnapshot, currentSnapshot) && currentSnapshot.length > 0) {
        console.log(`[${index}/${total}] ✅ Результаты обновились! (попытка ${attempts})`);
        console.log(`[${index}/${total}] 📸 Стало цен: ${currentSnapshot.length}`);
        console.log(`[${index}/${total}] 💰 Новая первая цена: ${currentSnapshot[0]}`);
        return true;
      }

      if (attempts % 10 === 0) {
        console.log(`[${index}/${total}] ⏳ Попытка ${attempts}, жду изменений... (${Math.floor((Date.now() - startTime) / 1000)}с)`);
      }
    }

    console.log(`[${index}/${total}] ⚠️ Timeout: результаты не изменились за ${timeout}мс`);
    return false;
  }

  /**
   * 🔥 ЖЕЛЕЗОБЕТОННЫЙ МЕТОД: Ждет стабилизации результатов
   */
  async waitForStableResults(page, index, total, stabilityTime = 3000) {
    console.log(`[${index}/${total}] ⏳ Ожидание стабилизации результатов...`);

    let previousSnapshot = await this.getPricesSnapshot(page);
    let stableFor = 0;
    const checkInterval = 500;
    let checks = 0;

    while (stableFor < stabilityTime) {
      await this.sleep(checkInterval);
      checks++;

      const currentSnapshot = await this.getPricesSnapshot(page);

      if (this.arraysEqual(previousSnapshot, currentSnapshot) && currentSnapshot.length > 0) {
        stableFor += checkInterval;
      } else {
        stableFor = 0;
        previousSnapshot = currentSnapshot;
        console.log(`[${index}/${total}] 🔄 Результаты еще меняются... (проверка ${checks})`);
      }
    }

    console.log(`[${index}/${total}] ✅ Результаты стабильны (${previousSnapshot.length} элементов, ${checks} проверок)`);
    return previousSnapshot.length;
  }

  /**
   * 🔥 ЖЕЛЕЗОБЕТОННЫЙ МЕТОД: Применяет фильтр авиакомпании
   */
  async applyAirlineFilter(page, airline, index, total) {
    console.log(`[${index}/${total}] ✈️ Применение фильтра: ${airline}`);

    try {
      // 1️⃣ СОХРАНЯЕМ SNAPSHOT ДО КЛИКА
      const beforeSnapshot = await this.getPricesSnapshot(page);
      console.log(`[${index}/${total}] 📸 Запомнили ${beforeSnapshot.length} цен перед кликом`);

      if (beforeSnapshot.length === 0) {
        throw new Error('Нет результатов для фильтрации');
      }

      // 2️⃣ ОТКРЫВАЕМ МОДАЛКУ ФИЛЬТРОВ
      console.log(`[${index}/${total}] 🔍 Ищу кнопку "Авиакомпании"...`);

      // Ждем кнопку с текстом "Авиакомпании"
      await page.waitForFunction(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        return buttons.some(btn =>
          btn.textContent.includes('Авиакомпани') ||
          btn.textContent.includes('авиакомпани')
        );
      }, { timeout: 10000 });

      // Кликаем по кнопке
      const modalOpened = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const airlineButton = buttons.find(btn =>
          btn.textContent.includes('Авиакомпани') ||
          btn.textContent.includes('авиакомпани')
        );

        if (airlineButton) {
          airlineButton.click();
          return true;
        }
        return false;
      });

      if (!modalOpened) {
        throw new Error('Не удалось кликнуть по кнопке "Авиакомпании"');
      }

      console.log(`[${index}/${total}] ✅ Кликнул по "Авиакомпании", жду модалку...`);
      await this.sleep(1000);

      // 3️⃣ ИЩЕМ И КЛИКАЕМ ПО ЧЕКБОКСУ АВИАКОМПАНИИ
      console.log(`[${index}/${total}] 🔍 Ищу чекбокс для ${airline}...`);

      // Ждем появления модалки с фильтрами
      await page.waitForSelector('[data-test-id*="filter"]', { timeout: 5000 });
      await this.sleep(500);

      // Ищем строку с нужной авиакомпанией по data-test-id="set-filter-row-IATA"
      const checkboxClicked = await page.evaluate((airlineCode) => {
        // Ищем по data-test-id="set-filter-row-EY" (например)
        const filterRow = document.querySelector(`[data-test-id="set-filter-row-${airlineCode}"]`);

        if (filterRow) {
          // Ищем чекбокс внутри строки
          const checkbox = filterRow.querySelector('input[type="checkbox"]');
          if (checkbox) {
            console.log(`Найден чекбокс для ${airlineCode}, состояние: ${checkbox.checked}`);
            if (!checkbox.checked) {
              checkbox.click();
              console.log(`Кликнул по чекбоксу ${airlineCode}`);
              return true;
            } else {
              console.log(`Чекбокс ${airlineCode} уже отмечен`);
              return true;
            }
          }
        }

        return false;
      }, airline);

      if (!checkboxClicked) {
        throw new Error(`Не найден чекбокс для ${airline}`);
      }

      console.log(`[${index}/${total}] ✅ Кликнул по чекбоксу ${airline}`);

      // 4️⃣ ЖЕЛЕЗОБЕТОННО ЖДЕМ ИЗМЕНЕНИЯ РЕЗУЛЬТАТОВ
      const changed = await this.waitForResultsChange(page, beforeSnapshot, index, total, 30000);

      if (!changed) {
        throw new Error(`Результаты не изменились после клика по ${airline}`);
      }

      // 5️⃣ ЖДЕМ СТАБИЛИЗАЦИИ
      await this.waitForStableResults(page, index, total, 3000);

      console.log(`[${index}/${total}] ✅ Фильтр ${airline} успешно применен!`);
      return true;

    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка применения фильтра: ${error.message}`);
      throw error;
    }
  }

  async getPriceFromUrl(url, index, total, airline = null) {
    const startTime = Date.now();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${index}/${total}] 🔍 Обработка`);
    console.log(`[${index}/${total}] 🔗 ${url}`);
    if (airline) console.log(`[${index}/${total}] ✈️ Фильтр: ${airline}`);
    console.log(`${'='.repeat(80)}\n`);

    // Кэш
    const cacheKey = `${url}_${airline || 'all'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.cacheTimeout)) {
      console.log(`[${index}/${total}] 💾 Кэш: ${cached.price.toLocaleString('ru-RU')} ₽`);
      return {
        price: cached.price,
        screenshot: cached.screenshot || null
      };
    }

    await this.init();
    const page = await this.browser.newPage();
    let screenshotPath = null;

    try {
      // Защита от детекта
      await page.evaluateOnNewDocument(() => {
        delete Object.getPrototypeOf(navigator).webdriver;

        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = function(parameters) {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery.apply(window.navigator.permissions, [parameters]);
        };

        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };

        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => ['ru-RU', 'ru', 'en-US', 'en']
        });
      });

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });

      // Блокируем капчи и трекеры
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (
          url.includes('recaptcha') ||
          url.includes('google-analytics') ||
          url.includes('googletagmanager') ||
          url.includes('mc.yandex') ||
          url.includes('metrika')
        ) {
          request.abort();
        } else {
          request.continue();
        }
      });

      console.log(`[${index}/${total}] 🔧 Страница настроена`);

      const delay = Math.floor(Math.random() * 2000 + 2000);
      console.log(`[${index}/${total}] ⏳ Задержка ${delay}мс...`);
      await this.sleep(delay);

      console.log(`[${index}/${total}] 🌐 Загрузка страницы...`);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log(`[${index}/${total}] ✅ HTTP ${response.status()}`);
      if (response.status() === 403 || response.status() >= 500) {
        throw new Error(`HTTP ${response.status()}`);
      }

      console.log(`[${index}/${total}] ⏳ Ожидание JavaScript...`);
      await this.sleep(8000);

      console.log(`[${index}/${total}] 🔍 Поиск результатов...`);
      let attempts = 0;
      const maxAttempts = 10;
      let found = false;

      while (attempts < maxAttempts && !found) {
        try {
          await page.waitForSelector('[data-test-id="search-results-items-list"]', {
            timeout: 5000,
            visible: true
          });
          found = true;
          console.log(`[${index}/${total}] ✅ Результаты найдены`);
        } catch (e) {
          attempts++;
          console.log(`[${index}/${total}] ⏳ Попытка ${attempts}/${maxAttempts}...`);
          await this.sleep(2000);
        }
      }

      if (!found) {
        throw new Error('Timeout: результаты не загрузились');
      }

      // 🔥 ЖДЕМ ПЕРВОНАЧАЛЬНОЙ СТАБИЛИЗАЦИИ
      await this.waitForStableResults(page, index, total, 3000);

      // 🔥 ПРИМЕНЯЕМ ФИЛЬТР (ЕСЛИ УКАЗАН)
      if (airline) {
        await this.applyAirlineFilter(page, airline, index, total);
      }

      // Извлекаем цену
      console.log(`[${index}/${total}] 💰 Извлечение цены...`);
      const priceData = await page.evaluate(() => {
        const container = document.querySelector('[data-test-id="search-results-items-list"]');
        if (!container) {
          return { error: 'Контейнер не найден' };
        }

        const prices = container.querySelectorAll('[data-test-id="price"]');
        if (prices.length === 0) {
          return { error: 'Цены не найдены' };
        }

        const firstPrice = prices[0].textContent.trim();
        const num = parseInt(firstPrice.replace(/[^\d]/g, ''));

        if (isNaN(num) || num < 1000 || num > 10000000) {
          return { error: `Некорректная цена: ${firstPrice}` };
        }

        return {
          price: num,
          totalPrices: prices.length,
          rawText: firstPrice
        };
      });

      if (priceData.error) {
        throw new Error(priceData.error);
      }

      // 📸 СКРИНШОТ ПРИ УСПЕХЕ
      const timestamp = Date.now();
      screenshotPath = path.join(__dirname, '../temp', `success_${airline || 'all'}_${timestamp}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
        clip: { x: 0, y: 0, width: 1200, height: 800 }
      });

      console.log(`[${index}/${total}] ✅ ${priceData.price.toLocaleString('ru-RU')} ₽ (найдено ${priceData.totalPrices} цен)`);
      console.log(`[${index}/${total}] 📸 ${screenshotPath}`);

      // Сохраняем в кэш
      this.cache.set(cacheKey, {
        price: priceData.price,
        screenshot: screenshotPath,
        timestamp: Date.now()
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${index}/${total}] ⏱️ ${elapsed} сек`);

      return {
        price: priceData.price,
        screenshot: screenshotPath
      };

    } catch (error) {
      console.error(`[${index}/${total}] ❌ ${error.message}`);

      try {
        const timestamp = Date.now();
        screenshotPath = path.join(__dirname, '../temp', `error_${airline || 'all'}_${timestamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[${index}/${total}] 📸 ${screenshotPath}`);
      } catch (e) {}

      return null;
    } finally {
      await page.close();
    }
  }

  async init() {
    if (this.browser) return;
    console.log('🚀 Запуск Puppeteer...');

    this.browser = await puppeteer.launch({
      headless: !this.debug,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      ignoreHTTPSErrors: true,
      dumpio: this.debug
    });

    console.log('✅ Puppeteer запущен');
  }

  async getPricesFromUrls(urls, airline = null) {
    const total = urls.length;
    const results = new Array(total).fill(null);
    console.log(`\n📊 Парсинг ${total} URL (по ${this.maxConcurrent} одновременно)\n`);

    const startTime = Date.now();

    for (let i = 0; i < total; i += this.maxConcurrent) {
      const batch = [];
      for (let j = 0; j < this.maxConcurrent && (i + j) < total; j++) {
        const index = i + j;
        batch.push(
          this.getPriceFromUrl(urls[index], index + 1, total, airline)
            .then(result => {
              results[index] = result;
              return result;
            })
            .catch(error => {
              results[index] = null;
              return null;
            })
        );
      }

      await Promise.all(batch);

      if (i + this.maxConcurrent < total) {
        const pause = Math.floor(Math.random() * 3000 + 5000);
        console.log(`\n⏸️ Пауза ${pause}мс...\n`);
        await this.sleep(pause);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validResults = results.filter(r => r !== null);
    console.log(`\n✅ Завершено: ${elapsed} сек. Успешно: ${validResults.length}/${total}\n`);

    return results;
  }

  cleanCache() {
    const now = Date.now();
    let removed = 0;

    for (const [url, data] of this.cache.entries()) {
      if (now - data.timestamp > this.cacheTimeout) {
        this.cache.delete(url);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`🧹 Очищено ${removed} записей кэша`);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🌐 Puppeteer закрыт');
    }
  }
}

module.exports = PuppeteerPricer;
