// scripts/importAirportsAdvanced.js

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');
const fs = require('fs').promises;

class AdvancedAirportImporter {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/bot.db');
        this.db = new sqlite3.Database(this.dbPath);

        // Кэши для данных
        this.citiesCache = new Map(); // city_code -> city_data
        this.countriesCache = new Map(); // country_code -> country_data
    }

    async run() {
        console.log('🚀 Запуск продвинутого импорта аэропортов...\n');
        try {
            // 1. Загружаем справочники
            console.log('📚 Загружаю справочники...');
            await this.loadReferenceData();

            // 2. Загружаем и обрабатываем аэропорты
            console.log('\n✈️ Загружаю данные аэропортов...');
            const airports = await this.loadAirportsData();
            console.log(`✅ Получено ${airports.length} аэропортов`);

            // 3. Обрабатываем каждый аэропорт
            console.log('\n🔄 Обрабатываю аэропорты...');
            const processedAirports = this.processAirports(airports);
            console.log(`✅ Обработано ${processedAirports.length} аэропортов`);

            // 4. Сохраняем в базу
            console.log('\n💾 Сохраняю в базу данных...');
            await this.saveToDatabase(processedAirports);

            // 5. 🔥 НОВОЕ: Добавляем ВСЕ города из справочника
            console.log('\n🏙️ Добавляю города из справочника...');
            await this.addAllCitiesToDatabase();

            // 6. Проверяем результат
            await this.verifyResults();

            console.log('\n🎉 Импорт успешно завершен!');
        } catch (error) {
            console.error('\n💥 Ошибка импорта:', error.message);
            console.error(error.stack);
        } finally {
            this.db.close();
        }
    }

    /**
     * Загрузка справочных данных (города, страны)
     */
    async loadReferenceData() {
        try {
            // Загружаем города
            console.log('🏙️ Загружаю данные городов...');
            const citiesResponse = await axios.get(
                'https://api.travelpayouts.com/data/ru/cities.json',
                { timeout: 15000 }
            );

            for (const city of citiesResponse.data) {
                if (city.code && city.name) {
                    this.citiesCache.set(city.code.toUpperCase(), {
                        code: city.code,
                        name: city.name,
                        name_en: city.name_translations?.en || city.name,
                        country_code: city.country_code,
                        timezone: city.time_zone,
                        coordinates: city.coordinates,
                        has_flightable_airport: city.has_flightable_airport || false
                    });
                }
            }

            console.log(`✅ Загружено ${this.citiesCache.size} городов`);

            // Загружаем страны
            console.log('🌍 Загружаю данные стран...');
            const countriesResponse = await axios.get(
                'https://api.travelpayouts.com/data/ru/countries.json',
                { timeout: 15000 }
            );

            for (const country of countriesResponse.data) {
                if (country.code && country.name) {
                    this.countriesCache.set(country.code.toUpperCase(), {
                        code: country.code,
                        name: country.name,
                        currency: country.currency
                    });
                }
            }

            console.log(`✅ Загружено ${this.countriesCache.size} стран`);
        } catch (error) {
            console.warn('⚠️ Не удалось загрузить справочники:', error.message);
            console.warn('🔄 Использую локальные справочники...');
            await this.loadLocalReferenceData();
        }
    }

    /**
     * Локальные справочные данные (резервные)
     */
    async loadLocalReferenceData() {
        // Локальный маппинг городов
        const localCities = {
            'MOW': { name: 'Москва', name_en: 'Moscow', country_code: 'RU' },
            'LED': { name: 'Санкт-Петербург', name_en: 'Saint Petersburg', country_code: 'RU' },
            'SVX': { name: 'Екатеринбург', name_en: 'Yekaterinburg', country_code: 'RU' },
            'KZN': { name: 'Казань', name_en: 'Kazan', country_code: 'RU' },
            'UFA': { name: 'Уфа', name_en: 'Ufa', country_code: 'RU' },
            'ROV': { name: 'Ростов-на-Дону', name_en: 'Rostov-on-Don', country_code: 'RU' },
            'AER': { name: 'Сочи', name_en: 'Sochi', country_code: 'RU' },
            'OVB': { name: 'Новосибирск', name_en: 'Novosibirsk', country_code: 'RU' },
            'GOJ': { name: 'Нижний Новгород', name_en: 'Nizhny Novgorod', country_code: 'RU' },
            'KRR': { name: 'Краснодар', name_en: 'Krasnodar', country_code: 'RU' },
            'KJA': { name: 'Красноярск', name_en: 'Krasnoyarsk', country_code: 'RU' },
            // Международные
            'IST': { name: 'Стамбул', name_en: 'Istanbul', country_code: 'TR' },
            'SAW': { name: 'Стамбул', name_en: 'Istanbul', country_code: 'TR' },
            'DXB': { name: 'Дубай', name_en: 'Dubai', country_code: 'AE' },
            'AUH': { name: 'Абу-Даби', name_en: 'Abu Dhabi', country_code: 'AE' },
            'BKK': { name: 'Бангкок', name_en: 'Bangkok', country_code: 'TH' },
            'DMK': { name: 'Бангкок', name_en: 'Bangkok', country_code: 'TH' },
            'SIN': { name: 'Сингапур', name_en: 'Singapore', country_code: 'SG' },
            'HKG': { name: 'Гонконг', name_en: 'Hong Kong', country_code: 'CN' },
            'DEL': { name: 'Дели', name_en: 'Delhi', country_code: 'IN' },
            'BOM': { name: 'Мумбаи', name_en: 'Mumbai', country_code: 'IN' },
            'TYO': { name: 'Токио', name_en: 'Tokyo', country_code: 'JP' },
        };

        // Локальный маппинг стран
        const localCountries = {
            'RU': { name: 'Россия', currency: 'RUB' },
            'TR': { name: 'Турция', currency: 'TRY' },
            'AE': { name: 'ОАЭ', currency: 'AED' },
            'TH': { name: 'Таиланд', currency: 'THB' },
            'SG': { name: 'Сингапур', currency: 'SGD' },
            'CN': { name: 'Китай', currency: 'CNY' },
            'IN': { name: 'Индия', currency: 'INR' },
            'US': { name: 'США', currency: 'USD' },
            'GB': { name: 'Великобритания', currency: 'GBP' },
            'DE': { name: 'Германия', currency: 'EUR' },
            'FR': { name: 'Франция', currency: 'EUR' },
            'ES': { name: 'Испания', currency: 'EUR' },
            'IT': { name: 'Италия', currency: 'EUR' },
            'GR': { name: 'Греция', currency: 'EUR' },
            'CY': { name: 'Кипр', currency: 'EUR' },
            'EG': { name: 'Египет', currency: 'EGP' },
            'VN': { name: 'Вьетнам', currency: 'VND' },
            'ID': { name: 'Индонезия', currency: 'IDR' },
            'MY': { name: 'Малайзия', currency: 'MYR' },
            'JP': { name: 'Япония', currency: 'JPY' },
        };

        // Загружаем в кэш
        Object.entries(localCities).forEach(([code, data]) => {
            this.citiesCache.set(code, data);
        });

        Object.entries(localCountries).forEach(([code, data]) => {
            this.countriesCache.set(code, data);
        });

        console.log(`✅ Загружено ${this.citiesCache.size} городов и ${this.countriesCache.size} стран из локального кэша`);
    }

    /**
     * Загрузка данных аэропортов
     */
    async loadAirportsData() {
        try {
            const response = await axios.get(
                'https://api.travelpayouts.com/data/ru/airports.json',
                { timeout: 20000 }
            );
            return response.data;
        } catch (error) {
            console.error('❌ Ошибка загрузки аэропортов:', error.message);
            throw error;
        }
    }

    /**
     * Обработка аэропортов
     */
    processAirports(airports) {
        const processed = [];
        const skipped = [];

        // Список популярных аэропортов
        const popularAirports = new Set([
            // Россия (топ 30)
            'SVO', 'DME', 'VKO', 'LED', 'SVX', 'KZN', 'AER', 'ROV', 'OVB', 'UFA',
            'GOJ', 'KRR', 'MRV', 'AAQ', 'KEJ', 'RTW', 'STW', 'SCW', 'PKC', 'MCX',
            'CEK', 'MJZ', 'NNM', 'NOZ', 'NJC', 'NYM', 'NUX', 'NYA', 'OMS', 'PEE',
            'KJA', 'KCY', // Красноярск
            // Международные (топ 40)
            'IST', 'SAW', 'ESB', 'ADB', 'AYT', 'DLM', 'BJV', 'GZP', 'DXB', 'AUH',
            'SHJ', 'DWC', 'RKT', 'BKK', 'DMK', 'HKT', 'CNX', 'SIN', 'KUL', 'CGK',
            'DPS', 'HKG', 'PEK', 'PVG', 'CAN', 'SZX', 'CTU', 'XIY', 'CKG', 'TAO',
            'DEL', 'BOM', 'MAA', 'BLR', 'CCU', 'HYD', 'AMD', 'COK', 'GOI', 'TRV',
            'JFK', 'LAX', 'ORD', 'DFW', 'DEN', 'SFO', 'LAS', 'SEA', 'MIA', 'ATL',
            'LHR', 'LGW', 'STN', 'MAN', 'BHX', 'GLA', 'EDI', 'LTN', 'NCL', 'BRS',
            'CDG', 'ORY', 'NCE', 'MRS', 'LYS', 'TLS', 'BOD', 'LIL', 'SXB', 'MPL',
            'FRA', 'MUC', 'HAM', 'STR', 'DUS', 'CGN', 'LEJ', 'BRE', 'HAJ', 'NUE',
            'AMS', 'EIN', 'GRQ', 'MST', 'RTM', 'BRU', 'CRL', 'ANR', 'LGG', 'OST',
            'NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS', 'OKA', 'KMI'
        ]);

        airports.forEach((airport, index) => {
            try {
                // Проверяем обязательные поля
                if (!airport.code || !airport.name) {
                    skipped.push({ code: airport.code, reason: 'Нет кода или названия' });
                    return;
                }

                // Проверяем тип (только аэропорты)
                if (airport.iata_type !== 'airport') {
                    skipped.push({ code: airport.code, reason: `Не аэропорт: ${airport.iata_type}` });
                    return;
                }

                // Проверяем IATA код
                const iataCode = airport.code.trim().toUpperCase();
                if (!/^[A-Z]{3}$/.test(iataCode)) {
                    skipped.push({ code: iataCode, reason: 'Невалидный IATA код' });
                    return;
                }

                // Определяем город
                let cityData = this.getCityData(airport, iataCode);

                // Определяем страну
                let countryData = this.getCountryData(airport, cityData);

                // Определяем дополнительные параметры
                const isPopular = popularAirports.has(iataCode);
                const region = countryData.code === 'RU' ? 'russia' : 'international';
                const displayOrder = isPopular ? this.getDisplayOrder(iataCode) : 0;
                const isInternational = countryData.code !== 'RU' ? 1 : 0;

                // Формируем объект для сохранения
                processed.push({
                    // Основные данные
                    iata_code: iataCode,
                    icao_code: null,
                    airport_name: airport.name.trim(),
                    airport_name_en: airport.name_translations?.en || null,

                    // Город
                    city_code: airport.city_code ? airport.city_code.toUpperCase() : null,
                    city_name: cityData.name,
                    city_name_en: cityData.name_en || null,

                    // Страна
                    country_code: countryData.code,
                    country_name: countryData.name,

                    // Географические данные
                    latitude: airport.coordinates?.lat || null,
                    longitude: airport.coordinates?.lon || null,
                    timezone: airport.time_zone || cityData.timezone || 'UTC',
                    altitude: null,

                    // Классификация
                    airport_type: airport.iata_type || 'airport',
                    is_major: 1,
                    is_popular: isPopular ? 1 : 0,
                    is_international: isInternational,
                    display_order: displayOrder,
                    region: region,

                    // Служебные
                    source: 'travelpayouts',

                    // Исходные данные для отладки
                    raw_data: JSON.stringify({
                        flightable: airport.flightable,
                        coordinates: airport.coordinates,
                        name_translations: airport.name_translations
                    })
                });

            } catch (error) {
                skipped.push({
                    code: airport.code,
                    reason: `Ошибка обработки: ${error.message}`
                });
            }

            // Прогресс
            if (processed.length % 500 === 0) {
                console.log(`  📊 Обработано: ${processed.length}...`);
            }
        });

        // Выводим статистику
        console.log(`\n📊 Статистика обработки:`);
        console.log(`  ✅ Успешно: ${processed.length}`);
        console.log(`  ❌ Пропущено: ${skipped.length}`);

        if (skipped.length > 0) {
            console.log('\n📝 Причины пропуска (первые 10):');
            skipped.slice(0, 10).forEach(item => {
                console.log(`  - ${item.code}: ${item.reason}`);
            });
        }

        return processed;
    }

    /**
     * Получить данные города
     */
    getCityData(airport, iataCode) {
        // Пробуем найти город по city_code
        if (airport.city_code) {
            const cityCode = airport.city_code.toUpperCase();
            const city = this.citiesCache.get(cityCode);
            if (city) {
                return {
                    name: city.name,
                    name_en: city.name_en,
                    timezone: city.timezone,
                    country_code: city.country_code
                };
            }
        }

        // Резервный маппинг по IATA коду аэропорта
        const cityByAirportCode = this.getCityByAirportCode(iataCode);
        if (cityByAirportCode) {
            return cityByAirportCode;
        }

        // Пытаемся извлечь из названия аэропорта
        const extractedCity = this.extractCityFromAirportName(airport.name);
        if (extractedCity) {
            return {
                name: extractedCity,
                name_en: null,
                timezone: 'UTC',
                country_code: airport.country_code || 'XX'
            };
        }

        // Запасной вариант
        return {
            name: 'Неизвестно',
            name_en: 'Unknown',
            timezone: 'UTC',
            country_code: airport.country_code || 'XX'
        };
    }

    /**
     * Получить город по коду аэропорта (резервный маппинг)
     */
    getCityByAirportCode(iataCode) {
        const airportToCityMap = {
            // Россия
            'SVO': { name: 'Москва', name_en: 'Moscow', country_code: 'RU' },
            'DME': { name: 'Москва', name_en: 'Moscow', country_code: 'RU' },
            'VKO': { name: 'Москва', name_en: 'Moscow', country_code: 'RU' },
            'LED': { name: 'Санкт-Петербург', name_en: 'Saint Petersburg', country_code: 'RU' },
            'SVX': { name: 'Екатеринбург', name_en: 'Yekaterinburg', country_code: 'RU' },
            'KZN': { name: 'Казань', name_en: 'Kazan', country_code: 'RU' },
            'AER': { name: 'Сочи', name_en: 'Sochi', country_code: 'RU' },
            'ROV': { name: 'Ростов-на-Дону', name_en: 'Rostov-on-Don', country_code: 'RU' },
            'OVB': { name: 'Новосибирск', name_en: 'Novosibirsk', country_code: 'RU' },
            'UFA': { name: 'Уфа', name_en: 'Ufa', country_code: 'RU' },
            'KJA': { name: 'Красноярск', name_en: 'Krasnoyarsk', country_code: 'RU' },
            'KCY': { name: 'Красноярск', name_en: 'Krasnoyarsk', country_code: 'RU' },
            // Международные
            'IST': { name: 'Стамбул', name_en: 'Istanbul', country_code: 'TR' },
            'DXB': { name: 'Дубай', name_en: 'Dubai', country_code: 'AE' },
            'BKK': { name: 'Бангкок', name_en: 'Bangkok', country_code: 'TH' },
            'SIN': { name: 'Сингапур', name_en: 'Singapore', country_code: 'SG' },
            'HKG': { name: 'Гонконг', name_en: 'Hong Kong', country_code: 'CN' },
            'DEL': { name: 'Дели', name_en: 'Delhi', country_code: 'IN' },
        };
        return airportToCityMap[iataCode];
    }

    /**
     * Извлечь город из названия аэропорта
     */
    extractCityFromAirportName(airportName) {
        // Убираем лишние слова
        const cleaned = airportName
            .replace(/аэропорт\s*/gi, '')
            .replace(/международный\s*/gi, '')
            .replace(/airport\s*/gi, '')
            .replace(/international\s*/gi, '')
            .replace(/имени\s+[А-Я][а-я]+\s*/gi, '')
            .replace(/им\.\s*[А-Я][а-я]+\s*/gi, '')
            .trim();

        // Берем первое слово как город
        const words = cleaned.split(/\s+/);
        if (words.length > 0 && words[0].length > 1) {
            return words[0];
        }

        return null;
    }

    /**
     * Получить данные страны
     */
    getCountryData(airport, cityData) {
        // Сначала пробуем из аэропорта
        if (airport.country_code) {
            const countryCode = airport.country_code.toUpperCase();
            const country = this.countriesCache.get(countryCode);
            if (country) {
                return {
                    code: countryCode,
                    name: country.name
                };
            }
        }

        // Потом из города
        if (cityData.country_code) {
            const countryCode = cityData.country_code.toUpperCase();
            const country = this.countriesCache.get(countryCode);
            if (country) {
                return {
                    code: countryCode,
                    name: country.name
                };
            }
        }

        // Запасной вариант
        const countryCode = airport.country_code || 'XX';
        return {
            code: countryCode,
            name: this.getCountryNameByCode(countryCode)
        };
    }

    /**
     * Название страны по коду (запасной вариант)
     */
    getCountryNameByCode(countryCode) {
        const countryMap = {
            'RU': 'Россия', 'TR': 'Турция', 'AE': 'ОАЭ', 'TH': 'Таиланд',
            'SG': 'Сингапур', 'CN': 'Китай', 'IN': 'Индия', 'US': 'США',
            'GB': 'Великобритания', 'DE': 'Германия', 'FR': 'Франция',
            'ES': 'Испания', 'IT': 'Италия', 'GR': 'Греция', 'CY': 'Кипр',
            'EG': 'Египет', 'VN': 'Вьетнам', 'ID': 'Индонезия', 'MY': 'Малайзия',
            'KZ': 'Казахстан', 'BY': 'Беларусь', 'UA': 'Украина', 'AZ': 'Азербайджан',
            'AM': 'Армения', 'GE': 'Грузия', 'UZ': 'Узбекистан', 'KR': 'Южная Корея',
            'JP': 'Япония', 'CA': 'Канада', 'AU': 'Австралия', 'BR': 'Бразилия',
            'MX': 'Мексика'
        };
        return countryMap[countryCode] || countryCode;
    }

    /**
     * Порядок отображения для популярных аэропортов
     */
    getDisplayOrder(iataCode) {
        const orderMap = {
            // Россия
            'SVO': 1, 'DME': 2, 'VKO': 3, 'LED': 4, 'SVX': 5,
            'KZN': 6, 'AER': 7, 'ROV': 8, 'OVB': 9, 'UFA': 10,
            'KJA': 11, 'KCY': 12,
            // Международные
            'IST': 1, 'SAW': 2, 'DXB': 3, 'AUH': 4, 'BKK': 5,
            'DMK': 6, 'SIN': 7, 'HKG': 8, 'DEL': 9, 'BOM': 10,
            'JFK': 11, 'LAX': 12, 'CDG': 13, 'LHR': 14, 'FRA': 15
        };
        return orderMap[iataCode] || 99;
    }

    /**
     * Сохранение в базу данных
     */
    async saveToDatabase(airports) {
        // Сначала обновляем структуру таблицы
        await this.updateTableSchema();

        // Очищаем таблицу
        console.log('🗑️ Очищаю таблицу airports...');
        await this.runQuery('DELETE FROM airports');

        // Вставляем данные пачками
        const batchSize = 100;
        let inserted = 0;

        for (let i = 0; i < airports.length; i += batchSize) {
            const batch = airports.slice(i, i + batchSize);

            try {
                // Начинаем транзакцию
                await this.runQuery('BEGIN TRANSACTION');

                for (const airport of batch) {
                    try {
                        await this.insertAirport(airport);
                        inserted++;
                    } catch (error) {
                        // Пропускаем дубликаты
                        if (!error.message.includes('UNIQUE constraint failed')) {
                            console.warn(`⚠️ Ошибка вставки ${airport.iata_code}: ${error.message}`);
                        }
                    }
                }

                // Коммитим транзакцию
                await this.runQuery('COMMIT');

                // Выводим прогресс
                if (inserted % 500 === 0) {
                    console.log(`  📊 Сохранено: ${inserted} аэропортов...`);
                }

            } catch (error) {
                await this.runQuery('ROLLBACK');
                console.error(`💥 Ошибка транзакции: ${error.message}`);
            }
        }

        console.log(`\n✅ Сохранено ${inserted} аэропортов`);
    }

    /**
     * 🔥 НОВАЯ ФУНКЦИЯ: Добавление ВСЕХ городов из справочника
     */
    async addAllCitiesToDatabase() {
        console.log(`📊 Всего городов в справочнике: ${this.citiesCache.size}`);

        // Популярные города России
        const popularRussianCities = new Set([
            'MOW', 'LED', 'SVX', 'KZN', 'AER', 'ROV', 'OVB', 'UFA', 'GOJ', 'KRR',
            'KJA', 'SCW', 'STW', 'RTW', 'MRV', 'VOG', 'ASF', 'PEE', 'OMS', 'KEJ'
        ]);

        // Популярные международные города
        const popularInternationalCities = new Set([
            'IST', 'DXB', 'AUH', 'BKK', 'SIN', 'HKG', 'DEL', 'BOM',
            'JFK', 'LAX', 'LHR', 'CDG', 'FRA', 'AMS', 'FCO', 'MAD',
            'BCN', 'ATH', 'LCA', 'HER', 'SSH', 'AYT', 'DLM', 'BJV'
        ]);

        let inserted = 0;
        let skipped = 0;

        await this.runQuery('BEGIN TRANSACTION');

        for (const [cityCode, cityData] of this.citiesCache.entries()) {
            // Пропускаем города без возможности полетов
            if (!cityData.has_flightable_airport) {
                skipped++;
                continue;
            }

            try {
                // Определяем страну
                const countryData = this.countriesCache.get(cityData.country_code) || {
                    name: this.getCountryNameByCode(cityData.country_code)
                };

                // Определяем параметры
                const isRussia = cityData.country_code === 'RU';
                const isPopular = popularRussianCities.has(cityCode) || popularInternationalCities.has(cityCode);
                const region = isRussia ? 'russia' : 'international';
                const displayOrder = this.getCityDisplayOrder(cityCode, isRussia);

                await this.insertCity({
                    city_code: cityCode,
                    city_name: cityData.name,
                    city_name_en: cityData.name_en,
                    country_code: cityData.country_code,
                    country_name: countryData.name,
                    timezone: cityData.timezone || 'UTC',
                    latitude: cityData.coordinates?.lat || null,
                    longitude: cityData.coordinates?.lon || null,
                    is_popular: isPopular ? 1 : 0,
                    is_international: isRussia ? 0 : 1,
                    display_order: displayOrder,
                    region: region
                });

                inserted++;

                if (inserted % 100 === 0) {
                    console.log(`  📊 Добавлено городов: ${inserted}...`);
                }

            } catch (error) {
                if (!error.message.includes('UNIQUE constraint failed')) {
                    console.warn(`⚠️ Ошибка вставки города ${cityCode}: ${error.message}`);
                }
            }
        }

        await this.runQuery('COMMIT');

        console.log(`✅ Добавлено ${inserted} городов`);
        console.log(`⏭️ Пропущено ${skipped} городов без аэропортов`);
    }

    /**
     * Порядок отображения для городов
     */
    getCityDisplayOrder(cityCode, isRussia) {
        if (isRussia) {
            const russianOrder = {
                'MOW': 1, 'LED': 2, 'SVX': 3, 'KZN': 4, 'AER': 5,
                'ROV': 6, 'OVB': 7, 'UFA': 8, 'GOJ': 9, 'KRR': 10,
                'KJA': 11
            };
            return russianOrder[cityCode] || 50;
        } else {
            const intOrder = {
                'IST': 1, 'DXB': 2, 'AUH': 3, 'BKK': 4, 'SIN': 5,
                'HKG': 6, 'DEL': 7, 'BOM': 8, 'LHR': 9, 'CDG': 10
            };
            return intOrder[cityCode] || 50;
        }
    }

    /**
     * Вставка города как отдельной записи
     */
    async insertCity(city) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO airports (
                    iata_code, airport_name, airport_name_lower, airport_name_en,
                    city_code, city_name, city_name_lower, city_name_en,
                    country_code, country_name, country_name_lower,
                    latitude, longitude, timezone,
                    airport_type, is_major, is_popular, is_international,
                    display_order, region, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const displayName = `${city.city_name} (любой аэропорт)`;
            const displayNameEn = city.city_name_en ? `${city.city_name_en} (any airport)` : null;

            this.db.run(sql, [
                city.city_code,
                displayName,
                displayName.toLowerCase(),
                displayNameEn,
                city.city_code,
                city.city_name,
                city.city_name.toLowerCase(),
                city.city_name_en,
                city.country_code,
                city.country_name,
                city.country_name.toLowerCase(),
                city.latitude,
                city.longitude,
                city.timezone,
                'city', // 🔥 Тип = city
                1,
                city.is_popular,
                city.is_international,
                city.display_order,
                city.region,
                'travelpayouts_city',
                new Date().toISOString()
            ], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Обновление структуры таблицы
     */
    async updateTableSchema() {
        console.log('🔧 Проверяю структуру таблицы...');

        const columns = [
            'airport_name_en TEXT',
            'city_code TEXT',
            'city_name_en TEXT',
            'is_international INTEGER DEFAULT 0',
            'altitude INTEGER',
            'airport_type TEXT',
            'source TEXT'
        ];

        for (const columnDef of columns) {
            const columnName = columnDef.split(' ')[0];
            try {
                await this.runQuery(`ALTER TABLE airports ADD COLUMN ${columnDef}`);
                console.log(`  ✅ Добавлена колонка: ${columnName}`);
            } catch (error) {
                if (!error.message.includes('duplicate column')) {
                    console.warn(`  ⚠️ Ошибка добавления ${columnName}: ${error.message}`);
                }
            }
        }
    }

    /**
     * Вставка одного аэропорта
     */
    async insertAirport(airport) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO airports (
                    iata_code, icao_code, airport_name, airport_name_lower, airport_name_en,
                    city_code, city_name, city_name_lower, city_name_en,
                    country_code, country_name, country_name_lower,
                    latitude, longitude, timezone, altitude,
                    airport_type, is_major, is_popular, is_international,
                    display_order, region, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.db.run(sql, [
                airport.iata_code,
                airport.icao_code,
                airport.airport_name,
                airport.airport_name.toLowerCase(),
                airport.airport_name_en,
                airport.city_code,
                airport.city_name,
                airport.city_name.toLowerCase(),
                airport.city_name_en,
                airport.country_code,
                airport.country_name,
                airport.country_name.toLowerCase(),
                airport.latitude,
                airport.longitude,
                airport.timezone,
                airport.altitude,
                airport.airport_type,
                airport.is_major,
                airport.is_popular,
                airport.is_international,
                airport.display_order,
                airport.region,
                airport.source,
                new Date().toISOString()
            ], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Проверка результатов
     */
    async verifyResults() {
        console.log('\n🔍 Проверяю результаты импорта...');

        try {
            // Общая статистика
            const stats = await this.runQueryGet(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN region = 'russia' THEN 1 ELSE 0 END) as russia,
                    SUM(CASE WHEN region = 'international' THEN 1 ELSE 0 END) as international,
                    SUM(is_popular) as popular,
                    SUM(CASE WHEN airport_type = 'city' THEN 1 ELSE 0 END) as cities,
                    SUM(CASE WHEN airport_type = 'airport' THEN 1 ELSE 0 END) as airports,
                    SUM(CASE WHEN city_name = 'Неизвестно' THEN 1 ELSE 0 END) as unknown_city
                FROM airports
            `);

            console.log(`📊 Статистика базы:`);
            console.log(`  Всего записей: ${stats.total}`);
            console.log(`  Аэропортов: ${stats.airports}`);
            console.log(`  Городов: ${stats.cities}`);
            console.log(`  Российских: ${stats.russia}`);
            console.log(`  Международных: ${stats.international}`);
            console.log(`  Популярных: ${stats.popular}`);
            console.log(`  С неизвестным городом: ${stats.unknown_city}`);

            // Примеры городов
            console.log('\n🏙️ Примеры городов:');
            const cityExamples = await this.runQueryAll(`
                SELECT iata_code, airport_name, city_name, country_name
                FROM airports
                WHERE airport_type = 'city'
                ORDER BY is_popular DESC, city_name
                LIMIT 10
            `);

            cityExamples.forEach(city => {
                console.log(`  ${city.iata_code} - ${city.airport_name}`);
                console.log(`    Город: ${city.city_name}, Страна: ${city.country_name}`);
            });

            // Проверяем Красноярск
            console.log('\n🔍 Проверка Красноярска:');
            const krasnoyarsk = await this.runQueryAll(`
                SELECT iata_code, airport_name, airport_type, city_name
                FROM airports
                WHERE city_name LIKE '%расноярск%' OR iata_code IN ('KJA', 'KCY')
                ORDER BY airport_type, iata_code
            `);

            if (krasnoyarsk.length > 0) {
                console.log(`  ✅ Найдено ${krasnoyarsk.length} записей:`);
                krasnoyarsk.forEach(item => {
                    console.log(`    ${item.iata_code} [${item.airport_type}] - ${item.airport_name}`);
                });
            } else {
                console.log('  ❌ Красноярск не найден!');
            }

        } catch (error) {
            console.error('  ⚠️ Ошибка проверки:', error.message);
        }
    }

    // Вспомогательные методы для работы с БД
    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    runQueryAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    runQueryGet(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

// Запуск
const importer = new AdvancedAirportImporter();
importer.run().catch(console.error);
