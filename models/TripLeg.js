const db = require('../config/database');

class TripLeg {
    static createMany(tripId, legs) {
        return new Promise((resolve, reject) => {
            const stmt = db.prepare(
                `INSERT INTO trip_legs (trip_id, leg_order, origin, destination, min_days, max_days,
                    adults, children, airline, baggage, max_stops, max_layover_hours)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );

            let completed = 0;
            let hasError = false;

            for (const leg of legs) {
                stmt.run(
                    [
                        tripId, leg.leg_order, leg.origin, leg.destination,
                        leg.min_days || null, leg.max_days || null,
                        leg.adults || 1, leg.children || 0,
                        leg.airline || null, leg.baggage ? 1 : 0,
                        leg.max_stops != null ? leg.max_stops : null,
                        leg.max_layover_hours || null
                    ],
                    (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            stmt.finalize();
                            reject(err);
                            return;
                        }
                        completed++;
                        if (completed === legs.length) {
                            stmt.finalize();
                            resolve();
                        }
                    }
                );
            }
        });
    }

    static getByTripId(tripId) {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM trip_legs WHERE trip_id = ? ORDER BY leg_order',
                [tripId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
}

module.exports = TripLeg;
