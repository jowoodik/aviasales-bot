module.exports = {
    apps: [
        {
            name: 'aviasales-bot',
            script: './index.js',
            node_args: ['--expose-gc'],  // ← ВОТ ЗДЕСЬ!
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './logs/bot-error.log',
            out_file: './logs/bot-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000
        },
        {
            name: 'aviasales-scheduler',
            script: './scheduler.js',
            node_args: ['--expose-gc'],  // ← ВОТ ЗДЕСЬ!
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './logs/scheduler-error.log',
            out_file: './logs/scheduler-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            kill_timeout: 5000
        }
    ]
};
