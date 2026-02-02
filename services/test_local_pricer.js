const AviasalesPricer = require('./AviasalesPricer');
const AviasalesAPI = require('./AviasalesAPI');
const fs = require('fs');
const path = require('path');

// 🎯 КОНФИГУРАЦИЯ ТЕСТА
const TEST_CONFIG = {
    // Режим тестирования:
    // 'local' - тест на локальных JSON файлах (example2.json, example3.json, example4.json)
    // 'api' - реальный API запрос с прокси
    mode: 'api', // 'local' или 'api'

    // === ДЛЯ РЕЖИМА 'local' ===
    localFiles: [
        {
            json: './example2.json',
            result: './example2-result.txt',
            params: {
                origin: 'MOW',
                destination: 'SVX',
                departure_date: '2026-03-05',
                return_date: '2026-03-12',
                adults: 4,
                children: 1
            }
        },
        {
            json: './example3.json',
            result: './example3-result.txt',
            params: {
                origin: 'SVX',
                destination: 'AER',
                departure_date: '2026-03-07',
                return_date: '2026-03-21',
                adults: 2,
                children: 0
            }
        },
        {
            json: './example4.json',
            result: './example4-result.txt',
            params: {
                origin: 'SVX',
                destination: 'ALA',
                departure_date: '2026-03-07',
                return_date: '2026-03-14',
                adults: 2,
                children: 0
            }
        }
    ],

    // === ДЛЯ РЕЖИМА 'api' ===
    // Маршрут
    origin: 'AER',
    destination: 'HKT',
    departure_date: '2026-03-07',
    return_date: null,
    adults: 3,
    children: 1,

    // Фильтры
    airline: null,
    baggage: true,
    max_stops: 1, // 0 = только прямые
    max_layover_hours: 15,

    // Настройки
    debug: true, // Показывать отладочную информацию
    test_urls_count: 1 // Сколько URL протестировать (для режима 'api')
};

// 🧪 ТЕСТ НА ЛОКАЛЬНЫХ JSON ФАЙЛАХ
async function testLocalFiles() {
    console.log('\n' + '='.repeat(80));
    console.log('🧪 ЛОКАЛЬНЫЙ ТЕСТ НА JSON ФАЙЛАХ');
    console.log('='.repeat(80));
    console.log('');

    const pricer = new AviasalesPricer(TEST_CONFIG.debug, '696196');

    let successCount = 0;
    let failedCount = 0;
    const results = [];

    for (let i = 0; i < TEST_CONFIG.localFiles.length; i++) {
        const testCase = TEST_CONFIG.localFiles[i];

        console.log('\n' + '-'.repeat(80));
        console.log(`📁 Тест ${i + 1}/${TEST_CONFIG.localFiles.length}: ${path.basename(testCase.json)}`);
        console.log('-'.repeat(80));

        try {
            // Читаем JSON
            if (!fs.existsSync(testCase.json)) {
                console.log(`❌ Файл не найден: ${testCase.json}`);
                failedCount++;
                continue;
            }

            const jsonContent = fs.readFileSync(testCase.json, 'utf-8');

            // Исправляем trailing commas
            const cleanedJson = jsonContent
                .replace(/,(\s*[\]}])/g, '$1')
                .replace(/,(\s*$)/gm, '');

            const data = JSON.parse(cleanedJson);
            const response = data[0];

            console.log(`✅ JSON загружен: ${response.tickets.length} билетов`);

            // Получаем лучший билет и proposal
            const ticket = response.tickets[0];
            const proposal = ticket.proposals[0];
            const price = proposal.unified_price?.value || proposal.price?.value;

            // Собираем flights из flight_legs по индексам
            const allFlightIndices = [];
            ticket.segments.forEach(segment => {
                if (segment.flights && Array.isArray(segment.flights)) {
                    allFlightIndices.push(...segment.flights);
                }
            });

            ticket.flights = allFlightIndices
                .map(index => response.flight_legs[index])
                .filter(flight => flight);

            console.log(`📊 Билет: signature=${ticket.signature.substring(0, 12)}...`);
            console.log(`   Сегменты: ${ticket.segments.length}, Flights собрано: ${ticket.flights.length}`);
            console.log(`   Цена: ${price} ${proposal.unified_price?.currency_code || proposal.price?.currency_code}`);

            // Генерируем ссылку
            const generatedLink = pricer.buildEnhancedSearchLink(
                testCase.params,
                ticket,
                proposal,
                price
            );

            if (!generatedLink) {
                console.log('❌ Не удалось сгенерировать ссылку');
                failedCount++;
                continue;
            }

            console.log('\n✅ Ссылка сгенерирована:');
            console.log(`   Длина: ${generatedLink.length} символов`);

            // Читаем ожидаемую ссылку
            if (fs.existsSync(testCase.result)) {
                const expectedLink = fs.readFileSync(testCase.result, 'utf-8').trim();

                // Парсим обе ссылки для сравнения
                const generatedUrl = new URL(generatedLink);
                const expectedUrl = new URL(expectedLink);

                const generatedParams = new URLSearchParams(generatedUrl.search);
                const expectedParams = new URLSearchParams(expectedUrl.search);

                console.log('\n🔍 Сравнение с эталоном:');

                // Проверяем базовый путь
                const pathMatch = generatedUrl.pathname === expectedUrl.pathname;
                console.log(`   Path: ${pathMatch ? '✅' : '❌'} (${generatedUrl.pathname})`);

                // Проверяем ключевые параметры
                const keysToCheck = ['expected_price', 'static_fare_key', 't', 'marker'];
                let allMatch = pathMatch;

                for (const key of keysToCheck) {
                    const genValue = generatedParams.get(key);
                    const expValue = expectedParams.get(key);
                    const match = genValue === expValue;
                    allMatch = allMatch && match;

                    if (key === 't') {
                        if (genValue && expValue) {
                            console.log(`   ${key}: ${match ? '✅' : '❌'}`);
                            if (!match) {
                                console.log(`      Generated: ${genValue.substring(0, 50)}...`);
                                console.log(`      Expected:  ${expValue.substring(0, 50)}...`);
                            }
                        } else {
                            console.log(`   ${key}: ${genValue ? '✅ присутствует' : '❌ отсутствует'}`);
                            allMatch = false;
                        }
                    } else {
                        console.log(`   ${key}: ${match ? '✅' : '❌'} ${genValue || 'N/A'}`);
                    }
                }

                if (allMatch) {
                    console.log('\n✅ ТЕСТ ПРОЙДЕН - ссылки полностью совпадают!');
                    successCount++;
                } else {
                    console.log('\n⚠️ ТЕСТ ПРОВАЛЕН - есть расхождения');
                    failedCount++;
                }

                results.push({
                    file: testCase.json,
                    success: allMatch,
                    price: price
                });
            } else {
                console.log(`\n⚠️ Файл с эталонной ссылкой не найден: ${testCase.result}`);
                console.log('   Сгенерированная ссылка:');
                console.log(`   ${generatedLink}`);

                successCount++;
                results.push({
                    file: testCase.json,
                    success: true,
                    price: price,
                    noReference: true
                });
            }

        } catch (error) {
            console.log(`\n❌ Ошибка обработки: ${error.message}`);
            if (TEST_CONFIG.debug) {
                console.log(error.stack);
            }
            failedCount++;
        }
    }

    // Итоги
    console.log('\n' + '='.repeat(80));
    console.log('📊 ИТОГИ ЛОКАЛЬНОГО ТЕСТИРОВАНИЯ');
    console.log('='.repeat(80));
    console.log('');
    console.log(`✅ Успешно: ${successCount}/${TEST_CONFIG.localFiles.length}`);
    console.log(`❌ Провалено: ${failedCount}/${TEST_CONFIG.localFiles.length}`);
    console.log('');

    if (successCount === TEST_CONFIG.localFiles.length) {
        console.log('🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
    } else if (successCount > 0) {
        console.log('⚠️ ЧАСТИЧНЫЙ УСПЕХ');
    } else {
        console.log('❌ ВСЕ ТЕСТЫ ПРОВАЛЕНЫ');
    }

    console.log('');
    console.log('='.repeat(80));
}

// 🌐 ТЕСТ С РЕАЛЬНЫМ API
async function testRealAPI() {
    console.log('\n' + '='.repeat(80));
    console.log('🌐 ТЕСТ С РЕАЛЬНЫМ API И ПРОКСИ');
    console.log('='.repeat(80));
    console.log('');
    console.log('📋 Параметры теста:');
    console.log(`   Маршрут: ${TEST_CONFIG.origin} → ${TEST_CONFIG.destination}`);
    console.log(`   Даты: ${TEST_CONFIG.departure_date} — ${TEST_CONFIG.return_date}`);
    console.log(`   Пассажиры: ${TEST_CONFIG.adults} взр${TEST_CONFIG.children > 0 ? ', ' + TEST_CONFIG.children + ' дет' : ''}`);
    console.log(`   Авиакомпания: ${TEST_CONFIG.airline || 'Все'}`);
    console.log(`   Багаж: ${TEST_CONFIG.baggage ? '20 кг' : 'Нет'}`);
    console.log(`   Пересадки: ${TEST_CONFIG.max_stops === 0 ? 'Только прямые' : 'До ' + TEST_CONFIG.max_stops}`);
    if (TEST_CONFIG.max_stops > 0 && TEST_CONFIG.max_layover_hours) {
        console.log(`   Макс. пересадка: ${TEST_CONFIG.max_layover_hours}ч`);
    }
    console.log(`   Тестовых URL: ${TEST_CONFIG.test_urls_count}`);
    console.log('');
    console.log('='.repeat(80));
    console.log('');

    const api = new AviasalesAPI(process.env.TRAVELPAYOUTS_TOKEN || 'your_token', '696196');
    const pricer = new AviasalesPricer(TEST_CONFIG.debug, '696196');

    try {
        // Генерируем URL
        console.log('🔗 Генерация тестовых URL...');
        const urls = [];
        const baseDate = new Date(TEST_CONFIG.departure_date);

        for (let i = 0; i < TEST_CONFIG.test_urls_count; i++) {
            const depDate = new Date(baseDate);
            depDate.setDate(depDate.getDate() + i);

            let retDate = null;
            if (TEST_CONFIG.return_date) {
                retDate = new Date(depDate);
                const daysDiff = Math.floor((new Date(TEST_CONFIG.return_date) - baseDate) / (1000 * 60 * 60 * 24));
                retDate.setDate(retDate.getDate() + daysDiff);
            }

            const url = api.generateSearchLink({
                origin: TEST_CONFIG.origin,
                destination: TEST_CONFIG.destination,
                departure_date: depDate.toISOString().split('T')[0],
                return_date: retDate ? retDate.toISOString().split('T')[0] : null,
                adults: TEST_CONFIG.adults,
                children: TEST_CONFIG.children,
                airline: TEST_CONFIG.airline,
                baggage: TEST_CONFIG.baggage,
                max_stops: TEST_CONFIG.max_stops
            });

            urls.push(url);
        }

        console.log(`✅ Сгенерировано ${urls.length} URL\n`);
        console.log('URL для тестирования:');
        urls.forEach((url, i) => {
            console.log(`   ${i + 1}. ${url}`);
        });
        console.log('');
        console.log('='.repeat(80));
        console.log('');

        // Запускаем проверку
        console.log('⏳ Запуск проверки через API...');
        console.log('   (проверка прокси → получение куки → поиск цен)');
        console.log('');

        const startTime = Date.now();
        const { results } = await pricer.getPricesFromUrls(
            urls,
            TEST_CONFIG.airline,
            TEST_CONFIG.max_stops === 0 ? null : TEST_CONFIG.max_layover_hours,
            TEST_CONFIG.baggage,
            TEST_CONFIG.max_stops
        );
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('');
        console.log('='.repeat(80));
        console.log('✅ РЕЗУЛЬТАТЫ API ТЕСТА');
        console.log('='.repeat(80));
        console.log('');

        let successCount = 0;
        let failedCount = 0;

        results.forEach((result, i) => {
            if (result && result.price) {
                successCount++;
                console.log(`${i + 1}. ✅ ${result.price.toLocaleString('ru-RU')} ${result.currency}`);
                if (result.enhancedSearchLink) {
                    console.log(`   🔗 ${result.enhancedSearchLink.substring(0, 100)}...`);
                }
            } else {
                failedCount++;
                console.log(`${i + 1}. ❌ Не найдено`);
            }
        });

        console.log('');
        console.log('📊 Статистика:');
        console.log(`   ✅ Успешно: ${successCount}`);
        console.log(`   ❌ Не найдено: ${failedCount}`);
        console.log(`   ⏱ Общее время: ${elapsed} сек`);
        console.log(`   ⏱ Среднее на URL: ${(elapsed / urls.length).toFixed(1)} сек`);
        console.log('');

        if (successCount > 0) {
            const prices = results.filter(r => r && r.price).map(r => r.price);
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const avgPrice = (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(0);

            console.log('💰 Цены:');
            console.log(`   Минимум: ${minPrice.toLocaleString('ru-RU')} ₽`);
            console.log(`   Максимум: ${maxPrice.toLocaleString('ru-RU')} ₽`);
            console.log(`   Средняя: ${avgPrice.toLocaleString('ru-RU')} ₽`);
            console.log('');
        }

        if (successCount === urls.length) {
            console.log('✅ ВСЕ API ТЕСТЫ ПРОШЛИ УСПЕШНО!');
        } else if (successCount > 0) {
            console.log('⚠️ ЧАСТИЧНЫЙ УСПЕХ');
        } else {
            console.log('❌ ВСЕ ТЕСТЫ ПРОВАЛИЛИСЬ');
        }

        console.log('');
        console.log('='.repeat(80));

    } catch (error) {
        console.error('');
        console.error('='.repeat(80));
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА API ТЕСТА');
        console.error('='.repeat(80));
        console.error('');
        console.error('Сообщение:', error.message);
        console.error('');
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        console.error('');
        console.error('='.repeat(80));
    }
}

// 🚀 ГЛАВНАЯ ФУНКЦИЯ
async function main() {
    console.log('');
    console.log('🚀 Запуск тестирования AviasalesPricer...');

    if (TEST_CONFIG.mode === 'local') {
        await testLocalFiles();
    } else if (TEST_CONFIG.mode === 'api') {
        await testRealAPI();
    } else {
        console.error('❌ Неизвестный режим тестирования:', TEST_CONFIG.mode);
        console.error('   Доступные режимы: "local" или "api"');
        process.exit(1);
    }

    console.log('');
    console.log('👋 Тестирование завершено!');
}

// Запуск
main()
    .then(() => {
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Необработанная ошибка:', error);
        process.exit(1);
    });