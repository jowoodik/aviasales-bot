# Модель периодичности оповещений

## Уровни приоритета с учётом звука

### 🚨 CRITICAL — со звуком, ВСЕГДА

```javascript
const isCritical = (route) => {
  return (
    route.currentPrice <= route.userBudget ||
    route.currentPrice < route.historicalMin ||
    route.currentPrice <= route.avgPrice * 0.5
  );
};
```

**Формат сообщения:** 🔥🔥🔥 СУПЕР ЦЕНА! с inline-кнопкой "КУПИТЬ СЕЙЧАС"

**Почему со звуком:** Реальная возможность купить дёшево

**Игнорирует настройки:** Даже если пользователь отключил уведомления

---

### 🔥 HIGH — беззвучно, не чаще 1 раза в 6 часов

```javascript
const isHigh = (route) => {
  return (
    (route.currentPrice > route.userBudget && 
     route.currentPrice <= route.userBudget * 1.15) ||
    (route.currentPrice <= route.avgPrice * 0.7 && 
     route.currentPrice > route.avgPrice * 0.5) ||
    route.priceDropPercent >= 15
  );
};
```

**Формат сообщения:** 📊 Хорошая цена найдена с inline-кнопкой "Посмотреть билет"

**Почему беззвучно:** Хорошая цена, но не критично

**Уважает настройки:** Если пользователь отключил уведомления → не отправляем

---

### 📊 MEDIUM — дневной дайджест (беззвучно)

```javascript
const isMedium = (route) => {
  return (
    (route.currentPrice > route.userBudget * 1.15 && 
     route.currentPrice <= route.userBudget * 1.3) ||
    (route.currentPrice <= route.avgPrice * 0.85 && 
     route.currentPrice > route.avgPrice * 0.7) ||
    (route.priceDropPercent >= 10 && route.priceDropPercent < 15)
  );
};
```

**Формат сообщения:** Компактный с минимумом деталей

---

### 🔕 LOW — тихое обновление

```javascript
const isLow = (route) => {
  return (
    route.currentPrice > route.userBudget * 1.3 ||
    route.currentPrice >= route.avgPrice * 0.85 ||
    route.priceDropPercent < 10
  );
};
```

**Формат сообщения:** Минимальная информация, только цена и превышение

---

## Логика с учётом настроек

```javascript
async function processRouteCheck(route, user) {
  const priority = getPriority(route);
  const notificationsEnabled = user.settings.notificationsEnabled;
  
  switch (priority) {
    case 'CRITICAL':
      await sendTelegramMessage(route, {
        disable_notification: false,
        ignore_user_settings: true,
        button_text: '🎫 КУПИТЬ СЕЙЧАС'
      });
      break;
      
    case 'HIGH':
      if (notificationsEnabled) {
        const lastNotif = await getLastNotification(route);
        if (Date.now() - lastNotif > 6 * 60 * 60 * 1000) {
          await sendTelegramMessage(route, {
            disable_notification: true,
            button_text: '🎫 Посмотреть билет'
          });
        }
      }
      break;
      
    case 'MEDIUM':
      if (notificationsEnabled) {
        await addToDailyDigest(route);
      }
      break;
      
    case 'LOW':
      await updateInBotSilently(route);
      break;
  }
}
```

---

## Ночной режим (23:00 - 08:00)

```javascript
const isNightTime = () => {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 8;
};

if (isNightTime() && user.settings.nightMode) {
  if (priority === 'CRITICAL') {
    await sendTelegramMessage(route, {
      disable_notification: true  // ночью беззвучно
    });
  } else {
    await scheduleFor08AM(route);
  }
}
```

---

## Различия между Plus и Free

### Plus:
- Проверки **каждый час**
- HIGH уведомления **раз в 3 часа**
- Дайджест **2 раза в день** (10:00 и 18:00)

### Free:
- Проверки **каждые 2 часа**
- HIGH уведомления **только в дайджесте**
- Дайджест **1 раз в день** (10:00)
- Лимит: **3 CRITICAL в день**

---

## Итоговая таблица

| Приоритет | Звук | Игнорирует "Выкл"? | Формат | Кнопка |
|-----------|------|-------------------|--------|--------|
| 🚨 CRITICAL | Да | ✅ Да | 🔥🔥🔥 СУПЕР ЦЕНА! | КУПИТЬ СЕЙЧАС |
| 🔥 HIGH | Нет | ❌ Нет | 📊 Хорошая цена | Посмотреть билет |
| 📊 MEDIUM | Нет | ❌ Нет | Компактный | В сводке |
| 🔕 LOW | Нет | — | Минимальный | Нет |

---

## Примеры inline-кнопок

### CRITICAL
```javascript
reply_markup: {
  inline_keyboard: [[
    { text: '🎫 КУПИТЬ СЕЙЧАС', url: aviasalesUrl }
  ]]
}
```

### HIGH
```javascript
reply_markup: {
  inline_keyboard: [[
    { text: '🎫 Посмотреть билет', url: aviasalesUrl }
  ]]
}
```

### Сводный отчёт
```javascript
reply_markup: {
  inline_keyboard: [
    [{ text: '🔗 Москва → Бали — Смотреть →', url: url1 }],
    [{ text: '🔗 Екатеринбург → Стамбул — Смотреть →', url: url2 }]
  ]
}
```
```

Основные изменения:
1. **Убраны прогресс-бары** - заменены на простые числа
2. **Разные форматы** для CRITICAL/HIGH/MEDIUM - каждый со своей психологией
3. **Inline-кнопки** вместо текстовых ссылок
4. **Акцент на экономии** в рублях для CRITICAL
5. **Элементы срочности** для критичных находок
6. **Динамический самолёт** в разделителях сводного отчёта

Теперь визуализация отражает важность находок и мотивирует к покупке! 🎯