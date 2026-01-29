class AirportFormatter {
    /**
     * Преобразовать введенный текст в IATA код
     */
    static parseAirportInput(text) {
        if (!text) return null;

        // Пытаемся извлечь код из скобок [XXX]
        const bracketMatch = text.match(/\[([A-Z]{3})\]/);
        if (bracketMatch) {
            return bracketMatch[1];
        }

        // Проверяем, не является ли сам текст кодом (3 заглавные буквы)
        if (/^[A-Z]{3}$/.test(text)) {
            return text;
        }

        return null;
    }

    /**
     * Создать клавиатуру с аэропортами
     */
    static createAirportsKeyboard(airports, includeBack = true) {
        const buttons = [];

        // Группируем по 2 аэропорта в ряд для компактности
        for (let i = 0; i < airports.length; i += 2) {
            const row = [];

            // Первый аэропорт в ряду
            if (airports[i]) {
                const airport1 = airports[i];
                row.push(this.formatButtonText(airport1));
            }

            // Второй аэропорт в ряду (если есть)
            if (airports[i + 1]) {
                const airport2 = airports[i + 1];
                row.push(this.formatButtonText(airport2));
            }

            if (row.length > 0) {
                buttons.push(row);
            }
        }

        // Добавляем кнопки поиска и отмены
        if (airports.length === 0) {
            buttons.push(['🔍 Уточнить поиск']);
        }

        if (includeBack) {
            buttons.push(['🔙 Отмена']);
        }

        return {
            reply_markup: {
                keyboard: buttons,
                resize_keyboard: true,
                one_time_keyboard: true
            }
        };
    }

    /**
     * Форматировать текст для кнопки
     */
    static formatButtonText(airport) {
        if (!airport) return '';

        // Если есть короткое имя для отображения
        if (airport.display_name) {
            return airport.display_name;
        }

        // Короткий формат: Город - Код
        return `${airport.city_name} [${airport.iata_code}]`;
    }

    /**
     * Создать инлайн-клавиатуру с подсказками
     */
    static createInlineKeyboard(airports, callbackPrefix) {
        const inlineKeyboard = [];

        airports.forEach((airport, index) => {
            inlineKeyboard.push([
                {
                    text: this.formatInlineButtonText(airport),
                    callback_data: `${callbackPrefix}_${airport.iata_code}`
                }
            ]);
        });

        // Кнопка "Показать еще"
        if (airports.length >= 5) {
            inlineKeyboard.push([
                {
                    text: '🔍 Показать больше результатов',
                    switch_inline_query_current_chat: ''
                }
            ]);
        }

        return inlineKeyboard;
    }

    /**
     * Форматировать текст для инлайн-кнопки
     */
    static formatInlineButtonText(airport) {
        const city = airport.city_name;
        const code = airport.iata_code;
        const country = airport.country_code;

        // Короткий формат: Город (Код)
        if (city.length > 15) {
            return `${city.substring(0, 12)}... (${code})`;
        }

        return `${city} (${code}) - ${country}`;
    }

    /**
     * Создать сообщение с результатами поиска
     */
    static createSearchResultsMessage(airports, query) {
        if (airports.length === 0) {
            return `🔍 По запросу "${query}" ничего не найдено.\n\nПопробуйте:\n• Ввести название города (например, "Москва")\n• Ввести название страны (например, "Россия")\n• Использовать IATA код (например, "SVX")`;
        }

        let message = `🔍 Результаты поиска "${query}":\n\n`;

        airports.forEach((airport, index) => {
            message += `${index + 1}. ${airport.city_name}, ${airport.country_name}\n`;
            message += `   ✈️ ${airport.airport_name} [${airport.iata_code}]\n\n`;
        });

        if (airports.length >= 10) {
            message += `\nПоказано ${airports.length} результатов. Уточните запрос для более точного поиска.`;
        }

        return message;
    }
}

module.exports = AirportFormatter;