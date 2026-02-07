const db = require('../config/database');

class AirportService {
    constructor() {}

    /**
     * Регистронезависимый поиск аэропортов и городов
     */
    /**
     * Регистронезависимый поиск аэропортов и городов
     */
    searchAirportsEnhanced(query, limit = 10) {
        return new Promise((resolve, reject) => {
            const searchTerm = query.trim().toLowerCase();
            const searchPattern = `%${searchTerm.replace(/\s+/g, '%')}%`;

            // 🔥 ИСПРАВЛЕНИЕ: Проверяем на IATA код более точно
            // IATA код всегда состоит из 3 букв (A-Z) и должен существовать в базе
            const isPotentialIataCode = /^[a-z]{3}$/.test(searchTerm);

            let sql;
            let params;

            if (isPotentialIataCode) {
                // Если это 3 буквы - это МОЖЕТ быть IATA код
                // Ищем точное совпадение и текстовый поиск
                const iataCode = searchTerm.toUpperCase();

                sql = `
                    SELECT * FROM (
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
                                          airport_type,
                                          CASE
                                              WHEN iata_code = ? THEN 1  -- Точный IATA код
                                              WHEN LOWER(iata_code) = ? THEN 2  -- IATA код в нижнем регистре
                                              ELSE 3
                                              END as exact_match,
                                          CASE WHEN airport_type = 'city' THEN 0 ELSE 1 END as type_priority,
                                          is_popular as popular_score
                                      FROM airports
                                      WHERE iata_code = ?
                                         OR city_name_lower LIKE ?
                                         OR airport_name_lower LIKE ?
                                         OR LOWER(city_name_en) LIKE ?
                                         OR LOWER(airport_name_en) LIKE ?
                                         OR city_code LIKE ?
                                  )
                    ORDER BY
                        exact_match,  -- Сначала точные IATA коды
                        type_priority,  -- Затем города
                        popular_score DESC,
                        is_major DESC,
                        city_name
                        LIMIT ?
                `;

                params = [
                    iataCode,
                    searchTerm,
                    iataCode,
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    `%${iataCode}%`,
                    limit
                ];

            } else {
                // Если это не 3 буквы или это текст - ищем как текст
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
                        airport_type,
                        CASE
                            -- Приоритет для точных совпадений в начале
                            WHEN city_name_lower LIKE ? || '%' THEN 1
                            WHEN airport_name_lower LIKE ? || '%' THEN 2
                            WHEN LOWER(city_name_en) LIKE ? || '%' THEN 3
                            WHEN LOWER(airport_name_en) LIKE ? || '%' THEN 4
                            WHEN country_name_lower LIKE ? || '%' THEN 5
                            ELSE 6
                            END as match_priority,
                        CASE WHEN airport_type = 'city' THEN 0 ELSE 1 END as type_priority
                    FROM airports
                    WHERE
                        city_name_lower LIKE ?
                       OR airport_name_lower LIKE ?
                       OR country_name_lower LIKE ?
                       OR LOWER(city_name_en) LIKE ?
                       OR LOWER(airport_name_en) LIKE ?
                       OR iata_code LIKE ?
                       OR city_code LIKE ?
                    ORDER BY
                        match_priority,
                        type_priority,
                        is_popular DESC,
                        is_major DESC,
                        city_name
                        LIMIT ?
                `;

                params = [
                    searchTerm,
                    searchTerm,
                    searchTerm,
                    searchTerm,
                    searchTerm,
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    searchPattern,
                    `%${searchTerm.toUpperCase()}%`,
                    `%${searchTerm.toUpperCase()}%`,
                    limit
                ];
            }

            console.log('Searching airports and cities (case-insensitive):', searchTerm);
            console.log('SQL query:', sql.substring(0, 200) + '...');

            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Database error in searchAirportsEnhanced:', err);
                    console.error('SQL:', sql);
                    console.error('Params:', params);
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
     * Получить популярные аэропорты отправления на основе статистики
     * @param {number} chatId - ID пользователя
     * @param {number} limit - количество результатов (по умолчанию 6)
     * @returns {Promise<Array>}
     */
    getPopularOriginAirports(chatId, limit = 6) {
        return new Promise((resolve, reject) => {
            const sql = `
                WITH user_airports AS (
                    -- Аэропорты текущего пользователя
                    SELECT DISTINCT
                        ur.origin as iata_code,
                        a.airport_name,
                        a.city_name,
                        a.city_name_en,
                        a.country_name,
                        a.country_code,
                        a.is_international,
                        a.airport_type,
                        a.region,
                        1 as is_user_airport,
                        999999 as route_count -- высокий приоритет для сортировки
                    FROM unified_routes ur
                             LEFT JOIN airports a ON ur.origin = a.iata_code
                    WHERE ur.chat_id = ? AND ur.is_paused = 0
                ),
                     global_airports AS (
                         -- Популярные аэропорты всех пользователей
                         SELECT
                             ur.origin as iata_code,
                             a.airport_name,
                             a.city_name,
                             a.city_name_en,
                             a.country_name,
                             a.country_code,
                             a.is_international,
                             a.airport_type,
                             a.region,
                             0 as is_user_airport,
                             COUNT(*) as route_count
                         FROM unified_routes ur
                                  LEFT JOIN airports a ON ur.origin = a.iata_code
                         WHERE ur.is_paused = 0
                         GROUP BY ur.origin
                     )
                SELECT DISTINCT
                    iata_code,
                    airport_name,
                    city_name,
                    city_name_en,
                    country_name,
                    country_code,
                    is_international,
                    airport_type,
                    region,
                    MAX(is_user_airport) as is_user_airport,
                    MAX(route_count) as route_count
                FROM (
                         SELECT * FROM user_airports
                         UNION ALL
                         SELECT * FROM global_airports
                     )
                GROUP BY iata_code
                ORDER BY is_user_airport DESC, route_count DESC, city_name ASC
                    LIMIT ?
            `;

            db.all(sql, [chatId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    /**
     * Получить популярные аэропорты назначения на основе статистики
     * @param {number} chatId - ID пользователя
     * @param {number} limit - количество результатов (по умолчанию 6)
     * @returns {Promise<Array>}
     */
    getPopularDestinationAirports(chatId, limit = 6) {
        return new Promise((resolve, reject) => {
            const sql = `
                WITH user_airports AS (
                    -- Аэропорты текущего пользователя
                    SELECT DISTINCT
                        ur.destination as iata_code,
                        a.airport_name,
                        a.city_name,
                        a.city_name_en,
                        a.country_name,
                        a.country_code,
                        a.is_international,
                        a.airport_type,
                        a.region,
                        1 as is_user_airport,
                        999999 as route_count -- высокий приоритет для сортировки
                    FROM unified_routes ur
                             LEFT JOIN airports a ON ur.destination = a.iata_code
                    WHERE ur.chat_id = ? AND ur.is_paused = 0
                ),
                     global_airports AS (
                         -- Популярные аэропорты всех пользователей
                         SELECT
                             ur.destination as iata_code,
                             a.airport_name,
                             a.city_name,
                             a.city_name_en,
                             a.country_name,
                             a.country_code,
                             a.is_international,
                             a.airport_type,
                             a.region,
                             0 as is_user_airport,
                             COUNT(*) as route_count
                         FROM unified_routes ur
                                  LEFT JOIN airports a ON ur.destination = a.iata_code
                         WHERE ur.is_paused = 0
                         GROUP BY ur.destination
                     )
                SELECT DISTINCT
                    iata_code,
                    airport_name,
                    city_name,
                    city_name_en,
                    country_name,
                    country_code,
                    is_international,
                    airport_type,
                    region,
                    MAX(is_user_airport) as is_user_airport,
                    MAX(route_count) as route_count
                FROM (
                         SELECT * FROM user_airports
                         UNION ALL
                         SELECT * FROM global_airports
                     )
                GROUP BY iata_code
                ORDER BY is_user_airport DESC, route_count DESC, city_name ASC
                    LIMIT ?
            `;

            db.all(sql, [chatId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
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