const db = require('../config/database');

class FlexibleRoute {
  static create(chatId, data) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO flexible_routes
         (chat_id, origin, destination, departure_start, departure_end,
          min_days, max_days, adults, children, airline, baggage, max_stops,
          max_layover_hours, threshold_price, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chatId,
          data.origin,
          data.destination,
          data.departure_start,
          data.departure_end,
          data.min_days,
          data.max_days,
          data.adults || 1,
          data.children || 0,
          data.airline,
          data.baggage || 0,
          data.max_stops || null,
          data.max_layover_hours || null,
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

  // 🔥 ДОБАВЛЕН МЕТОД findByChatId
  static findByChatId(chatId) {
    return this.findByUser(chatId);
  }

  static findByUser(chatId) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM flexible_routes WHERE chat_id = ? ORDER BY created_at DESC',
        [chatId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  static findById(routeId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM flexible_routes WHERE id = ?',
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
        `SELECT * FROM flexible_routes
         WHERE is_paused = 0
           AND date(departure_end) >= date('now')
         ORDER BY departure_start ASC`,
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
        'DELETE FROM flexible_routes WHERE id = ? AND chat_id = ?',
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
        'UPDATE flexible_routes SET is_paused = ? WHERE id = ? AND chat_id = ?',
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
        'UPDATE flexible_routes SET threshold_price = ? WHERE id = ? AND chat_id = ?',
        [newPrice, routeId, chatId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  // 🔥 ДОБАВЛЕН МЕТОД updateLastCheck
  static updateLastCheck(routeId) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE flexible_routes 
                SET last_check = CURRENT_TIMESTAMP 
                WHERE id = ?`,
        [routeId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }
}

module.exports = FlexibleRoute;
