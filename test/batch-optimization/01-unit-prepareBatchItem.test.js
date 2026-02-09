/**
 * Unit-тест: prepareBatchItem() возвращает правильные метаданные
 */

require('dotenv').config();
const UnifiedMonitor = require('../../services/UnifiedMonitor');

// Mock бота
const bot = {
  sendMessage: () => {},
  editMessageText: () => {},
};

async function runTest() {
  console.log('\n========================================');
  console.log('📋 Unit-тест: prepareBatchItem()');
  console.log('========================================\n');

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);

  // Тестовый маршрут (обычный - 1 комбинация)
  const simpleRoute = {
    id: 1,
    chat_id: 123,
    origin: 'MOW',
    destination: 'DXB',
    departure_date: '2026-03-15',
    return_date: '2026-03-25',
    has_return: 1,
    is_flexible: 0,
    airline: 'EK',
    baggage: 1,
    max_stops: 1,
    max_layover_hours: 6,
    adults: 2,
    children: 0
  };

  // Тестовый маршрут (гибкий - много комбинаций)
  const flexibleRoute = {
    id: 2,
    chat_id: 123,
    origin: 'LED',
    destination: 'DPS',
    departure_start: '2026-04-01',
    departure_end: '2026-04-05',
    has_return: 1,
    min_days: 7,
    max_days: 10,
    is_flexible: 1,
    airline: null,
    baggage: 0,
    max_stops: 2,
    max_layover_hours: null,
    adults: 1,
    children: 0
  };

  let allTestsPassed = true;

  // ========================================
  // Тест 1: Обычный маршрут (1 комбинация)
  // ========================================
  console.log('🧪 Тест 1: Обычный маршрут (is_flexible=0)\n');

  const simpleItems = monitor.prepareBatchItem(simpleRoute);

  console.log(`  Количество items: ${simpleItems.length}`);

  if (simpleItems.length !== 1) {
    console.error(`  ❌ ОШИБКА: ожидалось 1 item, получено ${simpleItems.length}`);
    allTestsPassed = false;
  } else {
    console.log('  ✅ Количество items корректно');
  }

  if (simpleItems.length > 0) {
    const item = simpleItems[0];

    // Проверка структуры
    const requiredFields = ['url', 'combination', 'airline', 'baggage', 'max_stops', 'max_layover_hours'];
    const missingFields = requiredFields.filter(field => !(field in item));

    if (missingFields.length > 0) {
      console.error(`  ❌ ОШИБКА: отсутствуют поля: ${missingFields.join(', ')}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Все обязательные поля присутствуют');
    }

    // Проверка URL
    if (!item.url || !item.url.startsWith('https://www.aviasales.ru/search/')) {
      console.error(`  ❌ ОШИБКА: некорректный URL: ${item.url}`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ URL корректен: ${item.url.substring(0, 60)}...`);
    }

    // Проверка combination
    if (!item.combination.departure_date || !item.combination.return_date) {
      console.error('  ❌ ОШИБКА: combination не содержит даты');
      allTestsPassed = false;
    } else {
      console.log(`  ✅ Combination: ${item.combination.departure_date} → ${item.combination.return_date}`);
    }

    // Проверка фильтров
    if (item.airline !== 'EK') {
      console.error(`  ❌ ОШИБКА: airline не совпадает: ожидалось EK, получено ${item.airline}`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ Airline: ${item.airline}`);
    }

    if (item.baggage !== true) {
      console.error(`  ❌ ОШИБКА: baggage не совпадает: ожидалось true, получено ${item.baggage}`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ Baggage: ${item.baggage}`);
    }

    if (item.max_stops !== 1) {
      console.error(`  ❌ ОШИБКА: max_stops не совпадает: ожидалось 1, получено ${item.max_stops}`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ Max stops: ${item.max_stops}`);
    }

    if (item.max_layover_hours !== 6) {
      console.error(`  ❌ ОШИБКА: max_layover_hours не совпадает: ожидалось 6, получено ${item.max_layover_hours}`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ Max layover hours: ${item.max_layover_hours}`);
    }
  }

  // ========================================
  // Тест 2: Гибкий маршрут (много комбинаций)
  // ========================================
  console.log('\n🧪 Тест 2: Гибкий маршрут (is_flexible=1)\n');

  const flexibleItems = monitor.prepareBatchItem(flexibleRoute);

  console.log(`  Количество items: ${flexibleItems.length}`);

  // Для гибкого маршрута ожидаем множество комбинаций
  // (5 дат вылета × 6 дат возврата = 30 комбинаций, но с фильтром days_in_country=7)
  if (flexibleItems.length === 0) {
    console.error('  ❌ ОШИБКА: items пустой для гибкого маршрута');
    allTestsPassed = false;
  } else {
    console.log(`  ✅ Сгенерировано комбинаций: ${flexibleItems.length}`);
  }

  // Проверка что фильтры null правильно обрабатываются
  if (flexibleItems.length > 0) {
    const item = flexibleItems[0];

    if (item.airline !== null) {
      console.error(`  ❌ ОШИБКА: airline должен быть null, получено ${item.airline}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Airline: null (корректно)');
    }

    if (item.baggage !== false) {
      console.error(`  ❌ ОШИБКА: baggage должен быть false, получено ${item.baggage}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Baggage: false');
    }

    if (item.max_stops !== 2) {
      console.error(`  ❌ ОШИБКА: max_stops должен быть 2, получено ${item.max_stops}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Max stops: 2');
    }

    if (item.max_layover_hours !== null) {
      console.error(`  ❌ ОШИБКА: max_layover_hours должен быть null, получено ${item.max_layover_hours}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Max layover hours: null (корректно)');
    }

    // Проверка разнообразия комбинаций
    const uniqueDepartureDates = new Set(flexibleItems.map(i => i.combination.departure_date));
    console.log(`  ✅ Уникальных дат вылета: ${uniqueDepartureDates.size}`);

    const uniqueReturnDates = new Set(flexibleItems.map(i => i.combination.return_date));
    console.log(`  ✅ Уникальных дат возврата: ${uniqueReturnDates.size}`);
  }

  // ========================================
  // Тест 3: Маршрут с null датами
  // ========================================
  console.log('\n🧪 Тест 3: Маршрут с null датами\n');

  const emptyRoute = {
    id: 3,
    chat_id: 123,
    origin: 'MOW',
    destination: 'DXB',
    departure_date: null,
    return_date: null,
    has_return: 0,
    is_flexible: 0,
    airline: null,
    baggage: 0,
    max_stops: null,
    max_layover_hours: null,
    adults: 1,
    children: 0
  };

  const emptyItems = monitor.prepareBatchItem(emptyRoute);

  console.log(`  Количество items: ${emptyItems.length}`);

  // getCombinations возвращает 1 комбинацию даже для null дат (это не баг)
  // Проверяем что combination содержит null
  if (emptyItems.length > 0 && emptyItems[0].combination.departure_date === null) {
    console.log('  ✅ Маршрут с null датами корректно обработан (combination.departure_date = null)');
  } else if (emptyItems.length === 0) {
    console.log('  ✅ Маршрут с null датами корректно обработан (0 items)');
  } else {
    console.error('  ❌ ОШИБКА: маршрут с null датами вернул некорректные данные');
    allTestsPassed = false;
  }

  // ========================================
  // Итоговый результат
  // ========================================
  console.log('\n========================================');
  if (allTestsPassed) {
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО');
  } else {
    console.log('❌ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛИЛИСЬ');
    process.exit(1);
  }
  console.log('========================================\n');
}

// Запуск теста
runTest().catch(error => {
  console.error('❌ Критическая ошибка теста:', error);
  process.exit(1);
});
