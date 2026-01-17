const db = require('../config/database');

class PriceAnalytics {
  static async savePrice(data) {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const dayOfMonth = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0;

    let season;
    if (month >= 3 && month <= 5) season = 'spring';
    else if (month >= 6 && month <= 8) season = 'summer';
    else if (month >= 9 && month <= 11) season = 'autumn';
    else season = 'winter';

    // 🔥 Передаем route_id если есть
    return new Promise((resolve, reject) => {
      db.run(`
          INSERT INTO price_analytics
          (route_id, route_type, origin, destination, price, airline, hour_of_day, day_of_week,
           day_of_month, month, year, is_weekend, season, chat_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data.routeId || null,  // 🔥 route_id
        data.routeType,
        data.origin,
        data.destination,
        data.price,
        data.airline,
        hour,
        dayOfWeek,
        dayOfMonth,
        month,
        year,
        isWeekend,
        season,
        data.chatId
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  static async getRegularRoutePriceHistory(routeId, chatId, days = 30) {
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              price,
              airline,
              found_at,
              search_link
          FROM best_prices
          WHERE route_id = ?
          ORDER BY found_at DESC
              LIMIT 20
      `, [routeId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static async getFlexibleRoutePriceHistory(routeId, days = 30) {
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              DATE(found_at) as date,
              MIN(total_price) as min_price,
              AVG(total_price) as avg_price,
              MAX(total_price) as max_price,
              COUNT(*) as checks_count
          FROM flexible_results
          WHERE route_id = ?
            AND found_at >= datetime('now', '-' || ? || ' days')
          GROUP BY DATE(found_at)
          ORDER BY date DESC
      `, [routeId, days], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static async getFlexibleRouteDetailedHistory(routeId, limit = 20) {
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              total_price,
              airline,
              departure_date,
              return_date,
              days_in_country,
              found_at,
              search_link
          FROM flexible_results
          WHERE route_id = ?
          ORDER BY found_at DESC
              LIMIT ?
      `, [routeId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // 🔥 Статистика по конкретному ROUTE_ID (новый метод)
  static async getRouteStatsById(routeId, chatId) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as total_checks,
          MIN(price) as min_price,
          AVG(price) as avg_price,
          MAX(price) as max_price
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ?
      `, [routeId, chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });
  }

  // 🔥 Анализ по часам для конкретного route_id
  static async analyzeByHourForRoute(routeId, chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT
          hour_of_day,
          COUNT(*) as count,
          AVG(price) as avg_price,
          MIN(price) as min_price,
          MAX(price) as max_price
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ?
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `, [routeId, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // 🔥 Анализ по дням недели для route_id
  static async analyzeByDayOfWeekForRoute(routeId, chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT
          day_of_week,
          is_weekend,
          COUNT(*) as count,
          AVG(price) as avg_price,
          MIN(price) as min_price,
          MAX(price) as max_price
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ?
        GROUP BY day_of_week
        ORDER BY day_of_week
      `, [routeId, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // 🔥 Анализ по дням месяца для route_id
  static async analyzeByDayOfMonthForRoute(routeId, chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT
          day_of_month,
          COUNT(*) as count,
          AVG(price) as avg_price,
          MIN(price) as min_price
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ?
        GROUP BY day_of_month
        ORDER BY day_of_month
      `, [routeId, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // 🔥 Fallback-методы по origin/destination (для старых данных)
  static async getRouteStats(origin, destination, chatId) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as total_checks,
          MIN(price) as min_price,
          AVG(price) as avg_price,
          MAX(price) as max_price
        FROM price_analytics
        WHERE origin = ? AND destination = ? AND chat_id = ?
      `, [origin, destination, chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });
  }

  // 🔥 Общая статистика пользователя
  static async getUserStats(chatId) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT
          COUNT(*) as total_prices,
          MIN(price) as best_price,
          AVG(price) as avg_price,
          MAX(price) as worst_price,
          MIN(found_at) as first_check,
          MAX(found_at) as last_check
        FROM price_analytics
        WHERE chat_id = ?
      `, [chatId], (err, row) => {
        if (err) reject(err);
        else resolve(row || {});
      });
    });
  }

  // 🔥 Тренд цен по route_id
  static async getPriceTrend(routeId, days = 30) {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT
          DATE(found_at) as date,
          AVG(price) as avg_price,
          MIN(price) as min_price,
          MAX(price) as max_price,
          COUNT(*) as checks
        FROM price_analytics
        WHERE route_id = ?
        AND found_at >= datetime('now', '-' || ? || ' days')
        GROUP BY DATE(found_at)
        ORDER BY date ASC
      `, [routeId, days], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // 🔥 Старые методы для совместимости (fallback)
  static async analyzeByHour(chatId = null) {
    const whereClause = chatId ? `WHERE chat_id = ${chatId}` : '';
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT
          hour_of_day,
          COUNT(*) as count,
          AVG(price) as avg_price,
          MIN(price) as min_price
        FROM price_analytics
        ${whereClause}
        GROUP BY hour_of_day
        ORDER BY hour_of_day
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // 🔥 Топ дней по минимальным/максимальным ценам
  static async getDailyPriceStats(routeId, chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
      SELECT 
        day_of_month, month,
        MIN(price) as min_price,
        AVG(price) as avg_price,
        MAX(price) as max_price,
        COUNT(*) as checks
      FROM price_analytics
      WHERE route_id = ? AND chat_id = ?
      GROUP BY day_of_month, month
      HAVING checks >= 3  -- Минимум 3 проверки в день
      ORDER BY min_price ASC  -- Для minDays
      LIMIT 5
    `, [routeId, chatId], (err, minDays) => {
        if (err) {
          reject(err);
          return;
        }

        // 🔥 Максимальные цены (отдельно)
        db.all(`
        SELECT 
          day_of_month, month,
          MIN(price) as min_price,
          AVG(price) as avg_price,
          MAX(price) as max_price,
          COUNT(*) as checks
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ?
        GROUP BY day_of_month, month
        HAVING checks >= 3
        ORDER BY max_price DESC
        LIMIT 5
      `, [routeId, chatId], (err, maxDays) => {
          if (err) reject(err);
          else resolve({ minDays, maxDays });
        });
      });
    });
  }
}

module.exports = PriceAnalytics;
