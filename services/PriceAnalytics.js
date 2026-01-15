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

    return new Promise((resolve, reject) => {
      db.run(`
                INSERT INTO price_analytics
                (route_type, origin, destination, price, airline, hour_of_day, day_of_week,
                 day_of_month, month, year, is_weekend, season, chat_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
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

  // Статистика по конкретному маршруту
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

  // Анализ по времени суток для конкретного маршрута
  static async analyzeByHourForRoute(origin, destination, chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              hour_of_day,
              COUNT(*) as count,
                    AVG(price) as avg_price,
                    MIN(price) as min_price
          FROM price_analytics
          WHERE origin = ? AND destination = ? AND chat_id = ?
          GROUP BY hour_of_day
          ORDER BY hour_of_day
      `, [origin, destination, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // Анализ по дням недели для конкретного маршрута
  static async analyzeByDayOfWeekForRoute(origin, destination, chatId) {
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              day_of_week,
              is_weekend,
              COUNT(*) as count,
                    AVG(price) as avg_price,
                    MIN(price) as min_price
          FROM price_analytics
          WHERE origin = ? AND destination = ? AND chat_id = ?
          GROUP BY day_of_week
          ORDER BY day_of_week
      `, [origin, destination, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static async analyzeByHour(chatId = null) {
    const whereClause = chatId ? `WHERE chat_id = ${chatId}` : '';
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              hour_of_day,
              COUNT(*) as count,
                    AVG(price) as avg_price,
                    MIN(price) as min_price,
                    MAX(price) as max_price
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

  static async analyzeByDayOfWeek(chatId = null) {
    const whereClause = chatId ? `WHERE chat_id = ${chatId}` : '';
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
              ${whereClause}
          GROUP BY day_of_week
          ORDER BY day_of_week
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static async compareWeekdaysVsWeekends(chatId = null) {
    const whereClause = chatId ? `WHERE chat_id = ${chatId}` : '';
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              CASE WHEN is_weekend = 1 THEN 'Выходные' ELSE 'Будни' END as period,
              COUNT(*) as count,
                    AVG(price) as avg_price,
                    MIN(price) as min_price
          FROM price_analytics
              ${whereClause}
          GROUP BY is_weekend
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static async getPriceTrend(origin, destination, days = 30) {
    return new Promise((resolve, reject) => {
      db.all(`
          SELECT
              DATE(found_at) as date,
              AVG(price) as avg_price,
              MIN(price) as min_price,
              MAX(price) as max_price,
              COUNT(*) as checks
          FROM price_analytics
          WHERE origin = ?
            AND destination = ?
            AND found_at >= datetime('now', '-' || ? || ' days')
          GROUP BY DATE(found_at)
          ORDER BY date ASC
      `, [origin, destination, days], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

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
}

module.exports = PriceAnalytics;
