module.exports = {
    apps: [{
        name: 'avia-bot',
        script: './index.js',
        node_args: ['--expose-gc'],  // ← ВОТ ЗДЕСЬ!
        instances: 1,
        autorestart: true,
        max_memory_restart: '3G',
    }]
};
