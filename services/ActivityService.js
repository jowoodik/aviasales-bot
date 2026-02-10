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
        const totalQueries = 13;

        const checkComplete = () => {
          completed++;
          if (completed === totalQueries) {
            resolve(funnel);
          }
        };

        // Начали создание маршрута (базовый уровень)
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'create_route_start'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.started_creation = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали аэропорты
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_airports'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_airports = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали тип поиска (фиксированные/гибкие)
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_search_type'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_search_type = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали тип билета (туда-обратно/в одну сторону)
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_has_return'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_has_return = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали даты
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_dates'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_dates = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали авиакомпанию
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_airline'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_airline = row?.count || 0;
            checkComplete();
          }
        );

        // Указали взрослых
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_adults'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_adults = row?.count || 0;
            checkComplete();
          }
        );

        // Указали детей
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_children'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_children = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали багаж
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_baggage'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_baggage = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали пересадки
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_max_stops'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_max_stops = row?.count || 0;
            checkComplete();
          }
        );

        // Выбрали время пересадки (только если есть пересадки)
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_max_layover'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_max_layover = row?.count || 0;
            checkComplete();
          }
        );

        // Указали бюджет
        db.get(
          `SELECT COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'route_step_budget'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.selected_budget = row?.count || 0;
            checkComplete();
          }
        );

        // Завершили создание маршрута
        db.get(
          `SELECT COUNT(*) as count
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
   * Получить детальную воронку оплаты с метриками времени и drop-off
   * @param {string} period - '1d', '7d', '30d'
   */
  static getPaymentFunnelDetailed(period = '30d') {
    const days = period === '1d' ? 1 : period === '7d' ? 7 : 30;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        const funnel = {};
        let completed = 0;
        const totalQueries = 8;

        const checkComplete = () => {
          completed++;
          if (completed === totalQueries) {
            resolve(funnel);
          }
        };

        // 1. Просмотрели информацию о подписке
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

        // 2. Попытка апгрейда (нажали на кнопку)
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

        // 3. Создана ссылка на оплату
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'payment_link_created'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.payment_link_created = row?.count || 0;
            checkComplete();
          }
        );

        // 4. Открыли помощь по оплате
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'payment_help_viewed'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.payment_help_viewed = row?.count || 0;
            checkComplete();
          }
        );

        // 5. Успешная оплата
        db.get(
          `SELECT COUNT(DISTINCT chat_id) as count
           FROM user_activity_log
           WHERE event_type = 'payment_success'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.payment_success = row?.count || 0;
            checkComplete();
          }
        );

        // 6. Общая сумма оплат
        db.get(
          `SELECT
             SUM(CAST(json_extract(event_data, '$.amount') AS REAL)) as total_amount,
             COUNT(*) as payment_count
           FROM user_activity_log
           WHERE event_type = 'payment_success'
             AND created_at >= datetime('now', '-${days} days')`,
          (err, row) => {
            funnel.total_revenue = row?.total_amount || 0;
            funnel.payment_count = row?.payment_count || 0;
            checkComplete();
          }
        );

        // 7. Средние времена между шагами
        db.all(
          `WITH steps AS (
             SELECT
               chat_id,
               event_type,
               created_at,
               LAG(created_at) OVER (PARTITION BY chat_id ORDER BY created_at) as prev_time,
               LAG(event_type) OVER (PARTITION BY chat_id ORDER BY created_at) as prev_event
             FROM user_activity_log
             WHERE event_type IN ('subscription_info', 'upgrade_attempt', 'payment_link_created', 'payment_success')
               AND created_at >= datetime('now', '-${days} days')
           )
           SELECT
             prev_event || '_to_' || event_type as transition,
             AVG((julianday(created_at) - julianday(prev_time)) * 24 * 60) as avg_minutes,
             COUNT(*) as count
           FROM steps
           WHERE prev_event IS NOT NULL
           GROUP BY prev_event, event_type`,
          (err, rows) => {
            funnel.time_metrics = rows || [];
            checkComplete();
          }
        );

        // 8. Методы оплаты
        db.all(
          `SELECT
             json_extract(event_data, '$.payment_method') as payment_method,
             COUNT(*) as count
           FROM user_activity_log
           WHERE event_type = 'payment_success'
             AND created_at >= datetime('now', '-${days} days')
             AND event_data IS NOT NULL
           GROUP BY payment_method`,
          (err, rows) => {
            funnel.payment_methods = rows || [];
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
