# Запуск
pm2 start index.js --name aviasales-bot

# Статус (видно всё: CPU, память, время работы, перезапуски)
pm2 status

# Логи в реальном времени
pm2 logs aviasales-bot

# Последние 50 строк логов
pm2 logs aviasales-bot --lines 50

# Только ошибки
pm2 logs aviasales-bot --err

# Перезапуск (применить изменения в коде)
pm2 restart aviasales-bot

# Остановка
pm2 stop aviasales-bot

# Удалить из PM2
pm2 delete aviasales-bot

# Мониторинг (красивая дашборд в терминале)
pm2 monit

# Автозапуск при перезагрузке
pm2 startup
pm2 save
