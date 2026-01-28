const db = require('../config/database');

class UnifiedRoute {
    /**
     * Создать новый маршрут
     */
    static create(chatId, routeData) {
        return new Promise((resolve, reject) => {
            const {
                origin,
                destination,
                is_flexible,
                has_return,
                departure_date,
                return_date,
                departure_start,
                departure_end,
                min_days,
                max_days,
                adults,
                children,
                airline,
                baggage,
                max_stops,
                max_layover_hours,
                threshold_price,
                currency
            } = routeData;

            const sql = `
                INSERT INTO unified_routes (
                    chat_id, origin, destination, is_flexible, has_return,
                    departure_date, return_date, departure_start, departure_end,
                    min_days, max_days, adults, children, airline, baggage,
                    max_stops, max_layover_hours, threshold_price, currency
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(sql, [
                chatId, origin, destination, is_flexible ? 1 : 0, has_return ? 1 : 0,
                departure_date, return_date, departure_start, departure_end,
                min_days, max_days, adults, children, airline, baggage,
                max_stops, max_layover_hours, threshold_price, currency || 'RUB'
            ], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    /**
     * Найти маршрут по ID
     */
    static findById(id) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM unified_routes WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    /**
     * Найти все маршруты пользователя
     */
    static findByChatId(chatId) {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM unified_routes WHERE chat_id = ? ORDER BY created_at DESC', [chatId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Получить все активные маршруты (для мониторинга)
     */
    static getAllActive() {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM unified_routes WHERE is_paused = 0', (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Переключить статус паузы маршрута (вкл/выкл)
     */
    static updateStatus(id, isActive) {
        return new Promise((resolve, reject) => {
            // isActive = 1 → is_paused = 0 (активен)
            // isActive = 0 → is_paused = 1 (на паузе)
            const isPaused = isActive ? 0 : 1;
            db.run('UPDATE unified_routes SET is_paused = ? WHERE id = ?', [isPaused, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Обновить статус паузы напрямую
     */
    static updatePauseStatus(id, isPaused) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE unified_routes SET is_paused = ? WHERE id = ?', [isPaused ? 1 : 0, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Обновить порог цены
     */
    static updateThreshold(id, threshold) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE unified_routes SET threshold_price = ? WHERE id = ?', [threshold, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Удалить маршрут
     */
    static delete(id) {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM unified_routes WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Обновить время последней проверки
     */
    static updateLastCheck(id) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE unified_routes SET last_check = datetime("now") WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Генерация комбинаций для гибкого маршрута
     */
    static getCombinations(route) {
        if (!route.is_flexible) {
            // Фиксированный маршрут - одна комбинация
            return [{
                departure_date: route.departure_date,
                return_date: route.return_date,
                days_in_country: route.has_return ? this._calculateDays(route.departure_date, route.return_date) : null
            }];
        }

        const combinations = [];
        const startDate = new Date(route.departure_start);
        const endDate = new Date(route.departure_end);

        // Если нет обратного билета - генерируем только даты вылета
        if (!route.has_return) {
            let currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                combinations.push({
                    departure_date: this._formatDate(currentDate),
                    return_date: null,
                    days_in_country: null
                });
                currentDate.setDate(currentDate.getDate() + 1);
            }
            return combinations;
        }

        // Гибкий маршрут с обратным билетом - генерируем комбинации
        let currentDeparture = new Date(startDate);

        while (currentDeparture <= endDate) {
            for (let days = route.min_days; days <= route.max_days; days++) {
                const returnDate = new Date(currentDeparture);
                returnDate.setDate(returnDate.getDate() + days);

                combinations.push({
                    departure_date: this._formatDate(currentDeparture),
                    return_date: this._formatDate(returnDate),
                    days_in_country: days
                });
            }
            currentDeparture.setDate(currentDeparture.getDate() + 1);
        }

        return combinations;
    }

    /**
     * Подсчет количества комбинаций
     */
    static countCombinations(route) {
        if (!route.is_flexible) return 1;

        if (!route.has_return) {
            const start = new Date(route.departure_start);
            const end = new Date(route.departure_end);
            const diffTime = Math.abs(end - start);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays + 1;
        }

        const start = new Date(route.departure_start);
        const end = new Date(route.departure_end);
        const diffTime = Math.abs(end - start);
        const departureDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        const stayDays = route.max_days - route.min_days + 1;

        return departureDays * stayDays;
    }

    /**
     * Вспомогательные методы
     */
    static _formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    static _calculateDays(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
}

module.exports = UnifiedRoute;
