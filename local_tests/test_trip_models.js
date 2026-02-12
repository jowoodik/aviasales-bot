// Тесты для моделей Trip, TripLeg, TripResult
// Используем in-memory SQLite для изоляции от продакшн БД

const sqlite3 = require('sqlite3').verbose();

let db;
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

// =============================================
// Настройка in-memory БД
// =============================================
function setupDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run(`
          CREATE TABLE trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            departure_start TEXT NOT NULL,
            departure_end TEXT NOT NULL,
            adults INTEGER DEFAULT 1,
            children INTEGER DEFAULT 0,
            airline TEXT,
            baggage INTEGER DEFAULT 0,
            max_stops INTEGER,
            max_layover_hours INTEGER,
            threshold_price REAL NOT NULL,
            currency TEXT DEFAULT 'RUB',
            is_paused INTEGER DEFAULT 0,
            is_archived INTEGER DEFAULT 0,
            last_check TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `);

        db.run(`
          CREATE TABLE trip_legs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL REFERENCES trips(id),
            leg_order INTEGER NOT NULL,
            origin TEXT NOT NULL,
            destination TEXT NOT NULL,
            min_days INTEGER,
            max_days INTEGER
          )
        `);

        db.run(`
          CREATE TABLE trip_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL REFERENCES trips(id),
            total_price REAL NOT NULL,
            found_at TEXT DEFAULT (datetime('now'))
          )
        `);

        db.run(`
          CREATE TABLE trip_leg_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_result_id INTEGER NOT NULL REFERENCES trip_results(id),
            leg_order INTEGER NOT NULL,
            departure_date TEXT NOT NULL,
            price REAL,
            airline TEXT,
            search_link TEXT
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });
}

// Подменяем require('../config/database') на in-memory db
const Module = require('module');
const originalResolve = Module._resolveFilename;
const path = require('path');

// Хак: подменяем модуль database на наш in-memory
const dbModulePath = path.resolve(__dirname, '../config/database.js');
let dbProxy = null;

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === '../config/database' || request === path.resolve(__dirname, '../config/database')) {
    // Возвращаем путь к нашему прокси
    return '__inmemory_db__';
  }
  return originalResolve.apply(this, arguments);
};

// Подменяем кеш модулей
require.cache['__inmemory_db__'] = {
  id: '__inmemory_db__',
  filename: '__inmemory_db__',
  loaded: true,
  get exports() { return db; }
};

// Теперь загружаем модели - они будут использовать наш in-memory db
let Trip, TripLeg, TripResult;

async function runTests() {
  try {
    // Настраиваем БД
    await setupDatabase();
    console.log('✅ In-memory БД создана\n');

    // Загружаем модели после создания БД
    Trip = require('../models/Trip');
    TripLeg = require('../models/TripLeg');
    TripResult = require('../models/TripResult');

    // =============================================
    // Тест 1: Trip.create
    // =============================================
    console.log('📋 Тест 1: Trip.create');
    {
      const tripId = await Trip.create(12345, {
        name: 'SVX → IST → SVX',
        departure_start: '2026-04-01',
        departure_end: '2026-04-05',
        adults: 2,
        children: 1,
        airline: 'S7',
        baggage: true,
        max_stops: 1,
        max_layover_hours: 6,
        threshold_price: 50000,
        currency: 'RUB'
      });

      assert(tripId > 0, 'трип создан с id > 0');
      assertEqual(typeof tripId, 'number', 'id - число');
    }

    // =============================================
    // Тест 2: Trip.findById
    // =============================================
    console.log('\n📋 Тест 2: Trip.findById');
    {
      const trip = await Trip.findById(1);
      assert(trip !== null, 'трип найден');
      assertEqual(trip.chat_id, 12345, 'chat_id = 12345');
      assertEqual(trip.name, 'SVX → IST → SVX', 'name корректен');
      assertEqual(trip.departure_start, '2026-04-01', 'departure_start');
      assertEqual(trip.departure_end, '2026-04-05', 'departure_end');
      assertEqual(trip.adults, 2, 'adults = 2');
      assertEqual(trip.children, 1, 'children = 1');
      assertEqual(trip.airline, 'S7', 'airline = S7');
      assertEqual(trip.baggage, 1, 'baggage = 1 (true → 1)');
      assertEqual(trip.max_stops, 1, 'max_stops = 1');
      assertEqual(trip.max_layover_hours, 6, 'max_layover_hours = 6');
      assertEqual(trip.threshold_price, 50000, 'threshold_price = 50000');
      assertEqual(trip.is_paused, 0, 'is_paused = 0');
      assertEqual(trip.is_archived, 0, 'is_archived = 0');
    }

    // =============================================
    // Тест 3: Trip.findById - несуществующий
    // =============================================
    console.log('\n📋 Тест 3: Trip.findById - несуществующий');
    {
      const trip = await Trip.findById(999);
      assertEqual(trip, undefined, 'несуществующий трип → undefined');
    }

    // =============================================
    // Тест 4: TripLeg.createMany и getByTripId
    // =============================================
    console.log('\n📋 Тест 4: TripLeg.createMany и getByTripId');
    {
      await TripLeg.createMany(1, [
        { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 3, max_days: 5 },
        { leg_order: 2, origin: 'IST', destination: 'SVX', min_days: null, max_days: null }
      ]);

      const legs = await TripLeg.getByTripId(1);
      assertEqual(legs.length, 2, '2 ноги созданы');

      assertEqual(legs[0].leg_order, 1, 'нога 1: leg_order = 1');
      assertEqual(legs[0].origin, 'SVX', 'нога 1: origin = SVX');
      assertEqual(legs[0].destination, 'IST', 'нога 1: destination = IST');
      assertEqual(legs[0].min_days, 3, 'нога 1: min_days = 3');
      assertEqual(legs[0].max_days, 5, 'нога 1: max_days = 5');

      assertEqual(legs[1].leg_order, 2, 'нога 2: leg_order = 2');
      assertEqual(legs[1].origin, 'IST', 'нога 2: origin = IST');
      assertEqual(legs[1].destination, 'SVX', 'нога 2: destination = SVX');
      assertEqual(legs[1].min_days, null, 'нога 2: min_days = null');
      assertEqual(legs[1].max_days, null, 'нога 2: max_days = null');
    }

    // =============================================
    // Тест 5: TripLeg.getByTripId - несуществующий трип
    // =============================================
    console.log('\n📋 Тест 5: TripLeg.getByTripId - несуществующий трип');
    {
      const legs = await TripLeg.getByTripId(999);
      assertEqual(legs.length, 0, 'пустой массив для несуществующего трипа');
    }

    // =============================================
    // Тест 6: TripResult.save и getBestResult
    // =============================================
    console.log('\n📋 Тест 6: TripResult.save и getBestResult');
    {
      // Сохраняем несколько результатов
      await TripResult.save(1, 45000, [
        { legOrder: 1, departureDate: '2026-04-02', price: 25000, airline: 'S7', searchLink: 'link1' },
        { legOrder: 2, departureDate: '2026-04-05', price: 20000, airline: 'SU', searchLink: 'link2' }
      ]);

      await TripResult.save(1, 38000, [
        { legOrder: 1, departureDate: '2026-04-03', price: 22000, airline: 'TK', searchLink: 'link3' },
        { legOrder: 2, departureDate: '2026-04-06', price: 16000, airline: 'S7', searchLink: 'link4' }
      ]);

      await TripResult.save(1, 52000, [
        { legOrder: 1, departureDate: '2026-04-01', price: 30000, airline: 'SU' },
        { legOrder: 2, departureDate: '2026-04-04', price: 22000, airline: 'S7' }
      ]);

      const best = await TripResult.getBestResult(1);
      assert(best !== null, 'лучший результат найден');
      assertEqual(best.total_price, 38000, 'лучшая цена = 38000');
      assertEqual(best.legs.length, 2, '2 ноги в результате');
      assertEqual(best.legs[0].price, 22000, 'нога 1: цена = 22000');
      assertEqual(best.legs[0].airline, 'TK', 'нога 1: airline = TK');
      assertEqual(best.legs[1].price, 16000, 'нога 2: цена = 16000');
    }

    // =============================================
    // Тест 7: TripResult.getTopResults
    // =============================================
    console.log('\n📋 Тест 7: TripResult.getTopResults');
    {
      const top = await TripResult.getTopResults(1, 2);
      assertEqual(top.length, 2, '2 лучших результата');
      assertEqual(top[0].total_price, 38000, 'первый = 38000');
      assertEqual(top[1].total_price, 45000, 'второй = 45000');
      assert(top[0].legs.length === 2, 'у первого 2 ноги');
      assert(top[1].legs.length === 2, 'у второго 2 ноги');
    }

    // =============================================
    // Тест 8: TripResult.getBestResult - нет результатов
    // =============================================
    console.log('\n📋 Тест 8: TripResult.getBestResult - нет результатов');
    {
      const best = await TripResult.getBestResult(999);
      assertEqual(best, null, 'null для несуществующего трипа');
    }

    // =============================================
    // Тест 9: TripResult.getTopResults - пустой
    // =============================================
    console.log('\n📋 Тест 9: TripResult.getTopResults - пустой');
    {
      const top = await TripResult.getTopResults(999, 3);
      assertEqual(top.length, 0, 'пустой массив для несуществующего трипа');
    }

    // =============================================
    // Тест 10: Trip.updateThreshold
    // =============================================
    console.log('\n📋 Тест 10: Trip.updateThreshold');
    {
      await Trip.updateThreshold(1, 60000);
      const trip = await Trip.findById(1);
      assertEqual(trip.threshold_price, 60000, 'бюджет обновлён на 60000');
    }

    // =============================================
    // Тест 11: Trip.updatePauseStatus
    // =============================================
    console.log('\n📋 Тест 11: Trip.updatePauseStatus');
    {
      await Trip.updatePauseStatus(1, true);
      let trip = await Trip.findById(1);
      assertEqual(trip.is_paused, 1, 'трип поставлен на паузу');

      await Trip.updatePauseStatus(1, false);
      trip = await Trip.findById(1);
      assertEqual(trip.is_paused, 0, 'трип снят с паузы');
    }

    // =============================================
    // Тест 12: Trip.setAsArchived
    // =============================================
    console.log('\n📋 Тест 12: Trip.setAsArchived');
    {
      // Создаем второй трип для архивации
      const tripId = await Trip.create(12345, {
        name: 'SVX → LED',
        departure_start: '2026-01-01',
        departure_end: '2026-01-05',
        threshold_price: 20000
      });

      await Trip.setAsArchived(tripId);
      const trip = await Trip.findById(tripId);
      assertEqual(trip.is_archived, 1, 'трип архивирован');
    }

    // =============================================
    // Тест 13: Trip.getActiveByChatId
    // =============================================
    console.log('\n📋 Тест 13: Trip.getActiveByChatId');
    {
      // Трип 1: активен (is_paused=0, is_archived=0)
      // Трип 2: архивирован (is_archived=1) - не должен быть в списке

      const active = await Trip.getActiveByChatId(12345);
      assertEqual(active.length, 1, '1 активный трип (архивированный исключён)');
      assertEqual(active[0].name, 'SVX → IST → SVX', 'правильный трип');
    }

    // =============================================
    // Тест 14: Trip.findNonArchivedByChatId
    // =============================================
    console.log('\n📋 Тест 14: Trip.findNonArchivedByChatId');
    {
      // Ставим первый трип на паузу
      await Trip.updatePauseStatus(1, true);

      const nonArchived = await Trip.findNonArchivedByChatId(12345);
      assertEqual(nonArchived.length, 1, '1 неархивированный трип');
      assertEqual(nonArchived[0].is_paused, 1, 'он на паузе, но не архивирован');

      // Возвращаем обратно
      await Trip.updatePauseStatus(1, false);
    }

    // =============================================
    // Тест 15: Trip.getAllActive
    // =============================================
    console.log('\n📋 Тест 15: Trip.getAllActive');
    {
      // Создаем трип для другого пользователя
      await Trip.create(99999, {
        name: 'MOW → DXB → MOW',
        departure_start: '2026-06-01',
        departure_end: '2026-06-10',
        threshold_price: 80000
      });

      const allActive = await Trip.getAllActive();
      assertEqual(allActive.length, 2, '2 активных трипа от разных пользователей');
    }

    // =============================================
    // Тест 16: Trip.updateLastCheck
    // =============================================
    console.log('\n📋 Тест 16: Trip.updateLastCheck');
    {
      await Trip.updateLastCheck(1);
      const trip = await Trip.findById(1);
      assert(trip.last_check !== null, 'last_check обновлён');
    }

    // =============================================
    // Тест 17: TripResult.save без leg results
    // =============================================
    console.log('\n📋 Тест 17: TripResult.save без leg results');
    {
      const resultId = await TripResult.save(1, 30000, []);
      assert(resultId > 0, 'результат создан без деталей ног');
    }

    // =============================================
    // Тест 18: TripResult.cleanOldResults
    // =============================================
    console.log('\n📋 Тест 18: TripResult.cleanOldResults');
    {
      // У нас уже 4 результата для трипа 1 (3 из теста 6 + 1 из теста 17)
      const beforeClean = await TripResult.getTopResults(1, 100);
      assert(beforeClean.length === 4, `до очистки: ${beforeClean.length} результатов`);

      // Оставляем только 2 самых новых
      await TripResult.cleanOldResults(1, 2);

      const afterClean = await TripResult.getTopResults(1, 100);
      assert(afterClean.length === 2, `после очистки: ${afterClean.length} результатов (оставлено 2)`);
    }

    // =============================================
    // Тест 19: Trip.delete (каскадное удаление)
    // =============================================
    console.log('\n📋 Тест 19: Trip.delete - каскадное удаление');
    {
      await Trip.delete(1);

      const trip = await Trip.findById(1);
      assertEqual(trip, undefined, 'трип удалён');

      const legs = await TripLeg.getByTripId(1);
      assertEqual(legs.length, 0, 'ноги удалены');

      const results = await TripResult.getTopResults(1, 100);
      assertEqual(results.length, 0, 'результаты удалены');
    }

    // =============================================
    // Тест 20: Trip.create с минимальными данными (дефолты)
    // =============================================
    console.log('\n📋 Тест 20: Trip.create - дефолтные значения');
    {
      const tripId = await Trip.create(55555, {
        name: 'TEST',
        departure_start: '2026-07-01',
        departure_end: '2026-07-05',
        threshold_price: 10000
      });

      const trip = await Trip.findById(tripId);
      assertEqual(trip.adults, 1, 'adults по умолчанию = 1');
      assertEqual(trip.children, 0, 'children по умолчанию = 0');
      assertEqual(trip.airline, null, 'airline по умолчанию = null');
      assertEqual(trip.baggage, 0, 'baggage по умолчанию = 0');
      assertEqual(trip.currency, 'RUB', 'currency по умолчанию = RUB');
      assertEqual(trip.is_paused, 0, 'is_paused по умолчанию = 0');
      assertEqual(trip.is_archived, 0, 'is_archived по умолчанию = 0');
    }

    // =============================================
    // Тест 21: TripLeg.createMany - 3 ноги
    // =============================================
    console.log('\n📋 Тест 21: TripLeg.createMany - 3 ноги');
    {
      const tripId = await Trip.create(77777, {
        name: 'SVX → IST → AYT → SVX',
        departure_start: '2026-08-01',
        departure_end: '2026-08-05',
        threshold_price: 100000
      });

      await TripLeg.createMany(tripId, [
        { leg_order: 1, origin: 'SVX', destination: 'IST', min_days: 3, max_days: 5 },
        { leg_order: 2, origin: 'IST', destination: 'AYT', min_days: 2, max_days: 4 },
        { leg_order: 3, origin: 'AYT', destination: 'SVX' }
      ]);

      const legs = await TripLeg.getByTripId(tripId);
      assertEqual(legs.length, 3, '3 ноги созданы');
      assertEqual(legs[0].origin, 'SVX', 'нога 1: SVX');
      assertEqual(legs[1].origin, 'IST', 'нога 2: IST');
      assertEqual(legs[2].origin, 'AYT', 'нога 3: AYT');
      assertEqual(legs[2].min_days, null, 'нога 3: min_days = null (без дефолта)');
    }

  } catch (error) {
    console.error('\n💥 КРИТИЧЕСКАЯ ОШИБКА:', error);
    failed++;
  } finally {
    // Закрываем БД
    if (db) {
      db.close();
    }

    // Восстанавливаем require
    Module._resolveFilename = originalResolve;
    delete require.cache['__inmemory_db__'];

    // Итого
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 РЕЗУЛЬТАТЫ: ${passed} пройдено, ${failed} провалено из ${passed + failed}`);
    if (failed === 0) {
      console.log('🎉 Все тесты пройдены!');
    } else {
      console.log('⚠️  Есть проваленные тесты!');
      process.exit(1);
    }
  }
}

runTests();
