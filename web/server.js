const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('../config/database');
const UnifiedRoute = require('../models/UnifiedRoute');
const RouteResult = require('../models/RouteResult');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tg-bot-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Сессии для админки
app.use(session({
  secret: process.env.SESSION_SECRET || 'aviasales-bot-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================
// MIDDLEWARE
// ============================================

// Проверка авторизации пользователя
function requireAuth(req, res, next) {
  const chatId = req.query.chat_id || req.body.chat_id;
  if (!chatId) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  req.chatId = parseInt(chatId);
  next();
}

// Проверка авторизации админа
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

// Получить лучшие цены для маршрутов
async function getBestPricesForRoutes(routes) {
  if (!routes || routes.length === 0) return [];

  const promises = routes.map(async (route) => {
    const bestResults = await RouteResult.getTopResults(route.id, 3);
    const bestPrice = bestResults && bestResults.length > 0 ? bestResults[0] : null;
    const savings = bestPrice ? Math.max(0, route.threshold_price - bestPrice.total_price) : 0;

    return {
      ...route,
      bestPrice: bestPrice,
      lastCheck: route.last_check ? { found_at: route.last_check } : null,
      savings: savings
    };
  });

  return Promise.all(promises);
}

// Получить статистику пользователя
async function getUserStats(chatId) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      const stats = {};

      // Количество маршрутов
      db.get('SELECT COUNT(*) as count FROM unified_routes WHERE chat_id = ?', [chatId], (err, row) => {
        stats.totalRoutes = row ? row.count : 0;
      });

      // Активные маршруты
      db.get('SELECT COUNT(*) as count FROM unified_routes WHERE chat_id = ? AND is_paused = 0', [chatId], (err, row) => {
        stats.activeRoutes = row ? row.count : 0;
      });

      // Всего результатов
      db.get(`
        SELECT COUNT(*) as count 
        FROM route_results rr 
        JOIN unified_routes ur ON rr.route_id = ur.id 
        WHERE ur.chat_id = ?
      `, [chatId], (err, row) => {
        stats.totalResults = row ? row.count : 0;

        // Завершаем через небольшую задержку
        setTimeout(() => resolve(stats), 50);
      });
    });
  });
}

// Статистика для админки
async function getAdminStats() {
  return new Promise((resolve) => {
    const stats = {};

    db.serialize(() => {
      // Пользователи
      db.get('SELECT COUNT(DISTINCT chat_id) as count FROM user_settings', (err, row) => {
        stats.totalUsers = row ? row.count : 0;
      });

      // Маршруты
      db.get('SELECT COUNT(*) as count FROM unified_routes', (err, row) => {
        stats.totalRoutes = row ? row.count : 0;
      });

      // Активные маршруты
      db.get('SELECT COUNT(*) as count FROM unified_routes WHERE is_paused = 0', (err, row) => {
        stats.activeRoutes = row ? row.count : 0;
      });

      // Проверки за 24 часа
      db.get(`
        SELECT COUNT(*) as count 
        FROM route_check_stats 
        WHERE check_timestamp >= datetime('now', '-1 day')
      `, (err, row) => {
        stats.checksLast24h = row ? row.count : 0;
      });

      // Успешные проверки
      db.get(`
        SELECT SUM(successful_checks) as total 
        FROM route_check_stats 
        WHERE check_timestamp >= datetime('now', '-1 day')
      `, (err, row) => {
        stats.successfulChecks = row ? (row.total || 0) : 0;
      });

      // Неудачные проверки
      db.get(`
        SELECT SUM(failed_checks) as total 
        FROM route_check_stats 
        WHERE check_timestamp >= datetime('now', '-1 day')
      `, (err, row) => {
        stats.failedChecks = row ? (row.total || 0) : 0;
      });

      // Размер БД
      db.get("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()", (err, row) => {
        stats.dbSize = row ? row.size : 0;

        setTimeout(() => resolve(stats), 100);
      });
    });
  });
}

// ============================================
// АДМИНКА - РОУТЫ
// ============================================

// Страница логина
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: null });
});

// Обработка логина
app.post('/admin/login', (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.loginTime = new Date();
    console.log('🔐 Админ вошел в систему');
    res.redirect('/admin');
  } else {
    console.log('❌ Неверная попытка входа в админку');
    res.render('admin-login', { error: 'Неверный пароль' });
  }
});

// Выход из админки
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  console.log('🚪 Админ вышел из системы');
  res.redirect('/admin/login');
});

// Главная страница админки
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const stats = await getAdminStats();
    res.render('admin', { stats });
  } catch (error) {
    console.error('Ошибка админки:', error);
    res.status(500).send('Ошибка загрузки данных: ' + error.message);
  }
});

// API: Получить пользователей
app.get('/admin/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          us.*,
          COUNT(DISTINCT ur.id) as total_routes,
          MAX(ur.last_check) as last_activity
        FROM user_settings us
        LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
        GROUP BY us.chat_id
        ORDER BY last_activity DESC NULLS LAST
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Получить все маршруты
app.get('/admin/api/routes', requireAdmin, async (req, res) => {
  try {
    const routes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          u.*,
          (SELECT COUNT(*) FROM route_results WHERE route_id = u.id) as check_count
        FROM unified_routes u
        ORDER BY u.created_at DESC
        LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Статистика проверок
app.get('/admin/api/check-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          cs.*,
          r.origin || ' → ' || r.destination as route_name,
          r.chat_id
        FROM route_check_stats cs
        JOIN unified_routes r ON cs.route_id = r.id
        ORDER BY cs.check_timestamp DESC
        LIMIT 50
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Неудачные проверки
app.get('/admin/api/failed-checks', requireAdmin, async (req, res) => {
  try {
    const failed = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          ccr.*,
          r.origin || ' → ' || r.destination as route_name,
          r.chat_id
        FROM combination_check_results ccr
        JOIN unified_routes r ON ccr.route_id = r.id
        WHERE ccr.status IN ('error', 'not_found')
        ORDER BY ccr.check_timestamp DESC
        LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    res.json(failed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Очистка базы
app.post('/admin/api/cleanup', requireAdmin, async (req, res) => {
  try {
    const { days } = req.body;
    const daysAgo = days || 30;

    const results = await new Promise((resolve, reject) => {
      db.serialize(() => {
        const stats = { deleted: {} };

        db.run(
            `DELETE FROM combination_check_results WHERE check_timestamp < datetime('now', '-' || ? || ' days')`,
            [daysAgo],
            function(err) {
              if (err) {
                reject(err);
              } else {
                stats.deleted.combinations = this.changes;

                db.run(
                    `DELETE FROM route_check_stats WHERE check_timestamp < datetime('now', '-' || ? || ' days')`,
                    [daysAgo],
                    function(err) {
                      if (err) {
                        reject(err);
                      } else {
                        stats.deleted.check_stats = this.changes;

                        db.run(
                            `DELETE FROM price_analytics WHERE found_at < datetime('now', '-' || ? || ' days')`,
                            [daysAgo],
                            function(err) {
                              if (err) {
                                reject(err);
                              } else {
                                stats.deleted.analytics = this.changes;
                                resolve(stats);
                              }
                            }
                        );
                      }
                    }
                );
              }
            }
        );
      });
    });

    console.log(`🧹 Очистка БД: удалено ${Object.values(results.deleted).reduce((a,b) => a+b, 0)} записей`);
    res.json({ success: true, results });
  } catch (error) {
    console.error('Ошибка очистки:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ПОЛЬЗОВАТЕЛЬСКИЕ РОУТЫ
// ============================================

// Главная страница
app.get('/', (req, res) => {
  res.render('index');
});

// Dashboard пользователя
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const allRoutes = await UnifiedRoute.findByChatId(req.chatId);
    const routes = allRoutes.filter(r => !r.is_flexible);
    const flexRoutes = allRoutes.filter(r => r.is_flexible);

    const stats = await getUserStats(req.chatId);
    const routesWithPrices = await getBestPricesForRoutes(routes);
    const flexRoutesWithPrices = await getBestPricesForRoutes(flexRoutes);

    const activeRoutes = routes.filter(r => !r.is_paused).length;
    const activeFlexRoutes = flexRoutes.filter(r => !r.is_paused).length;
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
    const routes = await UnifiedRoute.findByChatId(req.chatId);
    const regularRoutes = routes.filter(r => !r.is_flexible);
    res.json(regularRoutes || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: получить гибкие маршруты
app.get('/api/flexible-routes', requireAuth, async (req, res) => {
  try {
    const routes = await UnifiedRoute.findByChatId(req.chatId);
    const flexRoutes = routes.filter(r => r.is_flexible);
    res.json(flexRoutes || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: удалить маршрут
app.delete('/api/routes/:id', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    await UnifiedRoute.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: удалить гибкий маршрут
app.delete('/api/flexible-routes/:id', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    await UnifiedRoute.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: приостановить/возобновить маршрут
app.patch('/api/routes/:id/pause', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    const isPaused = req.body.is_paused ? 1 : 0;
    await UnifiedRoute.updatePauseStatus(req.params.id, isPaused);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: приостановить/возобновить гибкий маршрут
app.patch('/api/flexible-routes/:id/pause', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    const isPaused = req.body.is_paused ? 1 : 0;
    await UnifiedRoute.updatePauseStatus(req.params.id, isPaused);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: обновить порог цены
app.patch('/api/routes/:id/threshold', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    await UnifiedRoute.updateThreshold(req.params.id, req.body.threshold_price);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: обновить порог цены гибкого маршрута
app.patch('/api/flexible-routes/:id/threshold', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    await UnifiedRoute.updateThreshold(req.params.id, req.body.threshold_price);
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

    const route = await UnifiedRoute.findById(routeId);
    if (!route) {
      console.log(`[Analytics] Маршрут ${routeId} не найден`);
      return res.status(404).json({ error: 'Маршрут не найден' });
    }

    if (route.chat_id !== req.chatId) {
      console.log(`[Analytics] Доступ запрещен: маршрут принадлежит ${route.chat_id}, запрос от ${req.chatId}`);
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    // Получаем данные ИЗ price_analytics
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

    // Группируем по датам для графика
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

    // Heatmap
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

    const route = await UnifiedRoute.findById(routeId);
    if (!route) {
      console.log(`[FlexAnalytics] Маршрут ${routeId} не найден`);
      return res.status(404).json({ error: 'Маршрут не найден' });
    }

    if (route.chat_id !== req.chatId) {
      console.log(`[FlexAnalytics] Доступ запрещен: маршрут принадлежит ${route.chat_id}, запрос от ${req.chatId}`);
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    // Получаем данные ИЗ price_analytics
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

    // Heatmap для гибких маршрутов
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
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const results = await RouteResult.getTopResults(req.params.id, 10);
    res.json(results || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: получить лучшие билеты (топ-10 для гибкого маршрута)
app.get('/api/flexible-routes/:id/tickets', requireAuth, async (req, res) => {
  try {
    const route = await UnifiedRoute.findById(req.params.id);
    if (!route || route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const results = await RouteResult.getTopResults(req.params.id, 10);
    res.json(results || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Web-интерфейс запущен: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard?chat_id=YOUR_CHAT_ID`);
  console.log(`🔐 Admin панель: http://localhost:${PORT}/admin`);
  console.log(`🔑 Пароль админки: ${ADMIN_PASSWORD}`);
});

module.exports = app;