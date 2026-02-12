const AviasalesPricer = require('../services/AviasalesPricer');
const AviasalesAPI = require('../services/AviasalesAPI');
const TripOptimizer = require('../services/TripOptimizer');

// 🎯 КОНФИГУРАЦИЯ ТЕСТА
const TEST_CONFIG = {
    // Трип: SVX → MOW → DPS → MOW → SVX
    trip: {
        id: 999,
        name: 'SVX→MOW→DPS→MOW→SVX',
        departure_start: '2026-02-25',
        departure_end: '2026-03-12',
        threshold_price: 550000,
        currency: 'RUB'
    },

    // Ноги маршрута (per-leg фильтры)
    legs: [
        {
            leg_order: 1, origin: 'SVX', destination: 'MOW',
            min_days: 1, max_days: 1,
            adults: 4, children: 1, airline: null, baggage: 1, max_stops: 0, max_layover_hours: null
        },
        {
            leg_order: 2, origin: 'MOW', destination: 'DPS',
            min_days: 28, max_days: 29,
            adults: 4, children: 1, airline: 'EY', baggage: 1, max_stops: 1, max_layover_hours: 5
        },
        {
            leg_order: 3, origin: 'DPS', destination: 'MOW',
            min_days: 1, max_days: 1,
            adults: 4, children: 1, airline: 'EY', baggage: 1, max_stops: 1, max_layover_hours: 5
        },
        {
            leg_order: 4, origin: 'MOW', destination: 'SVX',
            min_days: null, max_days: null,
            adults: 4, children: 1, airline: null, baggage: 1, max_stops: 0, max_layover_hours: null
        }
    ],

    debug: true
};

function formatLegFilters(leg) {
    let pax = `${leg.adults} взр`;
    if (leg.children > 0) pax += ` + ${leg.children} дет`;

    const airline = leg.airline || 'Любая';
    const baggage = leg.baggage ? 'С багажом' : 'Без багажа';

    let stops;
    if (leg.max_stops === 0) stops = 'Прямые';
    else if (leg.max_stops === 1) stops = leg.max_layover_hours ? `До 1 пер. (${leg.max_layover_hours}ч)` : 'До 1 пер.';
    else if (leg.max_stops === 2) stops = 'До 2 пер.';
    else stops = 'Любые пер.';

    return `${pax} | ${airline} | ${baggage} | ${stops}`;
}

// 🚀 ГЛАВНАЯ ФУНКЦИЯ
async function main() {
    console.log('');
    console.log('='.repeat(80));
    console.log('🗺️  ТЕСТ СОСТАВНОГО МАРШРУТА (TRIP)');
    console.log('='.repeat(80));
    console.log('');

    const { trip, legs } = TEST_CONFIG;

    // 1. Показать параметры
    console.log('📋 Параметры трипа:');
    console.log(`   Маршрут: ${trip.name}`);
    console.log(`   Даты вылета: ${trip.departure_start} — ${trip.departure_end}`);
    console.log(`   Бюджет: ${trip.threshold_price.toLocaleString('ru-RU')} ₽`);
    console.log('');

    console.log('📍 Ноги маршрута:');
    for (const leg of legs) {
        const stay = leg.min_days !== null
            ? `${leg.min_days}-${leg.max_days} дн.`
            : '—';
        console.log(`   ${leg.leg_order}️⃣  ${leg.origin} → ${leg.destination} (${stay}) | ${formatLegFilters(leg)}`);
    }
    console.log('');

    // 2. Подсчет API-вызовов и комбинаций
    const apiCalls = TripOptimizer.countApiCalls(trip, legs);
    const combinations = TripOptimizer.countTripCombinations(trip, legs);
    console.log('📊 Оценка:');
    console.log(`   API-вызовов: ${apiCalls}`);
    console.log(`   Офлайн-комбинаций: ${combinations.toLocaleString('ru-RU')}`);
    console.log('');

    // 3. Генерация batch items
    const api = new AviasalesAPI(process.env.TRAVELPAYOUTS_TOKEN || 'your_token', '696196');
    const pricer = new AviasalesPricer(TEST_CONFIG.debug, '696196');

    const userSettings = { timezone: 'Asia/Yekaterinburg' };
    const batchItems = TripOptimizer.generateBatchItems(trip, legs, userSettings, api);

    console.log(`🔗 Сгенерировано ${batchItems.length} URLs для проверки:`);
    for (const leg of legs) {
        const legItems = batchItems.filter(i => i.legOrder === leg.leg_order);
        console.log(`   Нога ${leg.leg_order} (${leg.origin}→${leg.destination}): ${legItems.length} URLs`);
        if (legItems.length > 0 && legItems.length <= 5) {
            legItems.forEach(item => {
                console.log(`      📅 ${item.departureDate}`);
            });
        } else if (legItems.length > 5) {
            console.log(`      📅 ${legItems[0].departureDate} ... ${legItems[legItems.length - 1].departureDate}`);
        }
    }
    console.log('');

    if (batchItems.length === 0) {
        console.log('❌ Нет URL для проверки (все даты в прошлом?)');
        return;
    }

    // 4. Запуск реальной проверки
    console.log('='.repeat(80));
    console.log('⏳ Запуск реальной проверки через API...');
    console.log('   (инициализация прокси → получение куки → поиск цен)');
    console.log('='.repeat(80));
    console.log('');

    const startTime = Date.now();

    // Подготавливаем urlsWithFilters для batch проверки
    const urlsWithFilters = batchItems.map(item => ({
        url: item.url,
        airline: item.airline,
        baggage: item.baggage,
        max_stops: item.max_stops,
        max_layover_hours: item.max_layover_hours
    }));

    const response = await pricer.getPricesFromUrlsWithIndividualFilters(urlsWithFilters);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('='.repeat(80));
    console.log('📊 РЕЗУЛЬТАТЫ ПРОВЕРКИ ЦЕН');
    console.log('='.repeat(80));
    console.log('');
    console.log(`⏱  Время: ${elapsed} сек`);
    console.log(`📋 Статистика: ${response.stats.success}/${response.stats.total} успешно`);
    console.log('');

    // 5. Группировка результатов по ногам
    const pricesByLeg = new Map();

    for (let i = 0; i < batchItems.length; i++) {
        const item = batchItems[i];
        const result = response.results[i];

        if (!pricesByLeg.has(item.legOrder)) {
            pricesByLeg.set(item.legOrder, new Map());
        }
        const legMap = pricesByLeg.get(item.legOrder);

        if (result && result.price > 0) {
            const existing = legMap.get(item.departureDate);
            if (!existing || result.price < existing.price) {
                legMap.set(item.departureDate, {
                    price: result.price,
                    searchLink: result.enhancedSearchLink || result.searchLink || null,
                    airline: result.airline || null
                });
            }
        }
    }

    // 6. Вывод цен по ногам
    console.log('-'.repeat(80));
    console.log('💰 ЦЕНЫ ПО НОГАМ:');
    console.log('-'.repeat(80));

    for (const leg of legs) {
        const legPrices = pricesByLeg.get(leg.leg_order);
        const found = legPrices ? legPrices.size : 0;
        const totalForLeg = batchItems.filter(i => i.legOrder === leg.leg_order).length;

        console.log(`\n  Нога ${leg.leg_order}: ${leg.origin} → ${leg.destination} (найдено цен: ${found}/${totalForLeg})`);

        if (legPrices && legPrices.size > 0) {
            // Сортируем по дате
            const sorted = [...legPrices.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            for (const [date, data] of sorted) {
                const priceStr = data.price.toLocaleString('ru-RU');
                console.log(`    📅 ${date}: ${priceStr} ₽ ${data.airline ? '(' + data.airline + ')' : ''}`);
            }

            // Статистика
            const prices = [...legPrices.values()].map(v => v.price);
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            console.log(`    📉 Мин: ${minPrice.toLocaleString('ru-RU')} ₽ | Макс: ${maxPrice.toLocaleString('ru-RU')} ₽`);
        } else {
            console.log('    ❌ Цены не найдены');
        }
    }

    // 7. Поиск лучшей комбинации
    console.log('');
    console.log('='.repeat(80));
    console.log('🏆 ПОИСК ЛУЧШЕЙ КОМБИНАЦИИ');
    console.log('='.repeat(80));
    console.log('');

    const bestCombo = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

    if (!bestCombo) {
        console.log('❌ Не удалось найти полную комбинацию!');
        console.log('   Причины: нет цен для всех ног в совместимых датах.');
        console.log('');

        // Покажем, для каких ног нет цен
        for (const leg of legs) {
            const legPrices = pricesByLeg.get(leg.leg_order);
            if (!legPrices || legPrices.size === 0) {
                console.log(`   ⚠️  Нога ${leg.leg_order} (${leg.origin}→${leg.destination}): НЕТ ЦЕН`);
            }
        }
    } else {
        console.log(`✅ ЛУЧШАЯ КОМБИНАЦИЯ: ${bestCombo.totalPrice.toLocaleString('ru-RU')} ₽`);
        console.log('');

        for (const legResult of bestCombo.legs) {
            const legInfo = legs.find(l => l.leg_order === legResult.legOrder);
            const route = legInfo ? `${legInfo.origin}→${legInfo.destination}` : `Нога ${legResult.legOrder}`;
            const priceStr = legResult.price.toLocaleString('ru-RU');

            console.log(`  ${legResult.legOrder}️⃣  ${route} | ${legResult.departureDate} | ${legResult.airline || '—'} | ${priceStr} ₽`);
            if (legResult.searchLink) {
                console.log(`      🔗 ${legResult.searchLink.substring(0, 100)}...`);
            }
        }

        console.log('');

        // Сравнение с бюджетом
        const budget = trip.threshold_price;
        const diff = budget - bestCombo.totalPrice;
        if (diff > 0) {
            console.log(`✅ УКЛАДЫВАЕТСЯ В БЮДЖЕТ! Экономия: ${diff.toLocaleString('ru-RU')} ₽`);
        } else if (diff === 0) {
            console.log(`✅ Точно в бюджет: ${budget.toLocaleString('ru-RU')} ₽`);
        } else {
            console.log(`⚠️  Превышение бюджета на ${Math.abs(diff).toLocaleString('ru-RU')} ₽`);
        }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('👋 Тест завершён!');
    console.log('='.repeat(80));
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
