const SubscriptionService = require('../services/SubscriptionService');
const path = require('path');
const fs = require('fs');

class SubscriptionHandlers {
    constructor(bot, userStates) {
        this.bot = bot;
        this.userStates = userStates;
        // Путь к изображению с QR-кодом
        this.qrCodePath = path.join(__dirname, '../assets/qr.jpeg');
    }

    /**
     * Показать информацию о текущей подписке
     */
    async handleSubscriptionInfo(chatId) {
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
     * Обработка нажатия на кнопку оплаты
     */
    async handlePaymentCallback(chatId, callbackQueryId) {
        try {
            // Отвечаем на callback query
            this.bot.answerCallbackQuery(callbackQueryId, {
                text: '💳 Загружаю данные для оплаты...',
                show_alert: false
            });

            // Формируем текст инструкций (БЕЗ Markdown entities!)
            const instructionsText =
                `💳 ОПЛАТА ПОДПИСКИ PLUS\n\n` +
                `💰 Сумма: 199 ₽\n` +
                `⏱ Срок: 30 дней\n\n` +
                `📱 СПОСОБЫ ОПЛАТЫ:\n\n` +
                `1️⃣ По QR-коду:\n` +
                `   Отсканируйте QR-код на изображении выше\n\n` +
                `2️⃣ По номеру телефона:\n` +
                `   📞 +7-922-296-45-50\n` +
                `   🏦 ТБанк (СБП)\n\n` +
                `⚠️ ВАЖНО! В комментарии к переводу обязательно укажите:\n` +
                `\`${chatId}\` (скопируйте это число кликом по нему)\n\n` +
                `После оплаты подписка активируется вручную в течение 15 минут.\n` +
                `Если есть вопросы - напишите в поддержку.`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '✅ Я оплатил', callback_data: 'payment_confirm' },
                    { text: '❓ Помощь', callback_data: 'payment_help' }
                ]]
            };

            // Проверяем наличие файла с QR-кодом
            if (fs.existsSync(this.qrCodePath)) {
                // Сначала отправляем изображение БЕЗ caption
                await this.bot.sendPhoto(chatId, this.qrCodePath);

                // Затем отправляем текст отдельным сообщением
                await this.bot.sendMessage(chatId, instructionsText, {
                    parse_mode: 'Markdown', reply_markup: keyboard
                });
            } else {
                // Если файла нет, отправляем только текст с предупреждением
                const textWithWarning =
                    `⚠️ QR-код временно недоступен\n\n` + instructionsText;

                await this.bot.sendMessage(chatId, textWithWarning, {
                    parse_mode: 'Markdown', reply_markup: keyboard
                });
            }

            // Сохраняем в состояние, что пользователь ожидает оплаты
            this.userStates[chatId] = {
                step: 'awaiting_payment',
                timestamp: Date.now()
            };

        } catch (error) {
            console.error('Ошибка отправки данных для оплаты:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка загрузки данных для оплаты. Попробуйте позже.');
        }
    }

    /**
     * Подтверждение оплаты
     */
    async handlePaymentConfirm(chatId, callbackQueryId) {
        this.bot.answerCallbackQuery(callbackQueryId, {
            text: '✅ Спасибо! Проверяем оплату...',
            show_alert: false
        });

        this.bot.sendMessage(
            chatId,
            '✅ Спасибо за оплату!\n\n' +
            '⏳ Проверяем поступление платежа. Это займет до 15 минут.\n\n' +
            '📬 Вы получите уведомление, как только подписка будет активирована.\n\n' +
            'Если платеж не поступит в течение часа, напишите в поддержку с указанием:\n' +
            `• Вашего ID: ${chatId}\n` +
            '• Времени оплаты\n' +
            '• Скриншота чека'
        );

        delete this.userStates[chatId];
    }

    /**
     * Помощь по оплате
     */
    async handlePaymentHelp(chatId, callbackQueryId) {
        this.bot.answerCallbackQuery(callbackQueryId);

        this.bot.sendMessage(
            chatId,
            '❓ ПОМОЩЬ ПО ОПЛАТЕ\n\n' +
            '📱 Инструкция для СБП:\n\n' +
            '1️⃣ Откройте приложение вашего банка\n' +
            '2️⃣ Найдите раздел "Переводы по СБП" или "Переводы по номеру телефона"\n' +
            '3️⃣ Введите номер: +7-922-296-45-50\n' +
            '4️⃣ Выберите банк получателя: ТБанк\n' +
            '5️⃣ Укажите сумму: 199 ₽\n' +
            `6️⃣ В комментарии обязательно укажите: ${chatId}\n` +
            '7️⃣ Подтвердите перевод\n\n' +
            '⏱ Подписка активируется  вручную в течение 15 минут после оплаты.\n\n' +
            '❗️ Если у вас возникли проблемы, напишите в поддержку.'
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

                case 'payment_confirm':
                    await this.handlePaymentConfirm(chatId, query.id);
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
