# 📊 ДОКУМЕНТАЦИЯ: СТРУКТУРА БАЗЫ ДАННЫХ

## 🗂️ Обзор таблиц

База данных содержит **12 основных таблиц**:

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
11. **📢 broadcasts** - массовые рассылки (новое)
12. **📢 broadcast_log** - логи отправки рассылок (новое)

***

## 🔗 ДИАГРАММА СВЯЗЕЙ

```
┌─────────────────────┐
│   user_settings     │
│  (chat_id - PK)     │
└──────────┬──────────┘
           │ 1
           ├───────────────────────────┬───────────────┐
           │ N                         │ N             │ N
┌──────────┴──────────┐     ┌──────────┴──────────┐  ┌┴───────────────┐
│  unified_routes     │     │ broadcast_log        │  │ user_          │
│  (id - PK)          │◄────│  (chat_id - FK)      │  │ subscriptions  │
│  (chat_id - FK)     │     └──────────┬───────────┘  └────────────────┘
└──────────┬──────────┘                │ N
           │ 1                         │ N
           ├──────────┬─────────┬──────┴──┬────────────┐
           │ N        │ N       │ N       │            │ N
┌──────────┴─────┐ ┌──┴─────┐ ┌─┴────────┐ ┌──────────┴──────────┐ ┌┴──────────────────┐
│ route_results  │ │route_  │ │combination│ │   broadcasts        │ │ price_analytics   │
│ (route_id-FK)  │ │check_  │ │_check_    │ │   (id - PK)         │ │ (route_id - FK)   │
│                │ │stats   │ │results    │ └─────────────────────┘ │ (chat_id - FK)    │
└────────────────┘ │(FK)    │ │(FK)       │                         └───────────────────┘
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
- `1:N` с `broadcast_log` (один пользователь → много логов рассылок) 📢

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
INSERT INTO subscription_types 
(name, display_name, max_fixed_routes, max_flexible_routes, max_combinations, check_interval_hours, price_per_month)
VALUES
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

### 1️⃣1️⃣ **📢 broadcasts** (Массовые рассылки) - НОВОЕ

**Назначение:** Хранит информацию о массовых рассылках

```sql
CREATE TABLE broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_text TEXT NOT NULL,            -- Текст сообщения (Markdown)
    target_users TEXT NOT NULL DEFAULT 'all', -- 'all' или JSON массив chat_id
    scheduled_time TEXT NOT NULL,          -- Время отправки (HH:MM)

    -- Статус
    is_sent INTEGER DEFAULT 0,             -- 0 = в очереди, 1 = отправлено
    total_users INTEGER DEFAULT 0,         -- Всего пользователей для отправки
    sent_count INTEGER DEFAULT 0,          -- Уже отправлено

    -- Временные метки
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME                       -- Когда завершена отправка
);
```

**Связи:**
- `1:N` с `broadcast_log` (одна рассылка → много логов отправки)

**Индексы:**
```sql
CREATE INDEX idx_broadcasts_is_sent ON broadcasts(is_sent);
CREATE INDEX idx_broadcasts_scheduled ON broadcasts(scheduled_time);
CREATE INDEX idx_broadcasts_created ON broadcasts(created_at DESC);
```

**Пример запроса:**
```sql
-- Получить активные рассылки (не отправленные)
SELECT * FROM broadcasts
WHERE is_sent = 0
ORDER BY created_at DESC;

-- Статистика рассылок
SELECT 
    id,
    message_text,
    total_users,
    sent_count,
    ROUND(sent_count * 100.0 / total_users, 2) as progress,
    is_sent,
    created_at,
    sent_at
FROM broadcasts
ORDER BY created_at DESC
LIMIT 10;
```

***

### 1️⃣2️⃣ **📢 broadcast_log** (Логи отправки рассылок) - НОВОЕ

**Назначение:** Логирует каждую отправку сообщения в рамках рассылки

```sql
CREATE TABLE broadcast_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL,         -- FK → broadcasts
    chat_id INTEGER NOT NULL,              -- FK → user_settings

    -- Статус отправки
    status TEXT NOT NULL,                  -- 'success', 'error', 'skipped'
    error_message TEXT,                    -- Текст ошибки (если есть)

    -- Временная метка
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
    FOREIGN KEY (chat_id) REFERENCES user_settings(chat_id) ON DELETE CASCADE
);
```

**Связи:**
- `N:1` с `broadcasts` (много логов → одна рассылка)
- `N:1` с `user_settings` (много логов → один пользователь)

**Индексы:**
```sql
CREATE INDEX idx_broadcast_log_broadcast_id ON broadcast_log(broadcast_id);
CREATE INDEX idx_broadcast_log_chat_id ON broadcast_log(chat_id);
CREATE INDEX idx_broadcast_log_status ON broadcast_log(status);
CREATE INDEX idx_broadcast_log_sent_at ON broadcast_log(sent_at DESC);
```

**Пример запроса:**
```sql
-- История отправок для рассылки
SELECT 
    bl.id,
    bl.chat_id,
    us.timezone,
    bl.status,
    bl.error_message,
    bl.sent_at
FROM broadcast_log bl
LEFT JOIN user_settings us ON bl.chat_id = us.chat_id
WHERE bl.broadcast_id = ?
ORDER BY bl.sent_at ASC;

-- Ошибки при отправке
SELECT 
    bl.*,
    b.message_text,
    us.timezone
FROM broadcast_log bl
JOIN broadcasts b ON bl.broadcast_id = b.id
LEFT JOIN user_settings us ON bl.chat_id = us.chat_id
WHERE bl.status = 'error'
ORDER BY bl.sent_at DESC
LIMIT 100;
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

***

### 📌 Получить всех пользователей для рассылки (с timezone)

```sql
-- Все пользователи с активными маршрутами
SELECT DISTINCT
    us.chat_id,
    us.timezone,
    COUNT(DISTINCT ur.id) as routes_count
FROM user_settings us
LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
GROUP BY us.chat_id
HAVING routes_count > 0
ORDER BY us.created_at DESC;

-- Только активные пользователи (проверки за последние 7 дней)
SELECT DISTINCT
    us.chat_id,
    us.timezone,
    MAX(ur.last_check) as last_active
FROM user_settings us
JOIN unified_routes ur ON us.chat_id = ur.chat_id
WHERE ur.last_check >= datetime('now', '-7 days')
GROUP BY us.chat_id
ORDER BY last_active DESC;
```

***

### 📌 Получить детальную информацию о рассылке

```sql
-- Полная информация о рассылке с логами
SELECT 
    b.id,
    b.message_text,
    b.scheduled_time,
    b.is_sent,
    b.total_users,
    b.sent_count,
    b.created_at,
    b.sent_at,
    COUNT(CASE WHEN bl.status = 'success' THEN 1 END) as success_count,
    COUNT(CASE WHEN bl.status = 'error' THEN 1 END) as error_count,
    COUNT(CASE WHEN bl.status = 'skipped' THEN 1 END) as skipped_count
FROM broadcasts b
LEFT JOIN broadcast_log bl ON b.id = bl.broadcast_id
WHERE b.id = ?
GROUP BY b.id;

-- Получить пользователей кому уже отправлено
SELECT 
    bl.chat_id,
    us.timezone,
    bl.sent_at,
    bl.status
FROM broadcast_log bl
LEFT JOIN user_settings us ON bl.chat_id = us.chat_id
WHERE bl.broadcast_id = ?
  AND bl.status = 'success'
ORDER BY bl.sent_at ASC;
```

***

### 📌 Пользователи для рассылки в определенное время

```sql
-- Получить пользователей у которых сейчас 10:00 по их локальному времени
-- (для планировщика рассылок)
WITH target_time AS (
    SELECT '10:00' as scheduled_time
)
SELECT 
    us.chat_id,
    us.timezone,
    strftime('%H:%M', datetime('now', 'localtime')) as server_time,
    -- Вычисляем локальное время пользователя
    strftime('%H:%M', 
        datetime('now', 'utc', 
            CASE us.timezone
                WHEN 'Europe/Moscow' THEN '+3 hours'
                WHEN 'Asia/Yekaterinburg' THEN '+5 hours'
                WHEN 'Asia/Vladivostok' THEN '+10 hours'
                -- добавить остальные таймзоны
                ELSE '+0 hours'
            END
        )
    ) as user_local_time
FROM user_settings us
WHERE user_local_time = (SELECT scheduled_time FROM target_time);
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

***

### Пример 2: Создание рассылки и логирование

```sql
-- Шаг 1: Создать рассылку
INSERT INTO broadcasts (message_text, target_users, scheduled_time, total_users)
VALUES (
    '🎉 Новая функция! Теперь можно искать билеты с гибкими датами.',
    'all',
    '10:00',
    (SELECT COUNT(*) FROM user_settings)
);

-- Шаг 2: Получить ID созданной рассылки
SELECT last_insert_rowid() as broadcast_id;

-- Шаг 3: При отправке каждому пользователю - добавить лог
INSERT INTO broadcast_log (broadcast_id, chat_id, status)
VALUES (1, 123456789, 'success');

-- Шаг 4: Обновить счетчик отправленных
UPDATE broadcasts
SET sent_count = sent_count + 1
WHERE id = 1;

-- Шаг 5: Когда все отправлено - пометить как завершенную
UPDATE broadcasts
SET is_sent = 1, sent_at = CURRENT_TIMESTAMP
WHERE id = 1 AND sent_count >= total_users;
```

***

### Пример 3: Статистика рассылок

```sql
-- Общая статистика по всем рассылкам
SELECT 
    COUNT(*) as total_broadcasts,
    SUM(CASE WHEN is_sent = 1 THEN 1 ELSE 0 END) as sent,
    SUM(CASE WHEN is_sent = 0 THEN 1 ELSE 0 END) as pending,
    SUM(total_users) as total_messages,
    SUM(sent_count) as actually_sent,
    AVG(sent_count * 100.0 / NULLIF(total_users, 0)) as avg_success_rate
FROM broadcasts;

-- Последние 10 рассылок с детальной статистикой
SELECT 
    b.id,
    SUBSTR(b.message_text, 1, 50) || '...' as preview,
    b.scheduled_time,
    b.total_users,
    b.sent_count,
    ROUND(b.sent_count * 100.0 / NULLIF(b.total_users, 0), 2) || '%' as success_rate,
    b.is_sent,
    b.created_at,
    COALESCE(
        (SELECT COUNT(*) FROM broadcast_log WHERE broadcast_id = b.id AND status = 'error'),
        0
    ) as errors
FROM broadcasts b
ORDER BY b.created_at DESC
LIMIT 10;
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
7. **📢 broadcasts** — массовые рассылки (новое)
8. **📢 broadcast_log** — логи отправки рассылок (новое)

### Ключевые Foreign Keys:

- `unified_routes.chat_id` → `user_settings.chat_id`
- `route_results.route_id` → `unified_routes.id`
- `route_check_stats.route_id` → `unified_routes.id`
- `combination_check_results.route_id` → `unified_routes.id`
- `price_analytics.route_id` → `unified_routes.id`
- `price_analytics.chat_id` → `user_settings.chat_id`
- `user_subscriptions.chat_id` → `user_settings.chat_id`
- **`broadcast_log.broadcast_id` → `broadcasts.id`** 📢
- **`broadcast_log.chat_id` → `user_settings.chat_id`** 📢

### Новая функциональность - Массовая рассылка:

- Таблица `broadcasts` хранит информацию о рассылках
- Таблица `broadcast_log` логирует каждую отправку
- Поддержка отправки по локальному времени пользователя
- Автоматическое соблюдение rate limits Telegram (25 сообщений/сек)
- Полная статистика и отслеживание ошибок

Теперь у вас есть полная карта базы данных! 🎉

---

*Последнее обновление: 03.02.2026*  
*Версия БД: 2.0* - Добавлены таблицы для массовой рассылки
