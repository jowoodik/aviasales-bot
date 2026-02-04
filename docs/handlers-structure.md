# Структура обработчиков бота

## Главный файл

### index.js
Точка входа приложения. Регистрирует все обработчики событий Telegram.

**Обработчики команд:**
- `/start` — приветствие, инициализация пользователя
- `/help` — справка по боту
- `/subscription` — информация о подписке
- `/upgrade` — переход на Plus
- `/admin_check` — принудительная проверка (только admin)

**Обработчики событий:**
- `message` — обработка текстовых сообщений и меню
- `callback_query` — обработка нажатий inline-кнопок
- `pre_checkout_query` — проверка перед оплатой (Telegram Payments)
- `successful_payment` — успешная оплата (Telegram Payments)

**Вспомогательные функции:**
- `getMainMenuKeyboard()` — клавиатура главного меню
- `handleHelp()` — формирование справки
- `handleCheckNow()` — запуск проверки всех маршрутов
- `checkIfFirstTime()` — проверка нового пользователя
- `initializeUserSettings()` — создание настроек и подписки

---

## Папка handlers/

### routeHandlers.js
Обработчики для работы с маршрутами.

**Методы:**
- `handleMyRoutes(chatId)` — список маршрутов пользователя
- `handleCreateRoute(chatId)` — начало создания маршрута
- `handleCreateStep(chatId, text)` — шаги создания маршрута
- `handleRouteDetails(chatId, index)` — детали маршрута
- `handleEditRoute(chatId)` — редактирование маршрута
- `handleEditAction(chatId, text)` — действия редактирования
- `handleEditThreshold(chatId, text)` — изменение порога цены
- `handleDeleteRoute(chatId)` — удаление маршрута
- `handleConfirmDelete(chatId, text)` — подтверждение удаления
- `handleShowChart(chatId, route)` — график цен
- `handleShowHeatmap(chatId, route)` — heatmap лучшего времени

### settingsHandlers.js
Обработчики настроек пользователя.

**Методы:**
- `handleSettings(chatId)` — меню настроек
- `handleTimezone(chatId)` — настройка таймзоны
- `handleQuietHours(chatId)` — тихие часы
- `handleNotifyOnCheck(chatId)` — уведомления о проверках
- `handleMessage(chatId, text, userStates)` — обработка ввода в настройках

### subscriptionHandlers.js
Обработчики подписок и платежей.

**Методы:**
- `handleSubscriptionInfo(chatId)` — информация о подписке
- `handleUpgrade(chatId)` — переход на Plus (/upgrade)
- `handlePaymentCallback(chatId, callbackQueryId)` — отправка счёта на оплату
- `handlePaymentHelp(chatId, callbackQueryId)` — помощь по оплате
- `handlePreCheckoutQuery(query)` — обработка pre-checkout
- `handleSuccessfulPayment(message)` — успешная оплата
- `handleCallbackQuery(query)` — маршрутизация callback-запросов
- `_createPaymentRecord(...)` — создание записи платежа в БД
- `_updatePaymentStatus(...)` — обновление статуса платежа
- `_getPaymentByPayload(...)` — получение платежа по payload

---

## Папка services/

### SubscriptionService.js
Бизнес-логика подписок.

**Методы:**
- `getUserSubscription(chatId)` — получить текущую подписку
- `initializeUserSubscription(chatId, type)` — создать подписку
- `checkUserLimits(chatId, isFlexible, combinations)` — проверить лимиты
- `getSubscriptionStats(chatId)` — статистика подписки
- `updateSubscription(chatId, type)` — обновить подписку

### ActivityService.js
Логирование активности пользователей.

**Методы:**
- `logEvent(chatId, eventType, eventData)` — записать событие

### NotificationService.js
Отправка уведомлений.

**Методы:**
- `sendPriceAlert(chatId, route, result)` — уведомление о цене
- `sendCheckReport(chatId, stats)` — отчёт о проверке
- `getUserRoutesStats(chatId)` — статистика маршрутов

### UnifiedMonitor.js
Мониторинг цен на маршруты.

**Методы:**
- `checkAllRoutes()` — проверка всех маршрутов
- `checkRoute(route)` — проверка одного маршрута

---

## Поток данных

```
Telegram → index.js
              │
              ├── /start, /help, /subscription, /upgrade
              │
              ├── message → userStates → routeHandlers
              │                        → settingsHandlers
              │
              ├── callback_query → subscriptionHandlers
              │                  → routeHandlers
              │
              ├── pre_checkout_query → subscriptionHandlers.handlePreCheckoutQuery
              │
              └── successful_payment → subscriptionHandlers.handleSuccessfulPayment
                                            │
                                            └── SubscriptionService.updateSubscription
```
