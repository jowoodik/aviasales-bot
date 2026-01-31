const db = require('../config/database');

class SubscriptionService {
    /**
     * Получить текущую подписку пользователя
     */
    static async getUserSubscription(chatId) {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT st.*, us.valid_to, us.valid_from, us.is_active
                FROM user_subscriptions us
                JOIN subscription_types st ON st.name = us.subscription_type
                WHERE us.chat_id = ? AND us.is_active = 1
                AND (us.valid_to IS NULL OR us.valid_to > datetime('now'))
                ORDER BY us.valid_from DESC
                LIMIT 1
            `, [chatId], (err, row) => {
                if (err) reject(err);
                else if (row) resolve(row);
                else {
                    // Если подписка не найдена, возвращаем free по умолчанию
                    db.get(`SELECT * FROM subscription_types WHERE name = 'free'`, (err, freePlan) => {
                        if (err) reject(err);
                        else resolve(freePlan);
                    });
                }
            });
        });
    }

    /**
     * Инициализировать подписку пользователя (при первом входе)
     */
    static async initializeUserSubscription(chatId, subscriptionType = 'free') {
        return new Promise((resolve, reject) => {
            db.run(`
                INSERT OR REPLACE INTO user_subscriptions 
                (chat_id, subscription_type, valid_from, valid_to, is_active)
                VALUES (?, ?, datetime('now'), ?, 1)
            `, [chatId, subscriptionType, subscriptionType === 'free' || subscriptionType === 'admin' ? null : this._getOneMonthLater()],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    /**
     * Проверить лимиты пользователя
     */
    static async checkUserLimits(chatId, isFlexible, combinationsCount = 0) {
        const subscription = await this.getUserSubscription(chatId);
        const routes = await this._getUserRoutes(chatId);

        const flexibleCount = routes.filter(r => r.is_flexible === 1).length;
        const fixedCount = routes.filter(r => r.is_flexible === 0).length;

        const limits = {
            allowed: true,
            message: ''
        };

        // Проверка лимитов по типу маршрута
        if (isFlexible && flexibleCount >= subscription.max_flexible_routes) {
            limits.allowed = false;
            limits.message = `⚠️ Лимит гибких маршрутов исчерпан.\n\n` +
                `📊 Ваша подписка "${subscription.display_name}" позволяет:\n` +
                `• ${subscription.max_flexible_routes} гибкий маршрут\n` +
                `• ${subscription.max_fixed_routes} фиксированных маршрутов\n` +
                `• До ${subscription.max_combinations} комбинаций\n\n` +
                `💎 Хотите больше? Оформите подписку Plus!`;
        }

        if (!isFlexible && fixedCount >= subscription.max_fixed_routes) {
            limits.allowed = false;
            limits.message = `⚠️ Лимит фиксированных маршрутов исчерпан.\n\n` +
                `📊 Ваша подписка "${subscription.display_name}" позволяет:\n` +
                `• ${subscription.max_flexible_routes} гибкий маршрут\n` +
                `• ${subscription.max_fixed_routes} фиксированных маршрутов\n` +
                `• До ${subscription.max_combinations} комбинаций\n\n` +
                `💎 Хотите больше? Оформите подписку Plus!`;
        }

        // Проверка лимитов комбинаций для гибких маршрутов
        if (isFlexible && combinationsCount > subscription.max_combinations) {
            limits.allowed = false;
            limits.message = `⚠️ Превышен лимит комбинаций.\n\n` +
                `📊 Будет ${combinationsCount} комбинаций, но ваша подписка "${subscription.display_name}" позволяет максимум ${subscription.max_combinations}.\n\n` +
                `💎 Хотите больше? Оформите подписку Plus (до 50 комбинаций)!`;
        }

        return limits;
    }

    /**
     * Получить статистику подписки
     */
    static async getSubscriptionStats(chatId) {
        const subscription = await this.getUserSubscription(chatId);
        const routes = await this._getUserRoutes(chatId);

        const flexibleCount = routes.filter(r => r.is_flexible === 1).length;
        const fixedCount = routes.filter(r => r.is_flexible === 0).length;

        return {
            subscription: subscription.display_name,
            maxFlexible: subscription.max_flexible_routes,
            maxFixed: subscription.max_fixed_routes,
            maxCombinations: subscription.max_combinations,
            checkInterval: subscription.check_interval_hours,
            currentFlexible: flexibleCount,
            currentFixed: fixedCount,
            remainingFlexible: Math.max(0, subscription.max_flexible_routes - flexibleCount),
            remainingFixed: Math.max(0, subscription.max_fixed_routes - fixedCount),
            validTo: subscription.valid_to,
            price: subscription.price_per_month > 0 ? `${subscription.price_per_month} ₽/мес` : 'Бесплатно'
        };
    }

    /**
     * Обновить подписку пользователя
     */
    static async updateSubscription(chatId, subscriptionType) {
        return new Promise((resolve, reject) => {
            const validTo = subscriptionType === 'free' || subscriptionType === 'admin' ?
                null : this._getOneMonthLater();

            db.run(`
                UPDATE user_subscriptions 
                SET subscription_type = ?, valid_from = datetime('now'), valid_to = ?
                WHERE chat_id = ?
            `, [subscriptionType, validTo, chatId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Вспомогательный метод: получить маршруты пользователя
     */
    static _getUserRoutes(chatId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM unified_routes WHERE chat_id = ? AND is_paused = 0`, [chatId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Вспомогательный метод: дата через месяц
     */
    static _getOneMonthLater() {
        const date = new Date();
        date.setMonth(date.getMonth() + 1);
        return date.toISOString().split('T')[0];
    }
}

module.exports = SubscriptionService;