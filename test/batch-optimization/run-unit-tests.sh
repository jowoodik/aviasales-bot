#!/bin/bash

# Скрипт для быстрого запуска unit-тестов batch-оптимизации
# Эти тесты быстрые и не выполняют реальные API запросы

echo "=========================================="
echo "🧪 Запуск unit-тестов batch-оптимизации"
echo "=========================================="
echo ""

# Цвета для вывода
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

FAILED=0

# Тест 1: prepareBatchItem
echo "📋 Тест 1: prepareBatchItem()..."
node test/batch-optimization/01-unit-prepareBatchItem.test.js
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Тест 1 пройден${NC}"
else
    echo -e "${RED}❌ Тест 1 провален${NC}"
    FAILED=1
fi
echo ""

# Тест 2: processBatchResults
echo "📋 Тест 2: processBatchResults()..."
node test/batch-optimization/02-unit-processBatchResults.test.js
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Тест 2 пройден${NC}"
else
    echo -e "${RED}❌ Тест 2 провален${NC}"
    FAILED=1
fi
echo ""

# Итоговый результат
echo "=========================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ВСЕ UNIT-ТЕСТЫ ПРОЙДЕНЫ${NC}"
    exit 0
else
    echo -e "${RED}❌ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛИЛИСЬ${NC}"
    exit 1
fi
