const db = require('../config/database');

class BestPrice {
  static findByRouteId(routeId, limit = 3) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM best_prices 
         WHERE route_id = ? 
         ORDER BY price ASC 
         LIMIT ?`,
        [routeId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static findBestForRoute(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM best_prices 
         WHERE route_id = ? 
         ORDER BY price ASC 
         LIMIT 1`,
        [routeId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  static create(routeId, price, airline, searchLink) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO best_prices (route_id, price, airline, search_link) 
         VALUES (?, ?, ?, ?)`,
        [routeId, price, airline, searchLink],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  static deleteAllForRoute(routeId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM best_prices WHERE route_id = ?',
        [routeId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

module.exports = BestPrice;
