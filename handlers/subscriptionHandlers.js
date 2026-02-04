const SubscriptionService = require('../services/SubscriptionService');
const ActivityService = require('../services/ActivityService');
const db = require('../config/database');

// Токен провайдера платежей (ЮKassa)
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN;

// Конфигурация подписки Plus
const PLUS_SUBSCRIPTION = {
    title: 'Plus подписка',
    description: 'Расширенные возможности мониторинга на 1 месяц',
    price: 19900,  // копейки (199 рублей)
    currency: 'RUB'
};

class SubscriptionHandlers {
    constructor(bot, userStates) {
        this.bot = bot;
        this.userStates = userStates;
    }

    /**
     * Показать информацию о текущей подписке
     */
    async handleSubscriptionInfo(chatId) {
        // Логируем просмотр подписки
        ActivityService.logEvent(chatId, 'subscription_info').catch(err => console.error('Activity log error:', err));

        try {
            const stats = await SubscriptionService.getSubscriptionStats(chatId);
            let message = `📊 ВАША ПОДПИСКА: ${stats.subscription}\n\n`;

            if (stats.validTo) {
                const date = new Date(stats.validTo);
                message += `📅 Действует до: ${date.toLocaleDateString('ru-RU')}\n`;
            } else {
                message += `📅 Бессрочная подписка\n`;
            }

            message += `💰 Стоимость: ${stats.price}\n`;
            message += `⏱ Частота проверок: каждые ${stats.checkInterval} ${this._pluralize(stats.checkInterval, 'час', 'часа', 'часов')}\n\n`;
            message += `📈 ЛИМИТЫ:\n`;
            message += `• Фиксированные маршруты: ${stats.currentFixed}/${stats.maxFixed} (осталось ${stats.remainingFixed})\n`;
            message += `• Гибкие маршруты: ${stats.currentFlexible}/${stats.maxFlexible} (осталось ${stats.remainingFlexible})\n`;
            message += `• Макс. комбинаций в гибком: ${stats.maxCombinations}\n\n`;

            const keyboard = {
                reply_markup: {
                    inline_keyboard: []
                }
            };

            if (stats.subscription === 'Бесплатная') {
                message += `💎 ПОДПИСКА PLUS:\n`;
                message += `• 5 фиксированных маршрутов\n`;
                message += `• 3 гибких маршрута\n`;
                message += `• До 50 комбинаций в гибком\n`;
                message += `• Проверка каждые 2 часа\n`;
                message += `• Приоритетная поддержка\n`;
                message += `• Стоимость: 199 ₽/мес\n\n`;
                message += `Хотите улучшить подписку?`;

                keyboard.reply_markup.inline_keyboard.push([
                    { text: '💎 Перейти на Plus', callback_data: 'upgrade_to_plus' }
                ]);
            }

            this.bot.sendMessage(chatId, message, keyboard.reply_markup.inline_keyboard.length > 0 ? keyboard : {});
        } catch (error) {
            console.error('Ошибка получения информации о подписке:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка получения информации о подписке');
        }
    }

    /**
     * Обработка команды /upgrade
     */
    async handleUpgrade(chatId) {
        try {
            // Проверяем текущую подписку
            const subscription = await SubscriptionService.getUserSubscription(chatId);

            if (subscription.name === 'plus') {
                this.bot.sendMessage(
                    chatId,
                    '✅ У вас уже активна подписка Plus!\n\n' +
                    'Если срок подписки заканчивается, вы можете продлить её, оплатив еще раз.'
                );
                return;
            }

            if (subscription.name === 'admin') {
                this.bot.sendMessage(
                    chatId,
                    '👑 У вас Admin подписка - все возможности уже доступны!'
                );
                return;
            }

            // Показываем преимущества и кнопку оплаты
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '💳 Оплатить 199 ₽', callback_data: 'payment_plus' }
                    ]]
                }
            };

            this.bot.sendMessage(
                chatId,
                '💎 ПОДПИСКА PLUS\n\n' +
                '🎯 Преимущества:\n' +
                '• 5 фиксированных маршрутов (вместо 3)\n' +
                '• 3 гибких маршрута (вместо 1)\n' +
                '• До 50 комбинаций в гибком маршруте (вместо 20)\n' +
                '• Проверка каждые 2 часа (вместо 4)\n' +
                '• Приоритетная поддержка\n\n' +
                '💰 Стоимость: 199 ₽/мес\n\n' +
                'Для оплаты нажмите кнопку ниже:',
                keyboard
            );
        } catch (error) {
            console.error('Ошибка обработки upgrade:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка. Попробуйте позже.');
        }
    }

    /**
     * Обработка нажатия на кнопку оплаты - отправка счёта через Telegram Payments
     */
    async handlePaymentCallback(chatId, callbackQueryId) {
        // Логируем попытку апгрейда
        ActivityService.logEvent(chatId, 'upgrade_attempt').catch(err => console.error('Activity log error:', err));

        try {
            // Отвечаем на callback query
            this.bot.answerCallbackQuery(callbackQueryId, {
                text: '💳 Создаю счёт для оплаты...',
                show_alert: false
            });

            // Генерируем уникальный payload
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 8);
            const payload = `plus_${chatId}_${timestamp}_${random}`;

            // Сохраняем запись о платеже в БД
            await this._createPaymentRecord(chatId, payload, 'plus', PLUS_SUBSCRIPTION.price);

            // Отправляем счёт через Telegram Payments
            await this.bot.sendInvoice(
                chatId,
                PLUS_SUBSCRIPTION.title,                    // title
                PLUS_SUBSCRIPTION.description,              // description
                payload,                                    // payload (уникальный идентификатор)
                PAYMENT_TOKEN,                              // provider_token
                PLUS_SUBSCRIPTION.currency,                 // currency
                [{ label: 'Plus подписка (30 дней)', amount: PLUS_SUBSCRIPTION.price }]  // prices
            );

            console.log(`📤 Отправлен счёт для ${chatId}, payload: ${payload}`);

        } catch (error) {
            console.error('Ошибка отправки счёта:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка создания счёта. Попробуйте позже.');
        }
    }
    async handlePreCheckoutQuery(query) {
        const chatId = query.from.id;
        const payload = query.invoice_payload;
        console.log(`📥 Pre-checkout от ${chatId}, payload: ${payload}`);

        try {
            const payment = await this._getPaymentByPayload(payload);

            if (!payment) {
                console.error(`❌ Платёж не найден: ${payload}`);
                await this.bot.answerPreCheckoutQuery(query.id, false, {
                    error_message: 'Счёт не найден. Пожалуйста, создайте новый счёт.'
                });
                return;
            }

            // ✅ ИЗМЕНЕНИЕ: Разрешаем повторные попытки, если платёж ещё не завершён
            if (payment.status === 'completed') {
                console.error(`❌ Платёж уже завершён: ${payment.status}`);
                await this.bot.answerPreCheckoutQuery(query.id, false, {
                    error_message: 'Этот счёт уже оплачен. Создайте новый счёт для повторной оплаты.'
                });
                return;
            }

            // Обновляем статус на pre_checkout (можно делать несколько раз)
            await this._updatePaymentStatus(payload, 'pre_checkout');

            // Подтверждаем pre-checkout
            await this.bot.answerPreCheckoutQuery(query.id, true);
            console.log(`✅ Pre-checkout подтверждён для ${chatId}`);

        } catch (error) {
            console.error('Ошибка обработки pre_checkout:', error);
            await this.bot.answerPreCheckoutQuery(query.id, false, {
                error_message: 'Ошибка обработки платежа. Попробуйте позже.'
            });
        }
    }
    /**
     * Обработка successful_payment - успешная оплата
     */
    async handleSuccessfulPayment(message) {
        const chatId = message.chat.id;
        const payment = message.successful_payment;
        const payload = payment.invoice_payload;
        const telegramChargeId = payment.telegram_payment_charge_id;
        const providerChargeId = payment.provider_payment_charge_id;

        console.log(`💰 Успешная оплата от ${chatId}:`);
        console.log(`   Payload: ${payload}`);
        console.log(`   Telegram charge ID: ${telegramChargeId}`);
        console.log(`   Provider charge ID: ${providerChargeId}`);
        console.log(`   Сумма: ${payment.total_amount} ${payment.currency}`);

        try {
            // Получаем запись о платеже
            const paymentRecord = await this._getPaymentByPayload(payload);

            if (!paymentRecord) {
                console.error(`❌ Запись о платеже не найдена: ${payload}`);
                this.bot.sendMessage(chatId,
                    '⚠️ Оплата получена, но произошла ошибка при обработке.\n' +
                    'Пожалуйста, свяжитесь с поддержкой: @jowoodik'
                );
                return;
            }

            // Обновляем статус платежа на completed
            await this._updatePaymentStatus(payload, 'completed', telegramChargeId, providerChargeId);

            // Активируем подписку
            await SubscriptionService.updateSubscription(chatId, paymentRecord.subscription_type);

            // Логируем успешную оплату
            ActivityService.logEvent(chatId, 'payment_success', {
                subscription_type: paymentRecord.subscription_type,
                amount: payment.total_amount,
                currency: payment.currency
            }).catch(err => console.error('Activity log error:', err));

            // Отправляем подтверждение
            const validTo = new Date();
            validTo.setMonth(validTo.getMonth() + 1);

            this.bot.sendMessage(chatId,
                '🎉 Оплата успешно получена!\n\n' +
                '💎 Подписка Plus активирована!\n\n' +
                `📅 Действует до: ${validTo.toLocaleDateString('ru-RU')}\n\n` +
                '✨ Теперь вам доступны:\n' +
                '• 5 фиксированных маршрутов\n' +
                '• 3 гибких маршрута\n' +
                '• До 50 комбинаций\n' +
                '• Проверка каждые 2 часа\n\n' +
                'Спасибо за поддержку проекта! 🙏'
            );

            console.log(`✅ Подписка Plus активирована для ${chatId}`);

        } catch (error) {
            console.error('Ошибка обработки successful_payment:', error);
            this.bot.sendMessage(chatId,
                '⚠️ Оплата получена, но произошла ошибка при активации подписки.\n' +
                'Пожалуйста, свяжитесь с поддержкой: @jowoodik'
            );
        }
    }

    /**
     * Помощь по оплате
     */
    async handlePaymentHelp(chatId, callbackQueryId) {
        this.bot.answerCallbackQuery(callbackQueryId);

        this.bot.sendMessage(
            chatId,
            '❓ ПОМОЩЬ ПО ОПЛАТЕ\n\n' +
            '💳 Оплата происходит через Telegram Payments с провайдером ЮKassa.\n\n' +
            '📝 Инструкция:\n' +
            '1️⃣ Нажмите кнопку "Оплатить 199 ₽"\n' +
            '2️⃣ В открывшемся окне выберите способ оплаты\n' +
            '3️⃣ Введите данные карты\n' +
            '4️⃣ Подтвердите оплату\n\n' +
            '✅ Подписка активируется автоматически сразу после оплаты!\n\n' +
            '🔒 Оплата безопасна - данные карты не сохраняются.\n\n' +
            '❗️ Если возникли проблемы, напишите в поддержку: @jowoodik'
        );
    }

    /**
     * Обработка callback query для подписок
     */
    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        const data = query.data;

        try {
            switch (data) {
                case 'upgrade_to_plus':
                case 'payment_plus':
                    await this.handlePaymentCallback(chatId, query.id);
                    break;

                case 'payment_help':
                    await this.handlePaymentHelp(chatId, query.id);
                    break;

                default:
                    this.bot.answerCallbackQuery(query.id);
            }
        } catch (error) {
            console.error('Ошибка обработки callback:', error);
            this.bot.answerCallbackQuery(query.id, {
                text: '❌ Ошибка. Попробуйте позже.',
                show_alert: true
            });
        }
    }

    // ============================================
    // МЕТОДЫ РАБОТЫ С БД (payments)
    // ============================================

    /**
     * Создать запись о платеже
     */
    _createPaymentRecord(chatId, payload, subscriptionType, amount) {
        return new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO payments (chat_id, payload, subscription_type, amount, status, created_at)
                VALUES (?, ?, ?, ?, 'pending', datetime('now'))
            `, [chatId, payload, subscriptionType, amount], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    /**
     * Обновить статус платежа
     */
    _updatePaymentStatus(payload, status, telegramChargeId = null, providerChargeId = null) {
        return new Promise((resolve, reject) => {
            let sql, params;

            if (status === 'pre_checkout') {
                sql = `UPDATE payments SET status = ?, pre_checkout_at = datetime('now') WHERE payload = ?`;
                params = [status, payload];
            } else if (status === 'completed') {
                sql = `UPDATE payments SET status = ?, telegram_payment_charge_id = ?, provider_payment_charge_id = ?, completed_at = datetime('now') WHERE payload = ?`;
                params = [status, telegramChargeId, providerChargeId, payload];
            } else {
                sql = `UPDATE payments SET status = ? WHERE payload = ?`;
                params = [status, payload];
            }

            db.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Получить запись о платеже по payload
     */
    _getPaymentByPayload(payload) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM payments WHERE payload = ?`, [payload], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    _pluralize(number, one, two, five) {
        let n = Math.abs(number);
        n %= 100;
        if (n >= 5 && n <= 20) {
            return five;
        }
        n %= 10;
        if (n === 1) {
            return one;
        }
        if (n >= 2 && n <= 4) {
            return two;
        }
        return five;
    }
}

module.exports = SubscriptionHandlers;
