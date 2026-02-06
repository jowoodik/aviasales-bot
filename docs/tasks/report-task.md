# Документация NotificationService - Актуальная реализация

## Обзор системы

NotificationService реализует приоритетную систему уведомлений с поддержкой:
- **4 уровня приоритетов**: CRITICAL, HIGH, MEDIUM, LOW
- **Прогресс-бары** для визуализации отклонения от бюджета и средней цены
- **Дайджесты** для отложенных уведомлений
- **Ночной режим** с беззвучными CRITICAL-уведомлениями
- **Лимиты** для Free подписки (3 CRITICAL в день)
- **Cooldown** для HIGH уведомлений (раз в 3 часа для Plus)

---

## Структура базы данных

### Таблица `notification_log`
```sql
CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  route_id INTEGER,
  priority TEXT NOT NULL,        -- 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  price REAL,
  message_type TEXT NOT NULL,    -- 'instant', 'digest', 'report'
  sent_at DATETIME DEFAULT (datetime('now')),
  disable_notification INTEGER DEFAULT 0
);
```

### Таблица `daily_digest_queue`
```sql
CREATE TABLE IF NOT EXISTS daily_digest_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  route_id INTEGER NOT NULL,
  priority TEXT NOT NULL,
  price REAL NOT NULL,
  avg_price REAL,
  historical_min REAL,
  best_result_id INTEGER,
  created_at DATETIME DEFAULT (datetime('now')),
  processed INTEGER DEFAULT 0
);
```

---

## Классификация приоритетов

### Метод: `classifyPriority(routeData)`

**Параметры:**
```javascript
{
  currentPrice: number,      // Текущая цена
  userBudget: number,        // Бюджет пользователя (threshold_price)
  avgPrice: number,          // Средняя цена из price_analytics
  historicalMin: number,     // Минимальная цена за всё время
  priceDropPercent: number   // Процент падения за последние 2 дня
}
```

**Возвращает:**
```javascript
{
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
  reasons: string[]  // Причины классификации
}
```

### Логика приоритетов

#### CRITICAL
- Цена <= бюджет пользователя
- Цена = исторический минимум
- Скидка >= 50% от средней цены

#### HIGH
- Превышение бюджета <= 15%
- Скидка 30-49% от средней цены
- Падение >= 15% за 24ч

#### MEDIUM
- Превышение бюджета 15-30%
- Скидка 15-29% от средней цены
- Падение 10-14% за 24ч

#### LOW
- Всё остальное

---

## Маршрутизация уведомлений

### Метод: `processAndRouteNotification(...)`

**Логика для каждого приоритета:**

| Приоритет | Ночью | Free подписка | Plus подписка |
|-----------|-------|---------------|---------------|
| **CRITICAL** | Беззвучно | Макс 3/день, затем → дайджест | Без лимита, со звуком |
| **HIGH** | → Дайджест | → Дайджест | Раз в 3ч (беззвучно), затем → дайджест |
| **MEDIUM** | → Дайджест | → Дайджест | → Дайджест |
| **LOW** | Тихо | Тихо | Тихо |

**Ночное время:** 23:00 - 08:00 в таймзоне пользователя

**Отключение уведомлений:** HIGH, MEDIUM, LOW игнорируются. CRITICAL всегда приходят.

---

## Формат уведомлений

### Структура блока маршрута

#### 1. Заголовок с маршрутом и датами
```
<b>Екатеринбург → Минск</b> • 1.05–4.05
```
- Города (не коды аэропортов) через `AirportCodeResolver`
- Даты в формате `dd.MM` (только день и месяц)
- Для односторонних: только дата вылета
- Для обратных: `dd.MM–dd.MM`

#### 2. Параметры поиска
```
👥 2 • Прямой
👥 2+1 • 1 пересадка
👥 2+1 • до 2 пересад. • 🧳 • Turkish Airlines
```

**Формат:**
- `👥 {adults}` или `👥 {adults}+{children}`
- Пересадки:
    - `max_stops = 0` → "Прямой"
    - `max_stops = 1` → "1 пересадка"
    - `max_stops < 99` → "до N пересад."
    - `max_stops >= 99` → "Любое кол-во пересадок"
- Багаж: `• 🧳` (если `baggage = true`)
- Авиакомпания: `• {название}` (если указана конкретная)

#### 3. Бюджет с прогресс-баром
```
🟢 <b>Бюджет:</b> 70 000 ₽
<code>[██████████████░]</code>
<b>Цена: 67 026 ₽</b> • -2 974 ₽ (-4%)
```

**Логика прогресс-бара:**
- Длина: 15 символов
- Заполнение: `█` (занято), `░` (свободно)
- Переполнение: добавляются символы `▓` справа (до 3 шт.)
- Индикатор: 🟢 если цена <= бюджет, 🔴 если превышает

**Расчёт:**
```javascript
const BAR_LENGTH = 15;
const budgetPercent = (currentPrice / userBudget) * 100;

if (budgetPercent > 100) {
  const overflowPercent = budgetPercent - 100;
  const overflowChars = Math.min(Math.round((overflowPercent / 50) * 3), 3);
  budgetBar = '█'.repeat(BAR_LENGTH) + '▓'.repeat(overflowChars);
} else {
  const filled = Math.round((budgetPercent / 100) * BAR_LENGTH);
  const empty = BAR_LENGTH - filled;
  budgetBar = '█'.repeat(filled) + '░'.repeat(empty);
}
```

**Разница:**
```javascript
const budgetDiff = currentPrice - userBudget;
const budgetDiffPercent = Math.round((budgetDiff / userBudget) * 100);
const budgetSign = budgetDiff >= 0 ? '+' : '';

// Вывод: • {sign}{diff}₽ ({sign}{percent}%)
```

#### 4. Средняя цена (опционально)
```
🟢 <b>Средняя:</b> 66 954 ₽
<code>[███████████████]</code>
<b>Цена: 67 026 ₽</b> • +72 ₽ (+0%)
```

**Условие отображения:** `analytics.dataPoints >= 5`

**Логика:** аналогична бюджету, но без переполнения.

#### 5. Время проверки
```
<i>Проверено в 13:55</i>
```

Формат: `HH:MM` в таймзоне пользователя.

#### 6. Статистика для гибких маршрутов
```
Сейчас выполнено 127 проверок. Всего проверок 3456
```

Отображается только для `is_flexible = 1`.

Для обычных маршрутов:
```
Всего выполнено 892 проверки
```

---

### Сводный отчёт

#### Заголовок
```
🚨 Отличные новости! • 13:55       (если есть CRITICAL)
📊 Проверка завершена • 13:55      (обычная проверка)
```

#### Разделитель между маршрутами
```
━━━━━━━━━━━━━━━━━━━━━━━
```

#### Подвал
```
Отличные цены! Не упусти 🎯       (если есть находки)
Продолжаю мониторинг 🔍           (если находок нет)
```

#### Кнопки
Inline-кнопки для каждого маршрута с ценой:
```
🔗 {Город → Город} — Смотреть →
```

Максимум 10 кнопок на сообщение.

---

## Обработка отсутствия цен

```
<b>Екатеринбург → Мальдивы</b>
❌ Цены не найдены
Ваш бюджет: 120 000 ₽

Сейчас выполнено 45 проверок. Всего проверок 2184
```

- Нет прогресс-баров
- Нет средней цены
- Показывается только бюджет и статистика проверок

---

## Дайджест

### Метод: `sendDigestForUser(chatId)`

**Когда отправляется:**
- Free: 1 раз в день в 10:00 (локальное время)
- Plus: 2 раза в день в 10:00 и 18:00

**Логика:**
1. Получить все непроцессированные элементы из `daily_digest_queue`
2. Отсортировать по приоритету (CRITICAL → HIGH → MEDIUM → LOW)
3. Для каждого элемента:
    - Получить маршрут из `unified_routes`
    - Получить лучший результат из `route_results`
    - Получить аналитику
    - Сформировать блок через `formatSingleRouteBlock()`
4. Отправить через `sendConsolidatedReport()`
5. Пометить элементы как `processed = 1`

**Звук:** Дайджест всегда приходит беззвучно (`disable_notification = true`).

---

## Вспомогательные методы

### Аналитика

#### `getRouteAnalytics(routeId)`
```sql
SELECT AVG(price) as avgPrice, MIN(price) as minPrice, COUNT(*) as dataPoints
FROM price_analytics WHERE route_id = ?
```

#### `getPriceDropPercent(routeId, currentPrice)`
```sql
SELECT MIN(price) as recentMin
FROM price_analytics
WHERE route_id = ? AND found_at > datetime('now', '-2 days')
```

Возвращает процент падения: `((recentMin - currentPrice) / recentMin) * 100`

#### `getRouteCheckStats(routeId)`
```sql
-- Последняя проверка
SELECT total_combinations, successful_checks, failed_checks, check_timestamp
FROM route_check_stats
WHERE route_id = ?
ORDER BY check_timestamp DESC LIMIT 1

-- Всего комбинаций
SELECT SUM(total_combinations) as totalAllCombinations
FROM route_check_stats WHERE route_id = ?
```

### Cooldown и лимиты

#### `_checkPriorityCooldown(chatId, routeId, priority, hours)`
```sql
SELECT COUNT(*) as cnt FROM notification_log
WHERE chat_id = ? AND route_id = ? AND priority = ?
  AND sent_at > datetime('now', '-' || ? || ' hours')
```

#### `_getCriticalCountToday(chatId)`
```sql
SELECT COUNT(*) as cnt FROM notification_log
WHERE chat_id = ? AND priority = 'CRITICAL'
  AND sent_at > datetime('now', 'start of day')
```

### Логирование

#### `_logNotification(chatId, routeId, priority, price, messageType, silent)`
```sql
INSERT INTO notification_log (chat_id, route_id, priority, price, message_type, disable_notification)
VALUES (?, ?, ?, ?, ?, ?)
```

#### `_addToDigestQueue(chatId, routeId, priority, price, analytics, bestResultId)`
```sql
INSERT INTO daily_digest_queue (chat_id, route_id, priority, price, avg_price, historical_min, best_result_id)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

---

## Форматирование

### Даты

#### `_formatShortDateForProgressBar(dateStr)`
Формат: `dd.MM`

```javascript
const day = date.getDate();
const month = String(date.getMonth() + 1).padStart(2, '0');
return `${day}.${month}`;
```

Примеры:
- `2026-05-01` → `1.05`
- `2026-12-25` → `25.12`

#### `_formatShortDateRu(dateStr)`
Формат: `d месяца`

```javascript
const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
return `${date.getDate()} ${months[date.getMonth()]}`;
```

### Время

#### `_formatTimeForUser(date, timezone)`
```javascript
return new Intl.DateTimeFormat('ru-RU', {
  timeZone: timezone,
  hour: '2-digit',
  minute: '2-digit'
}).format(date);
```

### Города

#### `airportResolver.formatRoute(origin, destination)`
```javascript
const originCity = getCityName(origin);
const destCity = getCityName(destination);
return `${originCity} → ${destCity}`;
```

Примеры:
- `SVX, MSQ` → `Екатеринбург → Минск`
- `MOW, DPS` → `Москва → Денпасар`

---

## Разбиение длинных сообщений

### Метод: `_splitMessage(text, maxLength)`

Telegram лимит: 4096 символов

**Логика:**
1. Если длина <= 4000 → возвращаем как есть
2. Разбиваем по разделителям `━━━━━━━━━━━━━━━━━━━━━━━`
3. Группируем части в чанки, не превышающие лимит
4. Inline-кнопки прикрепляются только к последнему чанку

---

## Настройки пользователя

### Таблица `user_settings`

```sql
night_mode INTEGER DEFAULT 1              -- Ночной режим (23:00-08:00)
notifications_enabled INTEGER DEFAULT 1   -- Основные уведомления
digest_enabled INTEGER DEFAULT 1          -- Дайджесты
timezone TEXT DEFAULT 'Asia/Yekaterinburg'
```

### Метод: `_isNightTime(timezone, settings)`

```javascript
if (!settings || !settings.night_mode) return false;

const tz = timezone || 'Asia/Yekaterinburg';
const now = new Date();
const userLocalTime = new Intl.DateTimeFormat('en-US', {
  timeZone: tz,
  hour: 'numeric',
  hour12: false
}).format(now);
const currentHour = parseInt(userLocalTime);

// Ночь: 23:00 - 08:00
return currentHour >= 23 || currentHour < 8;
```

---

## Broadcast (рассылки)

### Метод: `sendBroadcastMessages(chatIds, messageText, broadcastId, batchSize = 25)`

**Логика:**
1. Разбивает пользователей на батчи по 25
2. Отправляет параллельно внутри батча
3. Пауза 1 секунда между батчами (защита от rate limit)
4. Логирует успешные/неуспешные отправки через `BroadcastService`

---

## Полный workflow обработки маршрута

```
1. scheduler.js: checkUserRoutes(chatId)
   ↓
2. UnifiedMonitor.checkSingleRoute(route)
   → Сохранение в route_results, price_analytics, route_check_stats
   ↓
3. NotificationService.getRouteAnalytics(routeId)
   NotificationService.getPriceDropPercent(routeId, currentPrice)
   NotificationService.getRouteCheckStats(routeId)
   ↓
4. NotificationService.classifyPriority(routeData)
   → { priority: 'CRITICAL', reasons: [...] }
   ↓
5. NotificationService.processAndRouteNotification(...)
   → Решение: 'sent', 'sent_silent', 'digest', 'skipped', 'silent'
   ↓
6a. Если 'sent'/'sent_silent':
    NotificationService.formatSingleRouteBlock(...)
    → _sendInstantAlert(...)

6b. Если 'digest':
    → _addToDigestQueue(...)

6c. Если 'skipped'/'silent':
    → Ничего не делаем
   ↓
7. [Опционально] После всех маршрутов:
   NotificationService.sendConsolidatedReport(...)
   → Сводка по всем маршрутам пользователя
```

---

## Примеры использования

### Проверка одного маршрута
```javascript
const analytics = await notificationService.getRouteAnalytics(route.id);
const priceDropPercent = await notificationService.getPriceDropPercent(route.id, currentPrice);
const checkStats = await notificationService.getRouteCheckStats(route.id);

const { priority, reasons } = notificationService.classifyPriority({
  currentPrice: bestResult.total_price,
  userBudget: route.threshold_price,
  avgPrice: analytics.avgPrice,
  historicalMin: analytics.minPrice,
  priceDropPercent
});

const result = await notificationService.processAndRouteNotification({
  chatId,
  routeId: route.id,
  route,
  priority,
  reasons,
  currentPrice: bestResult.total_price,
  analytics,
  bestResult,
  checkStats,
  userSettings,
  subscriptionType: subscription.type
});

console.log(result); // { action: 'sent', priority: 'CRITICAL' }
```

### Отправка дайджеста
```javascript
// В cron задаче (каждый час)
const users = await getUsersWithPendingDigest();

for (const user of users) {
  const timezone = await notificationService._getUserTimezone(user.chat_id);
  const localHour = getLocalHour(timezone);

  const subscription = await getSubscriptionForUser(user.chat_id);
  const shouldSend = (subscription.type === 'free' && localHour === 10) ||
                     (subscription.type === 'plus' && [10, 18].includes(localHour));

  if (shouldSend) {
    await notificationService.sendDigestForUser(user.chat_id);
  }
}
```

### Сводный отчет
```javascript
const routeBlocks = [];

for (const route of routes) {
  const bestResult = await RouteResult.getTopResults(route.id, 1);
  const analytics = await notificationService.getRouteAnalytics(route.id);
  const checkStats = await notificationService.getRouteCheckStats(route.id);

  const block = notificationService.formatSingleRouteBlock(
    route, 
    bestResult[0], 
    analytics, 
    checkStats
  );

  routeBlocks.push({ 
    block, 
    route, 
    priority: /* определить */ 
  });
}

await notificationService.sendConsolidatedReport(
  chatId, 
  routeBlocks, 
  timezone, 
  false // со звуком
);
```

---

## Отличия от предыдущей версии

### Убрано
- ❌ Эмодзи в начале маршрута (🎉, ✅, 📉, 📊)
- ❌ Текстовые описания типа "на 6100₽ ниже бюджета!"
- ❌ Индикаторы приоритета в тексте `[CRITICAL]`, `[HIGH]` и т.д.
- ❌ Строка "Ваш бюджет:" как отдельная (теперь в блоке с прогресс-баром)
- ❌ Описательные контексты ("В рамках бюджета! ✅", "Превышение: Y₽")

### Добавлено
- ✅ Прогресс-бары `[█████░░░]` для бюджета и средней цены
- ✅ Индикаторы 🟢/🔴 перед "Бюджет" и "Средняя"
- ✅ Короткий формат дат `dd.MM` вместо полных дат
- ✅ Универсальный формат разницы: `• ±X₽ (±Y%)`
- ✅ Символы переполнения `▓` для прогресс-бара
- ✅ Время проверки внизу блока курсивом
- ✅ Статистика проверок для гибких маршрутов

### Изменено
- 🔄 Структура сообщения: компактнее и информативнее
- 🔄 Все данные о цене в единообразном формате
- 🔄 Параметры поиска в одной строке с эмодзи

---

## Константы и настройки

```javascript
// Прогресс-бар
const BAR_LENGTH = 15;           // Длина бара
const MAX_OVERFLOW_CHARS = 3;    // Макс символов переполнения

// Ночной режим
const NIGHT_START_HOUR = 23;     // Начало ночи
const NIGHT_END_HOUR = 8;        // Конец ночи

// Лимиты
const FREE_CRITICAL_LIMIT = 3;   // CRITICAL уведомлений в день для Free
const HIGH_COOLDOWN_HOURS = 3;   // Cooldown для HIGH (Plus)

// Дайджест
const FREE_DIGEST_HOURS = [10];         // Free: 1 раз в день
const PLUS_DIGEST_HOURS = [10, 18];    // Plus: 2 раза в день

// Telegram
const MESSAGE_CHAR_LIMIT = 4096;       // Лимит символов
const MESSAGE_SPLIT_AT = 4000;         // Разбивать с запасом
const MAX_INLINE_BUTTONS = 10;         // Макс кнопок
const BROADCAST_BATCH_SIZE = 25;       // Батч для рассылки
```
