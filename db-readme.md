Вот полная документация по структуре базы данных и связям между таблицами:

***

# 📊 ДОКУМЕНТАЦИЯ: СТРУКТУРА БАЗЫ ДАННЫХ

## 🗂️ Обзор таблиц

База данных содержит **10 основных таблиц**:

1. **user_settings** - настройки пользователей
2. **unified_routes** - маршруты (фиксированные и гибкие)
3. **route_results** - найденные билеты
4. **route_check_stats** - статистика проверок
5. **combination_check_results** - детальные результаты проверок
6. **price_analytics** - аналитика цен
7. **user_stats** - статистика пользователей
8. **user_subscriptions** - подписки пользователей
9. **subscription_types** - типы подписок
10. **notification_cooldown** - таймауты уведомлений

***

## 🔗 ДИАГРАММА СВЯЗЕЙ

```
┌─────────────────────┐
│   user_settings     │
│  (chat_id - PK)     │
└──────────┬──────────┘
           │ 1
           │
           │ N
┌──────────┴──────────┐
│  unified_routes     │◄────────────────────┐
│  (id - PK)          │                     │
│  (chat_id - FK)     │                     │
└──────────┬──────────┘                     │
           │ 1                              │
           ├──────────┬─────────┬───────────┤
           │ N        │ N       │ N         │ N
┌──────────┴─────┐ ┌──┴─────┐ ┌─┴────────┐ ┌┴──────────────────┐
│ route_results  │ │route_  │ │combination│ │ price_analytics   │
│ (route_id-FK)  │ │check_  │ │_check_    │ │ (route_id - FK)   │
│                │ │stats   │ │results    │ │ (chat_id - FK)    │
└────────────────┘ │(FK)    │ │(FK)       │ └───────────────────┘
                   └────────┘ └───────────┘

┌─────────────────────┐         ┌─────────────────────┐
│ user_subscriptions  │    N:1  │ subscription_types  │
│ (chat_id - FK)      │────────►│ (name - PK)         │
└─────────────────────┘         └─────────────────────┘

┌─────────────────────┐
│ notification_       │
│ cooldown            │
│ (chat_id - PK)      │
└─────────────────────┘

┌─────────────────────┐
│   user_stats        │
│ (chat_id - PK)      │
└─────────────────────┘
```

***

## 📋 ДЕТАЛЬНОЕ ОПИСАНИЕ ТАБЛИЦ

### 1️⃣ **user_settings** (Настройки пользователей)

**Назначение:** Хранит настройки пользователей бота

```sql
CREATE TABLE user_settings (
    chat_id INTEGER PRIMARY KEY,           -- Telegram chat ID
    quiet_hours_start INTEGER DEFAULT 23,  -- Начало тихих часов
    quiet_hours_end INTEGER DEFAULT 7,     -- Конец тихих часов
    timezone TEXT DEFAULT 'Asia/Yekaterinburg', -- Часовой пояс
    notify_on_check INTEGER DEFAULT 0,     -- Уведомлять о каждой проверке
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Связи:**
- `1:N` с `unified_routes` (один пользователь → много маршрутов)
- `1:1` с `user_subscriptions` (один пользователь → одна подписка)
- `1:1` с `user_stats` (один пользователь → одна статистика)
- `1:N` с `price_analytics` (один пользователь → много аналитики)

***

### 2️⃣ **unified_routes** (Маршруты)

**Назначение:** Хранит все маршруты пользователей (фиксированные и гибкие)

```sql
CREATE TABLE unified_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,              -- FK → user_settings
    
    -- Основные параметры
    origin TEXT NOT NULL,                  -- Код аэропорта вылета (IATA)
    destination TEXT NOT NULL,             -- Код аэропорта прилета (IATA)
    
    -- Тип маршрута
    is_flexible INTEGER DEFAULT 0,         -- 0 = фиксированный, 1 = гибкий
    has_return INTEGER DEFAULT 1,          -- 0 = в одну сторону, 1 = туда-обратно
    
    -- ДЛЯ ФИКСИРОВАННЫХ МАРШРУТОВ
    departure_date TEXT,                   -- Дата вылета (YYYY-MM-DD)
    return_date TEXT,                      -- Дата возврата (YYYY-MM-DD)
    
    -- ДЛЯ ГИБКИХ МАРШРУТОВ
    departure_start TEXT,                  -- Начало диапазона вылета
    departure_end TEXT,                    -- Конец диапазона вылета
    min_days INTEGER,                      -- Минимум дней в поездке
    max_days INTEGER,                      -- Максимум дней в поездке
    
    -- Параметры поиска
    adults INTEGER DEFAULT 1,              -- Количество взрослых
    children INTEGER DEFAULT 0,            -- Количество детей
    airline TEXT,                          -- Предпочитаемая авиакомпания ('any' = любая)
    baggage INTEGER DEFAULT 0,             -- 0 = только ручная кладь, 1 = 20кг
    max_stops INTEGER,                     -- Максимум пересадок (99 = любое)
    max_layover_hours INTEGER,             -- Максимум время пересадки (часы)
    
    -- Уведомления
    threshold_price REAL NOT NULL,         -- Пороговая цена для уведомлений
    currency TEXT DEFAULT 'RUB',           -- Валюта
    
    -- Служебные поля
    is_paused INTEGER DEFAULT 0,           -- 0 = активен, 1 = на паузе
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_check DATETIME,                   -- Время последней проверки
    
    FOREIGN KEY (chat_id) REFERENCES user_settings(chat_id)
);
```

**Связи:**
- `N:1` с `user_settings` (много маршрутов → один пользователь)
- `1:N` с `route_results` (один маршрут → много найденных билетов)
- `1:N` с `route_check_stats` (один маршрут → много статистик проверок)
- `1:N` с `combination_check_results` (один маршрут → много результатов проверок)
- `1:N` с `price_analytics` (один маршрут → много записей аналитики)

**Индексы:**
```sql
CREATE INDEX idx_unified_routes_chat_id ON unified_routes(chat_id);
```

***

### 3️⃣ **route_results** (Найденные билеты)

**Назначение:** Хранит найденные подходящие билеты (цена ≤ порога)

```sql
CREATE TABLE route_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,             -- FK → unified_routes
    
    departure_date TEXT NOT NULL,          -- Дата вылета найденного билета
    return_date TEXT,                      -- Дата возврата (если есть)
    days_in_country INTEGER,               -- Количество дней в поездке
    
    total_price REAL NOT NULL,             -- Общая цена билета
    airline TEXT NOT NULL,                 -- Авиакомпания
    search_link TEXT NOT NULL,             -- Ссылка на поиск Aviasales
    screenshot_path TEXT,                  -- Путь к скриншоту (если есть)
    
    found_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Когда найден
    
    FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
);
```

**Связи:**
- `N:1` с `unified_routes` (много билетов → один маршрут)

**Индексы:**
```sql
CREATE INDEX idx_route_results_route_id ON route_results(route_id);
CREATE INDEX idx_route_results_price ON route_results(route_id, total_price);
```

**Пример запроса:**
```sql
-- Получить лучшие билеты для маршрута
SELECT * FROM route_results
WHERE route_id = ?
ORDER BY total_price ASC
LIMIT 10;
```

***

### 4️⃣ **route_check_stats** (Статистика проверок)

**Назначение:** Агрегированная статистика по каждой проверке маршрута

```sql
CREATE TABLE route_check_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,             -- FK → unified_routes
    check_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    total_combinations INTEGER NOT NULL,   -- Всего проверено комбинаций
    successful_checks INTEGER NOT NULL,    -- Успешных проверок (найдены цены)
    failed_checks INTEGER NOT NULL,        -- Неудачных проверок (ошибки/не найдено)
    
    FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
);
```

**Связи:**
- `N:1` с `unified_routes` (много статистик → один маршрут)

**Индексы:**
```sql
CREATE INDEX idx_route_check_stats_route_timestamp 
ON route_check_stats(route_id, check_timestamp DESC);
```

**Пример запроса:**
```sql
-- Статистика проверок за последние 24 часа
SELECT 
    cs.*,
    (r.origin || ' → ' || r.destination) as route_name,
    r.chat_id
FROM route_check_stats cs
JOIN unified_routes r ON cs.route_id = r.id
WHERE cs.check_timestamp >= datetime('now', '-1 day')
ORDER BY cs.check_timestamp DESC;
```

***

### 5️⃣ **combination_check_results** (Детальные результаты проверок)

**Назначение:** Детальная информация о каждой проверенной комбинации дат

```sql
CREATE TABLE combination_check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER NOT NULL,             -- FK → unified_routes
    check_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    departure_date TEXT NOT NULL,          -- Проверенная дата вылета
    return_date TEXT,                      -- Проверенная дата возврата
    days_in_country INTEGER,               -- Дней в поездке
    
    status TEXT NOT NULL,                  -- 'success', 'not_found', 'error'
    price REAL,                            -- Найденная цена (если success)
    currency TEXT DEFAULT 'RUB',
    error_reason TEXT,                     -- Причина ошибки (если error)
    search_url TEXT,                       -- URL запроса
    
    FOREIGN KEY (route_id) REFERENCES unified_routes(id) ON DELETE CASCADE
);
```

**Связи:**
- `N:1` с `unified_routes` (много результатов → один маршрут)

**Индексы:**
```sql
CREATE INDEX idx_combination_check_route_timestamp 
ON combination_check_results(route_id, check_timestamp DESC);

CREATE INDEX idx_combination_check_status 
ON combination_check_results(route_id, status);
```

**Пример запроса:**
```sql
-- Все неудачные проверки
SELECT 
    ccr.*,
    (r.origin || ' → ' || r.destination) as route_name,
    r.chat_id
FROM combination_check_results ccr
JOIN unified_routes r ON ccr.route_id = r.id
WHERE ccr.status IN ('error', 'not_found')
ORDER BY ccr.check_timestamp DESC
LIMIT 100;
```

***

### 6️⃣ **price_analytics** (Аналитика цен)

**Назначение:** Собирает все найденные цены для аналитики и графиков

```sql
CREATE TABLE price_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Привязка
    route_type TEXT NOT NULL,              -- 'regular' или 'flexible'
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    route_id INTEGER,                      -- FK → unified_routes (может быть NULL)
    chat_id INTEGER,                       -- FK → user_settings (может быть NULL)
    
    -- Цена
    price REAL NOT NULL,
    airline TEXT,
    
    -- Время
    found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    hour_of_day INTEGER,                   -- Час дня (0-23)
    day_of_week INTEGER,                   -- День недели (0-6, 0=Пн)
    day_of_month INTEGER,                  -- День месяца (1-31)
    month INTEGER,                         -- Месяц (1-12)
    year INTEGER,                          -- Год
    is_weekend INTEGER,                    -- 0 = будний, 1 = выходной
    season TEXT                            -- 'winter', 'spring', 'summer', 'autumn'
);
```

**Связи:**
- `N:1` с `unified_routes` (много аналитики → один маршрут)
- `N:1` с `user_settings` (много аналитики → один пользователь)

**Индексы:**
```sql
CREATE INDEX idx_price_analytics_route_id ON price_analytics(route_id);
CREATE INDEX idx_price_analytics_date ON price_analytics(found_at);
CREATE INDEX idx_price_analytics_route ON price_analytics(origin, destination, route_id);
CREATE INDEX idx_price_analytics_time ON price_analytics(hour_of_day, day_of_week);
CREATE INDEX idx_price_analytics_chat ON price_analytics(chat_id);
```

**Пример запроса:**
```sql
-- История цен для графика
SELECT 
    price, 
    found_at, 
    airline
FROM price_analytics
WHERE route_id = ? AND chat_id = ?
ORDER BY found_at ASC;
```

***

### 7️⃣ **user_subscriptions** (Подписки пользователей)

**Назначение:** Хранит информацию о подписках пользователей

```sql
CREATE TABLE user_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL UNIQUE,       -- FK → user_settings
    subscription_type TEXT NOT NULL DEFAULT 'free', -- FK → subscription_types
    
    valid_from DATETIME DEFAULT CURRENT_TIMESTAMP,
    valid_to DATETIME,                     -- NULL для бесплатной подписки
    is_active INTEGER DEFAULT 1,           -- 0 = неактивна, 1 = активна
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (chat_id) REFERENCES user_settings(chat_id)
);
```

**Связи:**
- `1:1` с `user_settings` (одна подписка → один пользователь)
- `N:1` с `subscription_types` (много подписок → один тип)

**Индексы:**
```sql
CREATE INDEX idx_user_subscriptions_chat_id ON user_subscriptions(chat_id);
CREATE INDEX idx_user_subscriptions_valid_to ON user_subscriptions(valid_to);
CREATE INDEX idx_user_subscriptions_type ON user_subscriptions(subscription_type);
```

***

### 8️⃣ **subscription_types** (Типы подписок)

**Назначение:** Определяет доступные типы подписок и их лимиты

```sql
CREATE TABLE subscription_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,             -- 'free', 'plus', 'admin'
    display_name TEXT NOT NULL,            -- Отображаемое название
    
    max_fixed_routes INTEGER NOT NULL,     -- Макс. фиксированных маршрутов
    max_flexible_routes INTEGER NOT NULL,  -- Макс. гибких маршрутов
    max_combinations INTEGER NOT NULL,     -- Макс. комбинаций для проверки
    check_interval_hours INTEGER NOT NULL, -- Интервал проверок (часы)
    
    price_per_month REAL DEFAULT 0,        -- Цена в месяц
    is_active INTEGER DEFAULT 1,           -- Активна ли подписка
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Базовые типы
INSERT INTO subscription_types VALUES
('free', 'Бесплатная', 3, 1, 20, 4, 0),
('plus', 'Plus', 5, 3, 50, 2, 199),
('admin', 'Admin', 999, 999, 999, 1, 0);
```

**Связи:**
- `1:N` с `user_subscriptions` (один тип → много подписок)

***

### 9️⃣ **user_stats** (Статистика пользователей)

**Назначение:** Агрегированная статистика по пользователю

```sql
CREATE TABLE user_stats (
    chat_id INTEGER PRIMARY KEY,           -- FK → user_settings
    total_routes INTEGER DEFAULT 0,        -- Всего маршрутов
    total_alerts INTEGER DEFAULT 0,        -- Всего уведомлений отправлено
    total_savings REAL DEFAULT 0,          -- Общая экономия
    total_checks INTEGER DEFAULT 0,        -- Всего проверок выполнено
    last_check DATETIME,                   -- Последняя проверка
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

***

### 🔟 **notification_cooldown** (Таймауты уведомлений)

**Назначение:** Предотвращает спам уведомлений

```sql
CREATE TABLE notification_cooldown (
    chat_id INTEGER PRIMARY KEY,
    last_notification INTEGER NOT NULL     -- Unix timestamp
);
```

***

## 🔍 ПРИМЕРЫ ЗАПРОСОВ

### 📌 Получить лучшие цены для пользователя по маршруту

```sql
-- Вариант 1: Через route_results (найденные подходящие билеты)
SELECT 
    rr.id,
    rr.departure_date,
    rr.return_date,
    rr.total_price,
    rr.airline,
    rr.search_link,
    rr.found_at,
    ur.origin,
    ur.destination,
    ur.threshold_price
FROM route_results rr
JOIN unified_routes ur ON rr.route_id = ur.id
WHERE ur.chat_id = ?           -- ID пользователя
  AND ur.id = ?                -- ID маршрута
ORDER BY rr.total_price ASC
LIMIT 10;

-- Вариант 2: Через price_analytics (вся история цен)
SELECT 
    pa.price,
    pa.airline,
    pa.found_at,
    ur.origin,
    ur.destination
FROM price_analytics pa
JOIN unified_routes ur ON pa.route_id = ur.id
WHERE ur.chat_id = ?
  AND ur.id = ?
ORDER BY pa.price ASC, pa.found_at DESC
LIMIT 10;
```

**Связь таблиц:**
```
user_settings (chat_id) 
    ↓ 1:N
unified_routes (id, chat_id)
    ↓ 1:N
route_results (route_id) → лучшие найденные билеты
price_analytics (route_id, chat_id) → вся история цен
```

***

### 📌 Получить все маршруты пользователя с количеством найденных билетов

```sql
SELECT 
    ur.*,
    COUNT(DISTINCT rr.id) as total_results,
    MIN(rr.total_price) as best_price,
    (SELECT COUNT(*) FROM route_check_stats WHERE route_id = ur.id) as check_count
FROM unified_routes ur
LEFT JOIN route_results rr ON ur.id = rr.route_id
WHERE ur.chat_id = ?
GROUP BY ur.id
ORDER BY ur.created_at DESC;
```

**Связь таблиц:**
```
user_settings (chat_id)
    ↓
unified_routes (id, chat_id)
    ↓ LEFT JOIN
route_results (route_id) → подсчет билетов
route_check_stats (route_id) → подсчет проверок
```

***

### 📌 Статистика проверок с названиями маршрутов

```sql
SELECT 
    cs.id,
    cs.check_timestamp,
    cs.total_combinations,
    cs.successful_checks,
    cs.failed_checks,
    (ur.origin || ' → ' || ur.destination) as route_name,
    ur.chat_id,
    us.timezone
FROM route_check_stats cs
JOIN unified_routes ur ON cs.route_id = ur.id
JOIN user_settings us ON ur.chat_id = us.chat_id
WHERE cs.check_timestamp >= datetime('now', '-7 days')
ORDER BY cs.check_timestamp DESC;
```

**Связь таблиц:**
```
route_check_stats (route_id)
    ↓
unified_routes (id, chat_id) → получить origin/destination
    ↓
user_settings (chat_id) → получить настройки пользователя
```

***

### 📌 Топ пользователей по количеству маршрутов

```sql
SELECT 
    us.chat_id,
    us.timezone,
    COUNT(ur.id) as total_routes,
    COUNT(CASE WHEN ur.is_paused = 0 THEN 1 END) as active_routes,
    usub.subscription_type
FROM user_settings us
LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
LEFT JOIN user_subscriptions usub ON us.chat_id = usub.chat_id
GROUP BY us.chat_id
ORDER BY total_routes DESC
LIMIT 10;
```

**Связь таблиц:**
```
user_settings (chat_id)
    ↓ LEFT JOIN
unified_routes (chat_id) → подсчет маршрутов
    ↓ LEFT JOIN
user_subscriptions (chat_id) → тип подписки
```

***

## 🎯 ПРАКТИЧЕСКИЕ ПРИМЕРЫ

### Пример 1: Получить все данные о маршруте пользователя

```sql
-- Маршрут + настройки пользователя + подписка + статистика
SELECT 
    ur.*,
    us.timezone,
    us.quiet_hours_start,
    us.quiet_hours_end,
    usub.subscription_type,
    (SELECT COUNT(*) FROM route_results WHERE route_id = ur.id) as total_results,
    (SELECT MIN(total_price) FROM route_results WHERE route_id = ur.id) as best_price,
    (SELECT COUNT(*) FROM route_check_stats WHERE route_id = ur.id) as total_checks
FROM unified_routes ur
JOIN user_settings us ON ur.chat_id = us.chat_id
LEFT JOIN user_subscriptions usub ON ur.chat_id = usub.chat_id
WHERE ur.id = ?;
```

### Пример 2: Неудачные проверки с контекстом

```sql
SELECT 
    ccr.id,
    ccr.departure_date,
    ccr.return_date,
    ccr.status,
    ccr.error_reason,
    ccr.check_timestamp,
    (ur.origin || ' → ' || ur.destination) as route,
    ur.chat_id,
    ur.threshold_price,
    us.timezone
FROM combination_check_results ccr
JOIN unified_routes ur ON ccr.route_id = ur.id
JOIN user_settings us ON ur.chat_id = us.chat_id
WHERE ccr.status = 'error'
  AND ccr.check_timestamp >= datetime('now', '-1 day')
ORDER BY ccr.check_timestamp DESC;
```

***

## 📖 ВЫВОДЫ

### Основные связи:

1. **user_settings** — корневая таблица пользователей
2. **unified_routes** — центральная таблица, связывает пользователя с результатами
3. **route_results** — найденные билеты (цена ≤ порога)
4. **price_analytics** — вся история цен для аналитики
5. **route_check_stats** — агрегированная статистика проверок
6. **combination_check_results** — детальные результаты каждой проверки

### Ключевые Foreign Keys:

- `unified_routes.chat_id` → `user_settings.chat_id`
- `route_results.route_id` → `unified_routes.id`
- `route_check_stats.route_id` → `unified_routes.id`
- `combination_check_results.route_id` → `unified_routes.id`
- `price_analytics.route_id` → `unified_routes.id`
- `price_analytics.chat_id` → `user_settings.chat_id`
- `user_subscriptions.chat_id` → `user_settings.chat_id`

Теперь у вас есть полная карта базы данных! 🎉