const db = require('../config/database');

class Route {
  static create(chatId, data) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO routes
         (chat_id, origin, destination, departure_date, return_date, adults, children,
          airline, baggage, max_stops, max_layover_hours, threshold_price, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chatId,
          data.origin,
          data.destination,
          data.departure_date,
          data.return_date,
          data.adults || 1,
          data.children || 0,
          data.airline,
          data.baggage || 0,
          data.max_stops || 99,
          data.max_layover_hours || 5,  // 🔥 НОВОЕ ПОЛЕ
          data.threshold_price,
          data.currency || 'RUB'
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  static findByUser(chatId) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM routes WHERE chat_id = ? ORDER BY created_at DESC',
        [chatId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // 🔥 ДОБАВЬТЕ ЭТОТ МЕТОД
  static findById(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM routes WHERE id = ?',
        [routeId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  static findActive() {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM routes
         WHERE is_paused = 0
           AND date(departure_date) >= date('now')
         ORDER BY departure_date ASC`,
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static delete(routeId, chatId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM routes WHERE id = ? AND chat_id = ?',
        [routeId, chatId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static togglePause(routeId, chatId, isPaused) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE routes SET is_paused = ? WHERE id = ? AND chat_id = ?',
        [isPaused, routeId, chatId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateThreshold(routeId, chatId, newPrice) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE routes SET threshold_price = ? WHERE id = ? AND chat_id = ?',
        [newPrice, routeId, chatId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static deleteExpired() {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM routes
         WHERE auto_delete = 1
           AND date(departure_date) < date('now')`,
        [],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

module.exports = Route;
