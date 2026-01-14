#!/bin/bash

echo "🔍 ДИАГНОСТИКА БЛОКИРОВОК AVIASALES"
echo "===================================="
echo ""

# 1. Проверяем последние логи
echo "📋 ПОСЛЕДНИЕ ОШИБКИ В ЛОГАХ:"
echo "----------------------------"
if command -v pm2 &> /dev/null; then
    pm2 logs aviasales-bot --lines 50 --nostream | grep -i "error\|403\|timeout\|blocked" | tail -20
else
    echo "⚠️  PM2 не установлен, проверьте логи вручную"
fi
echo ""

# 2. Проверяем скриншоты ошибок
echo "📸 СКРИНШОТЫ ОШИБОК (последние 5):"
echo "-----------------------------------"
if [ -d "temp" ]; then
    ls -lht temp/error_*.png 2>/dev/null | head -5 || echo "✅ Скриншотов ошибок не найдено"
else
    echo "⚠️  Папка temp/ не найдена"
fi
echo ""

# 3. Проверяем размер базы данных
echo "💾 СТАТУС БАЗЫ ДАННЫХ:"
echo "----------------------"
if [ -f "data/bot.db" ]; then
    ls -lh data/bot.db
    echo ""
    echo "Количество записей:"
    sqlite3 data/bot.db "SELECT 
        (SELECT COUNT(*) FROM routes) as routes,
        (SELECT COUNT(*) FROM flexible_routes) as flexible,
        (SELECT COUNT(*) FROM flexible_results) as results,
        (SELECT COUNT(*) FROM price_analytics) as analytics;"
else
    echo "⚠️  База данных не найдена"
fi
echo ""

# 4. Проверяем последние успешные проверки
echo "✅ ПОСЛЕДНИЕ УСПЕШНЫЕ ПРОВЕРКИ:"
echo "--------------------------------"
if [ -d "temp" ]; then
    echo "Успешные скриншоты (последние 3):"
    ls -lht temp/success_*.png 2>/dev/null | head -3 || echo "❌ Нет успешных проверок"
else
    echo "⚠️  Папка temp/ не найдена"
fi
echo ""

# 5. Тест прямого запроса к Aviasales
echo "🌐 ТЕСТ ДОСТУПНОСТИ AVIASALES:"
echo "-------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" "https://www.aviasales.ru/")
echo "HTTP Status: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Aviasales доступен"
elif [ "$HTTP_CODE" = "403" ]; then
    echo "❌ ЗАБЛОКИРОВАН! (HTTP 403)"
elif [ "$HTTP_CODE" = "429" ]; then
    echo "❌ TOO MANY REQUESTS! (HTTP 429)"
else
    echo "⚠️  Неожиданный код: $HTTP_CODE"
fi
echo ""

# 6. Рекомендации
echo "💡 РЕКОМЕНДАЦИИ:"
echo "----------------"
echo "1. Посмотрите скриншоты ошибок: open temp/error_*.png"
echo "2. Если видите капчу/блокировку - увеличьте паузы в PuppeteerPricer.js"
echo "3. Попробуйте через прокси или с другого IP"
echo "4. Сделайте паузу 1-2 часа перед следующей проверкой"
echo ""
echo "🔧 Для детальных логов: pm2 logs aviasales-bot --lines 100"
