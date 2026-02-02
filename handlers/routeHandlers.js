const UnifiedRoute = require('../models/UnifiedRoute');
const RouteResult = require('../models/RouteResult');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const ChartGenerator = require("../services/ChartGenerator");
const AirportService = require('../services/AirportService');
const AirportFormatter = require('../utils/airportFormatter');
const SubscriptionService = require('../services/SubscriptionService');

class RouteHandlers {
    constructor(bot, userStates) {
        this.bot = bot;
        this.userStates = userStates;
        this.chartGenerator = new ChartGenerator();
        this.airportService = new AirportService();
    }

    getMainMenuKeyboard(chatId) {
        const keyboard = [
            ['📋 Мои маршруты'],
            ['⚙️ Настройки', '📊 Моя подписка'],
            ['ℹ️ Помощь']
        ];

        // Админу добавляем кнопку проверки
        if (chatId === 341508411) {
            keyboard.push(['✅ Проверить сейчас']);
        }

        return {
            reply_markup: {
                keyboard,
                resize_keyboard: true,
                persistent: true
            }
        };
    }

    /**
     * ВАЛИДАЦИЯ ЛИМИТОВ МАРШРУТОВ
     */
    async validateRouteLimit(chatId, isFlexible) {
        const limits = await SubscriptionService.checkUserLimits(chatId, isFlexible);

        if (!limits.allowed) {
            return {
                allowed: false,
                message: limits.message
            };
        }

        return { allowed: true };
    }

    /**
     * СПИСОК МАРШРУТОВ ПОЛЬЗОВАТЕЛЯ
     */
    async handleMyRoutes(chatId) {
        try {
            const routes = await UnifiedRoute.findByChatId(chatId);

            if (!routes || routes.length === 0) {
                const keyboard = {
                    reply_markup: {
                        keyboard: [
                            ['➕ Создать маршрут'],
                            ['◀️ Назад']
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };

                this.bot.sendMessage(
                    chatId,
                    '📋 У вас пока нет маршрутов.\n\nНажмите "Создать маршрут" для добавления первого маршрута.',
                    keyboard
                );
                return;
            }

            // Получаем лучшие цены с датами для всех маршрутов
            const routesWithBestPrices = await Promise.all(
                routes.map(async (route) => {
                    const bestResult = await this.getBestPriceWithDate(route.id);
                    return { ...route, bestResult };
                })
            );

            // Формируем сообщение со списком
            let message = `📋 МОИ МАРШРУТЫ\n\nУ вас ${routes.length} ${this._pluralize(routes.length, 'активный маршрут', 'активных маршрута', 'активных маршрутов')}:\n\n`;

            const buttons = [['➕ Создать маршрут']];

            for (let i = 0; i < routesWithBestPrices.length; i++) {
                const r = routesWithBestPrices[i];
                const statusIcon = r.is_paused ? '⏸️' : '✅';

                // Формат даты
                let dateStr;
                if (r.is_flexible) {
                    const start = DateUtils.formatDateDisplay(r.departure_start).substring(0, 5);
                    const end = DateUtils.formatDateDisplay(r.departure_end).substring(0, 5);
                    dateStr = `${start} - ${end} (диапазон, ${r.min_days}-${r.max_days} дней)`;
                } else if (r.has_return) {
                    const dep = DateUtils.formatDateDisplay(r.departure_date).substring(0, 5);
                    const ret = DateUtils.formatDateDisplay(r.return_date).substring(0, 5);
                    dateStr = `${dep} - ${ret} (туда-обратно)`;
                } else {
                    const dep = DateUtils.formatDateDisplay(r.departure_date).substring(0, 5);
                    dateStr = `${dep} (в одну сторону)`;
                }

                // Авиакомпания
                const airlineName = Formatters.getAirlineName(r.airline);

                // Пассажиры
                const passengers = Formatters.formatPassengers(r.adults, r.children);

                // Багаж
                const baggageIcon = r.baggage ? '🧳' : '🎒';
                const baggageText = r.baggage ? 'С багажом' : 'Без багажа';

                // Пересадки
                let stopsText;
                if (r.max_stops === 0) {
                    stopsText = 'Только прямые';
                } else if (r.max_stops === 99 || r.max_stops === null) {
                    stopsText = 'Любое количество пересадок';
                } else {
                    stopsText = `До ${r.max_stops} ${this._pluralize(r.max_stops, 'пересадки', 'пересадок', 'пересадок')}`;
                    if (r.max_layover_hours) {
                        stopsText += ` (макс ${r.max_layover_hours}ч)`;
                    }
                }

                // Лучшая цена с датой
                let bestPriceText;
                if (r.bestResult && r.bestResult.total_price) {
                    const timeAgo = r.bestResult.found_at ? Formatters.formatTimeAgo(r.bestResult.found_at) : 'давно';
                    bestPriceText = `${Formatters.formatPrice(r.bestResult.total_price, r.currency)} (найдено ${timeAgo})`;
                } else {
                    bestPriceText = 'Нет данных';
                }

                message += `${statusIcon} ${i + 1}. ✈️ ${r.origin} → ${r.destination}\n`;
                message += `   📅 ${dateStr}\n`;
                message += `   🏢 ${airlineName} | 👥 ${passengers}\n`;
                message += `   ${baggageIcon} ${baggageText} | 🔄 ${stopsText}\n`;
                message += `   💰 Порог: ${Formatters.formatPrice(r.threshold_price, r.currency)} | 🏆 Лучшая: ${bestPriceText}\n\n`;

                // Кнопка для выбора маршрута (компактный формат)
                let buttonText;
                if (r.is_flexible) {
                    const start = DateUtils.formatDateDisplay(r.departure_start).substring(0, 5);
                    const end = DateUtils.formatDateDisplay(r.departure_end).substring(0, 5);
                    const airline = r.airline || 'Все';
                    const passCount = r.children > 0 ? `${r.adults}+${r.children}` : `${r.adults}`;
                    buttonText = `${i + 1}. ${r.origin}→${r.destination} ${start}-${end} ${airline} ${passCount} ${baggageIcon}`;
                } else if (r.has_return) {
                    const dep = DateUtils.formatDateDisplay(r.departure_date).substring(0, 5);
                    const ret = DateUtils.formatDateDisplay(r.return_date).substring(0, 5);
                    const airline = r.airline || 'Все';
                    const passCount = r.children > 0 ? `${r.adults}+${r.children}` : `${r.adults}`;
                    buttonText = `${i + 1}. ${r.origin}→${r.destination} ${dep}-${ret} ${airline} ${passCount} ${baggageIcon}`;
                } else {
                    const dep = DateUtils.formatDateDisplay(r.departure_date).substring(0, 5);
                    const airline = r.airline || 'Все';
                    buttonText = `${i + 1}. ${r.origin}→${r.destination} ${dep}→ ${airline} ${r.adults} ${baggageIcon}`;
                }

                if (r.is_paused) {
                    buttonText += ' ⏸️';
                }

                buttons.push([buttonText]);
            }

            buttons.push(['🏠 Главное меню']);

            const keyboard = {
                reply_markup: {
                    keyboard: buttons,
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            this.bot.sendMessage(chatId, message, keyboard);
            this.userStates[chatId] = { step: 'select_route', routes };

        } catch (error) {
            console.error('Ошибка получения маршрутов:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка загрузки маршрутов: ' + error.message);
        }
    }

    /**
     * Получить лучшую цену с датой для маршрута
     */
    async getBestPriceWithDate(routeId) {
        return new Promise((resolve, reject) => {
            const db = require('../config/database');
            db.get(
                `SELECT total_price, found_at
                 FROM route_results
                 WHERE route_id = ?
                 ORDER BY total_price ASC, found_at DESC LIMIT 1`,
                [routeId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    /**
     * ДЕТАЛЬНЫЙ ПРОСМОТР МАРШРУТА
     */
    async handleRouteDetails(chatId, routeIndex) {
        try {
            const state = this.userStates[chatId];
            if (!state || !state.routes) {
                this.bot.sendMessage(chatId, '❌ Ошибка: маршрут не найден');
                return;
            }

            const route = state.routes[routeIndex];
            if (!route) {
                this.bot.sendMessage(chatId, '❌ Ошибка: маршрут не найден');
                return;
            }

            // Формируем детальную информацию
            let message = `✈️ ${route.origin} → ${route.destination}\n\n`;

            // Даты
            if (route.is_flexible) {
                message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)} (диапазон)\n`;
                if (route.has_return) {
                    message += `📆 Пребывание: ${route.min_days}-${route.max_days} дней\n`;
                }
            } else if (route.has_return) {
                message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_date)}\n`;
                message += `📅 Возврат: ${DateUtils.formatDateDisplay(route.return_date)}\n`;
            } else {
                message += `📅 Вылет: ${DateUtils.formatDateDisplay(route.departure_date)} (в одну сторону)\n`;
            }

            // Пассажиры
            message += `👥 ${Formatters.formatPassengers(route.adults, route.children)}\n`;

            // Авиакомпания
            message += `🏢 ${Formatters.getAirlineName(route.airline)}\n`;

            // Багаж
            message += route.baggage ? '🧳 С багажом 20 кг\n' : '🎒 Без багажа\n';

            // Пересадки
            if (route.max_stops === 0) {
                message += '🔄 Только прямые рейсы\n';
            } else if (route.max_stops === 99 || route.max_stops === null) {
                message += '🔄 Любое количество пересадок\n';
            } else {
                message += `🔄 До ${route.max_stops} ${this._pluralize(route.max_stops, 'пересадки', 'пересадок', 'пересадок')}\n`;
                if (route.max_layover_hours) {
                    message += `⏱ Макс. пересадка: ${route.max_layover_hours}ч\n`;
                }
            }

            // Порог
            message += `💰 Порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n`;

            // Статус
            if (route.is_paused) {
                message += '\n⏸️ Маршрут на паузе\n';
            }

            message += '\n🏆 ЛУЧШИЕ 3 ЦЕНЫ:\n\n';

            // Получаем топ-3 результата
            const topResults = await RouteResult.getTopResults(route.id, 3);

            if (topResults.length === 0) {
                message += 'Пока нет данных о ценах.\nБот начнет проверку автоматически.';
                await this.bot.sendMessage(chatId, message);
            } else {
                // Отправляем основное сообщение с деталями маршрута
                await this.bot.sendMessage(chatId, message);

                // Отправляем каждое предложение отдельным сообщением с улучшенной информацией
                for (let i = 0; i < topResults.length; i++) {
                    const result = topResults[i];
                    const icon = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
                    const timeAgo = result.found_at ? Formatters.formatTimeAgo(result.found_at) : 'недавно';
                    const airlineName = result.airline ? Formatters.getAirlineName(result.airline) : 'Любая';

                    let resultMessage = `${icon} *${Formatters.formatPrice(result.total_price, route.currency)}* - ${airlineName}\n`;
                    resultMessage += `📅 ${DateUtils.formatDateDisplay(result.departure_date)}`;

                    if (result.return_date) {
                        resultMessage += ` → ${DateUtils.formatDateDisplay(result.return_date)}`;
                        if (result.days_in_country) {
                            resultMessage += ` (${result.days_in_country} ${this._pluralize(result.days_in_country, 'день', 'дня', 'дней')})`;
                        }
                    }

                    resultMessage += `\n🕐 Найдено: ${timeAgo}`;

                    if (result.total_price <= route.threshold_price) {
                        const savings = route.threshold_price - result.total_price;
                        resultMessage += `\n🔥 *НИЖЕ ПОРОГА!* Экономия: ${Formatters.formatPrice(savings, route.currency)}`;
                    }

                    const linkKeyboard = {
                        inline_keyboard: [[
                            { text: '🔗 Купить билет', url: result.search_link }
                        ]]
                    };

                    await this.bot.sendMessage(
                        chatId,
                        resultMessage,
                        { parse_mode: 'Markdown', reply_markup: linkKeyboard }
                    );

                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            // Кнопки действий
            const keyboard = {
                reply_markup: {
                    keyboard: [
                        ['✏️ Редактировать'],
                        ['📊 График цен', '🗺️ Heatmap'],
                        ['🗑️ Удалить'],
                        ['◀️ Назад к маршрутам']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            this.bot.sendMessage(chatId, 'Выберите действие:', keyboard);
            this.userStates[chatId] = { step: 'route_action', route, routeIndex };

        } catch (error) {
            console.error('Ошибка просмотра маршрута:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
        }
    }

    /**
     * НАЧАЛО СОЗДАНИЯ МАРШРУТА
     */
    async handleCreateRoute(chatId) {
        this.userStates[chatId] = {
            step: 'origin',
            routeData: {}
        };

        // Получаем популярные аэропорты для России
        const popularAirports = await this.airportService.getPopularAirports('russia', 6);

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ...popularAirports.map(airport => [AirportFormatter.formatButtonText(airport)]),
                    ['🔍 Поиск аэропорта'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            '✈️ СОЗДАНИЕ МАРШРУТА\n\n📍 Шаг 1/12: Откуда вылетаете?\n\n' +
            'Выберите аэропорт из списка популярных или нажмите "Поиск аэропорта" для поиска по названию города.',
            keyboard
        );
    }

    /**
     * ОБРАБОТКА ШАГОВ СОЗДАНИЯ МАРШРУТА
     */
    async handleCreateStep(chatId, text) {
        const state = this.userStates[chatId];
        if (!state || !state.routeData) return false;

        try {
            switch (state.step) {
                case 'origin':
                    return await this._handleOriginStep(chatId, text, state);
                case 'origin_search':
                    return await this._handleOriginSearchStep(chatId, text, state);
                case 'origin_confirm':
                    return await this._handleAirportConfirmStep(chatId, text, state);
                case 'origin_select':
                    return await this._handleAirportSelectStep(chatId, text, state);
                case 'destination':
                    return await this._handleDestinationStep(chatId, text, state);
                case 'destination_search':
                    return await this._handleDestinationSearchStep(chatId, text, state);
                case 'destination_confirm':
                    return await this._handleAirportConfirmStep(chatId, text, state);
                case 'destination_select':
                    return await this._handleAirportSelectStep(chatId, text, state);
                case 'search_type':
                    return await this._handleSearchTypeStep(chatId, text, state);
                case 'has_return':
                    return await this._handleHasReturnStep(chatId, text, state);
                case 'departure_date':
                    return await this._handleDepartureDateStep(chatId, text, state);
                case 'return_date':
                    return await this._handleReturnDateStep(chatId, text, state);
                case 'departure_start':
                    return await this._handleDepartureStartStep(chatId, text, state);
                case 'departure_end':
                    return await this._handleDepartureEndStep(chatId, text, state);
                case 'min_days':
                    return await this._handleMinDaysStep(chatId, text, state);
                case 'max_days':
                    return await this._handleMaxDaysStep(chatId, text, state);
                case 'airline':
                    return await this._handleAirlineStep(chatId, text, state);
                case 'adults':
                    return await this._handleAdultsStep(chatId, text, state);
                case 'children':
                    return await this._handleChildrenStep(chatId, text, state);
                case 'baggage':
                    return await this._handleBaggageStep(chatId, text, state);
                case 'max_stops':
                    return await this._handleMaxStopsStep(chatId, text, state);
                case 'max_layover':
                    return await this._handleMaxLayoverStep(chatId, text, state);
                case 'threshold':
                    return await this._handleThresholdStep(chatId, text, state);
                case 'confirm':
                    return await this._handleConfirmStep(chatId, text, state);
            }
        } catch (error) {
            console.error('Ошибка обработки шага:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
            delete this.userStates[chatId];
        }

        return false;
    }

    // ========================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ КАЖДОГО ШАГА
    // ========================================

    /**
     * ПОКАЗАТЬ ШАГ ВЫБОРА ТИПА ПОИСКА
     */
    async _showSearchTypeStep(chatId, state) {
        const originCity = state.routeData.origin_city || state.routeData.origin;
        const destinationCity = state.routeData.destination_city || state.routeData.destination;

        // Получаем подписку пользователя для отображения правильных лимитов
        const subscription = await SubscriptionService.getUserSubscription(chatId);

        // Формируем описание для диапазона дат в зависимости от тарифа
        let flexibleDescription = '';
        if (subscription.name === 'free') {
            flexibleDescription = `🔹 Диапазон дат - бот найдет лучшие комбинации дат в указанном диапазоне (максимум ${subscription.max_combinations} комбинаций для бесплатного тарифа).`;
        } else if (subscription.name === 'plus') {
            flexibleDescription = `🔹 Диапазон дат - бот найдет лучшие комбинации дат в указанном диапазоне (до ${subscription.max_combinations} комбинаций на тарифе Plus).`;
        } else if (subscription.name === 'admin') {
            flexibleDescription = `🔹 Диапазон дат - бот найдет лучшие комбинации дат в указанном диапазоне (без ограничений).`;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['📅 Конкретная дата'],
                    ['📆 Диапазон дат'],
                    ['🔙 Назад']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Маршрут: ${originCity} [${state.routeData.origin}] → ${destinationCity} [${state.routeData.destination}]\n\n` +
            `📍 Шаг 3/12: Тип поиска\n\n` +
            `🔹 Конкретная дата - вы ищете билеты на точную дату вылета и возврата.\n\n` +
            `${flexibleDescription}\n\n` +
            `Что выбираете?`,
            keyboard
        );
    }


    /**
     * ПОКАЗАТЬ ШАГ ВЫБОРА АЭРОПОРТА ВЫЛЕТА (повторно)
     */
    async _showOriginStep(chatId) {
        // Получаем популярные аэропорты для России
        const popularAirports = await this.airportService.getPopularAirports('russia', 6);

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ...popularAirports.map(airport => [AirportFormatter.formatButtonText(airport)]),
                    ['🔍 Поиск аэропорта'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            '✈️ СОЗДАНИЕ МАРШРУТА\n\n📍 Шаг 1/12: Откуда вылетаете?\n\n' +
            'Выберите аэропорт из списка популярных или нажмите "Поиск аэропорта" для поиска по названию города.',
            keyboard
        );
    }

    /**
     * ОБРАБОТКА ШАГА ВЫБОРА АЭРОПОРТА ВЫЛЕТА
     */
    async _handleOriginStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        if (text === '🔍 Поиск аэропорта') {
            state.step = 'origin_search';
            this.bot.sendMessage(
                chatId,
                '🔍 Введите название города, страны или код аэропорта (например: "Москва", "Россия", или "SVX"):',
                { reply_markup: { remove_keyboard: true } }
            );
            return true;
        }

        // Пытаемся распарсить IATA код из текста
        const iataCode = AirportFormatter.parseAirportInput(text);

        if (iataCode) {
            // Проверяем существование аэропорта
            const airport = await this.airportService.getAirportByCode(iataCode);

            if (airport) {
                state.routeData.origin = iataCode;
                state.routeData.origin_city = airport.city_name;
                state.routeData.origin_country = airport.country_name;
                state.step = 'destination';

                // Показываем популярные аэропорты для пункта назначения
                await this._showDestinationStep(chatId, state);
                return true;
            }
        }

        // Если не удалось распарсить код, ищем аэропорты
        await this._searchAndShowAirports(chatId, text, 'origin');
        return true;
    }

    /**
     * ПОИСК АЭРОПОРТОВ ДЛЯ ПУНКТА ВЫЛЕТА
     */
    async _handleOriginSearchStep(chatId, text, state) {
        if (text === '🔙 Назад') {
            state.step = 'origin';
            // Вместо вызова handleCreateRoute, просто показываем шаг origin
            await this._showOriginStep(chatId, state);
            return true;
        }

        await this._searchAndShowAirports(chatId, text, 'origin');
        return true;
    }

    /**
     * ОБРАБОТКА ШАГА ВЫБОРА АЭРОПОРТА ПРИЛЕТА
     */
    async _handleDestinationStep(chatId, text, state) {
        if (text === '🔙 Назад') {
            state.step = 'origin';
            await this._showOriginStep(chatId, state);
            return true;
        }

        if (text === '🔍 Поиск аэропорта') {
            state.step = 'destination_search';
            this.bot.sendMessage(
                chatId,
                '🔍 Введите название города, страны или код аэропорта для пункта назначения:',
                { reply_markup: { remove_keyboard: true } }
            );
            return true;
        }

        // Пытаемся распарсить IATA код из текста
        const iataCode = AirportFormatter.parseAirportInput(text);

        if (iataCode) {
            // Проверяем существование аэропорта
            const airport = await this.airportService.getAirportByCode(iataCode);

            if (airport) {
                // Проверяем, не совпадает ли с пунктом вылета
                if (iataCode === state.routeData.origin) {
                    this.bot.sendMessage(chatId, '❌ Пункт назначения не может совпадать с пунктом вылета. Выберите другой аэропорт:');
                    return true;
                }

                state.routeData.destination = iataCode;
                state.routeData.destination_city = airport.city_name;
                state.routeData.destination_country = airport.country_name;
                state.step = 'search_type';

                // Переходим к следующему шагу
                await this._showSearchTypeStep(chatId, state);
                return true;
            }
        }

        // Если не удалось распарсить код, ищем аэропорты
        await this._searchAndShowAirports(chatId, text, 'destination');
        return true;
    }

    /**
     * ПОИСК АЭРОПОРТОВ ДЛЯ ПУНКТА НАЗНАЧЕНИЯ
     */
    async _handleDestinationSearchStep(chatId, text, state) {
        if (text === '🔙 Назад') {
            state.step = 'destination';
            // Показываем шаг destination снова
            await this._showDestinationStep(chatId, state);
            return true;
        }

        await this._searchAndShowAirports(chatId, text, 'destination');
        return true;
    }

    /**
     * ОБЩИЙ МЕТОД ПОИСКА И ОТОБРАЖЕНИЯ АЭРОПОРТОВ
     */
    async _searchAndShowAirports(chatId, query, stepType) {
        if (!query || query.trim().length < 2) {
            this.bot.sendMessage(
                chatId,
                '❌ Введите хотя бы 2 символа для поиска.',
                { reply_markup: { remove_keyboard: true } }
            );
            return;
        }

        // Показываем сообщение о поиске
        const searchingMsg = await this.bot.sendMessage(chatId, `🔍 Ищу аэропорты по запросу: "${query}"...`);

        try {
            // Ищем аэропорты - используем улучшенный поиск
            const airports = await this.airportService.searchAirportsEnhanced(query, 8);

            // Получаем состояние пользователя
            const state = this.userStates[chatId];
            if (!state) return;

            // Удаляем сообщение о поиске
            await this.bot.deleteMessage(chatId, searchingMsg.message_id);

            if (airports.length === 0) {
                const keyboard = {
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };

                this.bot.sendMessage(
                    chatId,
                    `❌ По запросу "${query}" аэропорты не найдены.\n\nПопробуйте:\n` +
                    '• Ввести название города (например, "Москва")\n' +
                    '• Ввести название страны (например, "Россия")\n' +
                    '• Использовать IATA код (например, "SVX")\n' +
                    '• Уточнить название (например, "Новосибирск" вместо "Нск")',
                    keyboard
                );
                return;
            }

            if (airports.length === 1) {
                // Если найден только один аэропорт, автоматически выбираем его
                const airport = airports[0];

                // Проверяем, есть ли у аэропорта английское название
                const englishName = airport.airport_name_en ?
                    `\n🏴 ${airport.airport_name_en}` : '';

                const message = `✅ Найден аэропорт:\n\n` +
                    `${airport.airport_name} [${airport.iata_code}]${englishName}\n` +
                    `${airport.city_name}, ${airport.country_name}\n\n` +
                    `Используем этот аэропорт?`;

                const keyboard = {
                    reply_markup: {
                        keyboard: [
                            ['✅ Да, использовать'],
                            ['❌ Нет, искать другой'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };

                this.bot.sendMessage(chatId, message, keyboard);

                // Сохраняем найденный аэропорт во временное состояние
                state.tempAirport = airport;
                state.tempStepType = stepType;
                state.step = `${stepType}_confirm`;
                return;
            }

            // Если найдено несколько аэропортов, показываем список
            const message = AirportFormatter.createSearchResultsMessage(airports, query);
            const keyboard = AirportFormatter.createAirportsKeyboard(airports, false);

            // Добавляем кнопку "Назад"
            keyboard.reply_markup.keyboard.push(['🔙 Назад']);

            this.bot.sendMessage(chatId, message, keyboard);

            // Сохраняем найденные аэропорты во временное состояние
            state.searchResults = airports;
            state.searchQuery = query;
            state.step = `${stepType}_select`;

        } catch (error) {
            console.error('Ошибка при поиске аэропортов:', error);

            // Удаляем сообщение о поиске в случае ошибки
            try {
                await this.bot.deleteMessage(chatId, searchingMsg.message_id);
            } catch (e) {}

            this.bot.sendMessage(
                chatId,
                `❌ Ошибка при поиске аэропортов: ${error.message}\n\nПопробуйте еще раз.`,
                { reply_markup: { keyboard: [['🔙 Назад']], resize_keyboard: true } }
            );
        }
    }

    /**
     * ПОДТВЕРЖДЕНИЕ ВЫБОРА ЕДИНСТВЕННОГО АЭРОПОРТА
     */
    async _handleAirportConfirmStep(chatId, text, state) {
        const stepType = state.tempStepType;
        const airport = state.tempAirport;

        if (text === '✅ Да, использовать') {
            if (stepType === 'origin') {
                state.routeData.origin = airport.iata_code;
                state.routeData.origin_city = airport.city_name;
                state.routeData.origin_country = airport.country_name;
                state.routeData.origin_city_code = airport.city_code;
                state.step = 'destination';
                delete state.tempAirport;
                delete state.tempStepType;
                await this._showDestinationStep(chatId, state);
            } else if (stepType === 'destination') {
                // Проверяем, не совпадает ли с пунктом вылета
                if (airport.iata_code === state.routeData.origin) {
                    this.bot.sendMessage(chatId, '❌ Пункт назначения не может совпадать с пунктом вылета. Выберите другой аэропорт:');
                    // Возвращаем к поиску
                    state.step = 'destination_search';
                    this.bot.sendMessage(
                        chatId,
                        '🔍 Введите название города, страны или код аэропорта для пункта назначения:',
                        { reply_markup: { remove_keyboard: true } }
                    );
                    return true;
                }

                state.routeData.destination = airport.iata_code;
                state.routeData.destination_city = airport.city_name;
                state.routeData.destination_country = airport.country_name;
                state.routeData.destination_city_code = airport.city_code;
                state.step = 'search_type';
                delete state.tempAirport;
                delete state.tempStepType;
                await this._showSearchTypeStep(chatId, state);
            }
        } else if (text === '❌ Нет, искать другой') {
            state.step = `${stepType}_search`;
            delete state.tempAirport;
            delete state.tempStepType;
            this.bot.sendMessage(
                chatId,
                `🔍 Введите название города, страны или код аэропорта${stepType === 'origin' ? ' вылета' : ' назначения'}:`,
                { reply_markup: { remove_keyboard: true } }
            );
        } else if (text === '🔙 Назад') {
            state.step = stepType;
            delete state.tempAirport;
            delete state.tempStepType;
            if (stepType === 'origin') {
                this.handleCreateRoute(chatId);
            } else {
                await this._showDestinationStep(chatId, state);
            }
        }

        return true;
    }

    /**
     * ВЫБОР АЭРОПОРТА ИЗ СПИСКА РЕЗУЛЬТАТОВ
     */
    async _handleAirportSelectStep(chatId, text, state) {
        const stepType = state.step.replace('_select', '');
        const airports = state.searchResults;

        if (text === '🔙 Назад') {
            state.step = stepType;
            delete state.searchResults;
            delete state.searchQuery;
            if (stepType === 'origin') {
                this.handleCreateRoute(chatId);
            } else {
                await this._showDestinationStep(chatId, state);
            }
            return true;
        }

        // Пытаемся найти выбранный аэропорт
        const selectedAirport = airports.find(airport =>
            AirportFormatter.formatButtonText(airport) === text ||
            airport.iata_code === AirportFormatter.parseAirportInput(text)
        );

        if (selectedAirport) {
            if (stepType === 'origin') {
                state.routeData.origin = selectedAirport.iata_code;
                state.routeData.origin_city = selectedAirport.city_name;
                state.routeData.origin_country = selectedAirport.country_name;
                state.routeData.origin_city_code = selectedAirport.city_code;
                state.step = 'destination';
                delete state.searchResults;
                delete state.searchQuery;
                await this._showDestinationStep(chatId, state);
            } else if (stepType === 'destination') {
                // Проверяем, не совпадает ли с пунктом вылета
                if (selectedAirport.iata_code === state.routeData.origin) {
                    this.bot.sendMessage(chatId, '❌ Пункт назначения не может совпадать с пунктом вылета. Выберите другой аэропорт из списка:');
                    return true;
                }

                state.routeData.destination = selectedAirport.iata_code;
                state.routeData.destination_city = selectedAirport.city_name;
                state.routeData.destination_country = selectedAirport.country_name;
                state.routeData.destination_city_code = selectedAirport.city_code;
                state.step = 'search_type';
                delete state.searchResults;
                delete state.searchQuery;
                await this._showSearchTypeStep(chatId, state);
            }
        } else {
            this.bot.sendMessage(chatId, '❌ Аэропорт не найден в списке. Выберите аэропорт из предложенных вариантов.');
        }

        return true;
    }

    /**
     * ПОКАЗАТЬ ШАГ ВЫБОРА ПУНКТА НАЗНАЧЕНИЯ
     */
    async _showDestinationStep(chatId, state) {
        const originCity = state.routeData.origin_city || state.routeData.origin;

        // Получаем популярные аэропорты для международных направлений
        const popularAirports = await this.airportService.getPopularAirports('international', 6);

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ...popularAirports.map(airport => [AirportFormatter.formatButtonText(airport)]),
                    ['🔍 Поиск аэропорта'],
                    ['🔙 Назад']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Вылет: ${originCity} [${state.routeData.origin}]\n\n` +
            `📍 Шаг 2/12: Куда летите?\n\n` +
            `Выберите аэропорт назначения из списка популярных или нажмите "Поиск аэропорта".`,
            keyboard
        );
    }

    async _handleSearchTypeStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        const isFlexible = text.includes('Диапазон');

        // Проверяем лимиты
        const validation = await this.validateRouteLimit(chatId, isFlexible);
        if (!validation.allowed) {
            this.bot.sendMessage(chatId, validation.message, this.getMainMenuKeyboard(chatId));
            delete this.userStates[chatId];
            return true;
        }

        state.routeData.is_flexible = isFlexible;
        state.step = 'has_return';

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['✅ Да, нужен обратный билет'],
                    ['❌ Нет, только в одну сторону'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Тип поиска: ${isFlexible ? 'Диапазон дат' : 'Конкретная дата'}\n\n` +
            `📍 Шаг 4/12: Нужен ли обратный билет?`,
            keyboard
        );

        return true;
    }

    async _handleHasReturnStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        const hasReturn = text.includes('Да');
        state.routeData.has_return = hasReturn;

        if (state.routeData.is_flexible) {
            // Получаем подписку пользователя для формирования правильного сообщения
            const subscription = await SubscriptionService.getUserSubscription(chatId);

            // Формируем предупреждение о лимите комбинаций в зависимости от тарифа
            let limitWarning = '';
            if (hasReturn) {
                if (subscription.name === 'free') {
                    limitWarning = `⚠️ Помните: максимум ${subscription.max_combinations} комбинаций для бесплатного тарифа!\n\n`;
                } else if (subscription.name === 'plus') {
                    limitWarning = `💎 Ваш тариф Plus: до ${subscription.max_combinations} комбинаций доступно!\n\n`;
                }
                // Для admin тарифа не показываем предупреждение, т.к. безлимит
            }

            // Гибкий поиск
            state.step = 'departure_start';
            this.bot.sendMessage(
                chatId,
                `✅ ${hasReturn ? 'Туда-обратно' : 'В одну сторону'}\n\n` +
                `📍 Шаг 5/${hasReturn ? '12' : '10'}: Начало диапазона вылета\n\n` +
                `${limitWarning}` +
                `Введите дату в формате ДД.ММ.ГГГГ, например: 25.02.2026`,
                { reply_markup: { remove_keyboard: true } }
            );
        } else {
            // Фиксированный поиск - без предупреждений о лимитах
            state.step = 'departure_date';
            this.bot.sendMessage(
                chatId,
                `✅ ${hasReturn ? 'Туда-обратно' : 'В одну сторону'}\n\n` +
                `📍 Шаг 5/${hasReturn ? '12' : '11'}: Дата вылета\n\n` +
                `Введите дату в формате ДД.ММ.ГГГГ, например: 15.03.2026`,
                { reply_markup: { remove_keyboard: true } }
            );
        }

        return true;
    }


    async _handleDepartureDateStep(chatId, text, state) {
        const date = DateUtils.convertDateFormat(text);

        if (!date) {
            this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ, например: 15.03.2026');
            return true;
        }

        // Проверка что дата в будущем
        const inputDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (inputDate < today) {
            this.bot.sendMessage(chatId, '❌ Дата вылета не может быть в прошлом. Введите корректную дату:');
            return true;
        }

        state.routeData.departure_date = date;

        if (state.routeData.has_return) {
            state.step = 'return_date';
            this.bot.sendMessage(
                chatId,
                `✅ Дата вылета: ${DateUtils.formatDateDisplay(date)}\n\n` +
                `📍 Шаг 6/12: Дата возврата\n\n` +
                `Введите дату в формате ДД.ММ.ГГГГ:`,
                { reply_markup: { remove_keyboard: true } }
            );
        } else {
            // Переходим сразу к выбору авиакомпании
            state.step = 'airline';
            this._showAirlineKeyboard(chatId, state);
        }

        return true;
    }

    async _handleReturnDateStep(chatId, text, state) {
        const date = DateUtils.convertDateFormat(text);

        if (!date) {
            this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ, например: 20.03.2026');
            return true;
        }

        const returnDate = new Date(date);
        const departureDate = new Date(state.routeData.departure_date);

        if (returnDate <= departureDate) {
            this.bot.sendMessage(chatId, '❌ Дата возврата должна быть позже даты вылета. Введите корректную дату:');
            return true;
        }

        state.routeData.return_date = date;
        state.step = 'airline';
        this._showAirlineKeyboard(chatId, state);

        return true;
    }

    async _handleDepartureStartStep(chatId, text, state) {
        const date = DateUtils.convertDateFormat(text);

        if (!date) {
            this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД-ММ-ГГГГ, например: 25-02-2026');
            return true;
        }

        const inputDate = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (inputDate < today) {
            this.bot.sendMessage(chatId, '❌ Дата не может быть в прошлом. Введите корректную дату:');
            return true;
        }

        state.routeData.departure_start = date;
        state.step = 'departure_end';

        this.bot.sendMessage(
            chatId,
            `✅ Начало диапазона: ${DateUtils.formatDateDisplay(date)}\n\n` +
            `📍 Шаг 6/${state.routeData.has_return ? '12' : '10'}: Конец диапазона вылета\n\n` +
            `Введите дату в формате ДД.ММ.ГГГГ:`,
            { reply_markup: { remove_keyboard: true } }
        );

        return true;
    }

    async _handleDepartureEndStep(chatId, text, state) {
        const date = DateUtils.convertDateFormat(text);

        if (!date) {
            this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД-ММ-ГГГГ, например: 10-03-2026');
            return true;
        }

        const endDate = new Date(date);
        const startDate = new Date(state.routeData.departure_start);

        if (endDate <= startDate) {
            this.bot.sendMessage(chatId, '❌ Конец диапазона должен быть позже начала. Введите корректную дату:');
            return true;
        }

        state.routeData.departure_end = date;

        if (state.routeData.has_return) {
            state.step = 'min_days';

            const keyboard = {
                reply_markup: {
                    keyboard: [
                        ['2', '3', '5'],
                        ['7', '10', '14'],
                        ['21', '28', '30']
                    ],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            };

            this.bot.sendMessage(
                chatId,
                `✅ Диапазон вылета: ${DateUtils.formatDateDisplay(state.routeData.departure_start)} - ${DateUtils.formatDateDisplay(date)}\n\n` +
                `📍 Шаг 7/12: Минимальное количество дней в стране\n\n` +
                `Выберите или введите число:`,
                keyboard
            );
        } else {
            // Нет обратного билета - проверяем количество комбинаций
            const tempRoute = {
                is_flexible: true,
                has_return: false,
                departure_start: state.routeData.departure_start,
                departure_end: state.routeData.departure_end
            };

            const combCount = UnifiedRoute.countCombinations(tempRoute);

            const subscription = await SubscriptionService.getUserSubscription(chatId);
            if (combCount > subscription.max_combinations) {
                this.bot.sendMessage(
                    chatId,
                    `⚠️ Получится ${combCount} ${this._pluralize(combCount, 'дата', 'даты', 'дат')} для проверки.\n\n` +
                    `📊 Ваша подписка "${subscription.display_name}" позволяет максимум ${subscription.max_combinations} комбинаций.\n` +
                    `💎 Хотите больше? Оформите подписку Plus (до 50 комбинаций)!\n\n` +
                    `Пожалуйста, сократите диапазон дат.`,
                    this.getMainMenuKeyboard(chatId)
                );
                delete this.userStates[chatId];
                return true;
            }

            // Всё ОК - переходим к авиакомпании
            state.step = 'airline';
            this._showAirlineKeyboard(chatId, state);
        }

        return true;
    }

    async _handleMinDaysStep(chatId, text, state) {
        const minDays = parseInt(text);

        if (isNaN(minDays) || minDays < 1 || minDays > 365) {
            this.bot.sendMessage(chatId, '❌ Введите число от 1 до 365:');
            return true;
        }

        state.routeData.min_days = minDays;
        state.step = 'max_days';

        const keyboard = {
            reply_markup: {
                keyboard: [
                    [String(minDays), String(minDays + 1), String(minDays + 2)],
                    ['7', '14', '21'],
                    ['28', '30', '60']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Минимум дней: ${minDays}\n\n` +
            `📍 Шаг 8/12: Максимальное количество дней в стране\n\n` +
            `Выберите или введите число (не менее ${minDays}):`,
            keyboard
        );

        return true;
    }

    async _handleMaxDaysStep(chatId, text, state) {
        const maxDays = parseInt(text);

        if (isNaN(maxDays) || maxDays < state.routeData.min_days || maxDays > 365) {
            this.bot.sendMessage(chatId, `❌ Введите число от ${state.routeData.min_days} до 365:`);
            return true;
        }

        state.routeData.max_days = maxDays;

        // Проверяем количество комбинаций
        const tempRoute = {
            is_flexible: true,
            has_return: true,
            departure_start: state.routeData.departure_start,
            departure_end: state.routeData.departure_end,
            min_days: state.routeData.min_days,
            max_days: maxDays
        };

        const combCount = UnifiedRoute.countCombinations(tempRoute);

        const subscription = await SubscriptionService.getUserSubscription(chatId);
        if (combCount > subscription.max_combinations) {
            this.bot.sendMessage(
                chatId,
                `⚠️ Получится ${combCount} ${this._pluralize(combCount, 'комбинация', 'комбинации', 'комбинаций')} для проверки.\n\n` +
                `📊 Ваша подписка "${subscription.display_name}" позволяет максимум ${subscription.max_combinations} комбинаций.\n` +
                `💎 Хотите больше? Оформите подписку Plus (до 50 комбинаций)!\n\n` +
                `Пожалуйста, сократите диапазон дат или количество дней пребывания.`,
                this.getMainMenuKeyboard(chatId)
            );
            delete this.userStates[chatId];
            return true;
        }

        // Всё ОК - показываем количество и переходим дальше
        this.bot.sendMessage(
            chatId,
            `✅ Максимум дней: ${maxDays}\n\n` +
            `📊 Будет проверено ${combCount} ${this._pluralize(combCount, 'комбинация', 'комбинации', 'комбинаций')}\n\n` +
            `Продолжаем настройку...`
        );

        state.step = 'airline';
        this._showAirlineKeyboard(chatId, state);

        return true;
    }

    _showAirlineKeyboard(chatId, state) {
        const data = state.routeData;
        let currentStep, totalSteps;

        if (data.is_flexible) {
            currentStep = data.has_return ? 9 : 7;
            totalSteps = data.has_return ? 12 : 10;
        } else {
            currentStep = data.has_return ? 7 : 6;
            totalSteps = data.has_return ? 12 : 11;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['🌐 Аэрофлот (SU)', 'S7 Airlines (S7)'],
                    ['Etihad (EY)', 'Emirates (EK)'],
                    ['Flydubai (FZ)', 'Utair (UT)'],
                    ['🌍 Любая'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `📍 Шаг ${currentStep}/${totalSteps}: Авиакомпания\n\n` +
            `Выберите предпочитаемую авиакомпанию или "Любая":`,
            keyboard
        );
    }

    async _handleAirlineStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        let airline = null;
        if (text.includes('Аэрофлот')) airline = 'SU';
        else if (text.includes('S7')) airline = 'S7';
        else if (text.includes('Etihad')) airline = 'EY';
        else if (text.includes('Emirates')) airline = 'EK';
        else if (text.includes('Flydubai')) airline = 'FZ';
        else if (text.includes('Utair')) airline = 'UT';

        state.routeData.airline = airline;
        state.step = 'adults';

        const data = state.routeData;
        let currentStep, totalSteps;

        if (data.is_flexible) {
            currentStep = data.has_return ? 10 : 8;
            totalSteps = data.has_return ? 12 : 10;
        } else {
            currentStep = data.has_return ? 8 : 7;
            totalSteps = data.has_return ? 12 : 11;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['1', '2', '3'],
                    ['4', '5', '6'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Авиакомпания: ${airline ? Formatters.getAirlineName(airline) : 'Любая'}\n\n` +
            `📍 Шаг ${currentStep}/${totalSteps}: Количество взрослых пассажиров (от 18 лет)\n\n` +
            `Выберите или введите число:`,
            keyboard
        );

        return true;
    }

    async _handleAdultsStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        const adults = parseInt(text);

        if (isNaN(adults) || adults < 1 || adults > 9) {
            this.bot.sendMessage(chatId, '❌ Введите число от 1 до 9:');
            return true;
        }

        state.routeData.adults = adults;
        state.step = 'children';

        const data = state.routeData;
        let currentStep, totalSteps;

        if (data.is_flexible) {
            currentStep = data.has_return ? 11 : 9;
            totalSteps = data.has_return ? 12 : 10;
        } else {
            currentStep = data.has_return ? 9 : 8;
            totalSteps = data.has_return ? 12 : 11;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['0 (без детей)'],
                    ['1', '2', '3'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Взрослых: ${adults}\n\n` +
            `📍 Шаг ${currentStep}/${totalSteps}: Количество детей (до 18 лет)\n\n` +
            `Выберите или введите число:`,
            keyboard
        );

        return true;
    }

    async _handleChildrenStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        const children = text.includes('без') ? 0 : parseInt(text);

        if (isNaN(children) || children < 0 || children > 8) {
            this.bot.sendMessage(chatId, '❌ Введите число от 0 до 8:');
            return true;
        }

        state.routeData.children = children;
        state.step = 'baggage';

        const data = state.routeData;
        let currentStep, totalSteps;

        if (data.is_flexible) {
            currentStep = data.has_return ? 12 : 10;
            totalSteps = data.has_return ? 12 : 10;
        } else {
            currentStep = data.has_return ? 10 : 9;
            totalSteps = data.has_return ? 12 : 11;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['✅ Да, нужен багаж 20 кг'],
                    ['❌ Нет, только ручная кладь'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Детей: ${children}\n\n` +
            `📍 Шаг ${currentStep}/${totalSteps}: Багаж\n\n` +
            `Нужен ли багаж? (20 кг в багажном отделении)`,
            keyboard
        );

        return true;
    }

    async _handleBaggageStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        const baggage = text.includes('Да') ? 1 : 0;
        state.routeData.baggage = baggage;
        state.step = 'max_stops';

        const data = state.routeData;
        let currentStep, totalSteps;

        if (data.is_flexible) {
            currentStep = data.has_return ? 13 : 11;
            totalSteps = data.has_return ? 13 : 11;
        } else {
            currentStep = data.has_return ? 11 : 10;
            totalSteps = data.has_return ? 12 : 11;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['0 (только прямые рейсы)'],
                    ['1 пересадка', '2 пересадки'],
                    ['🌍 Любое количество'],
                    ['🔙 Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `✅ Багаж: ${baggage ? '20 кг' : 'Только ручная кладь'}\n\n` +
            `📍 Шаг ${currentStep}/${totalSteps}: Пересадки\n\n` +
            `Сколько пересадок допустимо?`,
            keyboard
        );

        return true;
    }

    async _handleMaxStopsStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        let maxStops;
        if (text.includes('0') || text.includes('прямые')) {
            maxStops = 0;
            state.routeData.max_layover_hours = 0;
        } else if (text.includes('1')) {
            maxStops = 1;
        } else if (text.includes('2')) {
            maxStops = 2;
        } else {
            maxStops = 99; // Любое количество
        }

        state.routeData.max_stops = maxStops;

        if (maxStops === 0) {
            // Прямые рейсы - сразу к порогу
            state.step = 'threshold';
            this._showThresholdInput(chatId, state);
        } else {
            // Есть пересадки - спрашиваем максимальное время
            state.step = 'max_layover';

            const data = state.routeData;
            let currentStep, totalSteps;

            if (data.is_flexible) {
                currentStep = data.has_return ? 14 : 12;
                totalSteps = data.has_return ? 14 : 12;
            } else {
                currentStep = data.has_return ? 12 : 11;
                totalSteps = data.has_return ? 12 : 11;
            }

            const keyboard = {
                reply_markup: {
                    keyboard: [
                        ['5 часов', '10 часов'],
                        ['15 часов', '24 часа'],
                        ['🔙 Отмена']
                    ],
                    one_time_keyboard: true,
                    resize_keyboard: true
                }
            };

            this.bot.sendMessage(
                chatId,
                `✅ Пересадок: ${maxStops === 99 ? 'Любое количество' : maxStops}\n\n` +
                `📍 Шаг ${currentStep}/${totalSteps}: Максимальное время одной пересадки\n\n` +
                `Выберите или введите количество часов:`,
                keyboard
            );
        }

        return true;
    }

    async _handleMaxLayoverStep(chatId, text, state) {
        if (text === '🔙 Отмена') {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        const hours = parseInt(text.replace(/\D/g, ''));

        if (isNaN(hours) || hours <= 0 || hours > 48) {
            this.bot.sendMessage(chatId, '❌ Введите число от 1 до 48:');
            return true;
        }

        state.routeData.max_layover_hours = hours;
        state.step = 'threshold';
        this._showThresholdInput(chatId, state);

        return true;
    }

    _showThresholdInput(chatId, state) {
        const data = state.routeData;
        let totalSteps;

        if (data.is_flexible) {
            totalSteps = data.has_return ? 12 : 10;
        } else {
            totalSteps = data.has_return ? 12 : 11;
        }

        this.bot.sendMessage(
            chatId,
            `📍 Шаг ${totalSteps}/${totalSteps}: Пороговая цена\n\n` +
            `💰 Введите максимальную цену в рублях за весь маршрут, при которой вы хотите получать уведомления.\n\n` +
            `Например: 50000`,
            { reply_markup: { remove_keyboard: true } }
        );
    }

    async _handleThresholdStep(chatId, text, state) {
        const price = parseFloat(text);

        if (isNaN(price) || price <= 0) {
            this.bot.sendMessage(chatId, '❌ Введите корректную цену (число больше 0):');
            return true;
        }

        state.routeData.threshold_price = price;
        state.routeData.currency = 'RUB';
        state.step = 'confirm';

        // Показываем сводку для подтверждения
        await this._showConfirmation(chatId, state);
        return true;
    }

    async _showConfirmation(chatId, state) {
        const data = state.routeData;

        // Получаем подписку пользователя для определения интервала проверок
        let subscription;
        try {
            subscription = await SubscriptionService.getUserSubscription(chatId);
        } catch (error) {
            // Если не удалось получить подписку, используем значения по умолчанию
            subscription = {
                name: 'free',
                check_interval_hours: 4
            };
        }

        const checkInterval = subscription.check_interval_hours;

        // Функция для правильного склонения слова "час"
        const getHoursText = (hours) => {
            if (hours === 1) return 'час';
            if (hours >= 2 && hours <= 4) return 'часа';
            return 'часов';
        };

        let message = '✅ ПОДТВЕРЖДЕНИЕ МАРШРУТА\n\n';
        message += `✈️ ${data.origin} → ${data.destination}\n\n`;

        // Даты
        if (data.is_flexible) {
            message += `📅 Диапазон вылета: ${DateUtils.formatDateDisplay(data.departure_start)} - ${DateUtils.formatDateDisplay(data.departure_end)}\n`;
            if (data.has_return) {
                message += `📆 Пребывание: ${data.min_days}-${data.max_days} дней\n`;
                const combCount = UnifiedRoute.countCombinations({
                    is_flexible: true,
                    has_return: true,
                    departure_start: data.departure_start,
                    departure_end: data.departure_end,
                    min_days: data.min_days,
                    max_days: data.max_days
                });
                message += `📊 Будет проверено ${combCount} ${this._pluralize(combCount, 'комбинация', 'комбинации', 'комбинаций')}\n`;
            } else {
                message += `📆 В одну сторону\n`;
            }
        } else if (data.has_return) {
            message += `📅 Вылет: ${DateUtils.formatDateDisplay(data.departure_date)}\n`;
            message += `📅 Возврат: ${DateUtils.formatDateDisplay(data.return_date)}\n`;
        } else {
            message += `📅 Вылет: ${DateUtils.formatDateDisplay(data.departure_date)} (в одну сторону)\n`;
        }

        message += `\n👥 ${Formatters.formatPassengers(data.adults, data.children)}\n`;
        message += `🏢 ${Formatters.getAirlineName(data.airline)}\n`;
        message += data.baggage ? '🧳 С багажом 20 кг\n' : '🎒 Без багажа\n';

        if (data.max_stops === 0) {
            message += '🔄 Только прямые рейсы\n';
        } else if (data.max_stops === 99) {
            message += '🔄 Любое количество пересадок\n';
        } else {
            message += `🔄 До ${data.max_stops} ${this._pluralize(data.max_stops, 'пересадки', 'пересадок', 'пересадок')}\n`;
            if (data.max_layover_hours) {
                message += `⏱ Макс. время пересадки: ${data.max_layover_hours}ч\n`;
            }
        }

        message += `\n💰 Пороговая цена: ${Formatters.formatPrice(data.threshold_price, data.currency)}\n`;

        // Добавляем информацию о периодичности проверок в зависимости от подписки
        message += `\n📌 Бот будет автоматически проверять цены каждые ${checkInterval} ${getHoursText(checkInterval)} `;
        message += `и отправлять уведомления, когда найдет билеты дешевле указанного порога.`;

        // Добавляем информацию о тарифе
        if (subscription.display_name) {
            message += `\n\n📊 Ваш тариф: ${subscription.display_name}`;
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['✅ Сохранить маршрут'],
                    ['❌ Отменить']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(chatId, message, keyboard);
    }

    async _handleConfirmStep(chatId, text, state) {
        if (text.includes('Отменить')) {
            delete this.userStates[chatId];
            this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
            return true;
        }

        if (!text.includes('Сохранить')) {
            return true;
        }

        try {
            // Сохраняем маршрут
            const routeId = await UnifiedRoute.create(chatId, state.routeData);

            this.bot.sendMessage(
                chatId,
                '🎉 Маршрут успешно создан!\n\n' +
                '✅ Бот начнет автоматическую проверку цен в течение часа.\n' +
                '🔔 Вы получите уведомление, когда будет найдена цена ниже порога.',
                this.getMainMenuKeyboard(chatId)
            );

            delete this.userStates[chatId];

        } catch (error) {
            console.error('Ошибка создания маршрута:', error);
            this.bot.sendMessage(
                chatId,
                '❌ Ошибка при сохранении маршрута: ' + error.message,
                this.getMainMenuKeyboard(chatId)
            );
            delete this.userStates[chatId];
        }

        return true;
    }

    /**
     * РЕДАКТИРОВАНИЕ МАРШРУТА
     */
    handleEditRoute(chatId) {
        const state = this.userStates[chatId];
        if (!state || !state.route) {
            this.bot.sendMessage(chatId, '❌ Ошибка: маршрут не найден');
            return;
        }

        const route = state.route;
        const pauseText = route.is_paused ? '▶️ Возобновить' : '⏸️ Поставить на паузу';

        const keyboard = {
            reply_markup: {
                keyboard: [
                    [pauseText],
                    ['💰 Изменить порог цены'],
                    ['◀️ Назад']
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        };

        this.bot.sendMessage(chatId, '✏️ Выберите действие:', keyboard);
        this.userStates[chatId] = { step: 'edit_action', route };
    }

    async handleEditAction(chatId, text) {
        const state = this.userStates[chatId];
        if (!state || !state.route) {
            return false;
        }

        const route = state.route;

        if (text.includes('паузу') || text.includes('Возобновить')) {
            // Переключаем паузу
            const newPauseStatus = !route.is_paused;
            await UnifiedRoute.updatePauseStatus(route.id, newPauseStatus);

            this.bot.sendMessage(
                chatId,
                newPauseStatus ? '⏸️ Маршрут поставлен на паузу. Проверка цен остановлена.' : '▶️ Маршрут возобновлен. Проверка цен продолжится.',
                this.getMainMenuKeyboard(chatId)
            );
            delete this.userStates[chatId];
            return true;
        }

        if (text.includes('Изменить порог')) {
            state.step = 'edit_threshold';
            this.bot.sendMessage(
                chatId,
                `💰 Текущий порог: ${Formatters.formatPrice(route.threshold_price, route.currency)}\n\n` +
                'Введите новую пороговую цену в рублях:',
                { reply_markup: { remove_keyboard: true } }
            );
            return true;
        }

        if (text === '◀️ Назад') {
            await this.handleRouteDetails(chatId, state.routes.findIndex(r => r.id === route.id));
            return true;
        }

        return false;
    }

    async handleEditThreshold(chatId, text) {
        const state = this.userStates[chatId];
        if (!state || !state.route) {
            return false;
        }

        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
            this.bot.sendMessage(chatId, '❌ Введите корректную цену (число больше 0):');
            return true;
        }

        await UnifiedRoute.updateThreshold(state.route.id, price);

        this.bot.sendMessage(
            chatId,
            `✅ Пороговая цена изменена на ${Formatters.formatPrice(price, state.route.currency)}`,
            this.getMainMenuKeyboard(chatId)
        );

        delete this.userStates[chatId];
        return true;
    }

    /**
     * УДАЛЕНИЕ МАРШРУТА
     */
    handleDeleteRoute(chatId) {
        const state = this.userStates[chatId];
        if (!state || !state.route) {
            this.bot.sendMessage(chatId, '❌ Ошибка: маршрут не найден');
            return;
        }

        const route = state.route;

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['✅ Да, удалить'],
                    ['❌ Нет, отменить']
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            `⚠️ Вы уверены, что хотите удалить маршрут?\n\n` +
            `✈️ ${route.origin} → ${route.destination}\n\n` +
            `Это действие нельзя отменить. Вся история цен будет удалена.`,
            keyboard
        );

        this.userStates[chatId] = { step: 'confirm_delete', route };
    }

    async handleConfirmDelete(chatId, text) {
        const state = this.userStates[chatId];
        if (!state || !state.route) {
            return false;
        }

        if (text.includes('Да')) {
            await UnifiedRoute.delete(state.route.id);
            this.bot.sendMessage(
                chatId,
                '✅ Маршрут успешно удален',
                this.getMainMenuKeyboard(chatId)
            );
        } else {
            this.bot.sendMessage(
                chatId,
                '❌ Удаление отменено',
                this.getMainMenuKeyboard(chatId)
            );
        }

        delete this.userStates[chatId];
        return true;
    }

    async handleShowChart(chatId, route) {
        try {
            // Кнопки действий
            const keyboard = {
                reply_markup: {
                    keyboard: [
                        ['✏️ Редактировать'],
                        ['📊 График цен', '🗺️ Heatmap'],
                        ['🗑️ Удалить'],
                        ['◀️ Назад к маршрутам']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            await this.bot.sendMessage(chatId, '📊 Генерирую график цен...', keyboard);

            let chartBuffer;
            if (route.is_flexible) {
                chartBuffer = await this.chartGenerator.generateFlexibleRoutePriceChart(route, chatId);
            } else {
                chartBuffer = await this.chartGenerator.generateRegularRoutePriceChart(route, chatId);
            }

            if (!chartBuffer) {
                await this.bot.sendMessage(
                    chatId,
                    '❌ Недостаточно данных для построения графика.\n\nДождитесь накопления истории цен (минимум несколько проверок).'
                );
                return;
            }

            await this.bot.sendPhoto(chatId, chartBuffer, {
                caption: `📊 График цен: ${route.origin} → ${route.destination}`
            });

            return true;
        } catch (error) {
            console.error('Ошибка генерации графика:', error);
            await this.bot.sendMessage(chatId, '❌ Ошибка генерации графика: ' + error.message);
        }
    }

    /**
     * Показать тепловую карту для маршрута
     */
    async handleShowHeatmap(chatId, route) {
        try {
            // Кнопки действий
            const keyboard = {
                reply_markup: {
                    keyboard: [
                        ['✏️ Редактировать'],
                        ['📊 График цен', '🗺️ Heatmap'],
                        ['🗑️ Удалить'],
                        ['◀️ Назад к маршрутам']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            await this.bot.sendMessage(chatId, '🔥 Генерирую тепловую карту...', keyboard);

            const routeType = route.is_flexible ? 'flexible' : 'regular';
            const heatmapBuffer = await this.chartGenerator.generateHeatmapChart(route, chatId, routeType);

            if (!heatmapBuffer) {
                await this.bot.sendMessage(
                    chatId,
                    '❌ Недостаточно данных для тепловой карты.\n\nТребуется минимум 50-100 проверок для построения карты по часам и дням недели.'
                );
                return;
            }

            await this.bot.sendPhoto(chatId, heatmapBuffer, {
                caption: `🔥 Тепловая карта цен: ${route.origin} → ${route.destination}\n\nПоказывает минимальные цены по дням недели и часам суток`
            });

        } catch (error) {
            console.error('Ошибка генерации тепловой карты:', error);
            await this.bot.sendMessage(chatId, '❌ Ошибка генерации тепловой карты: ' + error.message, );
        }
    }

    /**
     * ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
     */
    _pluralize(number, one, two, five) {
        let n = Math.abs(number);
        n %= 100;
        if (n >= 5 && n <= 20) {
            return five;
        }
        n %= 10;
        if (n === 1) {
            return one;
        }
        if (n >= 2 && n <= 4) {
            return two;
        }
        return five;
    }
}

module.exports = RouteHandlers;
