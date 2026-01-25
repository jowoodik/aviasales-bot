const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class AviasalesPricer {
  constructor(debug = false) {
    this.browser = null;
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

  // 🔥 НОВАЯ ФУНКЦИЯ: Получение цены первого билета
  async getFirstPrice(page) {
    return await page.evaluate(() => {
      const prices = document.querySelectorAll('[data-test-id="price"]');
      if (prices.length === 0) return null;

      const firstPrice = prices[0].textContent.trim();
      const num = parseInt(firstPrice.replace(/\D/g, ''));

      return isNaN(num) ? null : num;
    });
  }

  // 🔥 НОВАЯ ФУНКЦИЯ: Ожидание стабилизации цены первого билета
  async waitForPriceStability(page, index, total, checksRequired = 3, checkInterval = 10000) {
    console.log(`[${index}/${total}] 💰 Отслеживание стабилизации цены первого билета...`);
    console.log(`[${index}/${total}] 📊 Параметры: ${checksRequired} проверок по ${checkInterval}мс`);

    let previousPrice = await this.getFirstPrice(page);

    if (previousPrice === null) {
      console.warn(`[${index}/${total}] ⚠️ Первая цена не найдена, жду загрузки...`);
      await this.sleep(checkInterval);
      previousPrice = await this.getFirstPrice(page);

      if (previousPrice === null) {
        throw new Error('Не удалось получить первую цену после ожидания');
      }
    }

    console.log(`[${index}/${total}] 💰 Начальная цена: ${previousPrice.toLocaleString('ru-RU')} ₽`);

    let stableChecks = 0;
    let totalChecks = 0;

    while (stableChecks < checksRequired) {
      await this.sleep(checkInterval);
      totalChecks++;

      const currentPrice = await this.getFirstPrice(page);

      if (currentPrice === null) {
        console.warn(`[${index}/${total}] ⚠️ Проверка ${totalChecks}: цена не найдена, сброс счетчика`);
        stableChecks = 0;
        previousPrice = null;
        continue;
      }

      if (currentPrice === previousPrice) {
        stableChecks++;
        console.log(`[${index}/${total}] ✅ Проверка ${totalChecks}: цена стабильна ${currentPrice.toLocaleString('ru-RU')} ₽ (${stableChecks}/${checksRequired})`);
      } else {
        console.log(`[${index}/${total}] 🔄 Проверка ${totalChecks}: цена изменилась ${previousPrice.toLocaleString('ru-RU')} → ${currentPrice.toLocaleString('ru-RU')} ₽, сброс счетчика`);
        stableChecks = 0;
        previousPrice = currentPrice;
      }
    }

    console.log(`[${index}/${total}] 🎉 Цена стабилизировалась на ${previousPrice.toLocaleString('ru-RU')} ₽ после ${totalChecks} проверок`);
    return previousPrice;
  }

  // 🔥 ФУНКЦИЯ: Сброс сохраненных фильтров
  async resetSavedFilters(page, index, total) {
    console.log(`[${index}/${total}] 🔄 Проверка сохраненных фильтров...`);

    try {
      const informerExists = await Promise.race([
        page.waitForSelector('[data-test-id="saved-filters-informer-container"]', {
          timeout: 5000,
          visible: true
        }).then(() => true),
        this.sleep(5000).then(() => false)
      ]);

      if (!informerExists) {
        console.log(`[${index}/${total}] ✅ Сохраненных фильтров нет`);
        return true;
      }

      console.log(`[${index}/${total}] ⚠️ Обнаружены сохраненные фильтры из прошлого поиска`);

      const resetClicked = await page.evaluate(() => {
        const informer = document.querySelector('[data-test-id="saved-filters-informer-container"]');
        if (!informer) {
          console.log('Информер не найден');
          return false;
        }

        const resetButton = informer.querySelector('button[data-test-id="button"]');
        if (!resetButton) {
          console.log('Кнопка сброса не найдена');
          return false;
        }

        const buttonText = resetButton.textContent.trim();
        console.log(`Найдена кнопка: "${buttonText}"`);

        if (buttonText.includes('Сбросить') || buttonText.includes('Reset')) {
          resetButton.click();
          console.log('✅ Кликнули кнопку сброса');
          return true;
        }

        return false;
      });

      if (!resetClicked) {
        console.warn(`[${index}/${total}] ⚠️ Не удалось кликнуть кнопку сброса`);
        return false;
      }

      console.log(`[${index}/${total}] ✅ Фильтры сброшены, ожидание обновления...`);
      await this.sleep(2000);

      return true;

    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка сброса фильтров:`, error.message);
      return false;
    }
  }

  // 🔥 НОВАЯ ФУНКЦИЯ: Применение фильтра максимального количества пересадок
  async applyMaxStopsFilter(page, maxStops, index, total) {
    console.log(`[${index}/${total}] 🔢 Применение фильтра макс. пересадок: ${maxStops}`);

    try {
      console.log(`[${index}/${total}] 🎯 Выбираю фильтр для ${maxStops} пересадок...`);

      // Формируем селектор и кликаем напрямую по элементу
      const selector = `[data-test-id="set-filter-row-${maxStops}"]`;

      const filterClicked = await page.evaluate((sel, stops) => {
        console.log(`Ищу элемент с селектором: ${sel}`);

        const filterRow = document.querySelector(sel);
        if (!filterRow) {
          console.error(`❌ Фильтр для ${stops} пересадок не найден`);

          // Выводим доступные фильтры для отладки
          const availableFilters = document.querySelectorAll('[data-test-id^="set-filter-row-"]');
          console.log(`📋 Доступные фильтры пересадок:`);
          availableFilters.forEach(f => {
            console.log(`  - ${f.getAttribute('data-test-id')}`);
          });

          return false;
        }

        console.log(`✅ Фильтр найден: ${sel}`);
        console.log(`🖱 Кликаю напрямую по элементу...`);

        // Кликаем прямо по найденному элементу
        filterRow.click();
        console.log(`✅ Клик выполнен для ${stops} пересадок`);

        return true;
      }, selector, maxStops);

      if (!filterClicked) {
        throw new Error(`Не удалось применить фильтр для ${maxStops} пересадок`);
      }

      console.log(`[${index}/${total}] ✅ Фильтр макс. пересадок (${maxStops}) применен`);
      return true;

    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка применения фильтра пересадок:`, error.message);
      return false;
    }
  }

  async applyBaggageFilter(page, index, total) {
    console.log(`[${index}/${total}] 🧳 Применение фильтра багажа (20 кг)...`);
    try {
      const baggageFilterExists = await page.$('[data-test-id="boolean-filter-baggage"]');
      if (!baggageFilterExists) {
        console.warn(`[${index}/${total}] ⚠️ Фильтр багажа не найден на странице`);
        return false;
      }

      const checkboxClicked = await page.evaluate(() => {
        const baggageFilter = document.querySelector('[data-test-id="boolean-filter-baggage"]');
        if (!baggageFilter) {
          console.error('❌ Фильтр багажа не найден');
          return false;
        }

        const checkbox = baggageFilter.querySelector('input[type="checkbox"]');
        if (checkbox) {
          const wasChecked = checkbox.checked;
          console.log(`Найден чекбокс багажа, checked=${wasChecked}`);

          if (!wasChecked) {
            checkbox.click();
            console.log('✅ Кликнули чекбокс багажа');
            return true;
          } else {
            console.log('ℹ️ Чекбокс уже включен');
            return true;
          }
        }

        const label = baggageFilter.querySelector('label');
        if (label) {
          console.log('Кликаю по label чекбокса...');
          label.click();
          return true;
        }

        return false;
      });

      if (!checkboxClicked) {
        throw new Error('Не удалось кликнуть чекбокс багажа');
      }

      console.log(`[${index}/${total}] ✅ Чекбокс "С багажом" активирован`);
      await this.sleep(1000);

      console.log(`[${index}/${total}] 🔍 Жду появления выбора веса багажа...`);
      try {
        await page.waitForSelector('[data-test-id="single-choice-filter-baggage_weight-20"]', {
          timeout: 5000,
          visible: true
        });
        console.log(`[${index}/${total}] ✅ Блок выбора веса появился`);
      } catch (e) {
        console.warn(`[${index}/${total}] ⚠️ Блок выбора веса не появился за 5 сек`);
        const availableFilters = await page.evaluate(() => {
          const filters = document.querySelectorAll('[data-test-id*="baggage"]');
          return Array.from(filters).map(f => f.getAttribute('data-test-id'));
        });
        console.log(`[${index}/${total}] 📋 Доступные фильтры багажа:`, availableFilters);
        return false;
      }

      await this.sleep(500);

      console.log(`[${index}/${total}] 🎯 Выбираю вес багажа 20 кг...`);
      const weightSelected = await page.evaluate(() => {
        const weight20 = document.querySelector('[data-test-id="single-choice-filter-baggage_weight-20"]');
        if (!weight20) {
          console.error('❌ Фильтр веса 20 кг не найден');
          return false;
        }

        const label = weight20.querySelector('label');
        if (label) {
          console.log('✅ Найден label для 20 кг, кликаем...');
          label.click();
          return true;
        }

        const radio = weight20.querySelector('input[type="radio"]');
        if (radio) {
          console.log('✅ Найден radio для 20 кг, кликаем...');
          radio.click();
          return true;
        }

        return false;
      });

      if (!weightSelected) {
        throw new Error('Не удалось выбрать вес багажа 20 кг');
      }

      console.log(`[${index}/${total}] ✅ Вес багажа 20 кг выбран`);
      return true;
    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка применения фильтра багажа:`, error.message);
      return false;
    }
  }

  async setMaxLayoverDuration(page, maxHours, index, total) {
    console.log(`[${index}/${total}] ⏱ Установка макс. времени пересадки: ${maxHours}ч...`);

    try {
      const filterContainer = await page.$('[data-test-id="range-filter-transfers_duration"]');
      if (!filterContainer) {
        console.warn(`[${index}/${total}] ⚠️ Фильтр времени пересадки не найден`);
        return false;
      }

      console.log(`[${index}/${total}] 🎯 Начинаю изменение слайдера drag&drop...`);

      const success = await page.evaluate((targetHours) => {
        console.log('🎯 Начинаем изменение слайдера...');
        const filterContainer = document.querySelector('[data-test-id="range-filter-transfers_duration"]');
        if (!filterContainer) {
          console.error('❌ Контейнер не найден');
          return false;
        }

        console.log('✅ 2. Контейнер найден');

        const slider = filterContainer.querySelector('.rc-slider');
        const maxHandle = slider.querySelector('.rc-slider-handle-2');

        if (!maxHandle) {
          console.error('❌ Правая ручка не найдена');
          return false;
        }

        const oldValue = parseInt(maxHandle.getAttribute('aria-valuenow'));
        const minValue = parseInt(maxHandle.getAttribute('aria-valuemin'));
        const maxValue = parseInt(maxHandle.getAttribute('aria-valuemax'));

        console.log('📊 Текущие значения:');
        console.log(`  Старое значение: ${oldValue} (${Math.floor(oldValue/60)}ч)`);
        console.log(`  Диапазон: ${minValue} - ${maxValue}`);

        const newValue = targetHours * 60;
        console.log(`🎯 Целевое значение: ${targetHours}ч = ${newValue} минут`);

        const range = maxValue - minValue;
        const valueFromMin = newValue - minValue;
        const percentPosition = (valueFromMin / range) * 100;

        console.log(`📐 Процентная позиция: ${percentPosition.toFixed(2)}%`);

        const sliderRect = slider.getBoundingClientRect();
        const handleRect = maxHandle.getBoundingClientRect();
        const newX = sliderRect.left + (sliderRect.width * percentPosition / 100);
        const centerY = sliderRect.top + sliderRect.height / 2;

        console.log(`📍 Координаты: x=${newX.toFixed(0)}, y=${centerY.toFixed(0)}`);

        console.log('🖱 Начинаем драг...');

        const mousedownEvent = new MouseEvent('mousedown', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: handleRect.left + handleRect.width / 2,
          clientY: handleRect.top + handleRect.height / 2,
          buttons: 1
        });
        maxHandle.dispatchEvent(mousedownEvent);

        return new Promise((resolve) => {
          setTimeout(() => {
            const mousemoveEvent = new MouseEvent('mousemove', {
              view: window,
              bubbles: true,
              cancelable: true,
              clientX: newX,
              clientY: centerY,
              buttons: 1
            });
            document.dispatchEvent(mousemoveEvent);

            setTimeout(() => {
              const mouseupEvent = new MouseEvent('mouseup', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: newX,
                clientY: centerY
              });
              document.dispatchEvent(mouseupEvent);

              setTimeout(() => {
                const resultValue = parseInt(maxHandle.getAttribute('aria-valuenow'));
                const resultHours = Math.floor(resultValue / 60);

                console.log('✅ Результат:');
                console.log(`  Старое: ${oldValue} (${Math.floor(oldValue/60)}ч)`);
                console.log(`  Новое: ${resultValue} (${resultHours}ч)`);
                console.log(`  Цель: ${newValue} (${targetHours}ч)`);

                if (Math.abs(resultValue - newValue) <= 60) {
                  console.log('🎉 Значение установлено!');
                  resolve(true);
                } else {
                  console.log('⚠️ Значение не точное, но продолжаем');
                  resolve(true);
                }

                const tag = filterContainer.querySelector('[data-test-id*="text"]');
                if (tag) {
                  console.log(`📝 Текст фильтра: "${tag.textContent.trim()}"`);
                }
              }, 500);
            }, 100);
          }, 100);
        });
      }, maxHours);

      if (!success) {
        console.warn(`[${index}/${total}] ⚠️ Не удалось изменить слайдер`);
        return false;
      }

      console.log(`[${index}/${total}] ✅ Слайдер изменён`);
      return true;
    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка изменения времени пересадки:`, error.message);
      return false;
    }
  }

  async applyAirlineFilter(page, airline, index, total) {
    console.log(`[${index}/${total}] ✈️ Применение фильтра авиакомпании: ${airline}`);

    try {
      console.log(`[${index}/${total}] 🔍 Ищу кнопку "Авиакомпании"...`);

      await page.waitForFunction(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        return buttons.some(btn => btn.textContent.includes('Авиакомпании') || btn.textContent.includes('Airlines'));
      }, { timeout: 10000 });

      const modalOpened = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        const airlineButton = buttons.find(btn =>
            btn.textContent.includes('Авиакомпании') || btn.textContent.includes('Airlines')
        );
        if (airlineButton) {
          airlineButton.click();
          return true;
        }
        return false;
      });

      if (!modalOpened) {
        throw new Error('Не удалось открыть модалку авиакомпаний');
      }

      console.log(`[${index}/${total}] ✅ Модалка открыта, ожидаю загрузки...`);
      await this.sleep(1000);

      console.log(`[${index}/${total}] 🎯 Включаю фильтр авиакомпании ${airline}...`);

      await page.waitForSelector('[data-test-id*="filter"]', { timeout: 5000 });
      await this.sleep(500);

      const checkboxClicked = await page.evaluate((airlineCode) => {
        const filterRow = document.querySelector(`[data-test-id="set-filter-row-${airlineCode}"]`);
        if (filterRow) {
          const checkbox = filterRow.querySelector('input[type="checkbox"]');
          if (checkbox) {
            console.log(`Найден чекбокс для ${airlineCode}, checked=${checkbox.checked}`);
            if (!checkbox.checked) {
              checkbox.click();
              console.log(`Кликнули ${airlineCode}`);
              return true;
            } else {
              console.log(`${airlineCode} уже выбран`);
              return true;
            }
          }
        }
        return false;
      }, airline);

      if (!checkboxClicked) {
        throw new Error(`Чекбокс авиакомпании ${airline} не найден`);
      }

      console.log(`[${index}/${total}] ✅ Чекбокс ${airline} активирован`);

      console.log(`[${index}/${total}] ✅ Фильтрация авиакомпании ${airline} завершена!`);
      return true;

    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка фильтрации авиакомпании:`, error.message);
      throw error;
    }
  }

  async applyPriceSortAscending(page, index, total) {
    console.log(`[${index}/${total}] 💰 Включение сортировки "Самые дешёвые"...`);
    try {
      await page.waitForSelector('[data-test-id="single-choice-filter-sort-price_asc"]', { timeout: 10000 });
      await this.sleep(500);

      const sortClicked = await page.evaluate(() => {
        const sortContainer = document.querySelector('[data-test-id="single-choice-filter-sort-price_asc"]');
        if (!sortContainer) {
          console.error('❌ Контейнер сортировки не найден');
          return false;
        }

        const label = sortContainer.querySelector('label');
        if (!label) {
          console.error('❌ Label не найден');
          return false;
        }

        console.log(`Найден label сортировки, кликаем...`);
        label.click();
        return true;
      });

      if (!sortClicked) {
        throw new Error('Не удалось кликнуть сортировку по цене');
      }

      console.log(`[${index}/${total}] ✅ Сортировка активирована`);
      return true;
    } catch (error) {
      console.error(`[${index}/${total}] ❌ Ошибка сортировки по цене:`, error.message);
      return false;
    }
  }

  async getPriceFromUrl(url, index, total, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
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

    await this.init();
    const page = await this.browser.newPage();
    let screenshotPath = null;

    try {
      await page.evaluateOnNewDocument(() => {
        delete Object.getPrototypeOf(navigator).webdriver;

        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = function(parameters) {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return originalQuery.apply(window.navigator.permissions, parameters);
        };

        window.chrome = { runtime: {} };
        window.chrome.loadTimes = function() {};
        window.chrome.csi = function() {};
        window.chrome.app = {};

        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => ['ru-RU', 'ru', 'en-US', 'en']
        });
      });

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1920, height: 1080 });

      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      });

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

      console.log(`[${index}/${total}] 📄 Загрузка страницы...`);
      const delay = Math.floor(Math.random() * 2000) + 2000;
      console.log(`[${index}/${total}] ⏳ Задержка перед загрузкой: ${delay}мс`);
      await this.sleep(delay);

      console.log(`[${index}/${total}] 🌐 Переход по URL...`);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log(`[${index}/${total}] ✅ HTTP ${response.status()}`);

      if (response.status() === 403 || response.status() >= 500) {
        throw new Error(`HTTP ${response.status()}`);
      }

      console.log(`[${index}/${total}] ⏳ Ожидание выполнения JavaScript...`);
      await this.sleep(5000);

      console.log(`[${index}/${total}] 🔍 Поиск результатов...`);
      await page.waitForSelector('[data-test-id="search-results-items-list"]', {
        timeout: 30000,
        visible: true
      });
      console.log(`[${index}/${total}] ✅ Результаты найдены!`);

      // 🔥 ШАГ 1: СОРТИРОВКА (ПЕРВЫМ ДЕЛОМ!)
      console.log(`[${index}/${total}] 📝 ШАГ 1: Применение сортировки по цене`);
      await this.applyPriceSortAscending(page, index, total);
      await this.sleep(1000);

      // 🔥 ШАГ 2: СБРОС СОХРАНЕННЫХ ФИЛЬТРОВ
      console.log(`[${index}/${total}] 📝 ШАГ 2: Сброс сохраненных фильтров`);
      await this.resetSavedFilters(page, index, total);
      await this.sleep(1000);

      // 🔥 ШАГ 3: ПРИМЕНЕНИЕ ФИЛЬТРОВ (БЕЗ СТАБИЛИЗАЦИИ)
      console.log(`[${index}/${total}] 📝 ШАГ 3: Применение фильтров`);

      // Максимальное количество пересадок
      if (max_stops !== null && max_stops !== undefined && max_stops >= 0) {
        console.log(`[${index}/${total}] 🔧 Фильтр макс. пересадок`);
        await this.applyMaxStopsFilter(page, max_stops, index, total);
        await this.sleep(1000);
      } else {
        console.log(`[${index}/${total}] ⏭ Пропускаю фильтр пересадок`);
      }

      // Багаж
      if (baggage === true || baggage === 1) {
        console.log(`[${index}/${total}] 🔧 Фильтр багажа`);
        await this.applyBaggageFilter(page, index, total);
        await this.sleep(1000);
      } else {
        console.log(`[${index}/${total}] ⏭ Пропускаю фильтр багажа`);
      }

      // Время пересадки
      if (maxLayoverHours !== null && maxLayoverHours !== undefined && maxLayoverHours > 0) {
        console.log(`[${index}/${total}] 🔧 Устанавливаю макс. время пересадки: ${maxLayoverHours}ч`);
        await this.setMaxLayoverDuration(page, maxLayoverHours, index, total);
        await this.sleep(1000);
      } else {
        console.log(`[${index}/${total}] ⏭ Пропускаю настройку времени пересадки`);
      }

      // Авиакомпания
      if (airline) {
        console.log(`[${index}/${total}] 🔧 Фильтр авиакомпании`);
        await this.applyAirlineFilter(page, airline, index, total);
        await this.sleep(1000);
      }

      // 🔥 ШАГ 4: ЕДИНСТВЕННАЯ СТАБИЛИЗАЦИЯ ПЕРЕД ПОЛУЧЕНИЕМ ЦЕНЫ
      console.log(`[${index}/${total}] 📝 ШАГ 4: Ожидание загрузки всех источников цен`);
      await this.waitForPriceStability(page, index, total, 3, 3000);

      // 🔥 ШАГ 5: ПОЛУЧЕНИЕ ФИНАЛЬНОЙ ЦЕНЫ
      console.log(`[${index}/${total}] 💰 Получение финальной цены...`);

      const priceData = await page.evaluate(() => {
        const container = document.querySelector('[data-test-id="search-results-items-list"]');
        if (!container) return { error: 'Контейнер результатов не найден' };

        const prices = container.querySelectorAll('[data-test-id="price"]');
        if (prices.length === 0) return { error: 'Цены не найдены' };

        const firstPrice = prices[0].textContent.trim();
        const num = parseInt(firstPrice.replace(/\D/g, ''));

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

      const timestamp = Date.now();
      screenshotPath = path.join(__dirname, '../temp', `success_${airline || 'all'}_${timestamp}.png`);

      await page.screenshot({
        path: screenshotPath,
        fullPage: false
      });

      console.log(`[${index}/${total}] 💰 Цена: ${priceData.price.toLocaleString('ru-RU')} ₽ (всего ${priceData.totalPrices} вариантов)`);
      console.log(`[${index}/${total}] 📸 Скриншот: ${screenshotPath}`);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${index}/${total}] ✅ ЗАВЕРШЕНО за ${elapsed}с`);

      return {
        price: priceData.price,
        screenshot: screenshotPath
      };

    } catch (error) {
      console.error(`[${index}/${total}] ❌ ОШИБКА:`, error.message);

      try {
        const timestamp = Date.now();
        screenshotPath = path.join(__dirname, '../temp', `error_${airline || 'all'}_${timestamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[${index}/${total}] 📸 Скриншот ошибки: ${screenshotPath}`);
      } catch (e) {
        // ignore
      }

      return null;

    } finally {
      await page.close();
    }
  }

  async getPricesFromUrls(urls, airline = null, maxLayoverHours = null, baggage = false, max_stops = null) {
    const total = urls.length;
    const results = new Array(total).fill(null);

    console.log(`🚀 Начинаю обработку ${total} URL по ${this.maxConcurrent} параллельно`);

    const startTime = Date.now();

    for (let i = 0; i < total; i += this.maxConcurrent) {
      const batch = [];

      for (let j = 0; j < this.maxConcurrent && i + j < total; j++) {
        const index = i + j;
        batch.push(
            this.getPriceFromUrl(urls[index], index + 1, total, airline, maxLayoverHours, baggage, max_stops)
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
        const pause = Math.floor(Math.random() * 3000) + 5000;
        console.log(`⏸ Пауза ${pause}мс перед следующей пачкой...`);
        await this.sleep(pause);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const validResults = results.filter(r => r !== null);
    console.log(`✅ Обработка завершена за ${elapsed}с. Успешно: ${validResults.length}/${total}`);

    return results;
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

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Puppeteer закрыт');
    }
  }
}

module.exports = AviasalesPricer;