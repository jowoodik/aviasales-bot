const SubscriptionService = require('../services/SubscriptionService');

class SubscriptionHandlers {
    constructor(bot, userStates) {
        this.bot = bot;
        this.userStates = userStates;
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

            if (stats.subscription !== 'Plus') {
                message += `💎 ПОДПИСКА PLUS:\n`;
                message += `• 5 фиксированных маршрутов\n`;
                message += `• 3 гибких маршрута\n`;
                message += `• До 50 комбинаций в гибком\n`;
                message += `• Проверка каждые 2 часа\n`;
                message += `• Стоимость: 199 ₽/мес\n\n`;
            }

            this.bot.sendMessage(chatId, message);

        } catch (error) {
            console.error('Ошибка получения информации о подписке:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка получения информации о подписке');
        }
    }

    /**
     * Обработка команды /upgrade
     */
    async handleUpgrade(chatId) {
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[
                    {text: '💳 Оплатить 199 ₽', callback_data: 'payment_plus'}
                ]]
            }
        };

        this.bot.sendMessage(
            chatId,
            '💎 ПОДПИСКА PLUS\n\n' +
            'Преимущества:\n' +
            '• 5 фиксированных маршрутов (вместо 3)\n' +
            '• 3 гибких маршрута (вместо 1)\n' +
            '• До 50 комбинаций в гибком маршруте (вместо 20)\n' +
            '• Проверка каждые 2 часа (вместо 4)\n' +
            '• Приоритетная поддержка\n\n' +
            'Стоимость: 199 ₽/мес\n\n' +
            'Для оплаты нажмите кнопку ниже:',
            // keyboard
        );
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