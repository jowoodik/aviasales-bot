const db = require('../config/database');

class BroadcastService {
    /**
     * Получить все неотправленные сообщения для рассылки
     */
    static async getPendingBroadcasts() {
        return new Promise((resolve, reject) => {
            db.all(
                'SELECT * FROM broadcast_messages WHERE is_sent = 0 ORDER BY created_at ASC',
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    /**
     * Получить пользователей для конкретной рассылки с учетом их локального времени
     * @param {Object} broadcast - Объект рассылки из БД
     * @returns {Array} - Массив chat_id пользователей, которым нужно отправить сообщение
     */
    static async getUsersToNotify(broadcast) {
        const { id: broadcastId, target_users, scheduled_time } = broadcast;

        // Парсим время отправки (формат HH:MM)
        const [scheduledHour, scheduledMinute] = scheduled_time.split(':').map(Number);

        return new Promise((resolve, reject) => {
            // Формируем WHERE условие для выборки пользователей
            let targetCondition = '1=1'; // по умолчанию все
            let params = [];

            if (target_users !== 'all') {
                try {
                    const usersList = JSON.parse(target_users);
                    if (usersList.length > 0) {
                        const placeholders = usersList.map(() => '?').join(',');
                        targetCondition = `us.chat_id IN (${placeholders})`;
                        params = usersList;
                    }
                } catch (e) {
                    console.error('Ошибка парсинга target_users:', e);
                    return resolve([]);
                }
            }

            // Получаем пользователей с timezone
            db.all(
                `
        SELECT us.chat_id, us.timezone
        FROM user_settings us
        WHERE ${targetCondition}
        AND us.chat_id NOT IN (
          SELECT chat_id FROM broadcast_log WHERE broadcast_id = ?
        )
        ORDER BY us.chat_id
        `,
                [...params, broadcastId],
                (err, users) => {
                    if (err) {
                        return reject(err);
                    }

                    if (!users || users.length === 0) {
                        return resolve([]);
                    }

                    // Фильтруем пользователей по локальному времени
                    const usersToNotify = users.filter((user) => {
                        try {
                            const timezone = user.timezone || 'Asia/Yekaterinburg';
                            const now = new Date();

                            // Получаем текущее время и минуты в timezone пользователя
                            const userLocalTime = new Intl.DateTimeFormat('en-US', {
                                timeZone: timezone,
                                hour: 'numeric',
                                minute: 'numeric',
                                hour12: false,
                            }).format(now);

                            const [currentHour, currentMinute] = userLocalTime.split(':').map(Number);

                            // Проверяем: достигло ли локальное время пользователя времени отправки
                            // Отправляем если время >= scheduled_time
                            if (
                                currentHour > scheduledHour ||
                                (currentHour === scheduledHour && currentMinute >= scheduledMinute)
                            ) {
                                return true;
                            }

                            return false;
                        } catch (e) {
                            console.error(`Ошибка проверки времени для пользователя ${user.chat_id}:`, e);
                            return false;
                        }
                    });

                    resolve(usersToNotify.map((u) => u.chat_id));
                }
            );
        });
    }

    /**
     * Записать лог отправки пользователю
     */
    static async logBroadcastSent(broadcastId, chatId, status) {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT OR IGNORE INTO broadcast_log (broadcast_id, chat_id, status) VALUES (?, ?, ?)',
                [broadcastId, chatId, status],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Проверить, отправлено ли сообщение всем пользователям
     * Если да, пометить рассылку как завершенную
     */
    static async checkAndMarkComplete(broadcastId) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // Получаем информацию о рассылке
                db.get(
                    'SELECT target_users FROM broadcast_messages WHERE id = ?',
                    [broadcastId],
                    (err, broadcast) => {
                        if (err || !broadcast) {
                            return reject(err || new Error('Broadcast not found'));
                        }

                        // Определяем сколько всего должно быть получателей
                        let totalUsersQuery;
                        let params;

                        if (broadcast.target_users === 'all') {
                            totalUsersQuery = 'SELECT COUNT(DISTINCT chat_id) as total FROM user_settings';
                            params = [];
                        } else {
                            try {
                                const usersList = JSON.parse(broadcast.target_users);
                                totalUsersQuery = `SELECT COUNT(*) as total FROM (${usersList.map(() => 'SELECT 1').join(' UNION ALL ')})`;
                                params = [];
                            } catch (e) {
                                console.error('Ошибка парсинга target_users при проверке завершения:', e);
                                return resolve(false);
                            }
                        }

                        db.get(totalUsersQuery, params, (err, totalRow) => {
                            if (err) {
                                return reject(err);
                            }

                            const totalUsers = totalRow.total;

                            // Получаем количество отправленных
                            db.get(
                                'SELECT COUNT(DISTINCT chat_id) as sent FROM broadcast_log WHERE broadcast_id = ?',
                                [broadcastId],
                                (err, sentRow) => {
                                    if (err) {
                                        return reject(err);
                                    }

                                    const sentCount = sentRow.sent;

                                    console.log(
                                        `📊 Рассылка #${broadcastId}: отправлено ${sentCount}/${totalUsers} пользователям`
                                    );

                                    // Если всем отправлено, помечаем как завершенную
                                    if (sentCount >= totalUsers && totalUsers > 0) {
                                        db.run(
                                            'UPDATE broadcast_messages SET is_sent = 1, sent_at = datetime("now") WHERE id = ?',
                                            [broadcastId],
                                            (err) => {
                                                if (err) {
                                                    console.error('Ошибка пометки рассылки как завершенной:', err);
                                                    return reject(err);
                                                }
                                                console.log(`✅ Рассылка #${broadcastId} завершена`);
                                                resolve(true);
                                            }
                                        );
                                    } else {
                                        resolve(false);
                                    }
                                }
                            );
                        });
                    }
                );
            });
        });
    }

    /**
     * Получить общую статистику рассылки
     */
    static async getBroadcastStats(broadcastId) {
        return new Promise((resolve, reject) => {
            db.get(
                `
        SELECT 
          bm.*,
          COUNT(DISTINCT bl.chat_id) as sent_count
        FROM broadcast_messages bm
        LEFT JOIN broadcast_log bl ON bm.id = bl.broadcast_id
        WHERE bm.id = ?
        GROUP BY bm.id
        `,
                [broadcastId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }
}

module.exports = BroadcastService;
