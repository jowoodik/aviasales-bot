const db = require('../config/database');

class ActivityService {
  /**
   * Записать событие активности пользователя
   * @param {number} chatId - ID чата пользователя
   * @param {string} eventType - Тип события
   * @param {object} eventData - Дополнительные данные (опционально)
   */
  static logEvent(chatId, eventType, eventData = null) {
    return new Promise((resolve, reject) => {
      const dataStr = eventData ? JSON.stringify(eventData) : null;
      db.run(
        `INSERT INTO user_activity_log (chat_id, event_type, event_data) VALUES (?, ?, ?)`,
        [chatId, eventType, dataStr],
        function(err) {
          if (err) {
            console.error('ActivityService: ошибка записи события:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  /**
   * Получить DAU - уникальные пользователи за последние 24 часа
   */
  static getDAU() {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(DISTINCT chat_id) as count
         FROM user_activity_log
         WHERE created_at >= datetime('now', '-1 day')`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        }
      );
    });
  }

  /**
   * Получить WAU - уникальные пользователи за последние 7 дней
   */
  static getWAU() {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(DISTINCT chat_id) as count
         FROM user_activity_log
         WHERE created_at >= datetime('now', '-7 days')`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        }
      );
    });
  }

  /**
   * Получить MAU - уникальные пользователи за последние 30 дней
   */
  static getMAU() {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(DISTINCT chat_id) as count
         FROM user_activity_log
         WHERE created_at >= datetime('now', '-30 days')`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.count || 0);
        }
      );
    });
  }

  /**
   * Получить воронку создания маршрутов за период
   * @param {string} period - '1d', '7d', '30d'
   */
  static getRoutesFunnel(period = '30d') {
    const days = period === '1d' ? 1 : period === '7d' ? 7 : 30;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        const funnel = {};
        let completed = 0;
        const totalQueries = 4;

        const checkComplete = () => {
          completed++;
          if (completed === totalQueries) {
            resolve(funnel);
          }
        };

        // Активные пользователи (любое действие)
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.active_users = row?.count || 0;
            checkComplete();
          }
        );

        // Просмотрели маршруты
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'view_routes'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.viewed_routes = row?.count || 0;
            checkComplete();
          }
        );

        // Начали создание маршрута
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'create_route_start'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.started_creation = row?.count || 0;
            checkComplete();
          }
        );

        // Завершили создание маршрута
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'route_created'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.completed_creation = row?.count || 0;
            checkComplete();
          }
        );
      });
    });
  }

  /**
   * Получить воронку подписки за период
   * @param {string} period - '1d', '7d', '30d'
   */
  static getSubscriptionFunnel(period = '30d') {
    const days = period === '1d' ? 1 : period === '7d' ? 7 : 30;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        const funnel = {};
        let completed = 0;
        const totalQueries = 2;

        const checkComplete = () => {
          completed++;
          if (completed === totalQueries) {
            resolve(funnel);
          }
        };

        // Просмотрели подписку
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'subscription_info'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.viewed_subscription = row?.count || 0;
            checkComplete();
          }
        );

        // Попытка апгрейда
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'upgrade_attempt'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.upgrade_attempts = row?.count || 0;
            checkComplete();
          }
        );
      });
    });
  }

  /**
   * Получить историю DAU за последние N дней
   * @param {number} days - количество дней
   */
  static getDAUHistory(days = 30) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT
           date(created_at) as date,
           COUNT(DISTINCT chat_id) as users
         FROM user_activity_log
         WHERE created_at >= datetime('now', '-${days} days')
         GROUP BY date(created_at)
         ORDER BY date ASC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Получить все метрики активности
   */
  static async getAllMetrics() {
    const [dau, wau, mau, routesFunnel, subscriptionFunnel, dauHistory] = await Promise.all([
      this.getDAU(),
      this.getWAU(),
      this.getMAU(),
      this.getRoutesFunnel('30d'),
      this.getSubscriptionFunnel('30d'),
      this.getDAUHistory(30)
    ]);

    return {
      userActivity: { dau, wau, mau },
      funnels: {
        routes: routesFunnel,
        subscription: subscriptionFunnel
      },
      dauHistory
    };
  }
}

module.exports = ActivityService;
