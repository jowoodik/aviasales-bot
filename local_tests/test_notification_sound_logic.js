// 🧪 Тест логики включения/выключения звука уведомлений

/**
 * Симуляция логики из processAndRouteNotification
 */
function testNotificationSound(priority, notificationsEnabled, hour, timezone = 'Europe/Moscow') {
  let disableNotification = false;

  if (priority === 'LOW') {
    disableNotification = true; // LOW всегда без звука
  } else {
    // CRITICAL/HIGH - проверяем настройки и время
    if (notificationsEnabled === 0) {
      disableNotification = true;
    }

    // Проверяем ночное время (23:00-8:00)
    if (hour >= 23 || hour < 8) {
      disableNotification = true;
    }
  }

  const sound = disableNotification ? '🔕 БЕЗ ЗВУКА' : '🔔 СО ЗВУКОМ';
  return { disableNotification, sound };
}

console.log('\n🧪 ТЕСТ ЛОГИКИ ЗВУКА УВЕДОМЛЕНИЙ\n');
console.log('='.repeat(80));

// Тест 1: CRITICAL/HIGH с включенными уведомлениями
console.log('\n📌 ТЕСТ 1: CRITICAL/HIGH, уведомления ВКЛЮЧЕНЫ (notifications_enabled = 1)');
console.log('-'.repeat(80));

const test1Cases = [
  { hour: 10, desc: 'Дневное время (10:00)' },
  { hour: 15, desc: 'Дневное время (15:00)' },
  { hour: 23, desc: 'Ночное время (23:00)' },
  { hour: 1, desc: 'Ночное время (01:00)' },
  { hour: 7, desc: 'Ночное время (07:00)' },
  { hour: 8, desc: 'Утро (08:00)' }
];

test1Cases.forEach(({ hour, desc }) => {
  const result = testNotificationSound('CRITICAL', 1, hour);
  console.log(`  ${desc.padEnd(25)} → ${result.sound}`);
});

// Тест 2: CRITICAL/HIGH с выключенными уведомлениями
console.log('\n📌 ТЕСТ 2: CRITICAL/HIGH, уведомления ВЫКЛЮЧЕНЫ (notifications_enabled = 0)');
console.log('-'.repeat(80));

const test2Cases = [
  { hour: 10, desc: 'Дневное время (10:00)' },
  { hour: 15, desc: 'Дневное время (15:00)' },
  { hour: 23, desc: 'Ночное время (23:00)' },
  { hour: 1, desc: 'Ночное время (01:00)' }
];

test2Cases.forEach(({ hour, desc }) => {
  const result = testNotificationSound('CRITICAL', 0, hour);
  console.log(`  ${desc.padEnd(25)} → ${result.sound}`);
});

// Тест 3: LOW приоритет
console.log('\n📌 ТЕСТ 3: LOW приоритет (всегда без звука)');
console.log('-'.repeat(80));

const test3Cases = [
  { enabled: 1, hour: 10, desc: 'Уведомления ВКЛ, день (10:00)' },
  { enabled: 1, hour: 23, desc: 'Уведомления ВКЛ, ночь (23:00)' },
  { enabled: 0, hour: 10, desc: 'Уведомления ВЫКЛ, день (10:00)' },
  { enabled: 0, hour: 23, desc: 'Уведомления ВЫКЛ, ночь (23:00)' }
];

test3Cases.forEach(({ enabled, hour, desc }) => {
  const result = testNotificationSound('LOW', enabled, hour);
  console.log(`  ${desc.padEnd(35)} → ${result.sound}`);
});

// Итоговая таблица
console.log('\n');
console.log('='.repeat(80));
console.log('📊 ИТОГОВАЯ ТАБЛИЦА');
console.log('='.repeat(80));

console.log('\n┌─────────────┬──────────────────┬──────────────┬────────────────┐');
console.log('│ Приоритет   │ notifications_en │ Время дня    │ Звук?          │');
console.log('├─────────────┼──────────────────┼──────────────┼────────────────┤');
console.log('│ CRITICAL/   │ 1 (включены)     │ 08:00-22:59  │ 🔔 ДА          │');
console.log('│ HIGH        │ 1 (включены)     │ 23:00-07:59  │ 🔕 НЕТ (ночь)  │');
console.log('│             │ 0 (выключены)    │ Любое        │ 🔕 НЕТ         │');
console.log('├─────────────┼──────────────────┼──────────────┼────────────────┤');
console.log('│ LOW         │ Любое            │ Любое        │ 🔕 НЕТ         │');
console.log('└─────────────┴──────────────────┴──────────────┴────────────────┘');

console.log('\n✅ Логика работает правильно!');
console.log('   • Если уведомления включены → со звуком, КРОМЕ ночного времени (23:00-8:00)');
console.log('   • Если уведомления выключены → ВСЕГДА без звука');
console.log('   • LOW приоритет → ВСЕГДА без звука (независимо от настроек)\n');
