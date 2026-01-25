const express = require('express');
const path = require('path');
const db = require('../config/database');
const Route = require('../models/Route');
const FlexibleRoute = require('../models/FlexibleRoute');
const FlexibleResult = require('../models/FlexibleResult');
const PriceAnalytics = require('../services/PriceAnalytics');

const app = express();
const PORT = process.env.WEB_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware для проверки chat_id
function requireAuth(req, res, next) {
    const chatId = req.query.chat_id || req.body.chat_id;
    if (!chatId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    req.chatId = parseInt(chatId);
    next();
}

// Получить лучшие цены для маршрутов
async function getBestPricesForRoutes(routes) {
    const promises = routes.map(async (route) => {
        return new Promise((resolve) => {
            db.get(
                `SELECT price, airline, found_at
                 FROM best_prices
                 WHERE route_id = ?
                 ORDER BY price ASC
                     LIMIT 1`,
                [route.id],
                (err, bestPrice) => {
                    if (err) {
                        resolve({ ...route, bestPrice: null, lastCheck: null });
                    } else {
                        db.get(
                            `SELECT price, found_at
                             FROM best_prices
                             WHERE route_id = ?
                             ORDER BY found_at DESC
                                 LIMIT 1`,
                            [route.id],
                            (err2, lastCheck) => {
                                resolve({
                                    ...route,
                                    bestPrice: bestPrice || null,
                                    lastCheck: lastCheck || null,
                                    savings: bestPrice ? Math.max(0, route.threshold_price - bestPrice.price) : 0
                                });
                            }
                        );
                    }
                }
            );
        });
    });
    return Promise.all(promises);
}

// Получить лучшие цены для гибких маршрутов
async function getBestPricesForFlexRoutes(routes) {
    const promises = routes.map(async (route) => {
        return new Promise((resolve) => {
            db.get(
                `SELECT total_price, airline, departure_date, return_date, found_at
                 FROM flexible_results
                 WHERE route_id = ?
                 ORDER BY total_price ASC
                     LIMIT 1`,
                [route.id],
                (err, bestPrice) => {
                    if (err) {
                        resolve({ ...route, bestPrice: null, lastCheck: null });
                    } else {
                        db.get(
                            `SELECT total_price, found_at
                             FROM flexible_results
                             WHERE route_id = ?
                             ORDER BY found_at DESC
                                 LIMIT 1`,
                            [route.id],
                            (err2, lastCheck) => {
                                resolve({
                                    ...route,
                                    bestPrice: bestPrice || null,
                                    lastCheck: lastCheck || null,
                                    savings: bestPrice ? Math.max(0, route.threshold_price - bestPrice.total_price) : 0
                                });
                            }
                        );
                    }
                }
            );
        });
    });
    return Promise.all(promises);
}

// Главная страница
app.get('/', (req, res) => {
    res.render('index');
});

// Dashboard пользователя
app.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const routes = await Route.findByUser(req.chatId);
        const flexRoutes = await FlexibleRoute.findByUser(req.chatId);
        const stats = await PriceAnalytics.getUserStats(req.chatId);

        const routesWithPrices = await getBestPricesForRoutes(routes || []);
        const flexRoutesWithPrices = await getBestPricesForFlexRoutes(flexRoutes || []);

        const activeRoutes = (routes || []).filter(r => !r.is_paused).length;
        const activeFlexRoutes = (flexRoutes || []).filter(r => !r.is_paused).length;
        const totalSavings = routesWithPrices.reduce((sum, r) => sum + (r.savings || 0), 0) +
            flexRoutesWithPrices.reduce((sum, r) => sum + (r.savings || 0), 0);

        let lastCheckTime = null;
        const allLastChecks = [
            ...routesWithPrices.filter(r => r.lastCheck).map(r => new Date(r.lastCheck.found_at)),
            ...flexRoutesWithPrices.filter(r => r.lastCheck).map(r => new Date(r.lastCheck.found_at))
        ];
        if (allLastChecks.length > 0) {
            lastCheckTime = new Date(Math.max(...allLastChecks));
        }

        res.render('dashboard', {
            chatId: req.chatId,
            routes: routesWithPrices,
            flexRoutes: flexRoutesWithPrices,
            stats: {
                ...stats,
                activeRoutes,
                activeFlexRoutes,
                totalSavings,
                lastCheckTime
            }
        });
    } catch (error) {
        console.error('Ошибка dashboard:', error);
        res.status(500).send('Ошибка загрузки данных: ' + error.message);
    }
});

// API: получить все маршруты
app.get('/api/routes', requireAuth, async (req, res) => {
    try {
        const routes = await Route.findByUser(req.chatId);
        res.json(routes || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: получить гибкие маршруты
app.get('/api/flexible-routes', requireAuth, async (req, res) => {
    try {
        const routes = await FlexibleRoute.findByUser(req.chatId);
        res.json(routes || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: удалить маршрут
app.delete('/api/routes/:id', requireAuth, async (req, res) => {
    try {
        await Route.delete(req.params.id, req.chatId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: удалить гибкий маршрут
app.delete('/api/flexible-routes/:id', requireAuth, async (req, res) => {
    try {
        await FlexibleRoute.delete(req.params.id, req.chatId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: приостановить/возобновить маршрут
app.patch('/api/routes/:id/pause', requireAuth, async (req, res) => {
    try {
        const isPaused = req.body.is_paused ? 1 : 0;
        await Route.togglePause(req.params.id, req.chatId, isPaused);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: приостановить/возобновить гибкий маршрут
app.patch('/api/flexible-routes/:id/pause', requireAuth, async (req, res) => {
    try {
        const isPaused = req.body.is_paused ? 1 : 0;
        await FlexibleRoute.togglePause(req.params.id, req.chatId, isPaused);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: обновить порог цены
app.patch('/api/routes/:id/threshold', requireAuth, async (req, res) => {
    try {
        await Route.updateThreshold(req.params.id, req.chatId, req.body.threshold_price);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: обновить порог цены гибкого маршрута
app.patch('/api/flexible-routes/:id/threshold', requireAuth, async (req, res) => {
    try {
        await FlexibleRoute.updateThreshold(req.params.id, req.chatId, req.body.threshold_price);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: получить аналитику для графиков (обычный маршрут)
app.get('/api/routes/:id/analytics', requireAuth, async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);

        console.log(`[Analytics] Запрос аналитики для маршрута ${routeId}, пользователь ${req.chatId}`);

        // Проверяем принадлежность маршрута пользователю
        const routeCheck = await new Promise((resolve, reject) => {
            db.get(
                'SELECT chat_id FROM routes WHERE id = ?',
                [routeId],
                (err, row) => {
                    if (err) {
                        console.error('[Analytics] Ошибка проверки маршрута:', err);
                        reject(err);
                    } else {
                        console.log('[Analytics] Маршрут найден:', row);
                        resolve(row);
                    }
                }
            );
        });

        if (!routeCheck) {
            console.log(`[Analytics] Маршрут ${routeId} не найден`);
            return res.status(404).json({ error: 'Маршрут не найден' });
        }

        if (routeCheck.chat_id !== req.chatId) {
            console.log(`[Analytics] Доступ запрещен: маршрут принадлежит ${routeCheck.chat_id}, запрос от ${req.chatId}`);
            return res.status(403).json({ error: 'Доступ запрещен' });
        }

        // ✅ Получаем данные ИЗ price_analytics КАК В БОТЕ
        const priceHistory = await new Promise((resolve, reject) => {
            db.all(
                `SELECT price, found_at, airline
                 FROM price_analytics
                 WHERE route_id = ? AND chat_id = ? AND route_type = 'regular'
                 ORDER BY found_at ASC`,
                [routeId, req.chatId],
                (err, rows) => {
                    if (err) {
                        console.log('[Analytics] Ошибка price_analytics:', err.message);
                        resolve([]);
                    } else {
                        console.log(`[Analytics] Найдено ${rows ? rows.length : 0} записей в price_analytics`);
                        resolve(rows || []);
                    }
                }
            );
        });

        // Группируем по датам для графика (min/max по дням)
        const groupedByDate = {};
        priceHistory.forEach(item => {
            const date = item.found_at.split(' ')[0]; // Берем только дату
            if (!groupedByDate[date]) {
                groupedByDate[date] = {
                    min_price: item.price,
                    max_price: item.price,
                    prices: [item.price]
                };
            } else {
                groupedByDate[date].prices.push(item.price);
                groupedByDate[date].min_price = Math.min(groupedByDate[date].min_price, item.price);
                groupedByDate[date].max_price = Math.max(groupedByDate[date].max_price, item.price);
            }
        });

        const priceHistoryGrouped = Object.keys(groupedByDate).map(date => ({
            date: date,
            min_price: groupedByDate[date].min_price,
            max_price: groupedByDate[date].max_price,
            avg_price: groupedByDate[date].prices.reduce((a, b) => a + b, 0) / groupedByDate[date].prices.length,
            check_count: groupedByDate[date].prices.length
        })).sort((a, b) => a.date.localeCompare(b.date));

        // ✅ Heatmap: используем day_of_week и hour_of_day из price_analytics
        const heatmap = await new Promise((resolve, reject) => {
            db.all(
                `SELECT
                     day_of_week,
                     hour_of_day,
                     AVG(price) as avg_price,
                     COUNT(*) as count
                 FROM price_analytics
                 WHERE route_id = ?
                   AND chat_id = ?
                   AND route_type = 'regular'
                   AND day_of_week IS NOT NULL
                   AND hour_of_day IS NOT NULL
                 GROUP BY day_of_week, hour_of_day
                 HAVING count >= 1
                 ORDER BY day_of_week, hour_of_day`,
                [routeId, req.chatId],
                (err, rows) => {
                    if (err) {
                        console.log('[Analytics] Ошибка heatmap:', err.message);
                        resolve([]);
                    } else {
                        console.log(`[Analytics] Heatmap: найдено ${rows ? rows.length : 0} точек`);
                        resolve(rows || []);
                    }
                }
            );
        });

        console.log(`[Analytics] Отправка: priceHistory=${priceHistoryGrouped.length}, heatmap=${heatmap.length}`);

        res.json({
            priceHistory: priceHistoryGrouped,
            heatmap: heatmap
        });
    } catch (error) {
        console.error('[Analytics] Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: получить аналитику для графиков (гибкий маршрут)
app.get('/api/flexible-routes/:id/analytics', requireAuth, async (req, res) => {
    try {
        const routeId = parseInt(req.params.id);

        console.log(`[FlexAnalytics] Запрос аналитики для гибкого маршрута ${routeId}`);

        const routeCheck = await new Promise((resolve, reject) => {
            db.get(
                'SELECT chat_id FROM flexible_routes WHERE id = ?',
                [routeId],
                (err, row) => {
                    if (err) {
                        console.error('[FlexAnalytics] Ошибка проверки маршрута:', err);
                        reject(err);
                    } else {
                        console.log('[FlexAnalytics] Маршрут найден:', row);
                        resolve(row);
                    }
                }
            );
        });

        if (!routeCheck) {
            console.log(`[FlexAnalytics] Маршрут ${routeId} не найден`);
            return res.status(404).json({ error: 'Маршрут не найден' });
        }

        if (routeCheck.chat_id !== req.chatId) {
            console.log(`[FlexAnalytics] Доступ запрещен: маршрут принадлежит ${routeCheck.chat_id}, запрос от ${req.chatId}`);
            return res.status(403).json({ error: 'Доступ запрещен' });
        }

        // ✅ Получаем данные ИЗ price_analytics КАК В БОТЕ
        const priceHistory = await new Promise((resolve, reject) => {
            db.all(
                `SELECT price, found_at, airline
                 FROM price_analytics
                 WHERE route_id = ? AND chat_id = ? AND route_type = 'flexible'
                 ORDER BY found_at ASC`,
                [routeId, req.chatId],
                (err, rows) => {
                    if (err) {
                        console.log('[FlexAnalytics] Ошибка price_analytics:', err.message);
                        resolve([]);
                    } else {
                        console.log(`[FlexAnalytics] Найдено ${rows ? rows.length : 0} записей`);
                        resolve(rows || []);
                    }
                }
            );
        });

        // Группируем по датам
        const groupedByDate = {};
        priceHistory.forEach(item => {
            const date = item.found_at.split(' ')[0];
            if (!groupedByDate[date]) {
                groupedByDate[date] = {
                    min_price: item.price,
                    max_price: item.price,
                    prices: [item.price]
                };
            } else {
                groupedByDate[date].prices.push(item.price);
                groupedByDate[date].min_price = Math.min(groupedByDate[date].min_price, item.price);
                groupedByDate[date].max_price = Math.max(groupedByDate[date].max_price, item.price);
            }
        });

        const priceHistoryGrouped = Object.keys(groupedByDate).map(date => ({
            date: date,
            min_price: groupedByDate[date].min_price,
            max_price: groupedByDate[date].max_price,
            avg_price: groupedByDate[date].prices.reduce((a, b) => a + b, 0) / groupedByDate[date].prices.length,
            check_count: groupedByDate[date].prices.length
        })).sort((a, b) => a.date.localeCompare(b.date));

        // ✅ Heatmap для гибких маршрутов
        const heatmap = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 
          day_of_week,
          hour_of_day,
          AVG(price) as avg_price,
          COUNT(*) as count
        FROM price_analytics 
        WHERE route_id = ? 
          AND chat_id = ? 
          AND route_type = 'flexible'
          AND day_of_week IS NOT NULL 
          AND hour_of_day IS NOT NULL
        GROUP BY day_of_week, hour_of_day
        HAVING count >= 1
        ORDER BY day_of_week, hour_of_day`,
                [routeId, req.chatId],
                (err, rows) => {
                    if (err) {
                        console.log('[FlexAnalytics] Ошибка heatmap:', err.message);
                        resolve([]);
                    } else {
                        console.log(`[FlexAnalytics] Heatmap: найдено ${rows ? rows.length : 0} точек`);
                        resolve(rows || []);
                    }
                }
            );
        });

        console.log(`[FlexAnalytics] Отправка: priceHistory=${priceHistoryGrouped.length}, heatmap=${heatmap.length}`);

        res.json({
            priceHistory: priceHistoryGrouped,
            heatmap: heatmap
        });
    } catch (error) {
        console.error('[FlexAnalytics] Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: получить лучшие билеты (топ-10 для обычного маршрута)
app.get('/api/routes/:id/tickets', requireAuth, async (req, res) => {
    try {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT price, airline, found_at, search_link
                 FROM best_prices
                 WHERE route_id = ?
                 ORDER BY price ASC
                     LIMIT 10`,
                [req.params.id],
                (err, rows) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        reject(err);
                    } else {
                        res.json(rows || []);
                        resolve();
                    }
                }
            );
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: получить лучшие билеты (топ-10 для гибкого маршрута)
app.get('/api/flexible-routes/:id/tickets', requireAuth, async (req, res) => {
    try {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT total_price, airline, departure_date, return_date, days_in_country, found_at, search_link
                 FROM flexible_results
                 WHERE route_id = ?
                 ORDER BY total_price ASC
                     LIMIT 10`,
                [req.params.id],
                (err, rows) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        reject(err);
                    } else {
                        res.json(rows || []);
                        resolve();
                    }
                }
            );
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`🌐 Web-интерфейс запущен: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard?chat_id=YOUR_CHAT_ID`);
});

module.exports = app;