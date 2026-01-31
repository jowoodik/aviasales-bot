// web/public/js/config.js

export const CONFIG = {
    // API Base URL
    API_BASE: '/admin/api',

    // API Endpoints
    API: {
        // Users
        USERS: '/users',
        USER_DETAIL: (chatId) => `/users/${chatId}`,
        USER_STATS: (chatId) => `/users/${chatId}/stats`,

        // Routes
        ROUTES: '/routes',
        ROUTE_DETAIL: (id) => `/routes/${id}`,
        ROUTE_PAUSE: (id) => `/routes/${id}/pause`,
        ROUTE_THRESHOLD: (id) => `/routes/${id}/threshold`,

        // Subscriptions
        SUBSCRIPTIONS: '/subscriptions',
        SUBSCRIPTION_DETAIL: (id) => `/subscriptions/${id}`,

        // Statistics
        CHECK_STATS: '/check-stats',
        FAILED_CHECKS: '/failed-checks',
        ANALYTICS: '/analytics',

        // Database
        DATABASE_INFO: '/database-info',
        BACKUP: '/backup',
        VACUUM: '/vacuum',
        CLEANUP: '/cleanup',
        TABLE_DATA: (tableName) => `/table/${tableName}`,
        SQL_QUERY: '/sql-query',

        // Export
        EXPORT: (type) => `/export/${type}`,
    },

    // Pagination
    PAGINATION: {
        DEFAULT_PAGE_SIZE: 20,
        PAGE_SIZE_OPTIONS: [10, 20, 50, 100]
    },

    // Table configurations
    TABLES: {
        USERS: {
            columns: [
                { key: 'chat_id', label: 'Chat ID', sortable: true, type: 'code' },
                { key: 'totalroutes', label: 'Маршруты', sortable: true, type: 'badge' },
                { key: 'timezone', label: 'Таймзона', sortable: true },
                { key: 'quiet_hours_start', label: 'Тихие часы', sortable: false, type: 'quiet-hours' },
                { key: 'lastactivity', label: 'Последняя активность', sortable: true, type: 'datetime' },
                { key: 'created_at', label: 'Создан', sortable: true, type: 'date' }
            ],
            actions: ['view', 'edit', 'delete']
        },
        ROUTES: {
            columns: [
                { key: 'id', label: 'ID', sortable: true },
                { key: 'chat_id', label: 'Chat ID', sortable: true, type: 'code' },
                { key: 'route', label: 'Маршрут', sortable: false, type: 'route' },
                { key: 'is_flexible', label: 'Тип', sortable: true, type: 'route-type' },
                { key: 'dates', label: 'Даты', sortable: false, type: 'dates' },
                { key: 'threshold_price', label: 'Порог', sortable: true, type: 'price' },
                { key: 'is_paused', label: 'Статус', sortable: true, type: 'status' },
                { key: 'created_at', label: 'Создан', sortable: true, type: 'date' }
            ],
            actions: ['view', 'edit', 'pause', 'delete']
        },
        CHECK_STATS: {
            columns: [
                { key: 'routename', label: 'Маршрут', sortable: false },
                { key: 'chatid', label: 'Chat ID', sortable: true, type: 'code' },
                { key: 'successful_checks', label: 'Успешных', sortable: true, type: 'badge-success' },
                { key: 'failed_checks', label: 'Неудачных', sortable: true, type: 'badge-danger' },
                { key: 'check_timestamp', label: 'Время', sortable: true, type: 'datetime' }
            ],
            actions: ['view']
        },
        FAILED_CHECKS: {
            columns: [
                { key: 'routename', label: 'Маршрут', sortable: false },
                { key: 'chatid', label: 'Chat ID', sortable: true, type: 'code' },
                { key: 'status', label: 'Статус', sortable: true, type: 'error-status' },
                { key: 'error_message', label: 'Ошибка', sortable: false },
                { key: 'check_timestamp', label: 'Время', sortable: true, type: 'datetime' }
            ],
            actions: ['view', 'delete']
        }
    },

    // Route types
    ROUTE_TYPES: {
        FIXED: 0,
        FLEXIBLE: 1
    },

    // Subscription types
    SUBSCRIPTION_TYPES: {
        FREE: 'free',
        PLUS: 'plus',
        ADMIN: 'admin'
    },

    // Status badges
    STATUS: {
        ACTIVE: { label: 'Активен', class: 'success' },
        PAUSED: { label: 'Пауза', class: 'secondary' },
        ERROR: { label: 'Ошибка', class: 'danger' },
        NOT_FOUND: { label: 'Не найден', class: 'warning' }
    },

    // Chart colors
    CHART_COLORS: {
        PRIMARY: '#2563eb',
        SUCCESS: '#10b981',
        DANGER: '#ef4444',
        WARNING: '#f59e0b',
        INFO: '#06b6d4',
        PURPLE: '#8b5cf6',
        PINK: '#ec4899'
    },

    // Toast notifications duration
    TOAST_DURATION: 3000,

    // Timezones (popular)
    TIMEZONES: [
        'Europe/Moscow',
        'Asia/Yekaterinburg',
        'Asia/Novosibirsk',
        'Asia/Krasnoyarsk',
        'Asia/Irkutsk',
        'Asia/Yakutsk',
        'Asia/Vladivostok',
        'Asia/Magadan',
        'Asia/Kamchatka'
    ],

    // Currencies
    CURRENCIES: ['RUB', 'USD', 'EUR', 'KZT'],

    // Airlines (popular)
    AIRLINES: [
        { code: 'any', name: 'Любая' },
        { code: 'SU', name: 'Аэрофлот' },
        { code: 'S7', name: 'S7 Airlines' },
        { code: 'UT', name: 'UTair' },
        { code: 'FV', name: 'Россия' },
        { code: 'U6', name: 'Уральские авиалинии' },
        { code: 'N4', name: 'Nordwind' },
        { code: 'DP', name: 'Победа' }
    ]
};

export default CONFIG;
