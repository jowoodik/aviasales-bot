/**
 * Тест автоархивации маршрутов с истекшими датами
 *
 * Проверяет:
 * 1. Архивацию фиксированных маршрутов с прошедшей датой вылета
 * 2. Архивацию гибких маршрутов с полностью прошедшим диапазоном
 * 3. Сохранение актуальных маршрутов
 * 4. Фильтрацию комбинаций для частично прошедших гибких маршрутов
 * 5. Учет таймзоны пользователя
 */

require('dotenv').config();
const db = require('../config/database');
const UnifiedRoute = require('../models/UnifiedRoute');
const TimezoneUtils = require('../utils/timezoneUtils');

// Тестовые данные
const TEST_CHAT_ID = 999999999;
const TEST_TIMEZONE = 'Asia/Yekaterinburg'; // UTC+5

// Цвета для вывода
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Получить "сегодня" в таймзоне пользователя
function getTodayInUserTimezone(timezone) {
  const userNow = TimezoneUtils.getCurrentTimeInTimezone(timezone);
  userNow.setHours(0, 0, 0, 0);
  return userNow;
}

// Очистка тестовых данных
async function cleanup() {
  return new Promise((resolve) => {
    db.serialize(() => {
      db.run('DELETE FROM unified_routes WHERE chat_id = ?', [TEST_CHAT_ID]);
      db.run('DELETE FROM user_settings WHERE chat_id = ?', [TEST_CHAT_ID]);
      db.run('DELETE FROM user_subscriptions WHERE chat_id = ?', [TEST_CHAT_ID], resolve);
    });
  });
}

// Создание тестового пользователя
async function createTestUser() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Создаем пользователя
      db.run(
        `INSERT OR REPLACE INTO user_settings (chat_id, timezone, quiet_hours_start, quiet_hours_end)
         VALUES (?, ?, 23, 7)`,
        [TEST_CHAT_ID, TEST_TIMEZONE]
      );

      // Создаем подписку
      db.run(
        `INSERT OR REPLACE INTO user_subscriptions (chat_id, subscription_type, is_active)
         VALUES (?, 'free', 1)`,
        [TEST_CHAT_ID],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  });
}

// Получить настройки пользователя
function getUserSettings() {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM user_settings WHERE chat_id = ?',
      [TEST_CHAT_ID],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Создать тестовый маршрут
async function createRoute(routeData) {
  const route = {
    origin: 'SVX',
    destination: 'DXB',
    threshold_price: 30000,
    currency: 'RUB',
    adults: 1,
    children: 0,
    baggage: 0,
    max_stops: null,
    max_layover_hours: null,
    airline: null,
    ...routeData
  };

  return await UnifiedRoute.create(TEST_CHAT_ID, route);
}

// Проверить статус маршрута
function checkRouteStatus(routeId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, is_archived, is_flexible, departure_date, departure_start, departure_end FROM unified_routes WHERE id = ?',
      [routeId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

// Эмуляция функции проверки и архивации (из scheduler.js)
async function checkAndArchiveExpiredRoute(route, userSettings) {
  const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
  const today = getTodayInUserTimezone(timezone);

  let checkDate;
  let dateLabel;

  if (route.is_flexible) {
    checkDate = new Date(route.departure_end);
    dateLabel = `${route.departure_start} - ${route.departure_end}`;
  } else {
    checkDate = new Date(route.departure_date);
    dateLabel = route.departure_date;
  }

  checkDate.setHours(0, 0, 0, 0);

  if (checkDate < today) {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE unified_routes SET is_archived = 1 WHERE id = ?',
        [route.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    log(`    📦 Маршрут ${route.id} архивирован (дата: ${dateLabel})`, 'yellow');
    return true;
  }

  return false;
}

// ОСНОВНОЙ ТЕСТ
async function runTest() {
  log('\n🧪 ТЕСТ АВТОАРХИВАЦИИ МАРШРУТОВ\n', 'cyan');

  try {
    // Очистка
    log('1️⃣  Очистка тестовых данных...', 'blue');
    await cleanup();
    log('   ✅ Данные очищены\n', 'green');

    // Создание пользователя
    log('2️⃣  Создание тестового пользователя...', 'blue');
    await createTestUser();
    const userSettings = await getUserSettings();
    log(`   ✅ Пользователь создан (timezone: ${userSettings.timezone})\n`, 'green');

    // Получаем "сегодня" в таймзоне пользователя
    const today = getTodayInUserTimezone(TEST_TIMEZONE);
    log(`📅 Сегодня в ${TEST_TIMEZONE}: ${formatDate(today)}\n`, 'cyan');

    // Создание тестовых маршрутов
    log('3️⃣  Создание тестовых маршрутов...', 'blue');

    const routes = {};

    // Маршрут 1: Фиксированный с прошедшей датой (вчера)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    routes.expiredFixed = await createRoute({
      is_flexible: 0,
      has_return: 1,
      departure_date: formatDate(yesterday),
      return_date: formatDate(new Date(yesterday.getTime() + 7 * 24 * 60 * 60 * 1000))
    });
    log(`   ✅ Маршрут #${routes.expiredFixed}: Фиксированный ПРОШЕДШИЙ (${formatDate(yesterday)})`, 'yellow');

    // Маршрут 2: Фиксированный с будущей датой (+5 дней)
    const future = new Date(today);
    future.setDate(future.getDate() + 5);
    routes.validFixed = await createRoute({
      is_flexible: 0,
      has_return: 1,
      departure_date: formatDate(future),
      return_date: formatDate(new Date(future.getTime() + 7 * 24 * 60 * 60 * 1000))
    });
    log(`   ✅ Маршрут #${routes.validFixed}: Фиксированный АКТУАЛЬНЫЙ (${formatDate(future)})`, 'green');

    // Маршрут 3: Гибкий с полностью прошедшим диапазоном
    const pastStart = new Date(today);
    pastStart.setDate(pastStart.getDate() - 10);
    const pastEnd = new Date(today);
    pastEnd.setDate(pastEnd.getDate() - 3);
    routes.expiredFlexible = await createRoute({
      is_flexible: 1,
      has_return: 1,
      departure_start: formatDate(pastStart),
      departure_end: formatDate(pastEnd),
      min_days: 5,
      max_days: 7
    });
    log(`   ✅ Маршрут #${routes.expiredFlexible}: Гибкий ПРОШЕДШИЙ (${formatDate(pastStart)} - ${formatDate(pastEnd)})`, 'yellow');

    // Маршрут 4: Гибкий с частично прошедшим диапазоном
    const partialStart = new Date(today);
    partialStart.setDate(partialStart.getDate() - 5);
    const partialEnd = new Date(today);
    partialEnd.setDate(partialEnd.getDate() + 5);
    routes.partialFlexible = await createRoute({
      is_flexible: 1,
      has_return: 1,
      departure_start: formatDate(partialStart),
      departure_end: formatDate(partialEnd),
      min_days: 5,
      max_days: 7
    });
    log(`   ✅ Маршрут #${routes.partialFlexible}: Гибкий ЧАСТИЧНО ПРОШЕДШИЙ (${formatDate(partialStart)} - ${formatDate(partialEnd)})`, 'cyan');

    // Маршрут 5: Гибкий с будущим диапазоном
    const futureStart = new Date(today);
    futureStart.setDate(futureStart.getDate() + 5);
    const futureEnd = new Date(today);
    futureEnd.setDate(futureEnd.getDate() + 15);
    routes.validFlexible = await createRoute({
      is_flexible: 1,
      has_return: 1,
      departure_start: formatDate(futureStart),
      departure_end: formatDate(futureEnd),
      min_days: 5,
      max_days: 7
    });
    log(`   ✅ Маршрут #${routes.validFlexible}: Гибкий АКТУАЛЬНЫЙ (${formatDate(futureStart)} - ${formatDate(futureEnd)})\n`, 'green');

    // Проверка маршрутов
    log('4️⃣  Проверка и архивация маршрутов...\n', 'blue');

    for (const [key, routeId] of Object.entries(routes)) {
      const route = await checkRouteStatus(routeId);
      const isExpired = await checkAndArchiveExpiredRoute(route, userSettings);

      const status = await checkRouteStatus(routeId);
      const archived = status.is_archived === 1;

      log(`   Маршрут #${routeId} (${key}):`, 'cyan');
      log(`     - Архивирован: ${archived ? '✅ Да' : '❌ Нет'}`, archived ? 'green' : 'yellow');
      log(`     - Ожидалось: ${key.includes('expired') ? '✅ Да' : '❌ Нет'}\n`);
    }

    // Проверка комбинаций для частично прошедшего гибкого маршрута
    log('5️⃣  Проверка фильтрации комбинаций...\n', 'blue');

    const partialRoute = await checkRouteStatus(routes.partialFlexible);
    const combinationsWithoutFilter = UnifiedRoute.getCombinations(partialRoute, null);
    const combinationsWithFilter = UnifiedRoute.getCombinations(partialRoute, today);

    log(`   Маршрут #${routes.partialFlexible} (частично прошедший):`, 'cyan');
    log(`     - Без фильтра: ${combinationsWithoutFilter.length} комбинаций`);
    log(`     - С фильтром: ${combinationsWithFilter.length} комбинаций`);
    log(`     - Отфильтровано: ${combinationsWithoutFilter.length - combinationsWithFilter.length} комбинаций ✅\n`, 'green');

    if (combinationsWithFilter.length > 0) {
      const firstCombo = combinationsWithFilter[0];
      log(`     - Первая актуальная комбинация: ${firstCombo.departure_date}`, 'cyan');
    }

    // Итоговая проверка
    log('\n6️⃣  Итоговая проверка...\n', 'blue');

    const expiredFixedStatus = await checkRouteStatus(routes.expiredFixed);
    const validFixedStatus = await checkRouteStatus(routes.validFixed);
    const expiredFlexibleStatus = await checkRouteStatus(routes.expiredFlexible);
    const partialFlexibleStatus = await checkRouteStatus(routes.partialFlexible);
    const validFlexibleStatus = await checkRouteStatus(routes.validFlexible);

    const results = {
      'Фиксированный прошедший архивирован': expiredFixedStatus.is_archived === 1,
      'Фиксированный актуальный НЕ архивирован': validFixedStatus.is_archived === 0,
      'Гибкий прошедший архивирован': expiredFlexibleStatus.is_archived === 1,
      'Гибкий частично прошедший НЕ архивирован': partialFlexibleStatus.is_archived === 0,
      'Гибкий актуальный НЕ архивирован': validFlexibleStatus.is_archived === 0,
      'Комбинации отфильтрованы': combinationsWithFilter.length < combinationsWithoutFilter.length
    };

    let allPassed = true;
    for (const [test, passed] of Object.entries(results)) {
      const icon = passed ? '✅' : '❌';
      const color = passed ? 'green' : 'red';
      log(`   ${icon} ${test}`, color);
      if (!passed) allPassed = false;
    }

    // Итог
    log('\n' + '='.repeat(60), 'cyan');
    if (allPassed) {
      log('✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ!', 'green');
    } else {
      log('❌ НЕКОТОРЫЕ ТЕСТЫ НЕ ПРОШЛИ', 'red');
    }
    log('='.repeat(60) + '\n', 'cyan');

    // Очистка
    log('7️⃣  Очистка тестовых данных...', 'blue');
    await cleanup();
    log('   ✅ Данные очищены\n', 'green');

  } catch (error) {
    log(`\n❌ ОШИБКА ТЕСТА: ${error.message}`, 'red');
    console.error(error);
    await cleanup();
    process.exit(1);
  }

  process.exit(0);
}

// Запуск теста
runTest();
