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
