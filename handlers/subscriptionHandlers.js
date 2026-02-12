const SubscriptionService = require('../services/SubscriptionService');
const ActivityService = require('../services/ActivityService');
const YooKassaService = require('../services/YooKassaService');
const db = require('../config/database');

// Конфигурация подписки Plus
const PLUS_SUBSCRIPTION = {
    title: 'Plus подписка',
    description: 'Расширенные возможности мониторинга на 1 месяц',
    price: 199,  // рублей
    currency: 'RUB'
};

class SubscriptionHandlers {
    constructor(bot, userStates) {
        this.bot = bot;
        this.userStates = userStates;

        // Проверка конфигурации ЮКассы
        if (YooKassaService.isConfigured()) {
            console.log('💰 YooKassa API: ✅ Configured');
        } else {
            console.warn('⚠️ YooKassa API: Not configured (missing YOOKASSA_SHOP_ID or YOOKASSA_API_KEY)');
        }
    }

    /**
     * Показать информацию о текущей подписке
     */
    async handleSubscriptionInfo(chatId) {
        // Логируем просмотр подписки
        ActivityService.logEvent(chatId, 'subscription_info').catch(err => console.error('Activity log error:', err));

        try {
            const stats = await SubscriptionService.getSubscriptionStats(chatId);

            let message = `📊 *ВАША ПОДПИСКА: ${stats.subscription}*\n\n`;

            if (stats.validTo) {
                const date = new Date(stats.validTo);
                message += `📅 Действует до: ${date.toLocaleDateString('ru-RU')}\n`;
            } else {
                message += `📅 Бессрочная подписка\n`;
            }

            message += `💰 Стоимость: ${stats.price}\n`;
            message += `⏱ Частота проверок: каждые ${stats.checkInterval} ${this._pluralize(stats.checkInterval, 'час', 'часа', 'часов')}\n\n`;

            message += `📈 *ЛИМИТЫ:*\n`;
            message += `• Фиксированные маршруты: ${stats.currentFixed}/${stats.maxFixed} (осталось ${stats.remainingFixed})\n`;
            message += `• Гибкие + составные маршруты: ${stats.currentFlexible}/${stats.maxFlexible} (осталось ${stats.remainingFlexible})\n`;
            message += `• Макс. комбинаций в гибком: ${stats.maxCombinations}\n`;

            const maxLegsLabel = stats.subscription === 'Plus' ? '7' : stats.subscription === 'Admin' ? '∞' : '5';
            message += `• Макс. плечей в составном: ${maxLegsLabel}\n\n`;

            message += `🔔 *СИСТЕМА УВЕДОМЛЕНИЙ:*\n`;
            message += `🚨 Критические (цена < бюджет) — раз в 6ч или при падении\n`;
            message += `🔥 Высокие (исторический минимум) — раз в 12ч\n`;
            message += `📊 Низкие (остальное) — раз в 24ч\n`;
            message += `🌙 Ночной режим (23:00-08:00) — беззвучно\n\n`;

            message += `_Настроить уведомления можно в разделе ⚙️ Настройки_\n\n`;

            const keyboard = {
                reply_markup: {
                    inline_keyboard: []
                }
            };

            if (stats.subscription === 'Бесплатная') {
                message += `💎 *ПОДПИСКА PLUS:*\n`;
                message += `• 5 фиксированных маршрутов\n`;
                message += `• 3 гибких/составных маршрута\n`;
                message += `• До 7 плечей в составном маршруте\n`;
                message += `• До 50 комбинаций в гибком\n`;
                message += `• Проверка каждые 2 часа\n`;
                message += `• Приоритетная поддержка\n`;
                message += `• Стоимость: 199 ₽/мес\n\n`;
                message += `Хотите улучшить подписку?`;

                keyboard.reply_markup.inline_keyboard.push([
                    { text: '💎 Перейти на Plus', callback_data: 'upgrade_to_plus' }
                ]);
            }

            this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                ...(keyboard.reply_markup.inline_keyboard.length > 0 ? keyboard : {})
            });

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
                '• 3 гибких/составных маршрута (вместо 1)\n' +
                '• До 7 плечей в составном маршруте (вместо 5)\n' +
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
     * Обработка нажатия на кнопку оплаты - создание платежа через ЮКасса API
     */
    async handlePaymentCallback(chatId, callbackQueryId) {
        // Логируем попытку апгрейда
        ActivityService.logEvent(chatId, 'upgrade_attempt').catch(err => console.error('Activity log error:', err));

        try {
            // Проверяем, настроена ли ЮКасса
            if (!YooKassaService.isConfigured()) {
                this.bot.answerCallbackQuery(callbackQueryId, {
                    text: '❌ Платежная система временно недоступна',
                    show_alert: true
                });
                return;
            }

            // Отвечаем на callback query
            this.bot.answerCallbackQuery(callbackQueryId, {
                text: '💳 Создаю ссылку на оплату...',
                show_alert: false
            });

            // Генерируем уникальный payload
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 8);
            const payload = `plus_${chatId}_${timestamp}_${random}`;

            // Формируем return_url (URL возврата после оплаты)
            const botUsername = process.env.BOT_USERNAME || 'aviasales_monitor_bot';
            const returnUrl = `https://t.me/${botUsername}`;

            // Создаем платеж в ЮКассе
            const payment = await YooKassaService.createPayment({
                amount: PLUS_SUBSCRIPTION.price,
                chatId: chatId,
                subscriptionType: 'plus',
                returnUrl: returnUrl
            });

            // Сохраняем запись о платеже в БД
            await this._createPaymentRecord(chatId, payload, 'plus', PLUS_SUBSCRIPTION.price * 100, payment.id, payment.confirmationUrl);

            // Логируем создание ссылки на оплату
            ActivityService.logEvent(chatId, 'payment_link_created', {
                subscription_type: 'plus',
                amount: PLUS_SUBSCRIPTION.price,
                payment_id: payment.id
            }).catch(err => console.error('Activity log error:', err));

            // Отправляем пользователю кнопку с URL оплаты
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Оплатить 199 ₽', url: payment.confirmationUrl }],
                        [{ text: '❓ Помощь по оплате', callback_data: 'payment_help' }]
                    ]
                }
            };

            await this.bot.sendMessage(
                chatId,
                '💰 ОПЛАТА ПОДПИСКИ PLUS\n\n' +
                '📌 Сумма: 199 ₽\n' +
                '📌 Срок: 30 дней\n\n' +
                '🔐 Оплата через ЮKassa — безопасно и удобно.\n' +
                '💳 Доступны: карты, СБП, ЮMoney и другие способы.\n\n' +
                'Нажмите кнопку ниже для перехода к оплате:',
                keyboard
            );

            console.log(`📤 Создана ссылка на оплату для ${chatId}, yookassa_id: ${payment.id}`);

        } catch (error) {
            console.error('Ошибка создания платежа:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка создания платежа. Попробуйте позже.');
        }
    }

    /**
     * Обработка успешного платежа из webhook ЮКассы
     * @param {Object} paymentData - Данные платежа из webhook
     */
    async handleYooKassaPaymentSuccess(paymentData) {
        const yookassaPaymentId = paymentData.id;
        const metadata = paymentData.metadata || {};
        const chatId = parseInt(metadata.chat_id);

        console.log(`💰 Обработка успешного платежа ЮКасса:`);
        console.log(`   Payment ID: ${yookassaPaymentId}`);
        console.log(`   Chat ID: ${chatId}`);
        console.log(`   Сумма: ${paymentData.amount.value} ${paymentData.amount.currency}`);

        try {
            // Получаем запись о платеже из БД
            const paymentRecord = await this._getPaymentByYookassaId(yookassaPaymentId);

            if (!paymentRecord) {
                console.error(`❌ Запись о платеже не найдена: ${yookassaPaymentId}`);
                return false;
            }

            // Проверяем, не был ли платеж уже обработан
            if (paymentRecord.status === 'completed') {
                console.log(`⚠️ Платеж ${yookassaPaymentId} уже обработан`);
                return true;
            }

            // Обновляем статус платежа
            await this._updatePaymentStatusByYookassaId(yookassaPaymentId, 'completed');

            // Активируем подписку
            await SubscriptionService.updateSubscription(paymentRecord.chat_id, paymentRecord.subscription_type);

            // Логируем успешную оплату
            ActivityService.logEvent(paymentRecord.chat_id, 'payment_success', {
                subscription_type: paymentRecord.subscription_type,
                amount: paymentData.amount.value,
                currency: paymentData.amount.currency,
                payment_method: paymentData.payment_method?.type || 'unknown'
            }).catch(err => console.error('Activity log error:', err));

            // Отправляем подтверждение пользователю
            const validTo = new Date();
            validTo.setMonth(validTo.getMonth() + 1);

            await this.bot.sendMessage(paymentRecord.chat_id,
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

            console.log(`✅ Подписка Plus активирована для ${paymentRecord.chat_id}`);
            return true;

        } catch (error) {
            console.error('Ошибка обработки платежа ЮКасса:', error);

            // Пытаемся уведомить пользователя об ошибке
            if (chatId) {
                this.bot.sendMessage(chatId,
                    '⚠️ Оплата получена, но произошла ошибка при активации подписки.\n' +
                    'Пожалуйста, свяжитесь с поддержкой: @jowoodik'
                ).catch(err => console.error('Failed to send error message:', err));
            }
            return false;
        }
    }

    /**
     * Помощь по оплате
     */
    async handlePaymentHelp(chatId, callbackQueryId) {
        // Логируем просмотр помощи
        ActivityService.logEvent(chatId, 'payment_help_viewed').catch(err => console.error('Activity log error:', err));

        this.bot.answerCallbackQuery(callbackQueryId);

        this.bot.sendMessage(
            chatId,
            '❓ ПОМОЩЬ ПО ОПЛАТЕ\n\n' +
            '💳 Оплата происходит через ЮKassa — надежный платежный сервис.\n\n' +
            '📝 Инструкция:\n' +
            '1️⃣ Нажмите кнопку "Оплатить 199 ₽"\n' +
            '2️⃣ Выберите удобный способ оплаты:\n' +
            '   • Банковская карта\n' +
            '   • СБП (Система быстрых платежей)\n' +
            '   • ЮMoney\n' +
            '   • И другие\n' +
            '3️⃣ Подтвердите оплату\n\n' +
            '✅ Подписка активируется автоматически после оплаты!\n\n' +
            '🔒 Оплата безопасна — данные карты не сохраняются.\n\n' +
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
    _createPaymentRecord(chatId, payload, subscriptionType, amount, yookassaPaymentId = null, confirmationUrl = null) {
        return new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO payments (chat_id, payload, subscription_type, amount, status, yookassa_payment_id, confirmation_url, created_at)
                VALUES (?, ?, ?, ?, 'pending', ?, ?, datetime('now'))
            `, [chatId, payload, subscriptionType, amount, yookassaPaymentId, confirmationUrl], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    /**
     * Получить запись о платеже по yookassa_payment_id
     */
    _getPaymentByYookassaId(yookassaPaymentId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM payments WHERE yookassa_payment_id = ?`, [yookassaPaymentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    /**
     * Обновить статус платежа по yookassa_payment_id
     */
    _updatePaymentStatusByYookassaId(yookassaPaymentId, status) {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE payments SET status = ?, webhook_received_at = datetime('now'), completed_at = datetime('now') WHERE yookassa_payment_id = ?`;
            const params = [status, yookassaPaymentId];

            db.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Получить запись о платеже по payload (для совместимости)
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
