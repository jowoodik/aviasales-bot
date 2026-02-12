// Тесты для TripOptimizer - ключевая логика составных маршрутов

// Мокаем зависимости перед require
const originalRequire = module.constructor.prototype.require;
module.constructor.prototype.require = function(id) {
  if (id === '../config/database') return {};
  if (id === '../utils/timezoneUtils') {
    return {
      getCurrentTimeInTimezone: (tz) => {
        // Возвращаем фиксированную дату для детерминированных тестов
        return new Date('2026-03-01T10:00:00');
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

const TripOptimizer = require('../services/TripOptimizer');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName} (ожидалось: ${expected}, получено: ${actual})`);
    failed++;
  }
}

function assertDeepEqual(actual, expected, testName) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    console.log(`     ожидалось: ${expectedJson}`);
    console.log(`     получено:  ${actualJson}`);
    failed++;
  }
}

// =============================================
// Тест 1: _formatDate
// =============================================
console.log('\n📋 Тест 1: _formatDate');
{
  assertEqual(TripOptimizer._formatDate(new Date('2026-03-15')), '2026-03-15', 'форматирование даты ISO');
  assertEqual(TripOptimizer._formatDate(new Date(2026, 0, 1)), '2026-01-01', 'форматирование 1 января');
  assertEqual(TripOptimizer._formatDate(new Date(2026, 11, 31)), '2026-12-31', 'форматирование 31 декабря');
  assertEqual(TripOptimizer._formatDate(new Date(2026, 5, 9)), '2026-06-09', 'форматирование с leading zero');
}

// =============================================
// Тест 2: countApiCalls - простой трип с 2 ногами
// =============================================
console.log('\n📋 Тест 2: countApiCalls - 2 ноги');
{
  const trip = {
    departure_start: '2026-03-10',
    departure_end: '2026-03-12' // 3 дня базовый диапазон
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 3, max_days: 5 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];

  const calls = TripOptimizer.countApiCalls(trip, legs);

  // Нога 1: baseDays = 3
  // Нога 2: baseDays + (cumulativeMaxDays - cumulativeMinDays) = 3 + (5 - 3) = 5
  // Итого: 3 + 5 = 8
  assertEqual(calls, 8, '2 ноги, 3 дня, 3-5 дней пребывания → 8 API-вызовов');
}

// =============================================
// Тест 3: countApiCalls - 3 ноги
// =============================================
console.log('\n📋 Тест 3: countApiCalls - 3 ноги');
{
  const trip = {
    departure_start: '2026-04-01',
    departure_end: '2026-04-03' // 3 дня
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 2, max_days: 4 },
    { leg_order: 2, origin: 'IST', destination: 'AYT', min_days: 3, max_days: 5 },
    { leg_order: 3, origin: 'AYT', destination: 'SVX', min_days: null, max_days: null }
  ];

  const calls = TripOptimizer.countApiCalls(trip, legs);

  // Нога 1: 3
  // Нога 2: 3 + (4 - 2) = 5
  // Нога 3: 3 + ((4+5) - (2+3)) = 3 + 4 = 7
  // Итого: 3 + 5 + 7 = 15
  assertEqual(calls, 15, '3 ноги → 15 API-вызовов');
}

// =============================================
// Тест 4: countApiCalls - 1 день, 1 нога (минимальный трип)
// =============================================
console.log('\n📋 Тест 4: countApiCalls - минимальный трип');
{
  const trip = {
    departure_start: '2026-05-01',
    departure_end: '2026-05-01' // 1 день
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'LED', min_days: null, max_days: null }
  ];

  const calls = TripOptimizer.countApiCalls(trip, legs);
  assertEqual(calls, 1, '1 нога, 1 день → 1 API-вызов');
}

// =============================================
// Тест 5: countTripCombinations
// =============================================
console.log('\n📋 Тест 5: countTripCombinations');
{
  const trip = {
    departure_start: '2026-03-10',
    departure_end: '2026-03-12' // 3 дня
  };

  // 2 ноги, первая с min_days=3, max_days=5 (range=3)
  const legs2 = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 3, max_days: 5 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];
  assertEqual(TripOptimizer.countTripCombinations(trip, legs2), 9, '3 дня * (5-3+1) stay range = 9 комбинаций');

  // 3 ноги
  const legs3 = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 2, max_days: 4 },
    { leg_order: 2, origin: 'IST', destination: 'AYT', min_days: 3, max_days: 5 },
    { leg_order: 3, origin: 'AYT', destination: 'SVX', min_days: null, max_days: null }
  ];
  // 3 * (4-2+1) * (5-3+1) = 3 * 3 * 3 = 27
  assertEqual(TripOptimizer.countTripCombinations(trip, legs3), 27, '3 ноги → 27 комбинаций');
}

// =============================================
// Тест 6: _calculateLegDateRanges - базовый
// =============================================
console.log('\n📋 Тест 6: _calculateLegDateRanges - базовый');
{
  const trip = {
    departure_start: '2026-04-01',
    departure_end: '2026-04-03'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 2, max_days: 3 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];

  // today = 2026-03-01 (мок), все даты в будущем
  const ranges = TripOptimizer._calculateLegDateRanges(trip, legs, new Date('2026-03-01'));

  assertEqual(ranges.length, 2, '2 ноги → 2 диапазона');
  assertDeepEqual(ranges[0], ['2026-04-01', '2026-04-02', '2026-04-03'], 'нога 1: полный диапазон вылета');

  // Нога 2: start = dep_start + cumMin = 2026-04-01 + 2 = 2026-04-03
  //          end = dep_end + cumMax = 2026-04-03 + 3 = 2026-04-06
  assertDeepEqual(ranges[1], ['2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06'], 'нога 2: сдвиг по min/max days');
}

// =============================================
// Тест 7: _calculateLegDateRanges - фильтрация прошедших дат
// =============================================
console.log('\n📋 Тест 7: _calculateLegDateRanges - фильтрация прошедших дат');
{
  const trip = {
    departure_start: '2026-03-01',
    departure_end: '2026-03-05'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 1, max_days: 2 }
  ];

  // today = 2026-03-03 → первые 2 дня отсекаются
  const ranges = TripOptimizer._calculateLegDateRanges(trip, legs, new Date('2026-03-03'));

  assertDeepEqual(ranges[0], ['2026-03-03', '2026-03-04', '2026-03-05'], 'прошедшие даты отфильтрованы');
}

// =============================================
// Тест 8: _calculateLegDateRanges - все даты в прошлом
// =============================================
console.log('\n📋 Тест 8: _calculateLegDateRanges - все даты в прошлом');
{
  const trip = {
    departure_start: '2026-01-01',
    departure_end: '2026-01-05'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 1, max_days: 2 }
  ];

  const ranges = TripOptimizer._calculateLegDateRanges(trip, legs, new Date('2026-03-01'));
  assertDeepEqual(ranges[0], [], 'все даты в прошлом → пустой массив');
}

// =============================================
// Тест 9: findBestCombination - простой случай (2 ноги)
// =============================================
console.log('\n📋 Тест 9: findBestCombination - 2 ноги');
{
  const trip = {
    departure_start: '2026-04-01',
    departure_end: '2026-04-03'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 2, max_days: 3 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];

  // Цены для ноги 1
  const leg1Prices = new Map([
    ['2026-04-01', { price: 15000, searchLink: 'link1', airline: 'S7' }],
    ['2026-04-02', { price: 12000, searchLink: 'link2', airline: 'SU' }],
    ['2026-04-03', { price: 18000, searchLink: 'link3', airline: 'S7' }]
  ]);

  // Цены для ноги 2
  const leg2Prices = new Map([
    ['2026-04-03', { price: 10000, searchLink: 'link4', airline: 'SU' }],
    ['2026-04-04', { price: 8000, searchLink: 'link5', airline: 'S7' }],
    ['2026-04-05', { price: 11000, searchLink: 'link6', airline: 'SU' }],
    ['2026-04-06', { price: 9000, searchLink: 'link7', airline: 'S7' }]
  ]);

  const pricesByLeg = new Map([
    [1, leg1Prices],
    [2, leg2Prices]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

  assert(result !== null, 'результат найден');
  assertEqual(result.legs.length, 2, '2 ноги в результате');

  // Лучшая комбинация:
  // Нога 1: 02.04 за 12000 (самый дешёвый)
  // Нога 2: 04.04 или 05.04 (min_days=2, max_days=3 от 02.04)
  //   04.04 → 8000, 05.04 → 11000
  // Итого: 12000 + 8000 = 20000
  assertEqual(result.totalPrice, 20000, 'лучшая цена: 12000 + 8000 = 20000');
  assertEqual(result.legs[0].departureDate, '2026-04-02', 'нога 1: вылет 02.04');
  assertEqual(result.legs[0].price, 12000, 'нога 1: цена 12000');
  assertEqual(result.legs[1].departureDate, '2026-04-04', 'нога 2: вылет 04.04');
  assertEqual(result.legs[1].price, 8000, 'нога 2: цена 8000');
}

// =============================================
// Тест 10: findBestCombination - 3 ноги
// =============================================
console.log('\n📋 Тест 10: findBestCombination - 3 ноги');
{
  const trip = {
    departure_start: '2026-05-01',
    departure_end: '2026-05-02'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 1, max_days: 2 },
    { leg_order: 2, origin: 'IST', destination: 'AYT', min_days: 1, max_days: 1 },
    { leg_order: 3, origin: 'AYT', destination: 'SVX', min_days: null, max_days: null }
  ];

  const pricesByLeg = new Map([
    [1, new Map([
      ['2026-05-01', { price: 10000 }],
      ['2026-05-02', { price: 9000 }]
    ])],
    [2, new Map([
      ['2026-05-02', { price: 5000 }],
      ['2026-05-03', { price: 4000 }],
      ['2026-05-04', { price: 6000 }]
    ])],
    [3, new Map([
      ['2026-05-03', { price: 7000 }],
      ['2026-05-04', { price: 8000 }],
      ['2026-05-05', { price: 6000 }]
    ])]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

  assert(result !== null, 'результат найден');
  assertEqual(result.legs.length, 3, '3 ноги в результате');

  // Комбинации:
  // 01.05 (10000) → 02.05 or 03.05 (1-2 дня) → ...
  //   01.05 → 02.05 (5000) → 03.05 (7000) = 22000
  //   01.05 → 03.05 (4000) → 04.05 (8000) = 22000
  // 02.05 (9000) → 03.05 or 04.05 (1-2 дня) → ...
  //   02.05 → 03.05 (4000) → 04.05 (8000) = 21000
  //   02.05 → 04.05 (6000) → 05.05 (6000) = 21000
  // Лучшая: 21000
  assertEqual(result.totalPrice, 21000, 'лучшая цена для 3 ног: 21000');
}

// =============================================
// Тест 11: findBestCombination - нет цен → null
// =============================================
console.log('\n📋 Тест 11: findBestCombination - нет цен');
{
  const trip = {
    departure_start: '2026-06-01',
    departure_end: '2026-06-03'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 2, max_days: 3 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];

  const pricesByLeg = new Map([
    [1, new Map()], // пустые цены
    [2, new Map()]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);
  assertEqual(result, null, 'нет цен → результат null');
}

// =============================================
// Тест 12: findBestCombination - pruning работает
// =============================================
console.log('\n📋 Тест 12: findBestCombination - early pruning');
{
  const trip = {
    departure_start: '2026-07-01',
    departure_end: '2026-07-01' // 1 день
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 1, max_days: 1 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];

  const pricesByLeg = new Map([
    [1, new Map([
      ['2026-07-01', { price: 5000 }]
    ])],
    [2, new Map([
      ['2026-07-02', { price: 3000 }]
    ])]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

  assert(result !== null, 'единственная комбинация найдена');
  assertEqual(result.totalPrice, 8000, 'цена 5000 + 3000 = 8000');
}

// =============================================
// Тест 13: findBestCombination - цена 0 игнорируется
// =============================================
console.log('\n📋 Тест 13: findBestCombination - нулевая цена');
{
  const trip = {
    departure_start: '2026-08-01',
    departure_end: '2026-08-02'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'LED', min_days: 1, max_days: 1 },
    { leg_order: 2, origin: 'LED', destination: 'SVX', min_days: null, max_days: null }
  ];

  const pricesByLeg = new Map([
    [1, new Map([
      ['2026-08-01', { price: 0 }],     // нулевая цена - игнорируется
      ['2026-08-02', { price: 7000 }]
    ])],
    [2, new Map([
      ['2026-08-02', { price: 0 }],     // нулевая цена - игнорируется
      ['2026-08-03', { price: 5000 }]
    ])]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

  assert(result !== null, 'результат найден (нулевые цены пропущены)');
  assertEqual(result.totalPrice, 12000, 'цена 7000 + 5000 = 12000');
}

// =============================================
// Тест 14: generateBatchItems - проверка генерации
// =============================================
console.log('\n📋 Тест 14: generateBatchItems');
{
  const trip = {
    id: 42,
    departure_start: '2026-04-01',
    departure_end: '2026-04-02',
    adults: 2,
    children: 1,
    airline: 'S7',
    baggage: 1,
    max_stops: 0,
    max_layover_hours: null
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 1, max_days: 2 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];
  const userSettings = { timezone: 'Europe/Moscow' };

  // Мок API
  const mockApi = {
    generateSearchLink: (params) => `https://api.test/search?from=${params.origin}&to=${params.destination}&date=${params.departure_date}`
  };

  const items = TripOptimizer.generateBatchItems(trip, legs, userSettings, mockApi);

  assert(items.length > 0, 'сгенерированы batch items');

  // Проверяем метаданные первого элемента
  const firstItem = items[0];
  assertEqual(firstItem.tripId, 42, 'tripId = 42');
  assertEqual(firstItem.legOrder, 1, 'legOrder = 1');
  assertEqual(firstItem.origin, 'SVX', 'origin = SVX');
  assertEqual(firstItem.destination, 'IST', 'destination = IST');
  assertEqual(firstItem.airline, 'S7', 'airline = S7');
  assertEqual(firstItem.baggage, true, 'baggage = true');
  assertEqual(firstItem.max_stops, 0, 'max_stops = 0');

  // Проверяем что URL содержит нужные параметры
  assert(firstItem.url.includes('from=SVX'), 'URL содержит from=SVX');
  assert(firstItem.url.includes('to=IST'), 'URL содержит to=IST');

  // Проверяем что есть items для обеих ног
  const leg1Items = items.filter(i => i.legOrder === 1);
  const leg2Items = items.filter(i => i.legOrder === 2);
  assert(leg1Items.length > 0, 'есть items для ноги 1');
  assert(leg2Items.length > 0, 'есть items для ноги 2');
}

// =============================================
// Тест 15: _calculateLegDateRanges - 3 ноги с кумулятивными днями
// =============================================
console.log('\n📋 Тест 15: _calculateLegDateRanges - 3 ноги с кумулятивными днями');
{
  const trip = {
    departure_start: '2026-05-10',
    departure_end: '2026-05-11' // 2 дня базовый диапазон
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 3, max_days: 5 },
    { leg_order: 2, origin: 'IST', destination: 'AYT', min_days: 2, max_days: 4 },
    { leg_order: 3, origin: 'AYT', destination: 'SVX', min_days: null, max_days: null }
  ];

  const ranges = TripOptimizer._calculateLegDateRanges(trip, legs, new Date('2026-03-01'));

  assertEqual(ranges.length, 3, '3 диапазона');

  // Нога 1: 10-11 мая
  assertDeepEqual(ranges[0], ['2026-05-10', '2026-05-11'], 'нога 1: 10-11 мая');

  // Нога 2: start = 10 + 3 = 13, end = 11 + 5 = 16
  assertDeepEqual(ranges[1], ['2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16'], 'нога 2: 13-16 мая');

  // Нога 3: start = 10 + (3+2) = 15, end = 11 + (5+4) = 20
  assertDeepEqual(ranges[2], [
    '2026-05-15', '2026-05-16', '2026-05-17', '2026-05-18', '2026-05-19', '2026-05-20'
  ], 'нога 3: 15-20 мая');
}

// =============================================
// Тест 16: findBestCombination - выбирает из нескольких вариантов
// =============================================
console.log('\n📋 Тест 16: findBestCombination - выбор оптимального из нескольких');
{
  const trip = {
    departure_start: '2026-06-01',
    departure_end: '2026-06-03'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'LED', min_days: 1, max_days: 2 },
    { leg_order: 2, origin: 'LED', destination: 'SVX', min_days: null, max_days: null }
  ];

  const pricesByLeg = new Map([
    [1, new Map([
      ['2026-06-01', { price: 5000, airline: 'S7' }],
      ['2026-06-02', { price: 6000, airline: 'SU' }],
      ['2026-06-03', { price: 4000, airline: 'DP' }]
    ])],
    [2, new Map([
      ['2026-06-02', { price: 7000, airline: 'S7' }],
      ['2026-06-03', { price: 3000, airline: 'SU' }],
      ['2026-06-04', { price: 9000, airline: 'S7' }],
      ['2026-06-05', { price: 2000, airline: 'DP' }]
    ])]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

  // Все комбинации:
  // 01.06(5000) → 02.06(7000) = 12000
  // 01.06(5000) → 03.06(3000) = 8000
  // 02.06(6000) → 03.06(3000) = 9000
  // 02.06(6000) → 04.06(9000) = 15000
  // 03.06(4000) → 04.06(9000) = 13000
  // 03.06(4000) → 05.06(2000) = 6000 ← лучшая!

  assertEqual(result.totalPrice, 6000, 'лучшая: 4000 + 2000 = 6000');
  assertEqual(result.legs[0].departureDate, '2026-06-03', 'нога 1: 03.06');
  assertEqual(result.legs[1].departureDate, '2026-06-05', 'нога 2: 05.06');
}

// =============================================
// Тест 17: findBestCombination - сохраняет метаданные
// =============================================
console.log('\n📋 Тест 17: findBestCombination - метаданные в результате');
{
  const trip = {
    departure_start: '2026-09-01',
    departure_end: '2026-09-01'
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 1, max_days: 1 },
    { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
  ];

  const pricesByLeg = new Map([
    [1, new Map([
      ['2026-09-01', { price: 15000, searchLink: 'https://search/1', airline: 'TK' }]
    ])],
    [2, new Map([
      ['2026-09-02', { price: 12000, searchLink: 'https://search/2', airline: 'SU' }]
    ])]
  ]);

  const result = TripOptimizer.findBestCombination(trip, legs, pricesByLeg);

  assertEqual(result.legs[0].searchLink, 'https://search/1', 'нога 1: searchLink сохранён');
  assertEqual(result.legs[0].airline, 'TK', 'нога 1: airline сохранён');
  assertEqual(result.legs[0].origin, 'SVX', 'нога 1: origin = SVX');
  assertEqual(result.legs[0].destination, 'IST', 'нога 1: destination = IST');
  assertEqual(result.legs[1].searchLink, 'https://search/2', 'нога 2: searchLink сохранён');
  assertEqual(result.legs[1].airline, 'SU', 'нога 2: airline сохранён');
}

// =============================================
// Тест 18: countApiCalls - одна нога без min/max days
// =============================================
console.log('\n📋 Тест 18: countApiCalls - одна нога open-ended');
{
  const trip = {
    departure_start: '2026-10-01',
    departure_end: '2026-10-10' // 10 дней
  };
  const legs = [
    { leg_order: 1, origin: 'SVX', destination: 'LED', min_days: null, max_days: null }
  ];

  const calls = TripOptimizer.countApiCalls(trip, legs);
  assertEqual(calls, 10, '1 нога, 10 дней → 10 API-вызовов');
}

// =============================================
// ИТОГО
// =============================================
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 РЕЗУЛЬТАТЫ: ${passed} пройдено, ${failed} провалено из ${passed + failed}`);
if (failed === 0) {
  console.log('🎉 Все тесты пройдены!');
} else {
  console.log('⚠️  Есть проваленные тесты!');
  process.exit(1);
}
