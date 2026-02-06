const axios = require('axios');

const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3';
const SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const API_KEY = process.env.YOOKASSA_API_KEY;

class YooKassaService {
    constructor() {
        if (!SHOP_ID || !API_KEY) {
            console.warn('⚠️ YooKassa credentials not configured (YOOKASSA_SHOP_ID, YOOKASSA_API_KEY)');
        }

        this.client = axios.create({
            baseURL: YOOKASSA_API_URL,
            auth: {
                username: SHOP_ID,
                password: API_KEY
            },
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Создать платеж в ЮКассе
     * @param {Object} params
     * @param {number} params.amount - Сумма в рублях
     * @param {number} params.chatId - ID чата пользователя
     * @param {string} params.subscriptionType - Тип подписки (plus)
     * @param {string} params.returnUrl - URL возврата после оплаты
     * @returns {Promise<{id: string, confirmationUrl: string, status: string}>}
     */
    async createPayment({ amount, chatId, subscriptionType, returnUrl }) {
        const idempotenceKey = `${chatId}_${subscriptionType}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        const payload = {
            amount: {
                value: amount.toFixed(2),
                currency: 'RUB'
            },
            confirmation: {
                type: 'redirect',
                return_url: returnUrl
            },
            capture: true,
            description: `Plus подписка для пользователя ${chatId}`,
            metadata: {
                chat_id: chatId.toString(),
                subscription_type: subscriptionType
            }
        };

        try {
            const response = await this.client.post('/payments', payload, {
                headers: {
                    'Idempotence-Key': idempotenceKey
                }
            });

            const payment = response.data;

            console.log(`💳 YooKassa: Создан платеж ${payment.id} для ${chatId}`);
            console.log(`   Статус: ${payment.status}`);
            console.log(`   Сумма: ${payment.amount.value} ${payment.amount.currency}`);

            return {
                id: payment.id,
                confirmationUrl: payment.confirmation.confirmation_url,
                status: payment.status
            };
        } catch (error) {
            console.error('❌ YooKassa createPayment error:', error.response?.data || error.message);
            throw new Error(`Ошибка создания платежа: ${error.response?.data?.description || error.message}`);
        }
    }

    /**
     * Получить информацию о платеже для верификации webhook
     * @param {string} paymentId - ID платежа ЮКассы
     * @returns {Promise<Object>} - Объект платежа
     */
    async getPayment(paymentId) {
        try {
            const response = await this.client.get(`/payments/${paymentId}`);
            const payment = response.data;

            console.log(`🔍 YooKassa: Получен платеж ${payment.id}`);
            console.log(`   Статус: ${payment.status}`);

            return payment;
        } catch (error) {
            console.error('❌ YooKassa getPayment error:', error.response?.data || error.message);
            throw new Error(`Ошибка получения платежа: ${error.response?.data?.description || error.message}`);
        }
    }

    /**
     * Проверить, настроен ли сервис
     * @returns {boolean}
     */
    isConfigured() {
        return !!(SHOP_ID && API_KEY);
    }
}

module.exports = new YooKassaService();
