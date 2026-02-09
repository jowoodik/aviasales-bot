/**
 * Integration-тест: Разные фильтры у маршрутов
 *
 * Проверяет что batch-проверка корректно применяет индивидуальные фильтры
 * для каждого маршрута.
 */

require('dotenv').config();
const db = require('../../config/database');

// Mock бота
const bot = {
  sendMessage: async () => {},
  editMessageText: async () => {},
};

const UnifiedMonitor = require('../../services/UnifiedMonitor');

const TEST_CHAT_ID = 99990;

async function cleanupTestData() {
  console.log('🧹 Очистка старых тестовых данных...\n');

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM route_results WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [TEST_CHAT_ID]);
      db.run('DELETE FROM route_check_stats WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [TEST_CHAT_ID]);
      db.run('DELETE FROM combination_check_results WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [TEST_CHAT_ID]);
      db.run('DELETE FROM price_analytics WHERE chat_id = ?', [TEST_CHAT_ID]);
      db.run('DELETE FROM unified_routes WHERE chat_id = ?', [TEST_CHAT_ID], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function createTestRoute(id, filters) {
  const { airline, baggage, max_stops, max_layover_hours } = filters;

  // Даты через 2 месяца
  const departureDate = new Date();
  departureDate.setMonth(departureDate.getMonth() + 2);
  const departureDateStr = departureDate.toISOString().split('T')[0];

  const returnDate = new Date(departureDate);
  returnDate.setDate(returnDate.getDate() + 10);
  const returnDateStr = returnDate.toISOString().split('T')[0];

  await new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO unified_routes
      (id, chat_id, origin, destination, departure_date_start, departure_date_end,
       return_date_start, return_date_end, is_flexible, threshold_price,
       airline, baggage, max_stops, max_layover_hours, adults, is_paused, created_at)
      VALUES (?, ?, 'MOW', 'DXB', ?, ?, ?, ?, 0, 70000, ?, ?, ?, ?, 1, 0, datetime('now'))
    `, [id, TEST_CHAT_ID, departureDateStr, departureDateStr, returnDateStr, returnDateStr,
        airline, baggage ? 1 : 0, max_stops, max_layover_hours], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function runTest() {
  console.log('\n========================================');
  console.log('📋 Integration-тест: Разные фильтры у маршрутов');
  console.log('========================================\n');

  console.log('⚠️  ВНИМАНИЕ: Этот тест выполняет РЕАЛЬНЫЕ запросы к API!\n');

  let allTestsPassed = true;
  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);

  try {
    await cleanupTestData();

    // ========================================
    // Создаем маршруты с разными фильтрами
    // ========================================
    console.log('✈️  Создание тестовых маршрутов с разными фильтрами...\n');

    const testRoutes = [
      {
        id: 98001,
        name: 'Прямой Emirates с багажом',
        filters: { airline: 'EK', baggage: true, max_stops: 0, max_layover_hours: null }
      },
      {
        id: 98002,
        name: 'Любая а/к без багажа, 1 пересадка',
        filters: { airline: null, baggage: false, max_stops: 1, max_layover_hours: null }
      },
      {
        id: 98003,
        name: 'Аэрофлот с багажом, до 2 пересадок',
        filters: { airline: 'SU', baggage: true, max_stops: 2, max_layover_hours: null }
      },
      {
        id: 98004,
        name: 'Любая а/к, короткая пересадка (до 3ч)',
        filters: { airline: null, baggage: false, max_stops: 1, max_layover_hours: 3 }
      }
    ];

    for (const route of testRoutes) {
      await createTestRoute(route.id, route.filters);
      console.log(`  ✅ Создан: ${route.name}`);
    }

    // ========================================
    // Подготавливаем batch items
    // ========================================
    console.log('\n📦 Подготовка batch items...\n');

    const batchItems = [];
    const routeMetaMap = new Map();

    for (const testRoute of testRoutes) {
      const route = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM unified_routes WHERE id = ?', [testRoute.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const items = monitor.prepareBatchItem(route);

      console.log(`  Route #${testRoute.id}: ${items.length} items`);
      console.log(`    Airline: ${items[0].airline || 'ANY'}`);
      console.log(`    Baggage: ${items[0].baggage}`);
      console.log(`    Max stops: ${items[0].max_stops !== null ? items[0].max_stops : 'ANY'}`);
      console.log(`    Max layover: ${items[0].max_layover_hours || 'ANY'}`);

      routeMetaMap.set(testRoute.id, { route, items });

      items.forEach(item => {
        batchItems.push({
          ...item,
          routeId: testRoute.id
        });
      });
    }

    console.log(`\n  ✅ Всего подготовлено ${batchItems.length} URLs для проверки\n`);

    // ========================================
    // Проверяем фильтры в batchItems
    // ========================================
    console.log('🔍 Проверка что фильтры различаются:\n');

    const route1Items = batchItems.filter(i => i.routeId === 98001);
    const route2Items = batchItems.filter(i => i.routeId === 98002);
    const route3Items = batchItems.filter(i => i.routeId === 98003);
    const route4Items = batchItems.filter(i => i.routeId === 98004);

    // Проверка Route 1 (Emirates)
    if (route1Items[0].airline !== 'EK') {
      console.error('  ❌ Route 1: airline должен быть EK');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 1: airline = EK');
    }

    if (route1Items[0].max_stops !== 0) {
      console.error('  ❌ Route 1: max_stops должен быть 0');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 1: max_stops = 0 (прямой)');
    }

    // Проверка Route 2 (любая а/к)
    if (route2Items[0].airline !== null) {
      console.error(`  ❌ Route 2: airline должен быть null, получен ${route2Items[0].airline}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 2: airline = null');
    }

    if (route2Items[0].max_stops !== 1) {
      console.error('  ❌ Route 2: max_stops должен быть 1');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 2: max_stops = 1');
    }

    // Проверка Route 3 (Аэрофлот)
    if (route3Items[0].airline !== 'SU') {
      console.error('  ❌ Route 3: airline должен быть SU');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 3: airline = SU');
    }

    if (route3Items[0].max_stops !== 2) {
      console.error('  ❌ Route 3: max_stops должен быть 2');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 3: max_stops = 2');
    }

    // Проверка Route 4 (короткая пересадка)
    if (route4Items[0].max_layover_hours !== 3) {
      console.error('  ❌ Route 4: max_layover_hours должен быть 3');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Route 4: max_layover_hours = 3');
    }

    // ========================================
    // Выполняем batch-проверку
    // ========================================
    console.log('\n🚀 Запуск batch-проверки с индивидуальными фильтрами...\n');

    const urlsWithFilters = batchItems.map(item => ({
      url: item.url,
      airline: item.airline,
      baggage: item.baggage,
      max_stops: item.max_stops,
      max_layover_hours: item.max_layover_hours
    }));

    const startTime = Date.now();
    const response = await monitor.pricer.getPricesFromUrlsWithIndividualFilters(urlsWithFilters);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Batch-проверка завершена за ${elapsed}s`);
    console.log(`📊 Успешно: ${response.stats.success}/${response.stats.total}\n`);

    // ========================================
    // Обрабатываем результаты
    // ========================================
    console.log('💾 Обработка результатов...\n');

    const routeResults = new Map();

    for (let i = 0; i < response.results.length; i++) {
      const item = batchItems[i];
      const result = response.results[i];

      if (!routeResults.has(item.routeId)) {
        routeResults.set(item.routeId, []);
      }

      routeResults.get(item.routeId).push({
        combination: item.combination,
        priceResult: result,
        url: item.url
      });
    }

    for (const [routeId, results] of routeResults) {
      const meta = routeMetaMap.get(routeId);
      await monitor.processBatchResults(routeId, meta.route, results);
      console.log(`  ✅ Route #${routeId}: результаты сохранены`);
    }

    // ========================================
    // Проверяем что цены различаются
    // ========================================
    console.log('\n💰 Анализ цен (ожидается что фильтры влияют на цену):\n');

    const prices = {};

    for (const testRoute of testRoutes) {
      const results = await new Promise((resolve, reject) => {
        db.all(`
          SELECT total_price FROM route_results
          WHERE route_id = ?
          ORDER BY total_price ASC
          LIMIT 1
        `, [testRoute.id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      if (results.length > 0) {
        prices[testRoute.id] = results[0].total_price;
        console.log(`  Route #${testRoute.id} (${testRoute.name}): ${results[0].total_price.toLocaleString('ru-RU')} ₽`);
      } else {
        console.log(`  Route #${testRoute.id} (${testRoute.name}): результатов не найдено`);
      }
    }

    // Сравнение цен
    if (Object.keys(prices).length >= 2) {
      const priceValues = Object.values(prices);
      const uniquePrices = new Set(priceValues);

      if (uniquePrices.size === 1) {
        console.warn('\n  ⚠️  ПРЕДУПРЕЖДЕНИЕ: все цены одинаковые, возможно фильтры не применились');
      } else {
        console.log('\n  ✅ Цены различаются, фильтры работают корректно');
      }
    }

  } catch (error) {
    console.error('❌ Критическая ошибка теста:', error);
    allTestsPassed = false;
  } finally {
    console.log('\n🧹 Очистка тестовых данных...');
    await cleanupTestData();
    console.log('✅ Тестовые данные удалены\n');
  }

  // Итоговый результат
  console.log('========================================');
  if (allTestsPassed) {
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО');
  } else {
    console.log('❌ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛИЛИСЬ');
    process.exit(1);
  }
  console.log('========================================\n');

  db.close();
}

// Запуск теста
runTest().catch(error => {
  console.error('❌ Критическая ошибка теста:', error);
  db.close();
  process.exit(1);
});
