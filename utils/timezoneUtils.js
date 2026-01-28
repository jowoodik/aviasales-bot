class TimezoneUtils {
    /**
     * Получить текущее время в указанной таймзоне
     */
    static getCurrentTimeInTimezone(timezone) {
        try {
            const now = new Date();
            const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
            const offset = tzDate.getTime() - utcDate.getTime();

            return new Date(now.getTime() + offset);
        } catch (error) {
            console.error('Ошибка получения времени в таймзоне:', error);
            return new Date();
        }
    }

    /**
     * Форматировать дату для отображения пользователю
     */
    static async formatDateForUser(utcDateString, chatId) {
        try {
            const db = require('../config/database');

            // Получаем таймзону пользователя
            const timezone = await new Promise((resolve, reject) => {
                db.get(
                    'SELECT timezone FROM user_settings WHERE chat_id = ?',
                    [chatId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row?.timezone || 'Asia/Yekaterinburg');
                    }
                );
            });

            // Парсим UTC дату
            const utcDate = new Date(utcDateString + (utcDateString.includes('Z') ? '' : 'Z'));

            // Форматируем в таймзоне пользователя
            const options = {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: timezone,
                hour12: false
            };

            return utcDate.toLocaleString('ru-RU', options);

        } catch (error) {
            console.error('Ошибка форматирования даты:', error);
            return utcDateString;
        }
    }

    /**
     * Проверка валидности таймзоны
     */
    static isValidTimezone(timezone) {
        try {
            new Date().toLocaleString('en-US', { timeZone: timezone });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Получить offset таймзоны
     */
    static getTimezoneOffset(timezone) {
        try {
            const now = new Date();
            const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
            const offsetMs = tzDate.getTime() - utcDate.getTime();
            const offsetHours = Math.round(offsetMs / (1000 * 60 * 60));
            return offsetHours;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Список популярных таймзон
     */
    static getTimezoneList() {
        return [
            { name: 'Europe/Kaliningrad', offset: '+2' },
            { name: 'Europe/Moscow', offset: '+3' },
            { name: 'Europe/Samara', offset: '+4' },
            { name: 'Asia/Yekaterinburg', offset: '+5' },
            { name: 'Asia/Omsk', offset: '+6' },
            { name: 'Asia/Novosibirsk', offset: '+7' },
            { name: 'Asia/Krasnoyarsk', offset: '+7' },
            { name: 'Asia/Irkutsk', offset: '+8' },
            { name: 'Asia/Yakutsk', offset: '+9' },
            { name: 'Asia/Vladivostok', offset: '+10' },
            { name: 'Asia/Magadan', offset: '+11' },
            { name: 'Asia/Kamchatka', offset: '+12' }
        ];
    }
}

module.exports = TimezoneUtils;
