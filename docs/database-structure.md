# Структура базы данных

База данных SQLite (`data/bot.db`) содержит следующие таблицы:

## Таблицы маршрутов

### unified_routes
Единая таблица маршрутов (фиксированные и гибкие).

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| chat_id | INTEGER | ID чата пользователя |
| origin | TEXT | Код аэропорта вылета |
| destination | TEXT | Код аэропорта назначения |
| is_flexible | INTEGER | 0 = фиксированный, 1 = гибкий |
| has_return | INTEGER | Есть ли обратный билет |
| departure_date | TEXT | Дата вылета (для фиксированных) |
| return_date | TEXT | Дата возврата (для фиксированных) |
| departure_start | TEXT | Начало диапазона вылета (для гибких) |
| departure_end | TEXT | Конец диапазона вылета (для гибких) |
| min_days | INTEGER | Минимум дней (для гибких) |
| max_days | INTEGER | Максимум дней (для гибких) |
| adults | INTEGER | Количество взрослых |
| children | INTEGER | Количество детей |
| airline | TEXT | Фильтр по авиакомпании |
| baggage | INTEGER | Требуется багаж |
| max_stops | INTEGER | Максимум пересадок |
| max_layover_hours | INTEGER | Максимум часов пересадки |
| threshold_price | REAL | Пороговая цена для уведомлений |
| currency | TEXT | Валюта (RUB) |
| is_paused | INTEGER | Маршрут на паузе |
| created_at | DATETIME | Дата создания |
| last_check | DATETIME | Последняя проверка |

### route_results
Результаты проверок маршрутов (найденные цены).

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| route_id | INTEGER | FK → unified_routes |
| departure_date | TEXT | Дата вылета |
| return_date | TEXT | Дата возврата |
| days_in_country | INTEGER | Дней в стране |
| total_price | REAL | Найденная цена |
| airline | TEXT | Авиакомпания |
| search_link | TEXT | Ссылка на поиск |
| screenshot_path | TEXT | Путь к скриншоту |
| found_at | DATETIME | Время находки |

### route_check_stats
Статистика проверок маршрутов.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| route_id | INTEGER | FK → unified_routes |
| check_timestamp | DATETIME | Время проверки |
| total_combinations | INTEGER | Всего комбинаций |
| successful_checks | INTEGER | Успешных проверок |
| failed_checks | INTEGER | Неудачных проверок |

### combination_check_results
Детальные результаты проверок комбинаций.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| route_id | INTEGER | FK → unified_routes |
| check_timestamp | DATETIME | Время проверки |
| departure_date | TEXT | Дата вылета |
| return_date | TEXT | Дата возврата |
| days_in_country | INTEGER | Дней в стране |
| status | TEXT | 'success', 'not_found', 'error' |
| price | REAL | Найденная цена |
| currency | TEXT | Валюта |
| error_reason | TEXT | Причина ошибки |
| search_url | TEXT | URL поиска |

---

## Таблицы подписок

### subscription_types
Типы подписок (справочник).

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| name | TEXT | Системное имя (free, plus, admin) |
| display_name | TEXT | Отображаемое имя |
| max_fixed_routes | INTEGER | Лимит фиксированных маршрутов |
| max_flexible_routes | INTEGER | Лимит гибких маршрутов |
| max_combinations | INTEGER | Лимит комбинаций в гибком |
| check_interval_hours | INTEGER | Интервал проверки (часы) |
| price_per_month | REAL | Цена в месяц (рубли) |
| is_active | INTEGER | Активна ли подписка |
| created_at | DATETIME | Дата создания |

**Базовые типы:**
- `free` — Бесплатная (3 фикс, 1 гибкий, 20 комбинаций, 4ч)
- `plus` — Plus (5 фикс, 3 гибких, 50 комбинаций, 2ч) — 199 ₽/мес
- `admin` — Admin (безлимит, 1ч)

### user_subscriptions
Подписки пользователей.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| chat_id | INTEGER | ID чата (UNIQUE) |
| subscription_type | TEXT | Тип подписки |
| valid_from | DATETIME | Начало действия |
| valid_to | DATETIME | Конец действия (NULL = бессрочно) |
| is_active | INTEGER | Активна |
| created_at | DATETIME | Дата создания |

### payments
Платежи через Telegram Payments.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| chat_id | INTEGER | ID чата пользователя |
| payload | TEXT | Уникальный идентификатор платежа (UNIQUE) |
| subscription_type | TEXT | Тип оплачиваемой подписки |
| amount | INTEGER | Сумма в копейках |
| currency | TEXT | Валюта (RUB) |
| status | TEXT | pending, pre_checkout, completed, failed |
| telegram_payment_charge_id | TEXT | ID платежа Telegram |
| provider_payment_charge_id | TEXT | ID платежа ЮKassa |
| created_at | DATETIME | Создание счёта |
| pre_checkout_at | DATETIME | Время pre-checkout |
| completed_at | DATETIME | Время завершения |

---

## Таблицы пользователей

### user_settings
Настройки пользователей.

| Поле | Тип | Описание |
|------|-----|----------|
| chat_id | INTEGER | PRIMARY KEY |
| quiet_hours_start | INTEGER | Начало тихих часов (23) |
| quiet_hours_end | INTEGER | Конец тихих часов (7) |
| timezone | TEXT | Таймзона (Asia/Yekaterinburg) |
| notify_on_check | INTEGER | Уведомлять о проверках |
| created_at | DATETIME | Дата создания |

### user_stats
Статистика пользователей.

| Поле | Тип | Описание |
|------|-----|----------|
| chat_id | INTEGER | PRIMARY KEY |
| total_routes | INTEGER | Всего маршрутов |
| total_alerts | INTEGER | Всего уведомлений |
| total_savings | REAL | Сэкономлено |
| total_checks | INTEGER | Всего проверок |
| last_check | DATETIME | Последняя проверка |
| created_at | DATETIME | Дата создания |

### user_activity_log
Лог активности пользователей.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| chat_id | INTEGER | ID чата |
| event_type | TEXT | Тип события (start, help, upgrade_attempt и т.д.) |
| event_data | TEXT | Дополнительные данные (JSON) |
| created_at | DATETIME | Время события |

---

## Таблицы рассылок

### broadcast_messages
Сообщения для массовой рассылки.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| message_text | TEXT | Текст сообщения |
| target_users | TEXT | 'all' или JSON массив chat_id |
| scheduled_time | TEXT | Время (HH:MM) |
| is_sent | INTEGER | 0 = в процессе, 1 = отправлено |
| created_at | DATETIME | Дата создания |
| sent_at | DATETIME | Время отправки |

### broadcast_log
Лог отправленных сообщений.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| broadcast_id | INTEGER | FK → broadcast_messages |
| chat_id | INTEGER | Кому отправлено |
| sent_at | DATETIME | Время отправки |

---

## Вспомогательные таблицы

### airports
Справочник аэропортов.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| iata_code | TEXT | Код IATA |
| icao_code | TEXT | Код ICAO |
| airport_name | TEXT | Название аэропорта |
| airport_name_en | TEXT | Название на английском |
| city_code | TEXT | Код города |
| city_name | TEXT | Название города |
| city_name_en | TEXT | Город на английском |
| country_code | TEXT | Код страны |
| country_name | TEXT | Название страны |
| latitude | REAL | Широта |
| longitude | REAL | Долгота |
| timezone | TEXT | Таймзона |
| is_major | INTEGER | Крупный аэропорт |
| is_popular | INTEGER | Популярный |
| is_international | INTEGER | Международный |
| region | TEXT | Регион |

### notification_cooldown
Кулдаун уведомлений.

| Поле | Тип | Описание |
|------|-----|----------|
| chat_id | INTEGER | PRIMARY KEY |
| last_notification | INTEGER | Timestamp последнего уведомления |

### price_analytics
Аналитика цен для графиков и heatmap.

| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER | PRIMARY KEY |
| route_type | TEXT | Тип маршрута |
| origin | TEXT | Откуда |
| destination | TEXT | Куда |
| price | REAL | Цена |
| airline | TEXT | Авиакомпания |
| found_at | DATETIME | Время находки |
| hour_of_day | INTEGER | Час дня |
| day_of_week | INTEGER | День недели |
| chat_id | INTEGER | ID пользователя |
| route_id | INTEGER | ID маршрута |
