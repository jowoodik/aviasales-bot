# Установка зависимостей
npm install

# Запуск бота
npm start

# Или для разработки с auto-reload
npm run dev



// 🔥 КОД ДЛЯ ПРОВЕРКИ В КОНСОЛИ БРАУЗЕРА (С DRAG SIMULATION)
(function() {
console.log('🔍 Ищу фильтр длительности пересадок...');

    // 1. Находим контейнер фильтра
    const filterContainer = document.querySelector('[data-test-id="range-filter-transfers_duration"]');
    if (!filterContainer) {
        console.error('❌ Контейнер фильтра не найден');
        return;
    }
    console.log('✅ Контейнер найден');
    
    // 2. Находим слайдер и правую ручку
    const slider = filterContainer.querySelector('.rc-slider');
    const maxHandle = slider.querySelector('.rc-slider-handle-2');
    
    if (!maxHandle) {
        console.error('❌ Правая ручка слайдера не найдена');
        return;
    }
    
    const oldValue = parseInt(maxHandle.getAttribute('aria-valuenow'));
    const minValue = parseInt(maxHandle.getAttribute('aria-valuemin'));
    const maxValue = parseInt(maxHandle.getAttribute('aria-valuemax'));
    
    console.log(`✅ Слайдер найден:`);
    console.log(`   Текущее: ${oldValue}мин (${Math.floor(oldValue/60)}ч)`);
    console.log(`   Диапазон: ${minValue} - ${maxValue}мин`);
    
    // 3. УСТАНАВЛИВАЕМ НОВОЕ ЗНАЧЕНИЕ
    const maxHours = 6; // 🔧 ИЗМЕНИТЕ ЭТО ЗНАЧЕНИЕ
    const newValue = maxHours * 60;
    
    console.log(`🎯 Устанавливаю: ${maxHours}ч (${newValue}мин)`);
    
    // 4. Вычисляем позицию в процентах
    const range = maxValue - minValue;
    const valueFromMin = newValue - minValue;
    const percentPosition = (valueFromMin / range) * 100;
    
    console.log(`📐 Позиция: ${percentPosition.toFixed(2)}%`);
    
    // 5. Получаем размеры слайдера
    const sliderRect = slider.getBoundingClientRect();
    const handleRect = maxHandle.getBoundingClientRect();
    
    // Вычисляем координаты для новой позиции
    const newX = sliderRect.left + (sliderRect.width * percentPosition / 100);
    const centerY = sliderRect.top + (sliderRect.height / 2);
    
    console.log(`📍 Координаты: x=${newX.toFixed(0)}, y=${centerY.toFixed(0)}`);
    
    // 6. СИМУЛИРУЕМ DRAG
    console.log('🖱️ Симулирую перетаскивание...');
    
    // Mousedown (начало перетаскивания)
    const mousedownEvent = new MouseEvent('mousedown', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: handleRect.left + handleRect.width / 2,
        clientY: handleRect.top + handleRect.height / 2,
        buttons: 1
    });
    maxHandle.dispatchEvent(mousedownEvent);
    
    // Небольшая задержка
    setTimeout(() => {
        // Mousemove (движение к новой позиции)
        const mousemoveEvent = new MouseEvent('mousemove', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: newX,
            clientY: centerY,
            buttons: 1
        });
        document.dispatchEvent(mousemoveEvent);
        
        setTimeout(() => {
            // Mouseup (отпускаем)
            const mouseupEvent = new MouseEvent('mouseup', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: newX,
                clientY: centerY
            });
            document.dispatchEvent(mouseupEvent);
            
            // Проверяем результат
            setTimeout(() => {
                const resultValue = parseInt(maxHandle.getAttribute('aria-valuenow'));
                const resultHours = Math.floor(resultValue / 60);
                
                console.log('\n📊 РЕЗУЛЬТАТ:');
                console.log(`   Было: ${oldValue}мин (${Math.floor(oldValue/60)}ч)`);
                console.log(`   Стало: ${resultValue}мин (${resultHours}ч)`);
                console.log(`   Цель: ${newValue}мин (${maxHours}ч)`);
                
                if (Math.abs(resultValue - newValue) < 60) {
                    console.log('✅ УСПЕХ! Фильтр применен');
                } else {
                    console.log('⚠️ Не совсем точно, но близко');
                }
                
                // Проверяем изменение тега
                const tag = filterContainer.querySelector('[data-test-id*="text"]');
                if (tag) {
                    console.log(`   Тег: ${tag.textContent.trim()}`);
                }
            }, 500);
        }, 100);
    }, 100);
})();
