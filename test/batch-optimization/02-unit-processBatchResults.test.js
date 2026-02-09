/**
 * Unit-тест: processBatchResults() сохраняет данные в БД
 */

require('dotenv').config();
const UnifiedMonitor = require('../../services/UnifiedMonitor');
const RouteResult = require('../../models/RouteResult');
const UnifiedRoute = require('../../models/UnifiedRoute');
const db = require('../../config/database');

// Mock бота
const bot = {
  sendMessage: () => {},
  editMessageText: () => {},
};

async function cleanupTestData(routeId) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM route_results WHERE route_id = ?', [routeId]);
      db.run('DELETE FROM route_check_stats WHERE route_id = ?', [routeId]);
      db.run('DELETE FROM combination_check_results WHERE route_id = ?', [routeId]);
      db.run('DELETE FROM price_analytics WHERE route_id = ?', [routeId]);
      db.run('DELETE FROM unified_routes WHERE id = ?', [routeId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function createTestRoute(routeId, chatId) {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO unified_routes
      (id, chat_id, origin, destination, departure_date, return_date,
       has_return, is_flexible, threshold_price,
       airline, baggage, max_stops, adults, is_paused, created_at)
      VALUES (?, ?, 'MOW', 'DXB', '2026-03-15', '2026-03-25',
              1, 0, 50000,
              'EK', 1, 1, 2, 0, datetime('now'))
    `, [routeId, chatId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function getRouteCheckStats(routeId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM route_check_stats
      WHERE route_id = ?
      ORDER BY check_timestamp DESC
      LIMIT 1
    `, [routeId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function getCombinationCheckResults(routeId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM combination_check_results
      WHERE route_id = ?
      ORDER BY check_timestamp DESC
    `, [routeId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function getPriceAnalytics(routeId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM price_analytics
      WHERE route_id = ?
      ORDER BY found_at DESC
    `, [routeId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function runTest() {
  console.log('\n========================================');
  console.log('📋 Unit-тест: processBatchResults()');
  console.log('========================================\n');

  const monitor = new UnifiedMonitor(process.env.TRAVELPAYOUTS_TOKEN, bot);
  const testRouteId = 99999;
  const testChatId = 12345;

  let allTestsPassed = true;

  try {
    // Очистка перед тестом
    await cleanupTestData(testRouteId);

    // Создание тестового маршрута
    console.log('🔧 Подготовка: создание тестового маршрута...\n');
    await createTestRoute(testRouteId, testChatId);

    // Получаем маршрут из БД
    const route = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM unified_routes WHERE id = ?', [testRouteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!route) {
      console.error('❌ ОШИБКА: не удалось создать тестовый маршрут');
      process.exit(1);
    }

    console.log(`✅ Тестовый маршрут создан: #${testRouteId}`);

    // ========================================
    // Тест 1: Сохранение успешных результатов
    // ========================================
    console.log('\n🧪 Тест 1: Сохранение успешных результатов\n');

    const mockResults = [
      {
        combination: {
          departure_date: '2026-03-15',
          return_date: '2026-03-25',
          days_in_country: null
        },
        priceResult: {
          price: 48000,
          currency: 'RUB',
          enhancedSearchLink: 'https://www.aviasales.ru/search/test1'
        },
        url: 'https://www.aviasales.ru/search/MOW1503DXB250321'
      },
      {
        combination: {
          departure_date: '2026-03-16',
          return_date: '2026-03-26',
          days_in_country: null
        },
        priceResult: {
          price: 52000,
          currency: 'RUB',
          enhancedSearchLink: 'https://www.aviasales.ru/search/test2'
        },
        url: 'https://www.aviasales.ru/search/MOW1603DXB260321'
      }
    ];

    await monitor.processBatchResults(testRouteId, route, mockResults);
    console.log('  ✅ processBatchResults() выполнен без ошибок');

    // Проверка route_results
    const routeResults = await RouteResult.getTopResults(testRouteId, 10);
    console.log(`  📊 Результатов в route_results: ${routeResults.length}`);

    if (routeResults.length !== 2) {
      console.error(`  ❌ ОШИБКА: ожидалось 2 результата, получено ${routeResults.length}`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ Количество результатов корректно');

      // Проверка цен
      const prices = routeResults.map(r => r.total_price).sort((a, b) => a - b);
      if (prices[0] !== 48000 || prices[1] !== 52000) {
        console.error(`  ❌ ОШИБКА: цены не совпадают: ${prices.join(', ')}`);
        allTestsPassed = false;
      } else {
        console.log(`  ✅ Цены корректны: ${prices.join(', ')} RUB`);
      }

      // Проверка ссылок
      const links = routeResults.map(r => r.search_link);
      if (!links[0].includes('test1') && !links[1].includes('test1')) {
        console.error('  ❌ ОШИБКА: enhancedSearchLink не сохранен');
        allTestsPassed = false;
      } else {
        console.log('  ✅ enhancedSearchLink сохранены корректно');
      }
    }

    // Проверка route_check_stats
    const checkStats = await getRouteCheckStats(testRouteId);

    if (!checkStats) {
      console.error('  ❌ ОШИБКА: статистика проверки не сохранена');
      allTestsPassed = false;
    } else {
      console.log('  ✅ Статистика проверки сохранена');

      if (checkStats.total_combinations !== 2) {
        console.error(`  ❌ ОШИБКА: total_combinations = ${checkStats.total_combinations}, ожидалось 2`);
        allTestsPassed = false;
      } else {
        console.log(`  ✅ total_combinations: ${checkStats.total_combinations}`);
      }

      if (checkStats.successful_checks !== 2) {
        console.error(`  ❌ ОШИБКА: successful_checks = ${checkStats.successful_checks}, ожидалось 2`);
        allTestsPassed = false;
      } else {
        console.log(`  ✅ successful_checks: ${checkStats.successful_checks}`);
      }

      if (checkStats.failed_checks !== 0) {
        console.error(`  ❌ ОШИБКА: failed_checks = ${checkStats.failed_checks}, ожидалось 0`);
        allTestsPassed = false;
      } else {
        console.log(`  ✅ failed_checks: ${checkStats.failed_checks}`);
      }
    }

    // Проверка combination_check_results
    const combinationResults = await getCombinationCheckResults(testRouteId);

    if (combinationResults.length !== 2) {
      console.error(`  ❌ ОШИБКА: combination_check_results содержит ${combinationResults.length} записей, ожидалось 2`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ combination_check_results: ${combinationResults.length} записей`);

      const statuses = combinationResults.map(r => r.status);
      if (!statuses.every(s => s === 'success')) {
        console.error(`  ❌ ОШИБКА: неверные статусы: ${statuses.join(', ')}`);
        allTestsPassed = false;
      } else {
        console.log(`  ✅ Все статусы: success`);
      }
    }

    // Проверка price_analytics
    const priceAnalytics = await getPriceAnalytics(testRouteId);

    if (priceAnalytics.length !== 2) {
      console.error(`  ❌ ОШИБКА: price_analytics содержит ${priceAnalytics.length} записей, ожидалось 2`);
      allTestsPassed = false;
    } else {
      console.log(`  ✅ price_analytics: ${priceAnalytics.length} записей`);
    }

    // Проверка last_check обновлен
    const updatedRoute = await new Promise((resolve, reject) => {
      db.get('SELECT last_check FROM unified_routes WHERE id = ?', [testRouteId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!updatedRoute.last_check) {
      console.error('  ❌ ОШИБКА: last_check не обновлен');
      allTestsPassed = false;
    } else {
      console.log(`  ✅ last_check обновлен: ${updatedRoute.last_check}`);
    }

    // ========================================
    // Тест 2: Сохранение с ошибками (билеты не найдены)
    // ========================================
    console.log('\n🧪 Тест 2: Сохранение результатов "не найдено"\n');

    const mockResultsNotFound = [
      {
        combination: {
          departure_date: '2026-03-17',
          return_date: '2026-03-27',
          days_in_country: null
        },
        priceResult: null, // Билеты не найдены
        url: 'https://www.aviasales.ru/search/MOW1703DXB270321'
      }
    ];

    await monitor.processBatchResults(testRouteId, route, mockResultsNotFound);
    console.log('  ✅ processBatchResults() выполнен без ошибок');

    // Проверка что статус not_found сохранен
    const combinationResultsAfter = await getCombinationCheckResults(testRouteId);
    const notFoundResults = combinationResultsAfter.filter(r => r.status === 'not_found');

    if (notFoundResults.length === 0) {
      console.error('  ❌ ОШИБКА: статус not_found не сохранен');
      allTestsPassed = false;
    } else {
      console.log(`  ✅ Статус not_found сохранен: ${notFoundResults.length} записей`);
    }

    // Проверка что в route_results не добавилось (null результат)
    const routeResultsAfter = await RouteResult.getTopResults(testRouteId, 10);
    if (routeResultsAfter.length !== 2) {
      console.error(`  ❌ ОШИБКА: null результат добавлен в route_results`);
      allTestsPassed = false;
    } else {
      console.log('  ✅ null результат корректно не добавлен в route_results');
    }

  } catch (error) {
    console.error('❌ Критическая ошибка теста:', error);
    allTestsPassed = false;
  } finally {
    // Очистка после теста
    console.log('\n🧹 Очистка тестовых данных...');
    await cleanupTestData(testRouteId);
    console.log('✅ Тестовые данные удалены\n');
  }

  // ========================================
  // Итоговый результат
  // ========================================
  console.log('========================================');
  if (allTestsPassed) {
    console.log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО');
  } else {
    console.log('❌ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛИЛИСЬ');
    process.exit(1);
  }
  console.log('========================================\n');

  // Закрываем БД
  db.close();
}

// Запуск теста
runTest().catch(error => {
  console.error('❌ Критическая ошибка теста:', error);
  db.close();
  process.exit(1);
});
