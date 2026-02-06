# Документация: Прямая интеграция ЮКасса API

## Содержание
- [Обзор](#обзор)
- [Архитектура](#архитектура)
- [Конфигурация](#конфигурация)
- [Флоу оплаты](#флоу-оплаты)
- [API и методы](#api-и-методы)
- [Безопасность](#безопасность)
- [Тестирование](#тестирование)
- [Troubleshooting](#troubleshooting)
- [Миграция со старой системы](#миграция-со-старой-системы)

---

## Обзор

### Зачем прямая интеграция?

**Проблема Telegram Payments API:**
- Ограниченный набор способов оплаты
- Нет поддержки СБП (Системы быстрых платежей)
- Жёсткая привязка к провайдеру через токен
- Сложности с кастомизацией процесса оплаты

**Преимущества прямого API ЮКассы:**
- ✅ Поддержка СБП
- ✅ Банковские карты, ЮMoney, Qiwi и другие методы
- ✅ Полный контроль над процессом оплаты
- ✅ Детальная аналитика платежей
- ✅ Webhook для надёжной обработки
- ✅ Возможность возвратов и отмен

---

## Архитектура

### Компоненты системы

```
┌─────────────────┐
│   Пользователь  │
└────────┬────────┘
         │ 1. Нажимает "Оплатить 199₽"
         ▼
┌─────────────────────────────────────┐
│  handlers/subscriptionHandlers.js   │
│  - handlePaymentCallback()          │
└────────┬───────────────────────┬────┘
         │                       │
         │ 2. Создать платёж     │ 6. Активировать подписку
         ▼                       │
┌─────────────────────────┐     │
│ services/YooKassaService │     │
│ - createPayment()        │     │
│ - getPayment()           │     │
└────────┬────────────────┘     │
         │                       │
         │ 3. POST /v3/payments  │
         ▼                       │
┌─────────────────────────┐     │
│    ЮКасса API           │     │
│  api.yookassa.ru/v3     │     │
└────────┬────────────────┘     │
         │                       │
         │ 4. Confirmation URL   │
         ▼                       │
┌─────────────────┐              │
│   Пользователь  │              │
│  Оплачивает     │              │
└────────┬────────┘              │
         │                       │
         │ 5. Webhook            │
         ▼                       │
┌──────────────────────────┐    │
│   web/server.js          │    │
│   POST /webhook/yookassa │────┘
│   - Верификация          │
│   - Обработка            │
└──────────────────────────┘
```

### Основные файлы

| Файл | Назначение |
|------|-----------|
| `services/YooKassaService.js` | Взаимодействие с API ЮКассы |
| `handlers/subscriptionHandlers.js` | Бизнес-логика подписок |
| `web/server.js` | Webhook endpoint |
| `config/database.js` | Схема БД для платежей |

---

## Конфигурация

### Переменные окружения

Добавьте в `.env`:

```bash
# ЮКасса (прямое API)
YOOKASSA_SHOP_ID=123456
YOOKASSA_API_KEY=test_secretkey
BOT_USERNAME=YourBotName

# Веб-сервер (необходим для webhook)
ENABLE_WEB=true
WEB_PORT=3000
```

### Получение credentials

1. Зарегистрируйтесь в [ЮКасса](https://yookassa.ru/)
2. Создайте магазин
3. В разделе "Интеграция" → "API":
   - Скопируйте `shopId` → `YOOKASSA_SHOP_ID`
   - Создайте секретный ключ → `YOOKASSA_API_KEY`
4. В Telegram получите `@username` бота → `BOT_USERNAME`

### Настройка webhook в ЮКассе

1. ЛК ЮКассы → "Интеграция" → "HTTP-уведомления"
2. URL: `https://your-domain.com/webhook/yookassa`
3. События:
   - ✅ `payment.succeeded` — успешная оплата
   - ✅ `payment.canceled` — отмена платежа

---

## Флоу оплаты

### 1. Инициация платежа

**Триггер:** Пользователь нажимает кнопку "Оплатить 199 ₽"

```javascript
// handlers/subscriptionHandlers.js
async handlePaymentCallback(chatId, callbackQueryId) {
    // 1. Проверка конфигурации
    if (!YooKassaService.isConfigured()) {
        return error("Платежная система недоступна");
    }

    // 2. Создание платежа в ЮКассе
    const payment = await YooKassaService.createPayment({
        amount: 199,
        chatId: chatId,
        subscriptionType: 'plus',
        returnUrl: 'https://t.me/YourBotName'
    });

    // 3. Сохранение в БД
    await _createPaymentRecord(
        chatId,
        payload,
        'plus',
        19900,  // копейки
        payment.id,  // yookassa_payment_id
        payment.confirmationUrl
    );

    // 4. Отправка кнопки пользователю
    bot.sendMessage(chatId, "...", {
        inline_keyboard: [[
            { text: '💳 Оплатить 199 ₽', url: payment.confirmationUrl }
        ]]
    });
}
```

### 2. Создание платежа в ЮКассе

```javascript
// services/YooKassaService.js
async createPayment({ amount, chatId, subscriptionType, returnUrl }) {
    const response = await axios.post('https://api.yookassa.ru/v3/payments', {
        amount: {
            value: amount.toFixed(2),
            currency: 'RUB'
        },
        confirmation: {
            type: 'redirect',
            return_url: returnUrl
        },
        capture: true,  // Автоматическое списание
        description: `Plus подписка для пользователя ${chatId}`,
        metadata: {
            chat_id: chatId.toString(),
            subscription_type: subscriptionType
        }
    }, {
        auth: {
            username: SHOP_ID,
            password: API_KEY
        },
        headers: {
            'Idempotence-Key': `${chatId}_${Date.now()}_${randomId}`
        }
    });

    return {
        id: response.data.id,
        confirmationUrl: response.data.confirmation.confirmation_url,
        status: response.data.status
    };
}
```

### 3. Оплата пользователем

Пользователь:
1. Переходит по `confirmationUrl`
2. Выбирает способ оплаты (карта, СБП, ЮMoney)
3. Вводит данные и подтверждает
4. После оплаты возвращается в бот (`returnUrl`)

### 4. Webhook от ЮКассы

```javascript
// web/server.js
app.post('/webhook/yookassa', async (req, res) => {
    const notification = req.body;

    if (notification.event === 'payment.succeeded') {
        // 1. Верификация через API
        const verifiedPayment = await YooKassaService.getPayment(notification.object.id);

        if (verifiedPayment.status !== 'succeeded') {
            return res.status(200).json({ status: 'ignored' });
        }

        // 2. Обработка платежа
        const subscriptionHandlers = new SubscriptionHandlers(botInstance, {});
        await subscriptionHandlers.handleYooKassaPaymentSuccess(verifiedPayment);

        res.status(200).json({ status: 'ok' });
    }
});
```

### 5. Активация подписки

```javascript
// handlers/subscriptionHandlers.js
async handleYooKassaPaymentSuccess(paymentData) {
    const yookassaPaymentId = paymentData.id;
    const chatId = parseInt(paymentData.metadata.chat_id);

    // 1. Получить запись из БД
    const paymentRecord = await _getPaymentByYookassaId(yookassaPaymentId);

    // 2. Проверка дубликатов
    if (paymentRecord.status === 'completed') {
        return true;  // Уже обработан
    }

    // 3. Обновление статуса
    await _updatePaymentStatusByYookassaId(yookassaPaymentId, 'completed');

    // 4. Активация подписки
    await SubscriptionService.updateSubscription(chatId, 'plus');

    // 5. Уведомление пользователя
    await bot.sendMessage(chatId, "🎉 Подписка Plus активирована!");

    return true;
}
```

---

## API и методы

### YooKassaService

#### `createPayment(params)`

Создание платежа в ЮКассе.

**Параметры:**
```javascript
{
    amount: 199,              // Сумма в рублях
    chatId: 123456789,        // ID пользователя
    subscriptionType: 'plus', // Тип подписки
    returnUrl: 'https://...'  // URL возврата
}
```

**Возвращает:**
```javascript
{
    id: '2d97f526-000f-5000-8000-1516e5b4dc95',
    confirmationUrl: 'https://yoomoney.ru/payments/...',
    status: 'pending'
}
```

#### `getPayment(paymentId)`

Получение информации о платеже (для верификации webhook).

**Параметры:**
```javascript
paymentId: '2d97f526-000f-5000-8000-1516e5b4dc95'
```

**Возвращает:**
Полный объект платежа из API ЮКассы.

#### `isConfigured()`

Проверка наличия credentials.

**Возвращает:** `true` / `false`

---

### База данных

#### Таблица `payments`

Новые поля:

```sql
yookassa_payment_id TEXT       -- ID платежа ЮКассы
confirmation_url TEXT          -- URL для оплаты
webhook_received_at DATETIME   -- Время получения webhook

-- Индекс для быстрого поиска
INDEX idx_payments_yookassa_id ON payments(yookassa_payment_id)
```

#### Методы БД

**`_createPaymentRecord()`**
```javascript
_createPaymentRecord(
    chatId,
    payload,
    subscriptionType,
    amount,
    yookassaPaymentId,
    confirmationUrl
)
```

**`_getPaymentByYookassaId()`**
```javascript
const payment = await _getPaymentByYookassaId('2d97f526-...');
```

**`_updatePaymentStatusByYookassaId()`**
```javascript
await _updatePaymentStatusByYookassaId('2d97f526-...', 'completed');
```

---

## Безопасность

### 1. Верификация webhook

**Проблема:** Злоумышленник может отправить фейковый webhook.

**Решение:** Верификация через GET запрос к API ЮКассы:

```javascript
// НИКОГДА не доверяйте webhook напрямую!
const paymentData = req.body.object;

// Верифицируем через API
const verifiedPayment = await YooKassaService.getPayment(paymentData.id);

if (verifiedPayment.status !== 'succeeded') {
    return res.status(200).json({ status: 'ignored' });
}

// Теперь можно обрабатывать
```

### 2. Проверка IP (опционально)

ЮКасса отправляет webhook с IP:
- `185.71.76.0/27`
- `185.71.77.0/27`
- `77.75.153.0/24`

```javascript
app.post('/webhook/yookassa', (req, res, next) => {
    const ip = req.ip;
    const allowedRanges = ['185.71.76.', '185.71.77.', '77.75.153.'];

    const isAllowed = allowedRanges.some(range => ip.startsWith(range));

    if (!isAllowed) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    next();
});
```

### 3. Защита от дубликатов

```javascript
// Проверяем, не был ли платеж уже обработан
if (paymentRecord.status === 'completed') {
    console.log(`⚠️ Платеж ${yookassaPaymentId} уже обработан`);
    return true;  // Возвращаем success
}
```

### 4. Idempotence Key

При создании платежа используем idempotence key для защиты от дубликатов:

```javascript
headers: {
    'Idempotence-Key': `${chatId}_${Date.now()}_${randomId}`
}
```

### 5. Всегда возвращаем 200 OK

**Важно:** ЮКасса повторяет webhook при ошибке (не 200). Всегда возвращайте 200:

```javascript
app.post('/webhook/yookassa', async (req, res) => {
    try {
        // Обработка...
    } catch (error) {
        console.error('Ошибка:', error);
        // Всё равно 200!
        res.status(200).json({ status: 'error', message: error.message });
    }
});
```

---

## Тестирование

### Тестовые карты ЮКассы

| Карта | CVV | Результат |
|-------|-----|-----------|
| `4100 0000 0000 0010` | Любой | ✅ Успех |
| `5555 5555 5555 5599` | Любой | ✅ Успех (3DS) |
| `4111 1111 1111 1026` | Любой | ❌ Отказ |

### Тестовый флоу

1. **Запуск бота:**
```bash
node index.js
```

2. **Запуск веб-сервера (если отдельно):**
```bash
node web/server.js
```

3. **Ngrok для локального тестирования webhook:**
```bash
ngrok http 3000
# Получаете URL: https://abc123.ngrok.io
# Настраиваете webhook: https://abc123.ngrok.io/webhook/yookassa
```

4. **Тестирование:**
   - Отправить боту `/upgrade`
   - Нажать "Оплатить 199 ₽"
   - Перейти по ссылке
   - Ввести тестовую карту `4100 0000 0000 0010`
   - Проверить логи webhook
   - Проверить активацию подписки

### Проверка логов

**В консоли бота:**
```
💳 YooKassa: Создан платёж 2d97f526-... для 123456789
   Статус: pending
   Сумма: 199.00 RUB
📤 Создана ссылка на оплату для 123456789
```

**В консоли веб-сервера:**
```
📥 YooKassa webhook received
   Event: payment.succeeded
   Object ID: 2d97f526-...
🔍 Верификация платежа 2d97f526-...
💰 Обработка успешного платежа ЮКасса:
   Payment ID: 2d97f526-...
   Chat ID: 123456789
   Сумма: 199.00 RUB
✅ Webhook обработан успешно
```

### SQL для проверки платежей

```sql
-- Все платежи пользователя
SELECT * FROM payments WHERE chat_id = 123456789 ORDER BY created_at DESC;

-- Последний платёж
SELECT * FROM payments WHERE yookassa_payment_id = '2d97f526-...';

-- Статистика
SELECT status, COUNT(*) FROM payments GROUP BY status;
```

---

## Troubleshooting

### Webhook не приходит

**Причины:**
1. Неверный URL в ЛК ЮКассы
2. Сервер недоступен (проверьте порт, firewall)
3. SSL сертификат некорректен

**Решение:**
```bash
# Проверка доступности
curl -X POST https://your-domain.com/webhook/yookassa

# Логи nginx (если используется)
tail -f /var/log/nginx/error.log

# Проверка, запущен ли веб-сервер
ps aux | grep node
```

### Платёж создаётся, но не обрабатывается

**Причина:** `botInstance` не установлен.

**Решение:**

```javascript
// index.js
if (process.env.ENABLE_WEB === 'true') {
    const {setBotInstance} = require('./server');
    setBotInstance(bot);  // ← Проверьте это
}
```

### Ошибка "Bot instance not set"

В логах webhook:
```
❌ Bot instance not set, cannot process payment
```

**Решение:** Убедитесь, что `ENABLE_WEB=true` в `.env`.

### Ошибка 401 Unauthorized

```
❌ YooKassa createPayment error: Unauthorized
```

**Причина:** Неверные `YOOKASSA_SHOP_ID` или `YOOKASSA_API_KEY`.

**Решение:** Проверьте credentials в `.env`.

### Платёж обрабатывается дважды

**Причина:** Webhook приходит несколько раз.

**Решение:** Проверка дубликатов уже реализована:
```javascript
if (paymentRecord.status === 'completed') {
    return true;  // Игнорируем повторный webhook
}
```

---

## Миграция со старой системы

### Что удалено

- ❌ `PAYMENT_TOKEN` (Telegram Payments)
- ❌ `handlePreCheckoutQuery()`
- ❌ `handleSuccessfulPayment()`
- ❌ `bot.on('pre_checkout_query', ...)`
- ❌ Проверка `msg.successful_payment`

### Что добавлено

- ✅ `YooKassaService`
- ✅ Новые поля в БД: `yookassa_payment_id`, `confirmation_url`, `webhook_received_at`
- ✅ Webhook endpoint: `POST /webhook/yookassa`
- ✅ `handleYooKassaPaymentSuccess()`
- ✅ Переменные: `YOOKASSA_SHOP_ID`, `YOOKASSA_API_KEY`, `BOT_USERNAME`

### Обратная совместимость

Старые платежи (через Telegram Payments) всё ещё в БД:
- Поле `payload` сохранено
- Поле `telegram_payment_charge_id` сохранено
- Можно создать отчёт по старым платежам

### Переход на новую систему

1. Обновите `.env`:
```bash
# Добавьте
YOOKASSA_SHOP_ID=your_shop_id
YOOKASSA_API_KEY=your_api_key
BOT_USERNAME=your_bot_username

# Можете удалить (но не обязательно)
# PAYMENT_TOKEN=...
```

2. Настройте webhook в ЮКассе

3. Перезапустите бота:
```bash
pm2 restart aviasales-bot
# или
node index.js
```

4. Протестируйте оплату

---

## FAQ

### Можно ли использовать оба метода одновременно?

Технически да, но не рекомендуется. Выберите один метод оплаты.

### Как настроить возвраты?

```javascript
// services/YooKassaService.js
async refundPayment(paymentId, amount) {
    const response = await this.client.post('/refunds', {
        payment_id: paymentId,
        amount: {
            value: amount.toFixed(2),
            currency: 'RUB'
        }
    }, {
        headers: {
            'Idempotence-Key': `refund_${paymentId}_${Date.now()}`
        }
    });

    return response.data;
}
```

### Как отслеживать частичные платежи?

Платежи с `capture: true` списываются сразу. Для частичных платежей используйте `capture: false` и метод `/payments/{id}/capture`.

### Поддерживается ли рекуррентная оплата?

Да, ЮКасса поддерживает автоплатежи. Требуется:
1. Первый платёж с `save_payment_method: true`
2. Сохранение `payment_method_id`
3. Последующие платежи с сохранённым методом

### Как обрабатывать отмены?

```javascript
if (notification.event === 'payment.canceled') {
    console.log(`📛 Платеж отменен: ${notification.object.id}`);
    await _updatePaymentStatusByYookassaId(paymentId, 'canceled');
}
```

---

## Полезные ссылки

- [Документация ЮКасса API](https://yookassa.ru/developers/api)
- [Тестовые данные](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing)
- [Webhook](https://yookassa.ru/developers/using-api/webhooks)
- [Идемпотентность](https://yookassa.ru/developers/using-api/basics#idempotence)

---

## Лицензия

Этот проект использует ЮКасса API в соответствии с их [условиями использования](https://yookassa.ru/docs/payment-acceptance/legal-aspects).

---

**Версия документации:** 1.0
**Дата:** 2026-02-06
**Автор:** Claude Code
