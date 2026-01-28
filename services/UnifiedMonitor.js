const UnifiedRoute = require('../models/UnifiedRoute');
const RouteResult = require('../models/RouteResult');
const AviasalesPricer = require('./AviasalesPricer');
const AviasalesAPI = require('./AviasalesAPI');
const NotificationService = require('./NotificationService');

class UnifiedMonitor {
    constructor(token, bot) {
        this.token = token;
        this.bot = bot;

        // Используем ОРИГИНАЛЬНЫЙ AviasalesPricer
        this.pricer = new AviasalesPricer(
            false, // debug = false
            process.env.AVIASALES_MARKER || '696196'
        );

        this.api = new AviasalesAPI(token, process.env.AVIASALES_MARKER || '696196');
        this.notificationService = new NotificationService(bot);
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
     * Проверка одного маршрута
     */
    async checkSingleRoute(route) {
        // Генерируем комбинации для проверки
        const combinations = UnifiedRoute.getCombinations(route);
        console.log(`📋 Комбинаций для проверки: ${combinations.length}`);

        if (combinations.length === 0) {
            console.log(`⚠️ Нет комбинаций для маршрута #${route.id}`);
            return [];
        }

        // Формируем URLs для проверки через ОРИГИНАЛЬНЫЙ метод AviasalesAPI
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

        // Проверяем цены через ОРИГИНАЛЬНЫЙ метод AviasalesPricer.getPricesFromUrls()
        const response = await this.pricer.getPricesFromUrls(
            urls,
            route.airline || null,
            route.max_layover_hours || null,
            route.baggage === 1,
            route.max_stops !== null ? route.max_stops : null
        );

        console.log(`✅ Получен ответ от Aviasales`);

        // Обрабатываем результаты
        const results = [];
        let savedCount = 0;

        for (let i = 0; i < response.results.length; i++) {
            const priceResult = response.results[i];
            const combination = combinations[i];

            if (priceResult && priceResult.price && priceResult.price > 0) {
                // Сохраняем результат
                await RouteResult.save(route.id, {
                    departure_date: combination.departure_date,
                    return_date: combination.return_date,
                    days_in_country: combination.days_in_country || null,
                    total_price: priceResult.price,
                    airline: route.airline || 'ANY',
                    search_link: urls[i],
                    screenshot_path: null
                });

                savedCount++;
                results.push({
                    ...priceResult,
                    combination: combination
                });

                // Если цена ниже порога - отправляем уведомление
                if (priceResult.price <= route.threshold_price) {
                    console.log(`🔥 Найдена цена ниже порога: ${priceResult.price} ₽`);

                    await this.notificationService.sendPriceAlert(
                        route.chat_id,
                        route,
                        {
                            price: priceResult.price,
                            currency: priceResult.currency || 'RUB',
                            airline: route.airline || 'ANY',
                            link: urls[i]
                        },
                        combination
                    );
                }

                // Сохраняем в price_analytics для графиков и тепловой карты
                await this.saveToPriceAnalytics(route, priceResult.price, combination);
            }
        }

        // Обновляем время последней проверки
        await UnifiedRoute.updateLastCheck(route.id);

        // Очищаем старые результаты (оставляем последние 10)
        await RouteResult.cleanOldResults(route.id, 10);

        console.log(`✅ Маршрут #${route.id} проверен. Найдено результатов: ${savedCount}`);

        return results;
    }

    /**
     * Сохранение в price_analytics (для графиков ChartGenerator)
     */
    async saveToPriceAnalytics(route, price, combination) {
        return new Promise((resolve, reject) => {
            const db = require('../config/database');
            const now = new Date();

            // Конвертируем в Екатеринбургское время
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

    /**
     * Проверка конкретного маршрута (для команды /check_ID)
     */
    async checkRoute(routeId) {
        try {
            const route = await UnifiedRoute.findById(routeId);
            if (!route) {
                throw new Error('Маршрут не найден');
            }

            return await this.checkSingleRoute(route);

        } catch (error) {
            console.error('Ошибка проверки маршрута:', error);
            throw error;
        }
    }

    /**
     * Отчет для админа
     */
    async sendReport(chatId) {
        try {
            const routes = await UnifiedRoute.findByChatId(chatId);

            let report = '📊 *ОТЧЕТ О ПРОВЕРКЕ*\n\n';

            for (const route of routes) {
                const bestPrice = await RouteResult.getBestPrice(route.id);

                report += `✈️ ${route.origin} → ${route.destination}\n`;

                if (bestPrice) {
                    report += `💰 Лучшая цена: ${bestPrice.toLocaleString('ru-RU')} ₽\n`;
                    report += `📊 Порог: ${route.threshold_price.toLocaleString('ru-RU')} ₽\n`;

                    if (bestPrice <= route.threshold_price) {
                        report += `🔥 Найдена цена ниже порога!\n`;
                    }
                } else {
                    report += `❌ Цены не найдены\n`;
                }

                report += '\n';
            }

            await this.bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Ошибка отправки отчета:', error);
        }
    }
}

module.exports = UnifiedMonitor;
