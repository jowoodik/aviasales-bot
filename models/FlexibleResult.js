const db = require('../config/database');

class FlexibleResult {
  static async saveResults(routeId, results) {
    // Удаляем старые результаты
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM flexible_results WHERE route_id = ?', [routeId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Сохраняем новые
    for (const result of results) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO flexible_results 
           (route_id, departure_date, return_date, days_in_country, total_price, airline, search_link, screenshot_path) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            routeId,
            result.departure_date,
            result.return_date,
            result.days_in_country,
            result.total_price,
            result.airline,
            result.search_link,
            result.screenshot_path || null
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }
  }

  static getTopResults(routeId, limit = 5) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM flexible_results
         WHERE route_id = ?
         ORDER BY total_price ASC
             LIMIT ?`,
        [routeId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static getBestPrice(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT MIN(total_price) as price FROM flexible_results WHERE route_id = ?',
        [routeId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.price || null);
        }
      );
    });
  }
}

module.exports = FlexibleResult;
