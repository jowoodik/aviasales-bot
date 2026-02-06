module.exports = {
    apps: [
        // 1. Основной Telegram бот
        {
            name: 'flyalert-bot',
            script: './index.js',
            node_args: ['--expose-gc'],
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production'
            },
            env_file: './.env', // Подключаем .env файл
            error_file: './logs/bot-error.log',
            out_file: './logs/bot-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000
        },

        // 2. Планировщик проверок маршрутов
        {
            name: 'flyalert-scheduler',
            script: './scheduler.js',
            node_args: ['--expose-gc'],
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production'
            },
            env_file: './.env', // Подключаем .env файл
            error_file: './logs/scheduler-error.log',
            out_file: './logs/scheduler-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000
        },

        // 3. Планировщик массовой рассылки (новое)
        {
            name: 'flyalert-broadcast',
            script: './broadcast-scheduler.js',
            node_args: ['--expose-gc'],
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '300M',
            env: {
                NODE_ENV: 'production'
            },
            env_file: './.env', // Подключаем .env файл
            error_file: './logs/broadcast-error.log',
            out_file: './logs/broadcast-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000
        },

        // 4. Веб-админка
        {
            name: 'flyalert-web',
            script: './web/server.js',
            node_args: ['--expose-gc'],
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production'
            },
            env_file: './.env', // Подключаем .env файл
            error_file: './logs/bot-web-error.log',
            out_file: './logs/bot-web-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000
        }
    ]
};