# План: Корректный расчёт DAU/WAU/MAU с воронкой

## Проблема
Текущий расчёт DAU/WAU/MAU основан на `last_check` маршрутов - это время автоматической проверки ботом, а не реальная активность пользователя.

## Решение
Создать систему отслеживания реальных действий пользователя с визуализацией воронки конверсии.

---

## Файлы для изменения

| Файл | Действие |
|------|----------|
| `config/database.js` | Добавить таблицу `user_activity_log` |
| `services/ActivityService.js` | **Создать** новый сервис |
| `index.js` | Интеграция логирования (3 точки) |
| `handlers/routeHandlers.js` | Интеграция логирования (8 точек) |
| `handlers/settingsHandlers.js` | Интеграция логирования (1 точка) |
| `handlers/subscriptionHandlers.js` | Интеграция логирования (2 точки) |
| `web/server.js` | Обновить API `/admin/api/analytics-main` |
| `web/public/js/pages/dashboard.js` | Добавить UI воронки |

---

## 1. Таблица user_activity_log

**Файл:** `config/database.js` (добавить после строки ~327)

```sql
CREATE TABLE IF NOT EXISTS user_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_chat_id ON user_activity_log(chat_id);
CREATE INDEX idx_activity_event_type ON user_activity_log(event_type);
CREATE INDEX idx_activity_created_at ON user_activity_log(created_at);
CREATE INDEX idx_activity_chat_date ON user_activity_log(chat_id, created_at);
```

**Типы событий (event_type):**
- `start` - запуск бота
- `main_menu` - возврат в главное меню
- `view_routes` - просмотр списка маршрутов
- `view_route_detail` - просмотр деталей маршрута
- `create_route_start` - начало создания маршрута
- `route_created` - успешное создание маршрута
- `edit_route` - редактирование маршрута
- `delete_route` - удаление маршрута
- `view_chart` - просмотр графика цен
- `view_heatmap` - просмотр heatmap
- `settings` - открытие настроек
- `subscription_info` - просмотр информации о подписке
- `upgrade_attempt` - попытка апгрейда
- `help` - просмотр помощи

---

## 2. ActivityService

**Файл:** `services/ActivityService.js` (новый файл)

```javascript
const db = require('../config/database');

class ActivityService {
    /**
     * Записать событие активности
     * @param {number} chatId - ID пользователя
     * @param {string} eventType - тип события
     * @param {object} eventData - дополнительные данные (опционально)
     */
    static async logEvent(chatId, eventType, eventData = null) {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO user_activity_log (chat_id, event_type, event_data)
                 VALUES (?, ?, ?)`,
                [chatId, eventType, eventData ? JSON.stringify(eventData) : null],
                (err) => {
                    if (err) {
                        console.error('ActivityService: ошибка логирования события:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    /**
     * Получить DAU (Daily Active Users)
     */
    static async getDAU() {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(DISTINCT chat_id) as count
                 FROM user_activity_log
                 WHERE created_at >= datetime('now', '-1 day')`,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });
    }

    /**
     * Получить WAU (Weekly Active Users)
     */
    static async getWAU() {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(DISTINCT chat_id) as count
                 FROM user_activity_log
                 WHERE created_at >= datetime('now', '-7 days')`,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });
    }

    /**
     * Получить MAU (Monthly Active Users)
     */
    static async getMAU() {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(DISTINCT chat_id) as count
                 FROM user_activity_log
                 WHERE created_at >= datetime('now', '-30 days')`,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });
    }

    /**
     * Получить воронку конверсии по маршрутам
     * @param {string} period - '1 day', '7 days', '30 days'
     */
    static async getRoutesFunnel(period = '30 days') {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT
                    (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
                     WHERE created_at >= datetime('now', '-${period}')) as active_users,
                    (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
                     WHERE event_type = 'view_routes' AND created_at >= datetime('now', '-${period}')) as viewed_routes,
                    (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
                     WHERE event_type = 'create_route_start' AND created_at >= datetime('now', '-${period}')) as started_creation,
                    (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
                     WHERE event_type = 'route_created' AND created_at >= datetime('now', '-${period}')) as completed_creation
                `,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { active_users: 0, viewed_routes: 0, started_creation: 0, completed_creation: 0 });
                }
            );
        });
    }

    /**
     * Получить воронку подписки
     * @param {string} period - '1 day', '7 days', '30 days'
     */
    static async getSubscriptionFunnel(period = '30 days') {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT
                    (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
                     WHERE event_type = 'subscription_info' AND created_at >= datetime('now', '-${period}')) as viewed_subscription,
                    (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
                     WHERE event_type = 'upgrade_attempt' AND created_at >= datetime('now', '-${period}')) as upgrade_attempts
                `,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { viewed_subscription: 0, upgrade_attempts: 0 });
                }
            );
        });
    }

    /**
     * Получить историю DAU за последние N дней
     */
    static async getDAUHistory(days = 30) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT
                    date(created_at) as date,
                    COUNT(DISTINCT chat_id) as users
                 FROM user_activity_log
                 WHERE created_at >= datetime('now', '-${days} days')
                 GROUP BY date(created_at)
                 ORDER BY date ASC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    /**
     * Получить распределение событий
     */
    static async getEventDistribution(period = '30 days') {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT
                    event_type,
                    COUNT(*) as count
                 FROM user_activity_log
                 WHERE created_at >= datetime('now', '-${period}')
                 GROUP BY event_type
                 ORDER BY count DESC`,
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
}

module.exports = ActivityService;
```

---

## 3. Точки интеграции логирования

### index.js
| Событие | Место |
|---------|-------|
| `start` | После `bot.onText(/\/start/, ...)` |
| `main_menu` | После `if (text === '🏠 Главное меню')` |
| `help` | В функции `handleHelp(chatId)` |

### handlers/routeHandlers.js
| Событие | Метод |
|---------|-------|
| `view_routes` | `handleMyRoutes()` |
| `view_route_detail` | `handleRouteDetails()` |
| `create_route_start` | `handleCreateRoute()` |
| `route_created` | `_handleConfirmStep()` (после успешного создания) |
| `edit_route` | `handleEditRoute()` |
| `delete_route` | `handleConfirmDelete()` (после удаления) |
| `view_chart` | `handleShowChart()` |
| `view_heatmap` | `handleShowHeatmap()` |

### handlers/settingsHandlers.js
| Событие | Метод |
|---------|-------|
| `settings` | `handleSettings()` |

### handlers/subscriptionHandlers.js
| Событие | Метод |
|---------|-------|
| `subscription_info` | `handleSubscriptionInfo()` |
| `upgrade_attempt` | `handlePaymentCallback()` |

---

## 4. Обновление API

**Файл:** `web/server.js` - endpoint `/admin/api/analytics-main`

Заменить текущий расчёт DAU/WAU/MAU (по `last_check`) на вызовы `ActivityService`.

Добавить в ответ:
```javascript
{
    // ... существующие поля ...
    userActivity: { dau, wau, mau },  // ← заменить на ActivityService
    funnels: {
        routes: {
            active_users: N,
            viewed_routes: N,
            started_creation: N,
            completed_creation: N
        },
        subscription: {
            viewed_subscription: N,
            upgrade_attempts: N
        }
    },
    dauHistory: [{ date: '2026-02-01', users: 5 }, ...]
}
```

---

## 5. UI воронки

**Файл:** `web/public/js/pages/dashboard.js`

Добавить после блока DAU/WAU/MAU новую секцию с двумя воронками:

**Воронка маршрутов:**
```
Активные пользователи: 100 (100%)
  ↓
Просмотрели маршруты: 80 (80%)
  ↓
Начали создание: 40 (50%)
  ↓
Завершили создание: 30 (75%)
```

**Воронка подписки:**
```
Просмотрели подписку: 50 (100%)
  ↓
Попытка апгрейда: 10 (20%)
```

Визуализация через Bootstrap progress bars.

---

## Порядок реализации

1. **database.js** - создание таблицы
2. **ActivityService.js** - новый сервис (создать файл)
3. **index.js** - логирование start, main_menu, help
4. **routeHandlers.js** - логирование 8 событий маршрутов
5. **settingsHandlers.js** - логирование settings
6. **subscriptionHandlers.js** - логирование subscription_info, upgrade_attempt
7. **server.js** - обновление API
8. **dashboard.js** - UI воронки

---

## Верификация

1. Перезапустить бота: `pm2 restart bot`
2. Выполнить несколько действий в боте (start, просмотр маршрутов, создание)
3. Проверить что данные записываются: `sqlite3 data/bot.db "SELECT * FROM user_activity_log LIMIT 10"`
4. Открыть админку `/admin` и проверить новые метрики DAU/WAU/MAU и воронки
