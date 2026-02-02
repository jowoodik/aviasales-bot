// test-airport-search.js
const AirportService = require('./AirportService');

// Создаем экземпляр сервиса
const airportService = new AirportService();

// Тестовые данные
const testQueries = [
    // Тесты IATA кодов
    'PKX',      // Аэропорт Дасин в Пекине
    'BJS',      // Код города Пекин (в базе может быть как город)
    'LED',      // Пулково, Санкт-Петербург
    'SVO',      // Шереметьево, Москва
    'DME',      // Домодедово, Москва
    'abc',      // Несуществующий код

    // Тесты текстового поиска
    'москва',
    'санкт-петербург',
    'new york',
    'париж',
    'пекин',
    'london',
    'берлин',

    // Частичные названия
    'mos',
    'санкт',
    'lon',

    // Случайные символы
    '123',
    '@#$',

    // Пустая строка
    '',

    // Длинная строка
    'оченьдлинноеназваниекоторогонесуществуетвбазеданных',
];

// Функция для форматирования результата
function formatResult(airport) {
    return {
        iata_code: airport.iata_code,
        airport_name: airport.airport_name,
        city_name: airport.city_name,
        country_name: airport.country_name,
        airport_type: airport.airport_type,
        is_popular: airport.is_popular,
        is_international: airport.is_international
    };
}

// Основная тестовая функция
async function runTests() {
    console.log('🚀 Начало тестирования поиска аэропортов\n');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    for (const query of testQueries) {
        totalTests++;
        console.log(`\n--- Тест ${totalTests}: "${query}" ---`);

        try {
            if (query === '') {
                console.log('⚠️  Пустой запрос - пропускаем');
                continue;
            }

            const startTime = Date.now();
            const results = await airportService.searchAirportsEnhanced(query, 5);
            const searchTime = Date.now() - startTime;

            console.log(`⌛ Время поиска: ${searchTime}мс`);
            console.log(`📊 Найдено результатов: ${results.length}`);

            if (results.length > 0) {
                console.log('📝 Топ результаты:');

                results.slice(0, 3).forEach((result, index) => {
                    console.log(`  ${index + 1}. ${result.iata_code} - ${result.city_name} (${result.country_name})`);
                    console.log(`     Тип: ${result.airport_type}, Популярный: ${result.is_popular}, Международный: ${result.is_international}`);
                });

                if (results.length > 3) {
                    console.log(`  ... и еще ${results.length - 3} результатов`);
                }

                passedTests++;
            } else {
                console.log('❌ Результатов не найдено');

                // Проверим, ожидаем ли мы найти что-то для этого запроса
                const isExpectedToFail = ['abc', '123', '@#$', 'оченьдлинноеназваниекоторогонесуществуетвбазеданных'].includes(query);

                if (isExpectedToFail) {
                    console.log('✅ Ожидаемый результат - не найдено');
                    passedTests++;
                } else {
                    console.log('⚠️  Неожиданный результат - возможно, проблема с данными');
                    failedTests++;
                }
            }

        } catch (error) {
            failedTests++;
            console.error(`❌ Ошибка при поиске "${query}":`);
            console.error(`   Сообщение: ${error.message}`);

            if (error.code) {
                console.error(`   Код ошибки: ${error.code}`);
            }

            // Покажем детали SQL-ошибки
            if (error.message.includes('SQLITE_ERROR')) {
                console.error('   🐛 SQL ошибка, возможно проблема в запросе');
            }
        }
    }

    // Вывод статистики
    console.log('\n' + '='.repeat(50));
    console.log('📈 СТАТИСТИКА ТЕСТИРОВАНИЯ:');
    console.log('='.repeat(50));
    console.log(`Всего тестов: ${totalTests}`);
    console.log(`✅ Успешно: ${passedTests}`);
    console.log(`❌ Провалено: ${failedTests}`);
    console.log(`📊 Успешность: ${Math.round((passedTests / totalTests) * 100)}%`);

    // Дополнительные тесты
    console.log('\n' + '='.repeat(50));
    console.log('🔍 ДОПОЛНИТЕЛЬНЫЕ ТЕСТЫ:');
    console.log('='.repeat(50));

    // Тест популярных аэропортов
    console.log('\nТест популярных аэропортов:');
    try {
        const popular = await airportService.getPopularAirports('russia', 5);
        console.log(`Популярные аэропорты России (${popular.length}):`);
        popular.forEach(airport => {
            console.log(`  - ${airport.iata_code}: ${airport.city_name} (${airport.airport_name})`);
        });
    } catch (error) {
        console.error(`Ошибка при получении популярных аэропортов: ${error.message}`);
    }

    // Тест поиска по коду
    console.log('\nТест поиска по конкретному коду IATA:');
    try {
        const airport = await airportService.getAirportByCode('SVO');
        if (airport) {
            console.log(`Найден аэропорт: ${airport.iata_code} - ${airport.airport_name}`);
            console.log(`  Город: ${airport.city_name}, Страна: ${airport.country_name}`);
            console.log(`  Часовой пояс: ${airport.timezone}`);
        } else {
            console.log('Аэропорт не найден');
        }
    } catch (error) {
        console.error(`Ошибка при поиске по коду: ${error.message}`);
    }

    // Тест на граничные случаи
    console.log('\nТест на граничные случаи:');

    // Тест с limit = 1
    try {
        const singleResult = await airportService.searchAirportsEnhanced('москва', 1);
        console.log(`Поиск с limit=1: найдено ${singleResult.length} результат(ов)`);
    } catch (error) {
        console.error(`Ошибка при поиске с limit=1: ${error.message}`);
    }

    // Тест с limit = 0
    try {
        const noResults = await airportService.searchAirportsEnhanced('москва', 0);
        console.log(`Поиск с limit=0: найдено ${noResults.length} результат(ов)`);
    } catch (error) {
        console.error(`Ошибка при поиске с limit=0: ${error.message}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 Тестирование завершено!');
    console.log('='.repeat(50));

    // Закрываем соединение с БД (если нужно)
    process.exit(failedTests > 0 ? 1 : 0);
}

// Обработка ошибок на уровне процесса
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Необработанное обещание:', promise, 'причина:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Необработанное исключение:', error);
    process.exit(1);
});

// Запуск тестов
runTests().catch(error => {
    console.error('🔥 Ошибка при запуске тестов:', error);
    process.exit(1);
});