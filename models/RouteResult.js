const db = require('../config/database');

class RouteResult {
    /**
     * Сохранить результат поиска
     */
    static save(routeId, data) {
        return new Promise((resolve, reject) => {
            db.run(`
        INSERT INTO route_results 
        (route_id, departure_date, return_date, days_in_country, 
         total_price, airline, search_link, screenshot_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
                routeId,
                data.departure_date,
                data.return_date,
                data.days_in_country,
                data.total_price,
                data.airline,
                data.search_link,
                data.screenshot_path
            ], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    /**
     * Получить топ N результатов по цене
     */
    static getTopResults(routeId, limit = 3) {
        return new Promise((resolve, reject) => {
            const sql = `
        SELECT * FROM route_results 
        WHERE route_id = ? 
        ORDER BY total_price ASC 
        LIMIT ?
      `;

            db.all(sql, [routeId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Получить результаты для маршрута
     */
    static getByRouteId(routeId, limit = 10) {
        return new Promise((resolve, reject) => {
            db.all(`
        SELECT * FROM route_results 
        WHERE route_id = ? 
        ORDER BY found_at DESC 
        LIMIT ?
      `, [routeId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Получить лучшую (минимальную) цену для маршрута
     */
    static getBestPrice(routeId) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT MIN(total_price) as best_price FROM route_results WHERE route_id = ?',
                [routeId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.best_price || null);
                }
            );
        });
    }

    /**
     * Удалить старые результаты
     */
    static cleanOldResults(routeId, keepCount = 10) {
        return new Promise((resolve, reject) => {
            db.run(`
        DELETE FROM route_results 
        WHERE route_id = ? 
        AND id NOT IN (
          SELECT id FROM route_results 
          WHERE route_id = ? 
          ORDER BY found_at DESC 
          LIMIT ?
        )
      `, [routeId, routeId, keepCount], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Статистика цен по направлению за последние 30 дней
     * Нормализует на 1 человека через JOIN с unified_routes
     */
    static getDirectionPriceStats(origin, destination, hasReturn) {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT
                    MIN(pa.price / (ur.adults + COALESCE(ur.children, 0))) as min_price_per_person,
                    ROUND(AVG(pa.price / (ur.adults + COALESCE(ur.children, 0)))) as avg_price_per_person
                FROM price_analytics pa
                JOIN unified_routes ur ON pa.route_id = ur.id
                WHERE pa.origin = ? AND pa.destination = ?
                  AND ur.has_return = ?
                  AND pa.found_at > datetime('now', '-30 days')
            `, [origin, destination, hasReturn ? 1 : 0], (err, row) => {
                if (err) reject(err);
                else resolve(row && row.min_price_per_person ? row : null);
            });
        });
    }

    /**
     * Глобальная статистика бота
     */
    static getGlobalStats() {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT COALESCE(SUM(total_combinations), 0) as totalCombinations FROM route_check_stats`,
                (err, row1) => {
                    if (err) return reject(err);
                    db.get(
                        `SELECT COUNT(*) as belowBudgetCount FROM route_results rr
                         JOIN unified_routes ur ON rr.route_id = ur.id
                         WHERE rr.total_price <= ur.threshold_price AND ur.threshold_price > 0`,
                        (err, row2) => {
                            if (err) return reject(err);
                            resolve({
                                totalCombinations: row1?.totalCombinations || 0,
                                belowBudgetCount: row2?.belowBudgetCount || 0
                            });
                        }
                    );
                }
            );
        });
    }

    /**
     * Удалить все результаты маршрута
     */
    static deleteByRouteId(routeId) {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM route_results WHERE route_id = ?',
                [routeId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }
}

module.exports = RouteResult;
