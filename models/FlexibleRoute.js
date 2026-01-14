const db = require('../config/database');

class FlexibleRoute {
  static create(data) {
    return new Promise((resolve, reject) => {
      const sql = `
          INSERT INTO flexible_routes
          (chat_id, origin, destination, departure_start, departure_end,
           min_days, max_days, airline, baggage, max_stops, adults, children, threshold_price, currency)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(sql, [
        data.chat_id, data.origin, data.destination,
        data.departure_start, data.departure_end,
        data.min_days, data.max_days,
        data.airline, data.baggage, data.max_stops,
        data.adults, data.children, data.threshold_price, data.currency
      ], function(err) {
        if (err) reject(err);
        else {
          db.run('UPDATE user_stats SET total_flexible = total_flexible + 1 WHERE chat_id = ?', [data.chat_id]);
          resolve(this.lastID);
        }
      });
    });
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

  static findByChatId(chatId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM flexible_routes WHERE chat_id = ?', [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static findActive() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM flexible_routes WHERE is_paused = 0', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static delete(id, chatId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM flexible_routes WHERE id = ? AND chat_id = ?', [id, chatId], function(err) {
        if (err) reject(err);
        else {
          db.run('UPDATE user_stats SET total_flexible = total_flexible - 1 WHERE chat_id = ?', [chatId]);
          resolve(this.changes);
        }
      });
    });
  }

  static updateThreshold(id, chatId, newThreshold) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE flexible_routes SET threshold_price = ? WHERE id = ? AND chat_id = ?',
        [newThreshold, id, chatId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static togglePause(id, chatId, isPaused) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE flexible_routes SET is_paused = ? WHERE id = ? AND chat_id = ?',
        [isPaused, id, chatId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static updateLastCheck(id) {
    return new Promise((resolve, reject) => {
      db.run(
        "UPDATE flexible_routes SET last_check = datetime('now') WHERE id = ?",
        [id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
}

module.exports = FlexibleRoute;
