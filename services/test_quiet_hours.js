// 🧪 Тест для проверки логики тихих часов с учетом timezone
// Запуск: node test_quiet_hours.js

// Эмулируем метод проверки тихих часов
function testQuietHours(timezone, quietStart, quietEnd, testTimeUTC) {
    const now = new Date(testTimeUTC);

    // Конвертируем UTC время в локальное время пользователя
    const userLocalTime = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
    }).format(now);

    const currentHour = parseInt(userLocalTime);

    // Проверяем тихие часы
    let isQuiet = false;

    if (quietStart > quietEnd) {
        // Через полночь (23-07)
        if (currentHour >= quietStart || currentHour < quietEnd) {
            isQuiet = true;
        }
    } else {
        // Обычный диапазон (01-06)
        if (currentHour >= quietStart && currentHour < quietEnd) {
            isQuiet = true;
        }
    }

    return {
        timezone,
        utcTime: now.toISOString(),
        localHour: currentHour,
        quietHours: `${quietStart}:00 - ${quietEnd}:00`,
        isInQuietHours: isQuiet,
        canSendNotification: !isQuiet
    };
}

// Форматируем результат
function formatResult(result) {
    const status = result.isInQuietHours ? '🔇 В ТИХИХ ЧАСАХ' : '✅ МОЖНО ОТПРАВЛЯТЬ';
    const color = result.isInQuietHours ? '\x1b[33m' : '\x1b[32m'; // желтый или зеленый
    const reset = '\x1b[0m';

    console.log(`${color}${status}${reset}`);
    console.log(`  Timezone: ${result.timezone}`);
    console.log(`  UTC время: ${result.utcTime}`);
    console.log(`  Местный час: ${result.localHour}:00`);
    console.log(`  Тихие часы: ${result.quietHours}`);
    console.log(`  Отправка: ${result.canSendNotification ? 'ДА' : 'НЕТ'}`);
    console.log('');
}

console.log('');
console.log('='.repeat(80));
console.log('🧪 ТЕСТИРОВАНИЕ ТИХИХ ЧАСОВ С УЧЕТОМ TIMEZONE');
console.log('='.repeat(80));
console.log('');

// ============================================
// ТЕСТ 1: Екатеринбург, тихие часы 23-07
// ============================================
console.log('📍 ТЕСТ 1: Екатеринбург (UTC+5), тихие часы 23:00 - 07:00');
console.log('-'.repeat(80));

// 22:00 UTC = 03:00 Екб (должно быть в тихих часах)
let result = testQuietHours('Asia/Yekaterinburg', 23, 7, '2026-02-02T22:00:00Z');
console.log('Сценарий: Ночь (22:00 UTC)');
formatResult(result);

// 02:00 UTC = 07:00 Екб (уже не в тихих часах, т.к. end=7 не включается)
result = testQuietHours('Asia/Yekaterinburg', 23, 7, '2026-02-02T02:00:00Z');
console.log('Сценарий: Утро (02:00 UTC)');
formatResult(result);

// 10:00 UTC = 15:00 Екб (не в тихих часах)
result = testQuietHours('Asia/Yekaterinburg', 23, 7, '2026-02-02T10:00:00Z');
console.log('Сценарий: День (10:00 UTC)');
formatResult(result);

// 18:00 UTC = 23:00 Екб (начало тихих часов)
result = testQuietHours('Asia/Yekaterinburg', 23, 7, '2026-02-02T18:00:00Z');
console.log('Сценарий: Вечер (18:00 UTC)');
formatResult(result);

// ============================================
// ТЕСТ 2: Москва, тихие часы 23-07
// ============================================
console.log('📍 ТЕСТ 2: Москва (UTC+3), тихие часы 23:00 - 07:00');
console.log('-'.repeat(80));

// 00:00 UTC = 03:00 МСК (в тихих часах)
result = testQuietHours('Europe/Moscow', 23, 7, '2026-02-02T00:00:00Z');
console.log('Сценарий: Ночь (00:00 UTC)');
formatResult(result);

// 04:00 UTC = 07:00 МСК (конец тихих часов, уже можно)
result = testQuietHours('Europe/Moscow', 23, 7, '2026-02-02T04:00:00Z');
console.log('Сценарий: Утро (04:00 UTC)');
formatResult(result);

// ============================================
// ТЕСТ 3: Обычный диапазон (не через полночь)
// ============================================
console.log('📍 ТЕСТ 3: Екатеринбург, тихие часы 01:00 - 06:00 (обычный диапазон)');
console.log('-'.repeat(80));

// 20:00 UTC = 01:00 Екб (начало тихих часов)
result = testQuietHours('Asia/Yekaterinburg', 1, 6, '2026-02-02T20:00:00Z');
console.log('Сценарий: Начало диапазона (20:00 UTC)');
formatResult(result);

// 00:00 UTC = 05:00 Екб (в тихих часах)
result = testQuietHours('Asia/Yekaterinburg', 1, 6, '2026-02-02T00:00:00Z');
console.log('Сценарий: В середине (00:00 UTC)');
formatResult(result);

// 01:00 UTC = 06:00 Екб (конец, уже можно)
result = testQuietHours('Asia/Yekaterinburg', 1, 6, '2026-02-02T01:00:00Z');
console.log('Сценарий: Конец диапазона (01:00 UTC)');
formatResult(result);

// 10:00 UTC = 15:00 Екб (не в тихих часах)
result = testQuietHours('Asia/Yekaterinburg', 1, 6, '2026-02-02T10:00:00Z');
console.log('Сценарий: За пределами (10:00 UTC)');
formatResult(result);

console.log('='.repeat(80));
console.log('✅ Тестирование завершено!');
console.log('');
console.log('📝 Примечания:');
console.log('   • Диапазон тихих часов: [start, end) - start включается, end нет');
console.log('   • Пример: 23-07 означает 23:00, 00:00, ..., 06:00 (07:00 уже можно)');
console.log('   • Для диапазона через полночь используется логика OR');
console.log('   • Для обычного диапазона используется логика AND');
console.log('='.repeat(80));
console.log('');
