const db = require('../config/database');

class AirportService {
    constructor() {}

    /**
     * Регистронезависимый поиск аэропортов и городов
     */
    searchAirportsEnhanced(query, limit = 10) {
        return new Promise((resolve, reject) => {
            const searchTerm = query.trim().toLowerCase();
            const searchPattern = `%${searchTerm}%`;

            // Проверяем, не является ли запрос IATA кодом (3 буквы)
            const isIataCode = /^[a-z]{3}$/.test(searchTerm);

            let sql;
            let params;

            if (isIataCode) {
                // Если это IATA код, ищем точное совпадение в первую очередь
                const iataCode = searchTerm.toUpperCase();

                sql = `
                    SELECT
                        iata_code,
                        airport_name,
                        airport_name_en,
                        city_code,
                        city_name,
                        city_name_en,
                        country_name,
                        country_code,
                        timezone,
                        is_major,
                        is_popular,
                        is_international,
                        region,
                        airport_type
                    FROM airports
                    WHERE iata_code = ?

                    UNION

                    SELECT
                        iata_code,
                        airport_name,
                        airport_name_en,
                        city_code,
                        city_name,
                        city_name_en,
                        country_name,
                        country_code,
                        timezone,
                        is_major,
                        is_popular,
                        is_international,
                        region,
                        airport_type
                    FROM airports
                    WHERE
                        city_name_lower LIKE ?
                       OR airport_name_lower LIKE ?
                       OR country_name_lower LIKE ?

                    ORDER BY
                        -- Сначала города
                        CASE WHEN airport_type = 'city' THEN 0 ELSE 1 END,
                        is_popular DESC,
                        is_major DESC,
                        city_name
                        LIMIT ?
                `;

                params = [
                    iataCode,
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    limit
                ];

            } else {
                // Если это текст, ищем по полям в нижнем регистре
                sql = `
                    SELECT
                        iata_code,
                        airport_name,
                        airport_name_en,
                        city_code,
                        city_name,
                        city_name_en,
                        country_name,
                        country_code,
                        timezone,
                        is_major,
                        is_popular,
                        is_international,
                        region,
                        airport_type
                    FROM airports
                    WHERE
                        city_name_lower LIKE ?
                       OR airport_name_lower LIKE ?
                       OR country_name_lower LIKE ?
                       OR iata_code LIKE ?
                       OR city_code LIKE ?

                    ORDER BY
                        -- Приоритет для точных совпадений в начале строки
                        CASE
                            WHEN city_name_lower LIKE ? || '%' THEN 1
                            WHEN airport_name_lower LIKE ? || '%' THEN 2
                            WHEN country_name_lower LIKE ? || '%' THEN 3
                            ELSE 4
                            END,
                        -- Сначала города, потом аэропорты
                        CASE WHEN airport_type = 'city' THEN 0 ELSE 1 END,
                        is_popular DESC,
                        is_major DESC,
                        city_name
                        LIMIT ?
                `;

                params = [
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    `%${searchTerm.toUpperCase()}%`,
                    `%${searchTerm.toUpperCase()}%`,
                    searchTerm,
                    searchTerm,
                    searchTerm,
                    limit
                ];
            }

            console.log('Searching airports and cities (case-insensitive):', searchTerm);

            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Database error in searchAirportsEnhanced:', err);
                    reject(err);
                } else {
                    console.log(`Found ${rows.length} results for query: ${searchTerm}`);
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Получить популярные аэропорты и города
     */
    getPopularAirports(region = null, limit = 8) {
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT
                    iata_code,
                    airport_name,
                    city_name,
                    city_name_en,
                    country_name,
                    country_code,
                    is_popular,
                    display_order,
                    region,
                    is_international,
                    airport_type
                FROM airports
                WHERE is_popular = 1
            `;

            const params = [];

            if (region) {
                if (region === 'international') {
                    sql += ` AND is_international = 1`;
                } else if (region === 'russia') {
                    sql += ` AND country_code = 'RU'`;
                }
            }

            sql += ` ORDER BY 
        CASE WHEN airport_type = 'city' THEN 0 ELSE 1 END,
        display_order ASC, 
        city_name 
        LIMIT ?`;

            params.push(limit);

            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    /**
     * Получить аэропорт или город по IATA коду
     */
    getAirportByCode(iataCode) {
        return new Promise((resolve, reject) => {
            if (!iataCode || iataCode.length !== 3) {
                resolve(null);
                return;
            }

            const sql = `
                SELECT
                    iata_code,
                    icao_code,
                    airport_name,
                    airport_name_en,
                    city_code,
                    city_name,
                    city_name_en,
                    country_name,
                    country_code,
                    timezone,
                    latitude,
                    longitude,
                    altitude,
                    airport_type,
                    is_popular,
                    is_international,
                    region
                FROM airports
                WHERE iata_code = ?
            `;

            db.get(sql, [iataCode.toUpperCase()], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

module.exports = AirportService;
