const db = require('../config/database');

class PaymentNotificationService {
    constructor(bot) {
        this.bot = bot;
    }

    /**
     * Проверить и отправить уведомления о новых платежах
     */
    async checkAndNotify() {
        try {
            // Получаем все completed платежи без уведомлений
            const payments = await this._getUnnotifiedPayments();

            if (payments.length === 0) {
                return;
            }

            console.log(`📬 Найдено ${payments.length} платежей без уведомлений`);

            for (const payment of payments) {
                try {
                    await this._sendPaymentNotification(payment);
                    await this._markAsNotified(payment.id);
                    console.log(`✅ Уведомление отправлено для платежа ${payment.yookassa_payment_id}`);
                } catch (error) {
                    console.error(`❌ Ошибка отправки уведомления для платежа ${payment.id}:`, error);
                }
            }
        } catch (error) {
            console.error('❌ Ошибка проверки платежей:', error);
        }
    }

    /**
     * Получить платежи без уведомлений
     */
    _getUnnotifiedPayments() {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM payments
                WHERE status = 'completed'
                  AND notification_sent = 0
                  AND yookassa_payment_id IS NOT NULL
                ORDER BY completed_at ASC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Отправить уведомление пользователю
     */
    async _sendPaymentNotification(payment) {
        const chatId = payment.chat_id;
        const subscriptionType = payment.subscription_type;

        // Формируем дату окончания подписки (через месяц)
        const validTo = new Date(payment.completed_at);
        validTo.setMonth(validTo.getMonth() + 1);

        let message = '🎉 Оплата успешно получена!\n\n';

        if (subscriptionType === 'plus') {
            message += '💎 Подписка Plus активирована!\n\n';
            message += `📅 Действует до: ${validTo.toLocaleDateString('ru-RU')}\n\n`;
            message += '✨ Теперь вам доступны:\n';
            message += '• 5 фиксированных маршрутов\n';
            message += '• 3 гибких маршрута\n';
            message += '• До 50 комбинаций\n';
            message += '• Проверка каждые 2 часа\n\n';
            message += 'Спасибо за поддержку проекта! 🙏';
        } else {
            message += `✅ Подписка "${subscriptionType}" активирована!\n\n`;
            message += `📅 Действует до: ${validTo.toLocaleDateString('ru-RU')}`;
        }

        await this.bot.sendMessage(chatId, message);
    }

    /**
     * Пометить платеж как уведомлённый
     */
    _markAsNotified(paymentId) {
        return new Promise((resolve, reject) => {
            db.run(`
                UPDATE payments
                SET notification_sent = 1
                WHERE id = ?
            `, [paymentId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

module.exports = PaymentNotificationService;
