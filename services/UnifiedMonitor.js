const UnifiedRoute = require('../models/UnifiedRoute');
const RouteResult = require('../models/RouteResult');
const AviasalesPricer = require('./AviasalesPricer');
const AviasalesAPI = require('./AviasalesAPI');
const db = require('../config/database');

class UnifiedMonitor {
    constructor(token, bot) {
        this.token = token;
        this.bot = bot;
        this.pricer = new AviasalesPricer(
            false,
            process.env.AVIASALES_MARKER || '696196'
        );
        this.api = new AviasalesAPI(token, process.env.AVIASALES_MARKER || '696196');
    }

    /**
     * Проверка всех активных маршрутов
     */
    async checkAllRoutes() {
        try {
            console.log('🔍 Начало проверки всех маршрутов...');
            const routes = await UnifiedRoute.getAllActive();
            console.log(`📊 Найдено ${routes.length} активных маршрутов`);

            for (const route of routes) {
                try {
                    console.log(`\n✈️ Проверка маршрута #${route.id}: ${route.origin} → ${route.destination}`);
                    await this.checkSingleRoute(route);
                } catch (error) {
                    console.error(`❌ Ошибка проверки маршрута #${route.id}:`, error.message);
                }
            }

            console.log(`\n📊 Проверка завершена`);
        } catch (error) {
            console.error('❌ Критическая ошибка мониторинга:', error);
        }
    }

    /**
     * Подготовка маршрута для batch-проверки (БЕЗ проверки цен).
     * Генерирует URLs и метаданные для всех комбинаций маршрута.
     *
     * @param {Object} route - Объект маршрута
     * @returns {Array} - Массив объектов {url, combination, airline, baggage, max_stops, max_layover_hours}
     */
    prepareBatchItem(route) {
        // Генерируем комбинации для проверки
        const combinations = UnifiedRoute.getCombinations(route);

        if (combinations.length === 0) {
            return [];
        }

        // Формируем массив объектов с URL и метаданными
        const items = combinations.map(combo => {
            const url = this.api.generateSearchLink({
                origin: route.origin,
                destination: route.destination,
                departure_date: combo.departure_date,
                return_date: combo.return_date,
                adults: route.adults || 1,
                children: route.children || 0,
                airline: route.airline
            });

            return {
                url: url,
                combination: combo,
                // Фильтры маршрута (для индивидуальной проверки)
                airline: route.airline || null,
                baggage: route.baggage === 1,
                max_stops: route.max_stops !== null ? route.max_stops : null,
                max_layover_hours: route.max_layover_hours || null
            };
        });

        return items;
    }

    /**
     * Обработка результатов batch-проверки для одного маршрута.
     * Сохраняет результаты в БД, обновляет статистику и аналитику.
     *
     * @param {number} routeId - ID маршрута
     * @param {Object} route - Объект маршрута
     * @param {Array} batchResults - Массив результатов [{combination, priceResult, url}, ...]
     * @returns {Array} - Массив успешных результатов
     */
    async processBatchResults(routeId, route, batchResults) {
        const checkTimestamp = new Date().toISOString();
        const results = [];
        let successfulChecks = 0;
        let failedChecks = 0;
        const combinationResults = [];

        console.log(`📋 Обработка ${batchResults.length} результатов для маршрута #${routeId}`);

        for (const item of batchResults) {
            const { combination, priceResult, url } = item;

            // Используем enhancedSearchLink если доступен
            const searchLink = priceResult?.enhancedSearchLink || url;

            let status, errorReason = null;

            if (priceResult && priceResult.price && priceResult.price > 0) {
                // Успешная проверка
                status = 'success';
                successfulChecks++;

                // Сохраняем результат в БД
                await RouteResult.save(routeId, {
                    departure_date: combination.departure_date,
                    return_date: combination.return_date,
                    days_in_country: combination.days_in_country || null,
                    total_price: priceResult.price,
                    airline: route.airline || 'ANY',
                    search_link: searchLink,
                    screenshot_path: null
                });

                results.push({
                    ...priceResult,
                    combination: combination
                });

                // Сохраняем в price_analytics
                await this.saveToPriceAnalytics(route, priceResult.price, combination);

            } else if (priceResult === null) {
                // Билеты не найдены
                status = 'not_found';
                errorReason = 'Билеты не найдены по заданным параметрам';
                failedChecks++;
            } else {
                // Другая ошибка
                status = 'error';
                errorReason = priceResult.error || 'Неизвестная ошибка при проверке';
                failedChecks++;
            }

            // Сохраняем детальную информацию о проверке комбинации
            combinationResults.push({
                route_id: routeId,
                check_timestamp: checkTimestamp,
                departure_date: combination.departure_date,
                return_date: combination.return_date,
                days_in_country: combination.days_in_country,
                status: status,
                price: priceResult?.price || null,
                currency: priceResult?.currency || 'RUB',
                error_reason: errorReason,
                search_url: searchLink
            });
        }

        // Сохраняем общую статистику проверки
        await this.saveCheckStats(routeId, {
            check_timestamp: checkTimestamp,
            total_combinations: batchResults.length,
            successful_checks: successfulChecks,
            failed_checks: failedChecks
        });

        // Сохраняем детальные результаты всех комбинаций
        await this.saveCombinationResults(combinationResults);

        // Обновляем время последней проверки
        await UnifiedRoute.updateLastCheck(routeId);

        // Очищаем старые результаты (оставляем последние 10)
        await RouteResult.cleanOldResults(routeId, 10);

        console.log(`✅ Маршрут #${routeId} обработан. Найдено результатов: ${successfulChecks}/${batchResults.length}`);

        return results;
    }

    /**
     * Проверка одного маршрута
     */
    async checkSingleRoute(route) {
        const checkTimestamp = new Date().toISOString();

        // Генерируем комбинации для проверки
        const combinations = UnifiedRoute.getCombinations(route);
        console.log(`📋 Комбинаций для проверки: ${combinations.length}`);

        if (combinations.length === 0) {
            console.log(`⚠️ Нет комбинаций для маршрута #${route.id}`);
            return [];
        }

        // Формируем URLs для проверки
        const urls = combinations.map(combo => {
            return this.api.generateSearchLink({
                origin: route.origin,
                destination: route.destination,
                departure_date: combo.departure_date,
                return_date: combo.return_date,
                adults: route.adults || 1,
                children: route.children || 0,
                airline: route.airline
            });
        });

        console.log(`🔗 Сформировано ${urls.length} URL для проверки`);

        // Проверяем цены
        const response = await this.pricer.getPricesFromUrls(
            urls,
            route.airline || null,
            route.max_layover_hours || null,
            route.baggage === 1,
            route.max_stops !== null ? route.max_stops : null
        );

        console.log(`✅ Получен ответ от Aviasales`);

        // 🔥 АНАЛИЗИРУЕМ РЕЗУЛЬТАТЫ
        const results = [];
        let successfulChecks = 0;
        let failedChecks = 0;
        const combinationResults = [];

        for (let i = 0; i < response.results.length; i++) {
            const priceResult = response.results[i];
            const combination = combinations[i];

            // 🔥 ИЗМЕНЕНО: используем enhancedSearchLink вместо простого URL
            const searchLink = priceResult?.enhancedSearchLink || urls[i];

            let status, errorReason = null;

            if (priceResult && priceResult.price && priceResult.price > 0) {
                // Успешная проверка
                status = 'success';
                successfulChecks++;

                // 🔥 ИЗМЕНЕНО: сохраняем enhancedSearchLink в search_link
                await RouteResult.save(route.id, {
                    departure_date: combination.departure_date,
                    return_date: combination.return_date,
                    days_in_country: combination.days_in_country || null,
                    total_price: priceResult.price,
                    airline: route.airline || 'ANY',
                    search_link: searchLink, // 🔥 ИСПОЛЬЗУЕМ РАСШИРЕННУЮ ССЫЛКУ
                    screenshot_path: null
                });

                results.push({
                    ...priceResult,
                    combination: combination
                });

                // Уведомления теперь маршрутизируются через scheduler → NotificationService.processAndRouteNotification

                // Сохраняем в price_analytics
                await this.saveToPriceAnalytics(route, priceResult.price, combination);

            } else if (priceResult === null) {
                // Билеты не найдены
                status = 'not_found';
                errorReason = 'Билеты не найдены по заданным параметрам';
                failedChecks++;
            } else {
                // Другая ошибка
                status = 'error';
                errorReason = priceResult.error || 'Неизвестная ошибка при проверке';
                failedChecks++;
            }

            // Сохраняем детальную информацию о проверке комбинации
            combinationResults.push({
                route_id: route.id,
                check_timestamp: checkTimestamp,
                departure_date: combination.departure_date,
                return_date: combination.return_date,
                days_in_country: combination.days_in_country,
                status: status,
                price: priceResult?.price || null,
                currency: priceResult?.currency || 'RUB',
                error_reason: errorReason,
                search_url: searchLink // 🔥 СОХРАНЯЕМ РАСШИРЕННУЮ ССЫЛКУ
            });
        }

        // Сохраняем общую статистику проверки
        await this.saveCheckStats(route.id, {
            check_timestamp: checkTimestamp,
            total_combinations: combinations.length,
            successful_checks: successfulChecks,
            failed_checks: failedChecks
        });

        // Сохраняем детальные результаты всех комбинаций
        await this.saveCombinationResults(combinationResults);

        // Обновляем время последней проверки
        await UnifiedRoute.updateLastCheck(route.id);

        // Очищаем старые результаты (оставляем последние 10)
        await RouteResult.cleanOldResults(route.id, 10);

        console.log(`✅ Маршрут #${route.id} проверен. Найдено результатов: ${successfulChecks}/${combinations.length}`);

        return results;
    }

    /**
     * Сохранение общей статистики проверки
     */
    async saveCheckStats(routeId, stats) {
        return new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO route_check_stats
                (route_id, check_timestamp, total_combinations, successful_checks, failed_checks)
                VALUES (?, ?, ?, ?, ?)
            `, [
                routeId,
                stats.check_timestamp,
                stats.total_combinations,
                stats.successful_checks,
                stats.failed_checks
            ], (err) => {
                if (err) {
                    console.error('❌ Ошибка сохранения статистики проверки:', err);
                    reject(err);
                } else {
                    console.log(`📊 Статистика проверки сохранена: ${stats.successful_checks}/${stats.total_combinations} успешно`);
                    resolve();
                }
            });
        });
    }

    /**
     * Сохранение детальных результатов комбинаций
     */
    async saveCombinationResults(combinationResults) {
        return new Promise((resolve, reject) => {
            if (combinationResults.length === 0) {
                resolve();
                return;
            }

            const placeholders = combinationResults.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
            const values = [];

            combinationResults.forEach(result => {
                values.push(
                    result.route_id,
                    result.check_timestamp,
                    result.departure_date,
                    result.return_date,
                    result.days_in_country,
                    result.status,
                    result.price,
                    result.currency,
                    result.error_reason,
                    result.search_url
                );
            });

            db.run(`
                INSERT INTO combination_check_results
                (route_id, check_timestamp, departure_date, return_date, days_in_country,
                 status, price, currency, error_reason, search_url)
                VALUES ${placeholders}
            `, values, (err) => {
                if (err) {
                    console.error('❌ Ошибка сохранения результатов комбинаций:', err);
                    reject(err);
                } else {
                    console.log(`💾 Сохранено ${combinationResults.length} результатов комбинаций`);
                    resolve();
                }
            });
        });
    }

    /**
     * Сохранение в price_analytics (для графиков ChartGenerator)
     */
    async saveToPriceAnalytics(route, price, combination) {
        return new Promise((resolve, reject) => {
            const now = new Date();
            const ekbDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));

            db.run(`
                INSERT INTO price_analytics
                (route_type, origin, destination, price, airline, found_at,
                 hour_of_day, day_of_week, day_of_month, month, year,
                 is_weekend, season, chat_id, route_id)
                VALUES (?, ?, ?, ?, ?, datetime('now'),
                        ?, ?, ?, ?, ?,
                        ?, ?, ?, ?)
            `, [
                route.is_flexible ? 'flexible' : 'regular',
                route.origin,
                route.destination,
                price,
                route.airline || 'ANY',
                ekbDate.getHours(),
                ekbDate.getDay(),
                ekbDate.getDate(),
                ekbDate.getMonth() + 1,
                ekbDate.getFullYear(),
                [0, 6].includes(ekbDate.getDay()) ? 1 : 0,
                this.getSeason(ekbDate.getMonth() + 1),
                route.chat_id,
                route.id
            ], (err) => {
                if (err) {
                    console.error('Ошибка сохранения в price_analytics:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Определение сезона
     */
    getSeason(month) {
        if (month >= 3 && month <= 5) return 'spring';
        if (month >= 6 && month <= 8) return 'summer';
        if (month >= 9 && month <= 11) return 'autumn';
        return 'winter';
    }
}

module.exports = UnifiedMonitor;