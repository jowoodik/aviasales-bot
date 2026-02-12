const db = require('../config/database');

class Trip {
    static create(chatId, tripData) {
        return new Promise((resolve, reject) => {
            const {
                name, departure_start, departure_end,
                threshold_price, currency
            } = tripData;

            db.run(`
                INSERT INTO trips (
                    chat_id, name, departure_start, departure_end,
                    threshold_price, currency
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, [
                chatId, name, departure_start, departure_end,
                threshold_price, currency || 'RUB'
            ], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    static findById(id) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM trips WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    static findNonArchivedByChatId(chatId) {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM trips WHERE chat_id = ? AND is_archived = 0 ORDER BY created_at DESC',
                [chatId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    static getActiveByChatId(chatId) {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM trips WHERE chat_id = ? AND is_paused = 0 AND is_archived = 0',
                [chatId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    static getAllActive() {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM trips WHERE is_paused = 0 AND is_archived = 0',
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    static updateThreshold(id, threshold) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE trips SET threshold_price = ? WHERE id = ?', [threshold, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    static updatePauseStatus(id, isPaused) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE trips SET is_paused = ? WHERE id = ?', [isPaused ? 1 : 0, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    static setAsArchived(id) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE trips SET is_archived = 1 WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    static updateLastCheck(id) {
        return new Promise((resolve, reject) => {
            db.run('UPDATE trips SET last_check = datetime("now") WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    static delete(id) {
        return new Promise((resolve, reject) => {
            // Удаляем связанные данные каскадно
            db.run('DELETE FROM trip_leg_results WHERE trip_result_id IN (SELECT id FROM trip_results WHERE trip_id = ?)', [id], () => {
                db.run('DELETE FROM trip_results WHERE trip_id = ?', [id], () => {
                    db.run('DELETE FROM trip_legs WHERE trip_id = ?', [id], () => {
                        db.run('DELETE FROM trips WHERE id = ?', [id], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                });
            });
        });
    }
}

module.exports = Trip;
