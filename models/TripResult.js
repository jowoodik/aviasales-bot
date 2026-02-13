const db = require('../config/database');

class TripResult {
    static save(tripId, totalPrice, legResults) {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO trip_results (trip_id, total_price) VALUES (?, ?)',
                [tripId, totalPrice],
                function(err) {
                    if (err) return reject(err);

                    const tripResultId = this.lastID;

                    if (!legResults || legResults.length === 0) {
                        return resolve(tripResultId);
                    }

                    const stmt = db.prepare(
                        'INSERT INTO trip_leg_results (trip_result_id, leg_order, departure_date, price, airline, search_link, is_round_trip, covered_by_round_trip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    );

                    let completed = 0;
                    let hasError = false;

                    for (const leg of legResults) {
                        stmt.run(
                            [tripResultId, leg.legOrder, leg.departureDate, leg.price, leg.airline || null, leg.searchLink || null, leg.isRoundTrip ? 1 : 0, leg.coveredByRoundTrip || null],
                            (err2) => {
                                if (err2 && !hasError) {
                                    hasError = true;
                                    stmt.finalize();
                                    reject(err2);
                                    return;
                                }
                                completed++;
                                if (completed === legResults.length) {
                                    stmt.finalize();
                                    resolve(tripResultId);
                                }
                            }
                        );
                    }
                }
            );
        });
    }

    static getBestResult(tripId) {
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM trip_results WHERE trip_id = ? ORDER BY total_price ASC LIMIT 1',
                [tripId],
                (err, row) => {
                    if (err) return reject(err);
                    if (!row) return resolve(null);

                    db.all(
                        'SELECT * FROM trip_leg_results WHERE trip_result_id = ? ORDER BY leg_order',
                        [row.id],
                        (err2, legs) => {
                            if (err2) return reject(err2);
                            resolve({ ...row, legs: (legs || []).map(TripResult._mapLegRow) });
                        }
                    );
                }
            );
        });
    }

    static getTopResults(tripId, limit = 3) {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM trip_results WHERE trip_id = ? ORDER BY total_price ASC LIMIT ?',
                [tripId, limit],
                async (err, rows) => {
                    if (err) return reject(err);
                    if (!rows || rows.length === 0) return resolve([]);

                    const results = [];
                    for (const row of rows) {
                        const legs = await new Promise((res, rej) => {
                            db.all(
                                'SELECT * FROM trip_leg_results WHERE trip_result_id = ? ORDER BY leg_order',
                                [row.id],
                                (err2, legRows) => {
                                    if (err2) rej(err2);
                                    else res((legRows || []).map(TripResult._mapLegRow));
                                }
                            );
                        });
                        results.push({ ...row, legs });
                    }
                    resolve(results);
                }
            );
        });
    }

    static _mapLegRow(row) {
        return {
            ...row,
            isRoundTrip: !!row.is_round_trip,
            coveredByRoundTrip: row.covered_by_round_trip || null
        };
    }

    static cleanOldResults(tripId, keepCount = 10) {
        return new Promise((resolve, reject) => {
            db.run(`
                DELETE FROM trip_leg_results WHERE trip_result_id IN (
                    SELECT id FROM trip_results WHERE trip_id = ?
                    AND id NOT IN (
                        SELECT id FROM trip_results WHERE trip_id = ?
                        ORDER BY found_at DESC LIMIT ?
                    )
                )
            `, [tripId, tripId, keepCount], (err) => {
                if (err) return reject(err);
                db.run(`
                    DELETE FROM trip_results WHERE trip_id = ?
                    AND id NOT IN (
                        SELECT id FROM trip_results WHERE trip_id = ?
                        ORDER BY found_at DESC LIMIT ?
                    )
                `, [tripId, tripId, keepCount], (err2) => {
                    if (err2) reject(err2);
                    else resolve();
                });
            });
        });
    }
}

module.exports = TripResult;
