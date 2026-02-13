// Загрузка переменных окружения из .env
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('../config/database');
const UnifiedRoute = require('../models/UnifiedRoute');
const RouteResult = require('../models/RouteResult');
const ActivityService = require('../services/ActivityService');
const airportResolver = require('../utils/AirportCodeResolver');
const YooKassaService = require('../services/YooKassaService');
const Trip = require('../models/Trip');
const TripLeg = require('../models/TripLeg');
const TripOptimizer = require('../services/TripOptimizer');
const TripResult = require('../models/TripResult');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tg-bot-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Отключаем кэширование для разработки
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));


// 🔥 ИСПРАВЛЕННЫЕ настройки сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'aviasales-bot-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' ? false : false // Для HTTP оставляем false
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
    // return res.status(401).json({ error: 'Не авторизован' });
  }
  req.chatId = parseInt(chatId);
  next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  // Если это API запрос - вернуть JSON
  if (req.path.startsWith('/admin/api/')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Требуется авторизация'
    });
  }

  // Иначе - редирект на логин
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

      db.get('SELECT COUNT(*) as count FROM unified_routes WHERE chat_id = ?', [chatId], (err, row) => {
        stats.totalRoutes = row ? row.count : 0;
      });

      db.get('SELECT COUNT(*) as count FROM unified_routes WHERE chat_id = ? AND is_paused = 0', [chatId], (err, row) => {
        stats.activeRoutes = row ? row.count : 0;
      });

      db.get(`
        SELECT COUNT(*) as count
        FROM route_results rr
          JOIN unified_routes ur ON rr.route_id = ur.id
        WHERE ur.chat_id = ?
      `, [chatId], (err, row) => {
        stats.totalResults = row ? row.count : 0;
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
      // Общее количество пользователей
      db.get('SELECT COUNT(DISTINCT chat_id) as count FROM unified_routes', (err, row) => {
        stats.totalUsers = row ? row.count : 0;
      });

      // Общее количество маршрутов
      db.get('SELECT COUNT(*) as count FROM unified_routes', (err, row) => {
        stats.totalRoutes = row ? row.count : 0;
      });

      // Активные маршруты
      db.get('SELECT COUNT(*) as count FROM unified_routes WHERE is_paused = 0', (err, row) => {
        stats.activeRoutes = row ? row.count : 0;
      });

      // Проверки за последние 24 часа
      db.get(`SELECT COUNT(*) as count FROM route_check_stats
              WHERE check_timestamp >= datetime('now', '-1 day')`, (err, row) => {
        stats.checksLast24h = row ? row.count : 0;
      });

      // Успешные проверки за 24ч
      db.get(`SELECT SUM(successful_checks) as total FROM route_check_stats
              WHERE check_timestamp >= datetime('now', '-1 day')`, (err, row) => {
        stats.successfulChecks = row && row.total ? row.total : 0;
      });

      // Неудачные проверки за 24ч
      db.get(`SELECT SUM(failed_checks) as total FROM route_check_stats
              WHERE check_timestamp >= datetime('now', '-1 day')`, (err, row) => {
        stats.failedChecks = row && row.total ? row.total : 0;
      });

      // Размер БД
      db.get('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()', (err, row) => {
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
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Проверка авторизации (для клиента)
app.get('/admin/check-auth', (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

// Страница логина (GET)
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Обработка логина (POST)
app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      req.session.isAdmin = true;
      req.session.loginTime = new Date();

      // Явно сохраняем сессию
      req.session.save((err) => {
        if (err) {
          console.error('❌ Ошибка сохранения сессии:', err);
          return res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
          });
        }

        console.log('🔐 Админ вошел в систему');
        res.json({ success: true });
      });
    } else {
      console.log('❌ Неверная попытка входа в админку');
      res.status(401).json({
        success: false,
        error: 'Неверный логин или пароль'
      });
    }
  } catch (error) {
    console.error('❌ Ошибка логина:', error);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Выход из админки
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  console.log('🚪 Админ вышел из системы');
  res.redirect('/admin/login');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Ошибка при выходе:', err);
      return res.status(500).json({ success: false });
    }
    console.log('🚪 Админ вышел из системы');
    res.json({ success: true });
  });
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
          us.chat_id,
          us.timezone,
          us.notifications_enabled,
          us.night_mode,
          us.created_at,
          COUNT(DISTINCT ur.id) as totalroutes,
          MAX(ur.last_check) as lastactivity
        FROM user_settings us
               LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
        GROUP BY us.chat_id, us.timezone, us.notifications_enabled, us.night_mode, us.created_at
        ORDER BY lastactivity DESC NULLS LAST
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(users);
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
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

    // Добавляем названия городов
    routes.forEach(r => {
      r.origin_city = airportResolver.getCityName(r.origin);
      r.destination_city = airportResolver.getCityName(r.destination);
    });

    res.json(routes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Получить маппинг аэропортов для клиента
app.get('/admin/api/airports', requireAdmin, async (req, res) => {
  try {
    const airports = await new Promise((resolve, reject) => {
      db.all(`SELECT iata_code, city_name FROM airports GROUP BY iata_code`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const mapping = {};
    airports.forEach(a => {
      mapping[a.iata_code] = a.city_name;
    });

    res.json(mapping);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Хелпер для резолва routename в названия городов
function resolveRoutenames(rows) {
  rows.forEach(r => {
    if (r.routename) {
      const parts = r.routename.split(' → ');
      if (parts.length === 2) {
        const o = parts[0], d = parts[1];
        r.routename = `${airportResolver.getCityName(o)} (${o}) → ${airportResolver.getCityName(d)} (${d})`;
      }
    }
  });
  return rows;
}

// API: Статистика проверок
app.get('/admin/api/check-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          cs.id,
          cs.route_id,
          cs.total_combinations,
          cs.successful_checks,
          cs.failed_checks,
          cs.check_timestamp,
          (r.origin || ' → ' || r.destination) as routename,
          r.chat_id as chatid
        FROM route_check_stats cs
               JOIN unified_routes r ON cs.route_id = r.id
        ORDER BY cs.check_timestamp DESC
          LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    resolveRoutenames(stats);
    res.json(stats);
  } catch (error) {
    console.error('Ошибка загрузки статистики:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Неудачные проверки
app.get('/admin/api/failed-checks', requireAdmin, async (req, res) => {
  try {
    const failed = await new Promise((resolve, reject) => {
      db.all(`
                SELECT
                    ccr.id,
                    ccr.route_id,
                    ccr.departure_date,
                    ccr.return_date,
                    ccr.days_in_country,
                    ccr.status,
                    ccr.price,
                    ccr.currency,
                    ccr.error_reason,
                    ccr.search_url,
                    ccr.check_timestamp,
                    (r.origin || ' → ' || r.destination) as routename,
                    r.chat_id as chatid
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

    resolveRoutenames(failed);
    res.json(failed);
  } catch (error) {
    console.error('Ошибка загрузки ошибок:', error);
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
// BROADCASTS API
// ============================================

// API: Получить все сообщения для рассылки
app.get('/admin/api/broadcasts', requireAdmin, async (req, res) => {
  try {
    const broadcasts = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          bm.*,
          COUNT(DISTINCT bl.chat_id) as sent_count,
          (
            SELECT COUNT(DISTINCT chat_id) 
            FROM user_settings 
            WHERE (bm.target_users = 'all' OR chat_id IN (
              SELECT value FROM json_each(
                CASE 
                  WHEN bm.target_users = 'all' THEN '[]'
                  ELSE bm.target_users 
                END
              )
            ))
          ) as total_users
        FROM broadcast_messages bm
        LEFT JOIN broadcast_log bl ON bm.id = bl.broadcast_id
        GROUP BY bm.id
        ORDER BY bm.created_at DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(broadcasts);
  } catch (error) {
    console.error('Ошибка загрузки рассылок:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Получить конкретное сообщение
app.get('/admin/api/broadcasts/:id', requireAdmin, async (req, res) => {
  try {
    const broadcastId = parseInt(req.params.id);

    const broadcast = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM broadcast_messages WHERE id = ?', [broadcastId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!broadcast) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    // Получаем статистику отправки
    const sentUsers = await new Promise((resolve, reject) => {
      db.all(`
        SELECT bl.chat_id, bl.sent_at, us.timezone, bl.status
        FROM broadcast_log bl
        LEFT JOIN user_settings us ON bl.chat_id = us.chat_id
        WHERE bl.broadcast_id = ?
        ORDER BY bl.sent_at DESC
      `, [broadcastId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({
      ...broadcast,
      sent_users: sentUsers
    });
  } catch (error) {
    console.error('Ошибка получения рассылки:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Создать новое сообщение для рассылки
app.post('/admin/api/broadcasts', requireAdmin, async (req, res) => {
  try {
    const { message_text, target_users, scheduled_time } = req.body;

    if (!message_text || !message_text.trim()) {
      return res.status(400).json({ error: 'Текст сообщения обязателен' });
    }

    if (!scheduled_time || !/^\d{2}:\d{2}$/.test(scheduled_time)) {
      return res.status(400).json({ error: 'Неверный формат времени (требуется HH:MM)' });
    }

    // Валидация target_users
    let targetUsersStr;
    if (target_users === 'all' || target_users === '[]' || !target_users) {
      targetUsersStr = 'all';
    } else {
      // Проверяем что это валидный JSON массив
      try {
        const parsed = JSON.parse(target_users);
        if (!Array.isArray(parsed)) {
          return res.status(400).json({ error: 'target_users должен быть массивом' });
        }
        targetUsersStr = target_users;
      } catch (e) {
        return res.status(400).json({ error: 'Неверный формат target_users' });
      }
    }

    const result = await new Promise((resolve, reject) => {
      db.run(
          `INSERT INTO broadcast_messages (message_text, target_users, scheduled_time)
         VALUES (?, ?, ?)`,
          [message_text.trim(), targetUsersStr, scheduled_time],
          function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
          }
      );
    });

    console.log(`[ADMIN] Создана рассылка #${result.id} на время ${scheduled_time}`);
    res.json({ success: true, id: result.id });
  } catch (error) {
    console.error('Ошибка создания рассылки:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Обновить сообщение для рассылки
app.put('/admin/api/broadcasts/:id', requireAdmin, async (req, res) => {
  try {
    const broadcastId = parseInt(req.params.id);
    const { message_text, target_users, scheduled_time } = req.body;

    // Проверяем что сообщение еще не отправлено
    const broadcast = await new Promise((resolve, reject) => {
      db.get('SELECT is_sent FROM broadcast_messages WHERE id = ?', [broadcastId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!broadcast) {
      return res.status(404).json({ error: 'Сообщение не найдено' });
    }

    if (broadcast.is_sent) {
      return res.status(400).json({ error: 'Нельзя редактировать отправленное сообщение' });
    }

    const updates = [];
    const params = [];

    if (message_text !== undefined) {
      updates.push('message_text = ?');
      params.push(message_text.trim());
    }

    if (target_users !== undefined) {
      let targetUsersStr;
      if (target_users === 'all') {
        targetUsersStr = 'all';
      } else {
        try {
          const parsed = JSON.parse(target_users);
          if (!Array.isArray(parsed)) {
            return res.status(400).json({ error: 'target_users должен быть массивом' });
          }
          targetUsersStr = target_users;
        } catch (e) {
          return res.status(400).json({ error: 'Неверный формат target_users' });
        }
      }
      updates.push('target_users = ?');
      params.push(targetUsersStr);
    }

    if (scheduled_time !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(scheduled_time)) {
        return res.status(400).json({ error: 'Неверный формат времени (требуется HH:MM)' });
      }
      updates.push('scheduled_time = ?');
      params.push(scheduled_time);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет данных для обновления' });
    }

    params.push(broadcastId);

    await new Promise((resolve, reject) => {
      db.run(
          `UPDATE broadcast_messages SET ${updates.join(', ')} WHERE id = ?`,
          params,
          function(err) {
            if (err) reject(err);
            else resolve();
          }
      );
    });

    console.log(`[ADMIN] Обновлена рассылка #${broadcastId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления рассылки:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Удалить сообщение для рассылки
app.delete('/admin/api/broadcasts/:id', requireAdmin, async (req, res) => {
  try {
    const broadcastId = parseInt(req.params.id);

    await new Promise((resolve, reject) => {
      db.run('DELETE FROM broadcast_messages WHERE id = ?', [broadcastId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`[ADMIN] Удалена рассылка #${broadcastId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления рассылки:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Получить список пользователей для выбора
app.get('/admin/api/broadcast-users', requireAdmin, async (req, res) => {
  try {
    const users = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          us.chat_id,
          us.timezone,
          us.created_at,
          COUNT(DISTINCT ur.id) as routes_count
        FROM user_settings us
        LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
        GROUP BY us.chat_id, us.timezone, us.created_at
        ORDER BY us.created_at DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(users);
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
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
    const route = await UnifiedRoute.findById(routeId);

    if (!route) {
      return res.status(404).json({ error: 'Маршрут не найден' });
    }
    if (route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const priceHistory = await new Promise((resolve) => {
      db.all(
          `SELECT price, found_at, airline
           FROM price_analytics
           WHERE route_id = ? AND chat_id = ? AND route_type = 'regular'
           ORDER BY found_at ASC`,
          [routeId, req.chatId],
          (err, rows) => resolve(rows || [])
      );
    });

    const groupedByDate = {};
    priceHistory.forEach(item => {
      const date = item.found_at.split(' ')[0];
      if (!groupedByDate[date]) {
        groupedByDate[date] = { min_price: item.price, max_price: item.price, prices: [item.price] };
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

    const heatmap = await new Promise((resolve) => {
      db.all(
          `SELECT day_of_week, hour_of_day, AVG(price) as avg_price, COUNT(*) as count
           FROM price_analytics
           WHERE route_id = ? AND chat_id = ? AND route_type = 'regular'
             AND day_of_week IS NOT NULL AND hour_of_day IS NOT NULL
           GROUP BY day_of_week, hour_of_day HAVING count >= 1
           ORDER BY day_of_week, hour_of_day`,
          [routeId, req.chatId],
          (err, rows) => resolve(rows || [])
      );
    });

    res.json({ priceHistory: priceHistoryGrouped, heatmap: heatmap });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: получить аналитику для графиков (гибкий маршрут)
app.get('/api/flexible-routes/:id/analytics', requireAuth, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);
    const route = await UnifiedRoute.findById(routeId);

    if (!route) {
      return res.status(404).json({ error: 'Маршрут не найден' });
    }
    if (route.chat_id !== req.chatId) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }

    const priceHistory = await new Promise((resolve) => {
      db.all(
          `SELECT price, found_at, airline FROM price_analytics
           WHERE route_id = ? AND chat_id = ? AND route_type = 'flexible'
           ORDER BY found_at ASC`,
          [routeId, req.chatId],
          (err, rows) => resolve(rows || [])
      );
    });

    const groupedByDate = {};
    priceHistory.forEach(item => {
      const date = item.found_at.split(' ')[0];
      if (!groupedByDate[date]) {
        groupedByDate[date] = { min_price: item.price, max_price: item.price, prices: [item.price] };
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

    const heatmap = await new Promise((resolve) => {
      db.all(
          `SELECT day_of_week, hour_of_day, AVG(price) as avg_price, COUNT(*) as count
           FROM price_analytics
           WHERE route_id = ? AND chat_id = ? AND route_type = 'flexible'
             AND day_of_week IS NOT NULL AND hour_of_day IS NOT NULL
           GROUP BY day_of_week, hour_of_day HAVING count >= 1
           ORDER BY day_of_week, hour_of_day`,
          [routeId, req.chatId],
          (err, rows) => resolve(rows || [])
      );
    });

    res.json({ priceHistory: priceHistoryGrouped, heatmap: heatmap });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: получить лучшие билеты
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
// ===== ИСПРАВЛЕННЫЕ API ENDPOINTS С ПРАВИЛЬНЫМИ НАЗВАНИЯМИ ПОЛЕЙ =====

// API: Информация о базе данных
app.get('/admin/api/database-info', requireAdmin, async (req, res) => {
  try {
    const tables = await new Promise((resolve, reject) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const tableInfo = await Promise.all(tables.map(async (table) => {
      const count = await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM ${table.name}`, (err, row) => {
          resolve(row ? row.count : 0);
        });
      });

      return {
        name: table.name,
        count: count,
        size: null
      };
    }));

    const totalRecords = tableInfo.reduce((sum, t) => sum + t.count, 0);

    res.json({
      success: true,
      tables: tableInfo,
      totalRecords: totalRecords
    });
  } catch (error) {
    console.error('Ошибка получения информации о БД:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Просмотр данных таблицы
app.get('/admin/api/table/:tableName', requireAdmin, async (req, res) => {
  try {
    const tableName = req.params.tableName;
    const limit = req.query.limit || 50;

    const validTables = await new Promise((resolve) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        resolve(rows ? rows.map(r => r.name) : []);
      });
    });

    if (!validTables.includes(tableName)) {
      return res.status(400).json({ error: 'Недопустимое имя таблицы' });
    }

    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM ${tableName} LIMIT ?`, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const total = await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
        resolve(row ? row.count : 0);
      });
    });

    res.json({
      success: true,
      tableName: tableName,
      rows: rows,
      total: total,
      showing: rows.length
    });
  } catch (error) {
    console.error('Ошибка чтения таблицы:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Выполнение SQL запроса (только SELECT)
app.post('/admin/api/sql-query', requireAdmin, async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim().toLowerCase().startsWith('select')) {
      return res.status(400).json({
        error: 'Разрешены только SELECT запросы'
      });
    }

    const results = await new Promise((resolve, reject) => {
      db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({
      success: true,
      results: results,
      count: results.length
    });
  } catch (error) {
    console.error('Ошибка выполнения SQL:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Создание бэкапа БД
app.post('/admin/api/backup', requireAdmin, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../backups');

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const dbPath = path.join(__dirname, '../data/bot.db');
    const backupPath = path.join(backupDir, `bot_backup_${timestamp}.db`);

    fs.copyFileSync(dbPath, backupPath);

    console.log(`[ADMIN] Создан бэкап: ${backupPath}`);

    res.json({
      success: true,
      filename: `bot_backup_${timestamp}.db`,
      path: backupPath
    });
  } catch (error) {
    console.error('Ошибка создания бэкапа:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Оптимизация (VACUUM) БД
app.post('/admin/api/vacuum', requireAdmin, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('VACUUM', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('[ADMIN] VACUUM выполнен');

    res.json({
      success: true,
      message: 'Оптимизация завершена'
    });
  } catch (error) {
    console.error('Ошибка VACUUM:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Аналитика системы
app.get('/admin/api/analytics-main', requireAdmin, async (req, res) => {
  try {
    // Топ пользователей
    const topUsers = await new Promise((resolve) => {
      db.all(`
        SELECT
          chat_id as chatid,
          COUNT(*) as routecount
        FROM unified_routes
        GROUP BY chat_id
        ORDER BY routecount DESC
          LIMIT 10
      `, (err, rows) => {
        resolve(rows || []);
      });
    });

    // Статистика по часам
    const hourlyStats = await new Promise((resolve) => {
      db.all(`
        SELECT
          CAST(strftime('%H', check_timestamp) AS INTEGER) as hour,
                    COUNT(*) as checks
        FROM route_check_stats
        WHERE check_timestamp >= datetime('now', '-7 days')
        GROUP BY hour
        ORDER BY hour
      `, (err, rows) => {
        resolve(rows || []);
      });
    });

    // Статистика настроек (таймзона, уведомления, ночной режим)
    const settingsActivity = await new Promise((resolve) => {
      db.serialize(() => {
        const stats = {};
        let completed = 0;
        const totalQueries = 7;

        const checkComplete = () => {
          completed++;
          if (completed === totalQueries) {
            resolve(stats);
          }
        };

        // Смена таймзоны
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'change_timezone'
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.timezoneChanges = row?.count || 0;
            checkComplete();
          });

        // Переключения уведомлений
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'toggle_notifications'
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.notificationToggles = row?.count || 0;
            checkComplete();
          });

        // Уведомления включены
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'toggle_notifications'
                AND json_extract(event_data, '$.enabled') = 1
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.notificationsEnabled = row?.count || 0;
            checkComplete();
          });

        // Уведомления отключены
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'toggle_notifications'
                AND json_extract(event_data, '$.enabled') = 0
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.notificationsDisabled = row?.count || 0;
            checkComplete();
          });

        // Переключения ночного режима
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'toggle_night_mode'
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.nightModeToggles = row?.count || 0;
            checkComplete();
          });

        // Ночной режим включен
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'toggle_night_mode'
                AND json_extract(event_data, '$.enabled') = 1
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.nightModeEnabled = row?.count || 0;
            checkComplete();
          });

        // Ночной режим отключен
        db.get(`SELECT COUNT(*) as count FROM user_activity_log
                WHERE event_type = 'toggle_night_mode'
                AND json_extract(event_data, '$.enabled') = 0
                AND created_at >= datetime('now', '-30 days')`,
          (err, row) => {
            stats.nightModeDisabled = row?.count || 0;
            checkComplete();
          });
      });
    });

    // DAU/WAU/MAU - реальная активность пользователей из user_activity_log
    const [dau, wau, mau, routesFunnel, subscriptionFunnel, dauHistory] = await Promise.all([
      ActivityService.getDAU(),
      ActivityService.getWAU(),
      ActivityService.getMAU(),
      ActivityService.getRoutesFunnel('30d'),
      ActivityService.getSubscriptionFunnel('30d'),
      ActivityService.getDAUHistory(30)
    ]);

    // Статистика трипов
    const allTrips = await new Promise((resolve) => {
      db.all('SELECT * FROM trips', (err, rows) => resolve(rows || []));
    });
    const activeTrips = allTrips.filter(t => !t.is_paused && !t.is_archived);
    const tripStats = {
      total: allTrips.length,
      active: activeTrips.length,
      archived: allTrips.filter(t => t.is_archived).length,
      paused: allTrips.filter(t => t.is_paused && !t.is_archived).length
    };

    // Подсчет комбинаций по всем маршрутам
    const allRoutes = await new Promise((resolve) => {
      db.all(`SELECT * FROM unified_routes`, (err, rows) => {
        resolve(rows || []);
      });
    });

    let activeCombinations = { fixed: 0, flexible: 0 };
    let allCombinations = { fixed: 0, flexible: 0 };

    for (const route of allRoutes) {
      const count = UnifiedRoute.countCombinations(route);
      if (route.is_flexible) {
        allCombinations.flexible += count;
      } else {
        allCombinations.fixed += count;
      }
      if (!route.is_paused && !route.is_archived) {
        if (route.is_flexible) {
          activeCombinations.flexible += count;
        } else {
          activeCombinations.fixed += count;
        }
      }
    }

    // Подсчет комбинаций по трипам
    let activeTripCombinations = 0;
    let allTripCombinations = 0;
    for (const trip of allTrips) {
      const legs = await TripLeg.getByTripId(trip.id);
      const count = TripOptimizer.countTripCombinations(trip, legs);
      allTripCombinations += count;
      if (!trip.is_paused && !trip.is_archived) {
        activeTripCombinations += count;
      }
    }

    // Новые за сегодня (с начала дня)
    const [newUsersToday, newFixedRoutesToday, newFlexibleRoutesToday, newTripsToday] = await Promise.all([
      new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM user_settings WHERE created_at >= date('now', 'start of day')`, (err, row) => resolve(row?.count || 0));
      }),
      new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM unified_routes WHERE created_at >= date('now', 'start of day') AND is_flexible = 0`, (err, row) => resolve(row?.count || 0));
      }),
      new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM unified_routes WHERE created_at >= date('now', 'start of day') AND is_flexible = 1`, (err, row) => resolve(row?.count || 0));
      }),
      new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM trips WHERE created_at >= date('now', 'start of day')`, (err, row) => resolve(row?.count || 0));
      })
    ]);

    // Комбинации новых маршрутов за сегодня (по категориям)
    const newRoutesTodayData = await new Promise((resolve) => {
      db.all(`SELECT * FROM unified_routes WHERE created_at >= date('now', 'start of day') AND is_paused = 0 AND is_archived = 0`, (err, rows) => resolve(rows || []));
    });
    let newFixedCombinationsToday = 0;
    let newFlexibleCombinationsToday = 0;
    for (const route of newRoutesTodayData) {
      const count = UnifiedRoute.countCombinations(route);
      if (route.is_flexible) {
        newFlexibleCombinationsToday += count;
      } else {
        newFixedCombinationsToday += count;
      }
    }
    // Комбинации новых трипов за сегодня
    let newTripCombinationsToday = 0;
    const newTripsTodayData = await new Promise((resolve) => {
      db.all(`SELECT * FROM trips WHERE created_at >= date('now', 'start of day') AND is_paused = 0 AND is_archived = 0`, (err, rows) => resolve(rows || []));
    });
    for (const trip of newTripsTodayData) {
      const legs = await TripLeg.getByTripId(trip.id);
      newTripCombinationsToday += TripOptimizer.countTripCombinations(trip, legs);
    }

    // Статистика подписок (по пользователям)
    const subscriptionStats = await new Promise((resolve) => {
      db.all(`
        SELECT
          COALESCE(us.subscription_type, 'free') as subscription_type,
          COUNT(DISTINCT ur.chat_id) as user_count
        FROM unified_routes ur
        LEFT JOIN user_subscriptions us ON ur.chat_id = us.chat_id
        GROUP BY subscription_type
        ORDER BY user_count DESC
      `, (err, rows) => {
        resolve(rows || []);
      });
    });

    res.json({
      success: true,
      topUsers,
      hourlyStats,
      settingsActivity,
      userActivity: { dau, wau, mau },
      combinations: {
        active: {
          fixed: activeCombinations.fixed,
          flexible: activeCombinations.flexible,
          trips: activeTripCombinations
        },
        all: {
          fixed: allCombinations.fixed,
          flexible: allCombinations.flexible,
          trips: allTripCombinations
        },
        newToday: {
          fixed: newFixedCombinationsToday,
          flexible: newFlexibleCombinationsToday,
          trips: newTripCombinationsToday
        }
      },
      newToday: {
        users: newUsersToday,
        fixedRoutes: newFixedRoutesToday,
        flexibleRoutes: newFlexibleRoutesToday,
        trips: newTripsToday
      },
      subscriptionStats,
      funnels: {
        routes: routesFunnel,
        subscription: subscriptionFunnel
      },
      dauHistory,
      tripStats
    });
  } catch (error) {
    console.error('Ошибка загрузки аналитики:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Статистика монетизации (клики по партнерским ссылкам)
app.get('/admin/api/monetization-stats', requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || '30'; // дней

    // Общее количество кликов
    const totalClicks = await new Promise((resolve) => {
      db.get(`
        SELECT COUNT(*) as count
        FROM user_activity_log
        WHERE event_type = 'affiliate_click'
          AND created_at >= datetime('now', '-${period} days')
      `, (err, row) => {
        resolve(row?.count || 0);
      });
    });

    // Клики на пользователя
    const clicksPerUser = await new Promise((resolve) => {
      db.get(`
        SELECT
          COUNT(DISTINCT chat_id) as users,
          COUNT(*) as clicks
        FROM user_activity_log
        WHERE event_type = 'affiliate_click'
          AND created_at >= datetime('now', '-${period} days')
      `, (err, row) => {
        if (!row || row.users === 0) return resolve(0);
        resolve((row.clicks / row.users).toFixed(2));
      });
    });

    // Топ направления по кликам
    const topRoutesByClicks = await new Promise((resolve) => {
      db.all(`
        SELECT
          JSON_EXTRACT(event_data, '$.origin') as origin,
          JSON_EXTRACT(event_data, '$.destination') as destination,
          COUNT(*) as clicks,
          AVG(CAST(JSON_EXTRACT(event_data, '$.price') AS REAL)) as avgPrice
        FROM user_activity_log
        WHERE event_type = 'affiliate_click'
          AND created_at >= datetime('now', '-${period} days')
          AND event_data IS NOT NULL
        GROUP BY origin, destination
        ORDER BY clicks DESC
        LIMIT 10
      `, (err, rows) => {
        resolve(rows || []);
      });
    });

    // CTR (клики / уведомления)
    const ctr = await new Promise((resolve) => {
      db.get(`
        SELECT
          (SELECT COUNT(*) FROM user_activity_log
           WHERE event_type = 'affiliate_click'
           AND created_at >= datetime('now', '-${period} days')) * 100.0 /
          NULLIF((SELECT COUNT(*) FROM notification_log
           WHERE sent_at >= datetime('now', '-${period} days')), 0) as ctr
      `, (err, row) => {
        resolve(row?.ctr ? parseFloat(row.ctr.toFixed(2)) : 0);
      });
    });

    // Клики по дням (для графика)
    const clicksByDay = await new Promise((resolve) => {
      db.all(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as clicks
        FROM user_activity_log
        WHERE event_type = 'affiliate_click'
          AND created_at >= datetime('now', '-${period} days')
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `, (err, rows) => {
        resolve(rows || []);
      });
    });

    // Количество уведомлений (для расчета CTR)
    const totalNotifications = await new Promise((resolve) => {
      db.get(`
        SELECT COUNT(*) as count
        FROM notification_log
        WHERE sent_at >= datetime('now', '-${period} days')
      `, (err, row) => {
        resolve(row?.count || 0);
      });
    });

    res.json({
      totalClicks,
      clicksPerUser: parseFloat(clicksPerUser),
      ctr,
      topRoutesByClicks,
      clicksByDay,
      totalNotifications,
      period: parseInt(period)
    });
  } catch (error) {
    console.error('Ошибка загрузки статистики монетизации:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Статистика вовлеченности (Engagement)
app.get('/admin/api/engagement-stats', requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || '30'; // дней

    // Stickiness = DAU / MAU
    const stickiness = await new Promise((resolve) => {
      db.get(`
        SELECT
          (SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
           WHERE created_at >= datetime('now', '-1 day')) * 100.0 /
          NULLIF((SELECT COUNT(DISTINCT chat_id) FROM user_activity_log
           WHERE created_at >= datetime('now', '-30 days')), 0) as stickiness
      `, (err, row) => {
        resolve(row?.stickiness ? parseFloat(row.stickiness.toFixed(2)) : 0);
      });
    });

    // Активных маршрутов на активного пользователя
    const activeRoutesPerUser = await new Promise((resolve) => {
      db.get(`
        SELECT
          COUNT(ur.id) * 1.0 / NULLIF(COUNT(DISTINCT ur.chat_id), 0) as avg_routes
        FROM unified_routes ur
        WHERE ur.is_paused = 0
          AND ur.is_archived = 0
          AND ur.chat_id IN (
            SELECT DISTINCT chat_id
            FROM user_activity_log
            WHERE created_at >= datetime('now', '-${period} days')
          )
      `, (err, row) => {
        resolve(row?.avg_routes ? parseFloat(row.avg_routes.toFixed(2)) : 0);
      });
    });

    // Retention D1 - пользователи, вернувшиеся через 1 день
    const retentionD1 = await new Promise((resolve) => {
      db.get(`
        WITH new_users AS (
          SELECT DISTINCT chat_id, DATE(MIN(created_at)) as first_day
          FROM user_activity_log
          WHERE created_at >= datetime('now', '-8 days')
          GROUP BY chat_id
          HAVING DATE(MIN(created_at)) = DATE('now', '-1 day')
        ),
        returned_users AS (
          SELECT DISTINCT nu.chat_id
          FROM new_users nu
          JOIN user_activity_log ual ON nu.chat_id = ual.chat_id
          WHERE DATE(ual.created_at) = DATE(nu.first_day, '+1 day')
        )
        SELECT
          COUNT(DISTINCT nu.chat_id) as total,
          COUNT(DISTINCT ru.chat_id) as returned
        FROM new_users nu
        LEFT JOIN returned_users ru ON nu.chat_id = ru.chat_id
      `, (err, row) => {
        if (!row || row.total === 0) return resolve(0);
        resolve(Math.round((row.returned / row.total) * 100));
      });
    });

    // Retention D7 - пользователи, вернувшиеся через 7 дней
    const retentionD7 = await new Promise((resolve) => {
      db.get(`
        WITH new_users AS (
          SELECT DISTINCT chat_id, DATE(MIN(created_at)) as first_day
          FROM user_activity_log
          WHERE created_at >= datetime('now', '-14 days')
          GROUP BY chat_id
          HAVING DATE(MIN(created_at)) = DATE('now', '-7 days')
        ),
        returned_users AS (
          SELECT DISTINCT nu.chat_id
          FROM new_users nu
          JOIN user_activity_log ual ON nu.chat_id = ual.chat_id
          WHERE DATE(ual.created_at) BETWEEN DATE(nu.first_day, '+6 days') AND DATE(nu.first_day, '+8 days')
        )
        SELECT
          COUNT(DISTINCT nu.chat_id) as total,
          COUNT(DISTINCT ru.chat_id) as returned
        FROM new_users nu
        LEFT JOIN returned_users ru ON nu.chat_id = ru.chat_id
      `, (err, row) => {
        if (!row || row.total === 0) return resolve(0);
        resolve(Math.round((row.returned / row.total) * 100));
      });
    });

    // Retention D30 - пользователи, вернувшиеся через 30 дней
    const retentionD30 = await new Promise((resolve) => {
      db.get(`
        WITH new_users AS (
          SELECT DISTINCT chat_id, DATE(MIN(created_at)) as first_day
          FROM user_activity_log
          WHERE created_at >= datetime('now', '-60 days')
          GROUP BY chat_id
          HAVING DATE(MIN(created_at)) = DATE('now', '-30 days')
        ),
        returned_users AS (
          SELECT DISTINCT nu.chat_id
          FROM new_users nu
          JOIN user_activity_log ual ON nu.chat_id = ual.chat_id
          WHERE DATE(ual.created_at) BETWEEN DATE(nu.first_day, '+28 days') AND DATE(nu.first_day, '+32 days')
        )
        SELECT
          COUNT(DISTINCT nu.chat_id) as total,
          COUNT(DISTINCT ru.chat_id) as returned
        FROM new_users nu
        LEFT JOIN returned_users ru ON nu.chat_id = ru.chat_id
      `, (err, row) => {
        if (!row || row.total === 0) return resolve(0);
        resolve(Math.round((row.returned / row.total) * 100));
      });
    });

    res.json({
      stickiness,
      activeRoutesPerUser,
      retention: {
        d1: retentionD1,
        d7: retentionD7,
        d30: retentionD30
      },
      period: parseInt(period)
    });
  } catch (error) {
    console.error('Ошибка загрузки статистики вовлеченности:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Детальная воронка оплаты
app.get('/admin/api/payment-funnel-detailed', requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || '30d';

    // Получаем детальную воронку из ActivityService
    const funnel = await ActivityService.getPaymentFunnelDetailed(period);

    // Рассчитываем конверсию и drop-off между шагами
    const base = funnel.viewed_subscription || 1;

    const metrics = {
      // Основные шаги воронки
      viewed_subscription: funnel.viewed_subscription,
      upgrade_attempts: funnel.upgrade_attempts,
      payment_link_created: funnel.payment_link_created,
      payment_help_viewed: funnel.payment_help_viewed,
      payment_success: funnel.payment_success,

      // Проценты конверсии (от начального шага)
      conversion: {
        viewed_to_attempt: base > 0 ? ((funnel.upgrade_attempts / base) * 100).toFixed(1) : 0,
        attempt_to_link: base > 0 ? ((funnel.payment_link_created / base) * 100).toFixed(1) : 0,
        link_to_success: base > 0 ? ((funnel.payment_success / base) * 100).toFixed(1) : 0,
        overall: base > 0 ? ((funnel.payment_success / base) * 100).toFixed(1) : 0
      },

      // Drop-off между шагами
      dropoff: {
        viewed_to_attempt: funnel.viewed_subscription > 0
          ? (((funnel.viewed_subscription - funnel.upgrade_attempts) / funnel.viewed_subscription) * 100).toFixed(1)
          : 0,
        attempt_to_link: funnel.upgrade_attempts > 0
          ? (((funnel.upgrade_attempts - funnel.payment_link_created) / funnel.upgrade_attempts) * 100).toFixed(1)
          : 0,
        link_to_success: funnel.payment_link_created > 0
          ? (((funnel.payment_link_created - funnel.payment_success) / funnel.payment_link_created) * 100).toFixed(1)
          : 0
      },

      // Финансовые метрики
      revenue: {
        total: funnel.total_revenue || 0,
        payment_count: funnel.payment_count || 0,
        average: funnel.payment_count > 0
          ? (funnel.total_revenue / funnel.payment_count).toFixed(2)
          : 0
      },

      // Метрики времени между шагами
      time_metrics: funnel.time_metrics || [],

      // Методы оплаты
      payment_methods: funnel.payment_methods || [],

      // Дополнительные метрики
      help_rate: funnel.payment_link_created > 0
        ? ((funnel.payment_help_viewed / funnel.payment_link_created) * 100).toFixed(1)
        : 0,

      period: period
    };

    res.json(metrics);
  } catch (error) {
    console.error('Ошибка загрузки детальной воронки оплаты:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Длительность проверок по часам
app.get('/admin/api/check-duration-by-hour', requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7; // по умолчанию 7 дней

    // Получаем данные о проверках, группируя по часу
    const checkDuration = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          strftime('%Y-%m-%d %H:00', check_timestamp) as hour,
          COUNT(*) as checks_count,
          MIN(check_timestamp) as first_check,
          MAX(check_timestamp) as last_check,
          -- Вычисляем длительность в минутах как разницу между первой и последней проверкой в этом часе
          CAST((julianday(MAX(check_timestamp)) - julianday(MIN(check_timestamp))) * 24 * 60 AS INTEGER) as duration_minutes
        FROM route_check_stats
        WHERE check_timestamp >= datetime('now', '-${days} days')
        GROUP BY strftime('%Y-%m-%d %H:00', check_timestamp)
        ORDER BY hour DESC
        LIMIT 168
      `, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({
      checkDuration: checkDuration.reverse(), // От старых к новым
      period: days
    });
  } catch (error) {
    console.error('Ошибка загрузки длительности проверок:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Детали пользователя
app.get('/admin/api/users/:chatId', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json(user);
  } catch (error) {
    console.error('Ошибка получения пользователя:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Удаление пользователя
app.delete('/admin/api/users/:chatId', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DELETE FROM unified_routes WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_settings WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_stats WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_subscriptions WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM notification_cooldown WHERE chat_id = ?', [chatId], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    console.log(`[ADMIN] Удален пользователь: ${chatId}`);

    res.json({
      success: true,
      message: `Пользователь ${chatId} удален`
    });
  } catch (error) {
    console.error('Ошибка удаления пользователя:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Переключение статуса маршрута
app.patch('/admin/api/routes/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);
    const { ispaused } = req.body;

    await new Promise((resolve, reject) => {
      db.run('UPDATE unified_routes SET is_paused = ? WHERE id = ?',
          [ispaused ? 1 : 0, routeId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });

    console.log(`[ADMIN] Маршрут ${routeId} ${ispaused ? 'приостановлен' : 'возобновлен'}`);

    res.json({
      success: true,
      routeId,
      ispaused
    });
  } catch (error) {
    console.error('Ошибка изменения статуса маршрута:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Удаление маршрута
app.delete('/admin/api/routes/:id', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);

    await new Promise((resolve, reject) => {
      db.run('DELETE FROM unified_routes WHERE id = ?', [routeId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`[ADMIN] Удален маршрут: ${routeId}`);

    res.json({
      success: true,
      message: `Маршрут ${routeId} удален`
    });
  } catch (error) {
    console.error('Ошибка удаления маршрута:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Приостановка всех маршрутов
app.post('/admin/api/routes/pause-all', requireAdmin, async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      db.run('UPDATE unified_routes SET is_paused = 1 WHERE is_paused = 0', function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });

    console.log(`[ADMIN] Приостановлено маршрутов: ${result}`);

    res.json({
      success: true,
      count: result
    });
  } catch (error) {
    console.error('Ошибка приостановки маршрутов:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TRIPS API
// ============================================

// API: Список всех трипов
app.get('/admin/api/trips', requireAdmin, async (req, res) => {
  try {
    const trips = await new Promise((resolve, reject) => {
      db.all(`
        SELECT t.*,
          (SELECT MIN(total_price) FROM trip_results WHERE trip_id = t.id) as best_price,
          (SELECT COUNT(*) FROM trip_results WHERE trip_id = t.id) as results_count
        FROM trips t ORDER BY t.created_at DESC LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Подгружаем legs для каждого трипа и резолвим города
    for (const trip of trips) {
      const legs = await TripLeg.getByTripId(trip.id);
      trip.legs = legs.map(leg => ({
        ...leg,
        origin_city: airportResolver.getCityName(leg.origin),
        destination_city: airportResolver.getCityName(leg.destination)
      }));
      trip.legs_count = legs.length;
      // Формируем название маршрута из плечей
      if (!trip.name && legs.length > 0) {
        trip.name = legs.map(l => l.origin).join('→') + '→' + legs[legs.length - 1].destination;
      }
    }

    res.json(trips);
  } catch (error) {
    console.error('Ошибка загрузки трипов:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Детали трипа
app.get('/admin/api/trips/:id', requireAdmin, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    const trip = await Trip.findById(tripId);

    if (!trip) {
      return res.status(404).json({ error: 'Трип не найден' });
    }

    const legs = await TripLeg.getByTripId(tripId);
    trip.legs = legs.map(leg => ({
      ...leg,
      origin_city: airportResolver.getCityName(leg.origin),
      destination_city: airportResolver.getCityName(leg.destination)
    }));

    const results = await TripResult.getTopResults(tripId, 5);
    trip.results = results;

    res.json(trip);
  } catch (error) {
    console.error('Ошибка загрузки трипа:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Пауза/возобновление трипа
app.patch('/admin/api/trips/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);
    const { is_paused } = req.body;

    await Trip.updatePauseStatus(tripId, is_paused);

    console.log(`[ADMIN] Трип ${tripId} ${is_paused ? 'приостановлен' : 'возобновлен'}`);

    res.json({ success: true, tripId, is_paused });
  } catch (error) {
    console.error('Ошибка изменения статуса трипа:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Удаление трипа
app.delete('/admin/api/trips/:id', requireAdmin, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id);

    await Trip.delete(tripId);

    console.log(`[ADMIN] Удален трип: ${tripId}`);

    res.json({ success: true, message: `Трип ${tripId} удален` });
  } catch (error) {
    console.error('Ошибка удаления трипа:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Очистка ошибок
app.delete('/admin/api/failed-checks', requireAdmin, async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      db.run('DELETE FROM combination_check_results WHERE status IN ("error", "not_found")', function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });

    console.log(`[ADMIN] Очищено записей об ошибках: ${result}`);

    res.json({
      success: true,
      deleted: result
    });
  } catch (error) {
    console.error('Ошибка очистки ошибок:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Сохранение настроек
app.post('/admin/api/settings', requireAdmin, async (req, res) => {
  try {
    const { intervalFree, intervalPlus, intervalAdmin } = req.body;

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`UPDATE subscription_types SET check_interval_hours = ? WHERE name = 'free'`, [intervalFree]);
        db.run(`UPDATE subscription_types SET check_interval_hours = ? WHERE name = 'plus'`, [intervalPlus]);
        db.run(`UPDATE subscription_types SET check_interval_hours = ? WHERE name = 'admin'`, [intervalAdmin], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    console.log(`[ADMIN] Настройки обновлены: Free=${intervalFree}h, Plus=${intervalPlus}h, Admin=${intervalAdmin}h`);

    res.json({
      success: true,
      message: 'Настройки сохранены'
    });
  } catch (error) {
    console.error('Ошибка сохранения настроек:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Экспорт данных
app.get('/admin/api/export/:type', requireAdmin, async (req, res) => {
  try {
    const type = req.params.type;
    let query = '';
    let filename = `export_${type}_${Date.now()}.csv`;

    switch(type) {
      case 'users':
        query = `SELECT us.*, COUNT(ur.id) as routes FROM user_settings us
                                                            LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
                 GROUP BY us.chat_id`;
        break;
      case 'routes':
        query = 'SELECT * FROM unified_routes ORDER BY created_at DESC';
        break;
      case 'checks':
        query = `SELECT cs.*, r.origin, r.destination FROM route_check_stats cs
                                                             JOIN unified_routes r ON cs.route_id = r.id
                 ORDER BY cs.check_timestamp DESC LIMIT 1000`;
        break;
      case 'all':
        const allData = {};
        const tables = ['unified_routes', 'user_settings', 'route_check_stats', 'price_analytics'];

        for (const table of tables) {
          allData[table] = await new Promise((resolve) => {
            db.all(`SELECT * FROM ${table}`, (err, rows) => {
              resolve(rows || []);
            });
          });
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=full_export_${Date.now()}.json`);
        return res.json(allData);
      default:
        return res.status(400).json({ error: 'Неизвестный тип экспорта' });
    }

    const rows = await new Promise((resolve, reject) => {
      db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Нет данных для экспорта' });
    }

    const keys = Object.keys(rows[0]);
    let csv = keys.join(',') + '\n';

    rows.forEach(row => {
      csv += keys.map(key => {
        const value = row[key];
        if (value === null) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send('\ufeff' + csv);
  } catch (error) {
    console.error('Ошибка экспорта:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Список пользователей
app.get('/admin/api/users', requireAdmin, async (req, res) => {
  try {
    const users = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          us.chat_id,
          us.timezone,
          us.notifications_enabled,
          us.night_mode,
          us.created_at,
          COUNT(DISTINCT ur.id) as totalroutes,
          MAX(ur.last_check) as lastactivity
        FROM user_settings us
               LEFT JOIN unified_routes ur ON us.chat_id = ur.chat_id
        GROUP BY us.chat_id, us.timezone, us.notifications_enabled, us.night_mode, us.created_at
        ORDER BY lastactivity DESC NULLS LAST
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(users);
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Список маршрутов
app.get('/admin/api/routes', requireAdmin, async (req, res) => {
  try {
    const routes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          u.id,
          u.chat_id,
          u.origin,
          u.destination,
          u.departure_date,
          u.return_date,
          u.is_flexible,
          u.flex_days_before,
          u.flex_days_after,
          u.passengers_adults,
          u.passengers_children,
          u.passengers_infants,
          u.preferred_airline,
          u.baggage,
          u.max_connections,
          u.threshold_price,
          u.is_paused,
          u.last_check,
          u.created_at,
          (SELECT COUNT(*) FROM route_results WHERE route_id = u.id) as checkcount
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
    console.error('Ошибка загрузки маршрутов:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Статистика проверок
app.get('/admin/api/check-stats', requireAdmin, async (req, res) => {
  try {
    const stats = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          cs.id,
          cs.route_id,
          cs.successful_checks,
          cs.failed_checks,
          cs.check_timestamp,
          (r.origin || ' → ' || r.destination) as routename,
          r.chat_id as chatid
        FROM route_check_stats cs
               JOIN unified_routes r ON cs.route_id = r.id
        ORDER BY cs.check_timestamp DESC
          LIMIT 100
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(stats);
  } catch (error) {
    console.error('Ошибка загрузки статистики:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Список ошибок
app.get('/admin/api/failed-checks', requireAdmin, async (req, res) => {
  try {
    const failed = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          ccr.id,
          ccr.route_id,
          ccr.status,
          ccr.error_message,
          ccr.check_timestamp,
          (r.origin || ' → ' || r.destination) as routename,
          r.chat_id as chatid
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
    console.error('Ошибка загрузки ошибок:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ДОПОЛНИТЕЛЬНЫЕ API ENDPOINTS ДЛЯ АДМИНКИ
// Добавить в server.js после существующих endpoints
// ============================================

// ============================================
// USER MANAGEMENT API
// ============================================

// API: Обновление настроек пользователя
app.put('/admin/api/users/:chatId', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);
    const { timezone, notifications_enabled, night_mode } = req.body;

    // Проверяем существование пользователя
    const userExists = await new Promise((resolve, reject) => {
      db.get('SELECT chat_id FROM user_settings WHERE chat_id = ?', [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });

    if (!userExists) {
      // Создаем пользователя если не существует
      await new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO user_settings (chat_id, timezone, notifications_enabled, night_mode)
                     VALUES (?, ?, ?, ?)`,
            [chatId, timezone, notifications_enabled, night_mode],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
        );
      });
    } else {
      // Обновляем существующего
      await new Promise((resolve, reject) => {
        db.run(
            `UPDATE user_settings
                     SET timezone = ?, notifications_enabled = ?, night_mode = ?
                     WHERE chat_id = ?`,
            [timezone, notifications_enabled, night_mode, chatId],
            function(err) {
              if (err) reject(err);
              else resolve();
            }
        );
      });
    }

    console.log(`[ADMIN] Updated user ${chatId} settings`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Удаление пользователя и всех его данных
app.delete('/admin/api/users/:chatId', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    await new Promise((resolve, reject) => {
      db.serialize(() => {
        // Удаляем все связанные данные
        db.run('DELETE FROM route_results WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [chatId]);
        db.run('DELETE FROM combination_check_results WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [chatId]);
        db.run('DELETE FROM route_check_stats WHERE route_id IN (SELECT id FROM unified_routes WHERE chat_id = ?)', [chatId]);
        db.run('DELETE FROM price_analytics WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM unified_routes WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_subscriptions WHERE chat_id = ?', [chatId]);
        db.run('DELETE FROM user_settings WHERE chat_id = ?', [chatId], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    console.log(`[ADMIN] Deleted user ${chatId} and all related data`);
    res.json({ success: true, message: 'User and all related data deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Получить детальную статистику пользователя
app.get('/admin/api/users/:chatId/stats', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    // Получаем настройки пользователя
    const settings = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM user_settings WHERE chat_id = ?', [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });

    // Получаем подписку
    const subscription = await new Promise((resolve, reject) => {
      db.get('SELECT subscription_type FROM user_subscriptions WHERE chat_id = ? AND is_active = 1', [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Статистика маршрутов
    const routeStats = await new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as total_routes,
          SUM(CASE WHEN is_paused = 0 THEN 1 ELSE 0 END) as active_routes,
          SUM(CASE WHEN is_flexible = 1 THEN 1 ELSE 0 END) as flexible_routes
        FROM unified_routes
        WHERE chat_id = ?
      `, [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });

    // Количество полученных уведомлений
    const notificationsReceived = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM notification_log WHERE chat_id = ?', [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.count : 0);
      });
    });

    res.json({
      // Подписка
      subscription_type: subscription ? subscription.subscription_type : 'free',
      // Настройки пользователя
      timezone: settings.timezone || 'Europe/Moscow',
      notifications_enabled: settings.notifications_enabled !== 0,
      night_mode: !!settings.night_mode,
      created_at: settings.created_at,
      // Статистика маршрутов
      total_routes: routeStats.total_routes || 0,
      active_routes: routeStats.active_routes || 0,
      flexible_routes: routeStats.flexible_routes || 0,
      // Уведомления
      notifications_received: notificationsReceived
    });
  } catch (error) {
    console.error('Ошибка получения статистики пользователя:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Получить маршруты пользователя
app.get('/admin/api/users/:chatId/routes', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    const routes = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          u.*,
          (SELECT COUNT(*) FROM route_results WHERE route_id = u.id) as check_count
        FROM unified_routes u
        WHERE u.chat_id = ?
        ORDER BY u.created_at DESC
      `, [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    routes.forEach(r => {
      r.origin_city = airportResolver.getCityName(r.origin);
      r.destination_city = airportResolver.getCityName(r.destination);
    });

    res.json(routes);
  } catch (error) {
    console.error('Ошибка получения маршрутов пользователя:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Получить уведомления пользователя
app.get('/admin/api/users/:chatId/notifications', requireAdmin, async (req, res) => {
  try {
    const chatId = parseInt(req.params.chatId);

    const notifications = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          nl.*,
          COALESCE(
            (SELECT origin || ' → ' || destination FROM unified_routes WHERE id = nl.route_id),
            'N/A'
          ) as routename
        FROM notification_log nl
        WHERE nl.chat_id = ?
        ORDER BY nl.sent_at DESC
        LIMIT 50
      `, [chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(notifications);
  } catch (error) {
    console.error('Ошибка получения уведомлений пользователя:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTES MANAGEMENT API
// ============================================

// API: Создание нового маршрута
app.post('/admin/api/routes', requireAdmin, async (req, res) => {
  try {
    const routeData = req.body;

    // Валидация обязательных полей
    if (!routeData.chat_id || !routeData.origin || !routeData.destination) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await UnifiedRoute.create(routeData.chat_id, routeData);

    console.log(`[ADMIN] Created route #${result.id} for user ${routeData.chat_id}`);
    res.json({ success: true, id: result.id });
  } catch (error) {
    console.error('Error creating route:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Обновление маршрута
app.get('/admin/api/routes/:id', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);

    const route = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM unified_routes WHERE id = ?', [routeId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!route) {
      return res.status(404).json({ error: 'Маршрут не найден' });
    }

    res.json(route);
  } catch (error) {
    console.error('Ошибка получения маршрута:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Получить билеты для конкретного маршрута
app.get('/admin/api/routes/:id/tickets', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);

    const results = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          id,
          route_id,
          departure_date,
          return_date,
          days_in_country,
          total_price,
          airline,
          search_link,
          screenshot_path,
          found_at
        FROM route_results
        WHERE route_id = ?
        ORDER BY total_price ASC, found_at DESC
          LIMIT 10
      `, [routeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(results);
  } catch (error) {
    console.error('Ошибка получения билетов:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Статистика проверок для конкретного маршрута
app.get('/admin/api/routes/:id/check-stats', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);

    // Сводка
    const summary = await new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as total_checks,
          SUM(successful_checks) as total_success,
          SUM(failed_checks) as total_failed,
          AVG(CAST(successful_checks AS REAL) / NULLIF(total_combinations, 0) * 100) as avg_success_rate,
          MAX(check_timestamp) as last_check_time
        FROM route_check_stats
        WHERE route_id = ?
      `, [routeId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });

    // Последние 20 проверок
    const recent = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          id,
          total_combinations,
          successful_checks,
          failed_checks,
          check_timestamp
        FROM route_check_stats
        WHERE route_id = ?
        ORDER BY check_timestamp DESC
        LIMIT 20
      `, [routeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({ summary, recent });
  } catch (error) {
    console.error('Ошибка получения статистики проверок:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Детали конкретной проверки (combination_check_results)
app.get('/admin/api/check-stats/:id/details', requireAdmin, async (req, res) => {
  try {
    const checkStatId = parseInt(req.params.id);

    // Получаем запись check_stats для определения route_id и времени
    const checkStat = await new Promise((resolve, reject) => {
      db.get(`
        SELECT cs.*, (r.origin || ' → ' || r.destination) as routename, r.chat_id
        FROM route_check_stats cs
        JOIN unified_routes r ON cs.route_id = r.id
        WHERE cs.id = ?
      `, [checkStatId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!checkStat) {
      return res.status(404).json({ error: 'Check stat not found' });
    }

    // Получаем детальные результаты комбинаций за это время проверки
    const details = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          id, route_id, departure_date, return_date, days_in_country,
          status, price, currency, error_reason, search_url, check_timestamp
        FROM combination_check_results
        WHERE route_id = ? AND check_timestamp = ?
        ORDER BY status ASC, price ASC
      `, [checkStat.route_id, checkStat.check_timestamp], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({ checkStat, details });
  } catch (error) {
    console.error('Ошибка получения деталей проверки:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Уведомления для конкретного маршрута
app.get('/admin/api/routes/:id/notifications', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);

    const notifications = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          id,
          chat_id,
          priority,
          price,
          message_type,
          sent_at,
          disable_notification
        FROM notification_log
        WHERE route_id = ?
        ORDER BY sent_at DESC
        LIMIT 30
      `, [routeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(notifications);
  } catch (error) {
    console.error('Ошибка получения уведомлений маршрута:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: История цен для конкретного маршрута
app.get('/admin/api/routes/:id/price-history', requireAdmin, async (req, res) => {
  try {
    const routeId = parseInt(req.params.id);

    // Сводка из price_analytics
    const summary = await new Promise((resolve, reject) => {
      db.get(`
        SELECT
          MIN(price) as min_price,
          AVG(price) as avg_price,
          MAX(price) as max_price,
          COUNT(*) as data_points
        FROM price_analytics
        WHERE route_id = ?
          AND found_at >= datetime('now', '-30 days')
      `, [routeId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });

    // Тренд по дням за 30 дней
    const trend = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          DATE(found_at) as date,
          MIN(price) as min_price,
          AVG(price) as avg_price,
          COUNT(*) as count
        FROM price_analytics
        WHERE route_id = ?
          AND found_at >= datetime('now', '-30 days')
        GROUP BY DATE(found_at)
        ORDER BY date DESC
      `, [routeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({ summary, trend });
  } catch (error) {
    console.error('Ошибка получения истории цен:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SUBSCRIPTIONS API
// ============================================

// API: Получить все подписки
app.get('/admin/api/subscriptions', requireAdmin, async (req, res) => {
  try {
    const subscriptions = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          us.*,
          u.timezone,
          u.created_at as user_created_at
        FROM user_subscriptions us
               LEFT JOIN user_settings u ON us.chat_id = u.chat_id
        ORDER BY us.created_at DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(subscriptions);
  } catch (error) {
    console.error('Ошибка загрузки подписок:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Создать новую подписку
app.post('/admin/api/subscriptions', requireAdmin, async (req, res) => {
  try {
    const { chat_id, subscription_type, duration_months } = req.body;

    if (!chat_id || !subscription_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validFrom = new Date();
    let validTo = null;

    // Для Plus подписки устанавливаем срок действия
    if (subscription_type === 'plus') {
      validTo = new Date();
      validTo.setMonth(validTo.getMonth() + (duration_months || 1));
    }

    // Деактивируем старые подписки пользователя
    await new Promise((resolve, reject) => {
      db.run(
          'UPDATE user_subscriptions SET is_active = 0 WHERE chat_id = ?',
          [chat_id],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
      );
    });

    // Создаем новую подписку
    const result = await new Promise((resolve, reject) => {
      db.run(
          `INSERT INTO user_subscriptions 
                 (chat_id, subscription_type, valid_from, valid_to, is_active)
                 VALUES (?, ?, ?, ?, 1)`,
          [chat_id, subscription_type, validFrom.toISOString(), validTo ? validTo.toISOString() : null],
          function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
          }
      );
    });

    console.log(`[ADMIN] Created subscription #${result.id} for user ${chat_id}`);
    res.json({ success: true, id: result.id });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Обновить подписку
app.put('/admin/api/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const { subscription_type, is_active, extend_months } = req.body;

    // Получаем текущую подписку
    const current = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM user_subscriptions WHERE id = ?', [subId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!current) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    let newValidTo = current.valid_to;

    // Продлеваем подписку если запрошено
    if (extend_months && extend_months > 0) {
      const baseDate = current.valid_to ? new Date(current.valid_to) : new Date();
      const extended = new Date(baseDate);
      extended.setMonth(extended.getMonth() + extend_months);
      newValidTo = extended.toISOString();
    }

    // Обновляем подписку
    await new Promise((resolve, reject) => {
      db.run(
          `UPDATE user_subscriptions 
                 SET subscription_type = ?, is_active = ?, valid_to = ?
                 WHERE id = ?`,
          [subscription_type, is_active, newValidTo, subId],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
      );
    });

    console.log(`[ADMIN] Updated subscription #${subId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Удалить подписку
app.delete('/admin/api/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);

    await new Promise((resolve, reject) => {
      db.run('DELETE FROM user_subscriptions WHERE id = ?', [subId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`[ADMIN] Deleted subscription #${subId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SUBSCRIPTION TYPES API
// ============================================

// API: Получить все типы подписок
app.get('/admin/api/subscription-types', requireAdmin, async (req, res) => {
  try {
    const types = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM subscription_types ORDER BY id`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json(types);
  } catch (error) {
    console.error('Error loading subscription types:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Обновить тип подписки
app.put('/admin/api/subscription-types/:id', requireAdmin, async (req, res) => {
  try {
    const typeId = parseInt(req.params.id);
    const { max_fixed_routes, max_flexible_routes, max_combinations, check_interval_hours, price_per_month } = req.body;

    // Получаем текущий тип
    const current = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM subscription_types WHERE id = ?', [typeId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!current) {
      return res.status(404).json({ error: 'Subscription type not found' });
    }

    // Обновляем тип подписки
    await new Promise((resolve, reject) => {
      db.run(
          `UPDATE subscription_types
           SET max_fixed_routes = ?,
               max_flexible_routes = ?,
               max_combinations = ?,
               check_interval_hours = ?,
               price_per_month = ?
           WHERE id = ?`,
          [
            max_fixed_routes ?? current.max_fixed_routes,
            max_flexible_routes ?? current.max_flexible_routes,
            max_combinations ?? current.max_combinations,
            check_interval_hours ?? current.check_interval_hours,
            price_per_month ?? current.price_per_month,
            typeId
          ],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
      );
    });

    console.log(`[ADMIN] Updated subscription type #${typeId} (${current.name})`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating subscription type:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ANALYTICS ENHANCEMENTS
// ============================================

// API: Расширенная аналитика (улучшенная версия)
app.get('/admin/api/analytics', requireAdmin, async (req, res) => {
  try {
    console.log('📊 Admin API: Getting analytics...');

    // 1. Общая статистика
    const generalStats = await new Promise((resolve) => {
      db.get(`
        SELECT 
          (SELECT COUNT(*) FROM unified_routes) as total_routes,
          (SELECT COUNT(*) FROM unified_routes WHERE is_paused = 0) as active_routes,
          (SELECT COUNT(*) FROM unified_routes WHERE is_flexible = 0) as fixed_routes,
          (SELECT COUNT(*) FROM unified_routes WHERE is_flexible = 1) as flexible_routes,
          (SELECT COUNT(DISTINCT chat_id) FROM unified_routes) as total_users,
          (SELECT COUNT(*) FROM route_results) as total_results,
          (SELECT COUNT(*) FROM route_check_stats) as total_checks
      `, (err, row) => {
        if (err) {
          console.error('❌ Error generalStats:', err);
          resolve({});
        } else {
          resolve(row || {});
        }
      });
    });

    // 2. Топ пользователей по количеству маршрутов
    const topUsers = await new Promise((resolve) => {
      db.all(`
        SELECT 
          ur.chat_id,
          COUNT(*) as route_count,
          COUNT(CASE WHEN ur.is_paused = 0 THEN 1 END) as active_count,
          COUNT(CASE WHEN ur.is_flexible = 1 THEN 1 END) as flexible_count,
          MIN(ur.created_at) as first_route_date,
          MAX(ur.last_check) as last_check_date,
          COALESCE(us.subscription_type, 'free') as subscription_type
        FROM unified_routes ur
        LEFT JOIN user_subscriptions us ON ur.chat_id = us.chat_id
        GROUP BY ur.chat_id
        ORDER BY route_count DESC
        LIMIT 15
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error topUsers:', err);
          resolve([]);
        } else {
          console.log('✅ topUsers:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 3. Топ маршруты (по количеству создания)
    const topRoutes = await new Promise((resolve) => {
      db.all(`
        SELECT 
          origin,
          destination,
          COUNT(*) as count,
          AVG(threshold_price) as avg_threshold,
          MIN(threshold_price) as min_threshold,
          MAX(threshold_price) as max_threshold,
          COUNT(CASE WHEN is_paused = 0 THEN 1 END) as active_count
        FROM unified_routes
        GROUP BY origin, destination
        ORDER BY count DESC
        LIMIT 15
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error topRoutes:', err);
          resolve([]);
        } else {
          console.log('✅ topRoutes:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 4. Топ направления (по destination)
    const topDestinations = await new Promise((resolve) => {
      db.all(`
        SELECT 
          destination,
          COUNT(*) as count,
          COUNT(DISTINCT chat_id) as unique_users,
          AVG(threshold_price) as avg_threshold
        FROM unified_routes
        GROUP BY destination
        ORDER BY count DESC
        LIMIT 15
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error topDestinations:', err);
          resolve([]);
        } else {
          console.log('✅ topDestinations:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 5. Топ точки отправления (по origin)
    const topOrigins = await new Promise((resolve) => {
      db.all(`
        SELECT 
          origin,
          COUNT(*) as count,
          COUNT(DISTINCT chat_id) as unique_users
        FROM unified_routes
        GROUP BY origin
        ORDER BY count DESC
        LIMIT 15
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error topOrigins:', err);
          resolve([]);
        } else {
          console.log('✅ topOrigins:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 6. Распределение цен
    const priceDistribution = await new Promise((resolve) => {
      db.all(`
        SELECT
          CASE 
            WHEN threshold_price < 5000 THEN '< 5000'
            WHEN threshold_price < 10000 THEN '5000-10000'
            WHEN threshold_price < 20000 THEN '10000-20000'
            WHEN threshold_price < 50000 THEN '20000-50000'
            ELSE '> 50000'
          END as range,
          COUNT(*) as count
        FROM unified_routes
        WHERE threshold_price IS NOT NULL
        GROUP BY range
        ORDER BY 
          CASE range
            WHEN '< 5000' THEN 1
            WHEN '5000-10000' THEN 2
            WHEN '10000-20000' THEN 3
            WHEN '20000-50000' THEN 4
            ELSE 5
          END
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error priceDistribution:', err);
          resolve([]);
        } else {
          console.log('✅ priceDistribution:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 7. Статистика по часам (последние 7 дней)
    const hourlyStats = await new Promise((resolve) => {
      db.all(`
        SELECT
          CAST(strftime('%H', check_timestamp) AS INTEGER) as hour,
          COUNT(*) as checks,
          AVG(successful_checks) as avg_success,
          AVG(failed_checks) as avg_failed
        FROM route_check_stats
        WHERE check_timestamp >= datetime('now', '-7 days')
        GROUP BY hour
        ORDER BY hour
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error hourlyStats:', err);
          resolve([]);
        } else {
          console.log('✅ hourlyStats:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 8. Статистика по дням недели
    const weekdayStats = await new Promise((resolve) => {
      db.all(`
        SELECT
          CAST(strftime('%w', check_timestamp) AS INTEGER) as weekday,
          COUNT(*) as checks,
          SUM(total_combinations) as total_combinations,
          SUM(successful_checks) as successful_checks
        FROM route_check_stats
        WHERE check_timestamp >= datetime('now', '-30 days')
        GROUP BY weekday
        ORDER BY weekday
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error weekdayStats:', err);
          resolve([]);
        } else {
          console.log('✅ weekdayStats:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 9. Средние цены по маршрутам (из price_analytics)
    const avgPrices = await new Promise((resolve) => {
      db.all(`
        SELECT
          origin,
          destination,
          AVG(price) as average_price,
          MIN(price) as min_price,
          MAX(price) as max_price,
          COUNT(*) as price_count
        FROM price_analytics
        WHERE found_at >= datetime('now', '-30 days')
        GROUP BY origin, destination
        HAVING price_count >= 5
        ORDER BY average_price DESC
        LIMIT 15
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error avgPrices:', err);
          resolve([]);
        } else {
          console.log('✅ avgPrices:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 10. Динамика создания маршрутов (по дням за последний месяц)
    const routeCreationTrend = await new Promise((resolve) => {
      db.all(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count,
          COUNT(CASE WHEN is_flexible = 1 THEN 1 END) as flexible_count
        FROM unified_routes
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error routeCreationTrend:', err);
          resolve([]);
        } else {
          console.log('✅ routeCreationTrend:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 11. Успешность проверок (последние 100 проверок)
    const checkSuccessRate = await new Promise((resolve) => {
      db.get(`
        SELECT
          COUNT(*) as total_checks,
          SUM(successful_checks) as total_success,
          SUM(failed_checks) as total_failed,
          SUM(total_combinations) as total_combinations,
          AVG(CAST(successful_checks AS REAL) / NULLIF(total_combinations, 0) * 100) as success_rate
        FROM route_check_stats
        WHERE check_timestamp >= datetime('now', '-7 days')
      `, (err, row) => {
        if (err) {
          console.error('❌ Error checkSuccessRate:', err);
          resolve({});
        } else {
          console.log('✅ checkSuccessRate:', row);
          resolve(row || {});
        }
      });
    });

    // 12. Статистика по авиакомпаниям
    const airlineStats = await new Promise((resolve) => {
      db.all(`
        SELECT
          airline,
          COUNT(*) as count
        FROM unified_routes
        WHERE airline IS NOT NULL AND airline != 'any'
        GROUP BY airline
        ORDER BY count DESC
        LIMIT 10
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error airlineStats:', err);
          resolve([]);
        } else {
          console.log('✅ airlineStats:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 13. Статистика по подпискам
    const subscriptionStats = await new Promise((resolve) => {
      db.all(`
        SELECT
          COALESCE(us.subscription_type, 'free') as subscription_type,
          COUNT(DISTINCT ur.chat_id) as user_count,
          COUNT(ur.id) as route_count,
          AVG(ur.threshold_price) as avg_threshold
        FROM unified_routes ur
        LEFT JOIN user_subscriptions us ON ur.chat_id = us.chat_id
        GROUP BY subscription_type
        ORDER BY user_count DESC
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error subscriptionStats:', err);
          resolve([]);
        } else {
          console.log('✅ subscriptionStats:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 14. Лучшие найденные предложения за последние 7 дней
    // Сравниваем с средней ценой по направлению, берем только уникальные маршруты
    const bestDeals = await new Promise((resolve) => {
      db.all(`
        WITH avg_prices AS (
          SELECT
            ur.origin,
            ur.destination,
            AVG(rr.total_price) as avg_price
          FROM route_results rr
          JOIN unified_routes ur ON rr.route_id = ur.id
          GROUP BY ur.origin, ur.destination
        ),
        best_per_route AS (
          SELECT
            rr.id,
            rr.route_id,
            ur.origin,
            ur.destination,
            rr.departure_date,
            rr.return_date,
            rr.total_price,
            ap.avg_price,
            (ap.avg_price - rr.total_price) as savings,
            rr.airline,
            rr.found_at,
            ROW_NUMBER() OVER (PARTITION BY ur.origin, ur.destination ORDER BY (ap.avg_price - rr.total_price) DESC) as rn
          FROM route_results rr
          JOIN unified_routes ur ON rr.route_id = ur.id
          JOIN avg_prices ap ON ur.origin = ap.origin AND ur.destination = ap.destination
          WHERE rr.found_at >= datetime('now', '-7 days')
            AND rr.total_price < ap.avg_price
        )
        SELECT
          id,
          route_id,
          origin,
          destination,
          departure_date,
          return_date,
          total_price,
          avg_price,
          savings,
          airline,
          found_at
        FROM best_per_route
        WHERE rn = 1
        ORDER BY savings DESC
        LIMIT 20
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error bestDeals:', err);
          resolve([]);
        } else {
          console.log('✅ bestDeals:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    // 15. Активность по месяцам (история создания маршрутов)
    const monthlyActivity = await new Promise((resolve) => {
      db.all(`
        SELECT
          strftime('%Y-%m', created_at) as month,
          COUNT(*) as route_count,
          COUNT(DISTINCT chat_id) as user_count
        FROM unified_routes
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
      `, (err, rows) => {
        if (err) {
          console.error('❌ Error monthlyActivity:', err);
          resolve([]);
        } else {
          console.log('✅ monthlyActivity:', rows ? rows.length : 0);
          resolve(rows || []);
        }
      });
    });

    console.log('✅ Analytics complete');

    // Добавляем названия городов в аналитику
    topRoutes.forEach(r => {
      r.origin_city = airportResolver.getCityName(r.origin);
      r.destination_city = airportResolver.getCityName(r.destination);
    });
    topDestinations.forEach(r => {
      r.destination_city = airportResolver.getCityName(r.destination);
    });
    topOrigins.forEach(r => {
      r.origin_city = airportResolver.getCityName(r.origin);
    });
    avgPrices.forEach(r => {
      r.origin_city = airportResolver.getCityName(r.origin);
      r.destination_city = airportResolver.getCityName(r.destination);
    });
    bestDeals.forEach(r => {
      r.origin_city = airportResolver.getCityName(r.origin);
      r.destination_city = airportResolver.getCityName(r.destination);
    });

    res.json({
      success: true,
      generalStats,
      topUsers,
      topRoutes,
      topDestinations,
      topOrigins,
      priceDistribution,
      hourlyStats,
      weekdayStats,
      avgPrices,
      routeCreationTrend,
      checkSuccessRate,
      airlineStats,
      subscriptionStats,
      bestDeals,
      monthlyActivity
    });
  } catch (error) {
    console.error('❌ Error loading analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DATABASE API (для новой админки)
// ============================================

// API: Информация о БД
app.get('/admin/api/database/info', requireAdmin, async (req, res) => {
  try {
    const tables = await new Promise((resolve, reject) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const tableInfo = await Promise.all(tables.map(async (table) => {
      const count = await new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM ${table.name}`, (err, row) => {
          resolve(row ? row.count : 0);
        });
      });
      return { name: table.name, count: count };
    }));

    const totalRecords = tableInfo.reduce((sum, t) => sum + t.count, 0);

    res.json({
      tables: tableInfo,
      totalRecords: totalRecords
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Данные таблицы
app.get('/admin/api/database/table/:tableName', requireAdmin, async (req, res) => {
  try {
    const tableName = req.params.tableName;
    const limit = parseInt(req.query.limit) || 50;

    // Проверка допустимого имени таблицы
    const validTables = await new Promise((resolve) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        resolve(rows ? rows.map(r => r.name) : []);
      });
    });

    if (!validTables.includes(tableName)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    const rows = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM ${tableName} LIMIT ?`, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const total = await new Promise((resolve) => {
      db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
        resolve(row ? row.count : 0);
      });
    });

    res.json({ rows, total, showing: rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: SQL запрос
app.post('/admin/api/database/query', requireAdmin, async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim().toLowerCase().startsWith('select')) {
      return res.status(400).json({ error: 'Only SELECT queries allowed' });
    }

    const results = await new Promise((resolve, reject) => {
      db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.json({ results, count: results.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Бэкап БД
app.post('/admin/api/database/backup', requireAdmin, async (req, res) => {
  try {
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../backups');

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const dbPath = path.join(__dirname, '../aviasales.db');
    const backupPath = path.join(backupDir, `backup_${timestamp}.db`);

    fs.copyFileSync(dbPath, backupPath);

    console.log(`[ADMIN] Backup created: ${backupPath}`);
    res.json({ success: true, filename: `backup_${timestamp}.db` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: VACUUM
app.post('/admin/api/database/vacuum', requireAdmin, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('VACUUM', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('[ADMIN] VACUUM completed');
    res.json({ success: true, message: 'Database optimized' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Экспорт данных
app.get('/admin/api/export/:type', requireAdmin, async (req, res) => {
  try {
    const type = req.params.type;
    let query = '';

    switch(type) {
      case 'users':
        query = 'SELECT * FROM user_settings';
        break;
      case 'routes':
        query = 'SELECT * FROM unified_routes ORDER BY created_at DESC';
        break;
      case 'results':
        query = 'SELECT * FROM route_results ORDER BY found_at DESC LIMIT 1000';
        break;
      default:
        return res.status(400).json({ error: 'Unknown export type' });
    }

    const rows = await new Promise((resolve, reject) => {
      db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No data to export' });
    }

    // Create CSV
    const keys = Object.keys(rows[0]);
    let csv = keys.join(',') + '\n';

    rows.forEach(row => {
      csv += keys.map(key => {
        const value = row[key];
        if (value === null) return '';
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=export_${type}_${Date.now()}.csv`);
    res.send('\ufeff' + csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================
// NOTIFICATION LOG API
// ============================================

// API: Лог уведомлений
app.get('/admin/api/notifications', requireAdmin, async (req, res) => {
  try {
    const notifications = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          nl.id,
          nl.chat_id,
          nl.route_id,
          nl.priority,
          nl.price,
          nl.message_type,
          nl.sent_at,
          nl.disable_notification,
          (r.origin || ' → ' || r.destination) as routename
        FROM notification_log nl
        LEFT JOIN unified_routes r ON nl.route_id = r.id
        ORDER BY nl.sent_at DESC
        LIMIT 200
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    resolveRoutenames(notifications);
    res.json(notifications);
  } catch (error) {
    console.error('Ошибка загрузки лога уведомлений:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DIGEST QUEUE API
// ============================================

// ============================================
// DIGEST QUEUE API (REMOVED)
// Дайджесты удалены из системы уведомлений
// ============================================

// API: Очередь дайджеста (УДАЛЕНО)
// app.get('/admin/api/digest-queue', requireAdmin, async (req, res) => {
//   try {
//     const queue = await new Promise((resolve, reject) => {
//       db.all(`
//         SELECT
//           dq.id,
//           dq.chat_id,
//           dq.route_id,
//           dq.priority,
//           dq.price,
//           dq.avg_price,
//           dq.historical_min,
//           dq.created_at,
//           dq.processed,
//           (r.origin || ' → ' || r.destination) as routename
//         FROM daily_digest_queue dq
//         LEFT JOIN unified_routes r ON dq.route_id = r.id
//         ORDER BY dq.created_at DESC
//         LIMIT 200
//       `, (err, rows) => {
//         if (err) reject(err);
//         else resolve(rows || []);
//       });
//     });
//
//     resolveRoutenames(queue);
//     res.json(queue);
//   } catch (error) {
//     console.error('Ошибка загрузки очереди дайджеста:', error);
//     res.status(500).json({ error: error.message });
//   }
// });
//
// // API: Удаление элемента из очереди дайджеста (УДАЛЕНО)
// app.delete('/admin/api/digest-queue/:id', requireAdmin, async (req, res) => {
//   try {
//     const id = parseInt(req.params.id);
//
//     await new Promise((resolve, reject) => {
//       db.run('DELETE FROM daily_digest_queue WHERE id = ?', [id], function(err) {
//         if (err) reject(err);
//         else resolve();
//       });
//     });
//
//     console.log(`[ADMIN] Deleted digest queue item ${id}`);
//     res.json({ success: true });
//   } catch (error) {
//     console.error('Ошибка удаления из очереди дайджеста:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

console.log('✅ All admin API endpoints loaded');

// ============================================
// YOOKASSA WEBHOOK
// ============================================

app.post('/webhook/yookassa', async (req, res) => {
    console.log('📥 YooKassa webhook received');

    try {
        const notification = req.body;

        // Логируем для отладки
        console.log('   Event:', notification.event);
        console.log('   Object ID:', notification.object?.id);

        // Проверяем тип события
        if (notification.event === 'payment.succeeded') {
            const paymentData = notification.object;

            // Верифицируем платеж через API ЮКассы
            console.log(`🔍 Верификация платежа ${paymentData.id}...`);

            let verifiedPayment;
            try {
                verifiedPayment = await YooKassaService.getPayment(paymentData.id);
            } catch (verifyError) {
                console.error('❌ Ошибка верификации платежа:', verifyError.message);
                // Даже если верификация не удалась, возвращаем 200, чтобы ЮКасса не повторяла запрос
                return res.status(200).json({ status: 'verification_failed' });
            }

            // Проверяем статус платежа
            if (verifiedPayment.status !== 'succeeded') {
                console.warn(`⚠️ Платеж ${paymentData.id} не в статусе succeeded: ${verifiedPayment.status}`);
                return res.status(200).json({ status: 'ignored' });
            }

            // Обрабатываем платеж БЕЗ botInstance (он запущен в отдельном процессе)
            // Активируем подписку напрямую через SubscriptionService
            const SubscriptionService = require('../services/SubscriptionService');

            const chatId = parseInt(verifiedPayment.metadata?.chat_id);
            const yookassaPaymentId = verifiedPayment.id;

            if (!chatId) {
                console.error('❌ chat_id не найден в metadata');
                return res.status(200).json({ status: 'missing_chat_id' });
            }

            // Обновляем статус платежа в БД
            await new Promise((resolve, reject) => {
                db.run(`
                    UPDATE payments
                    SET status = 'completed',
                        webhook_received_at = datetime('now'),
                        completed_at = datetime('now')
                    WHERE yookassa_payment_id = ?
                `, [yookassaPaymentId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Активируем подписку
            await SubscriptionService.updateSubscription(chatId, 'plus');

            console.log(`✅ Подписка активирована для пользователя ${chatId}, платеж ${yookassaPaymentId}`);
            console.log(`   ℹ️ Уведомление пользователю будет отправлено ботом автоматически`);

            res.status(200).json({ status: 'ok', chat_id: chatId });

        } else if (notification.event === 'payment.canceled') {
            // Платеж отменен - можно логировать, но активных действий не требуется
            console.log(`📛 Платеж отменен: ${notification.object?.id}`);
            res.status(200).json({ status: 'canceled_acknowledged' });

        } else {
            // Неизвестное событие
            console.log(`❓ Неизвестное событие: ${notification.event}`);
            res.status(200).json({ status: 'unknown_event' });
        }

    } catch (error) {
        console.error('❌ Ошибка обработки YooKassa webhook:', error);
        // Всегда возвращаем 200, чтобы ЮКасса не повторяла запрос
        res.status(200).json({ status: 'error', message: error.message });
    }
});

console.log('✅ YooKassa webhook endpoint registered: POST /webhook/yookassa');

// ===== КОНЕЦ API ENDPOINTS =====

// Запуск сервера с инициализацией
(async () => {
  try {
    await airportResolver.load();
    console.log('✅ AirportResolver loaded');
  } catch (err) {
    console.error('⚠️ AirportResolver load failed:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`🌐 Web-интерфейс запущен: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard?chat_id=YOUR_CHAT_ID`);
    console.log(`🔐 Admin панель: http://localhost:${PORT}/admin`);
    console.log(`🔑 Пароль админки: ${ADMIN_PASSWORD}`);
  });
})();

// Экспорт
module.exports = app;