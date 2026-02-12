const Trip = require('../models/Trip');
const TripLeg = require('../models/TripLeg');
const TripResult = require('../models/TripResult');
const TripOptimizer = require('../services/TripOptimizer');
const SubscriptionService = require('../services/SubscriptionService');
const AirportService = require('../services/AirportService');
const AirportFormatter = require('../utils/airportFormatter');
const DateUtils = require('../utils/dateUtils');
const Formatters = require('../utils/formatters');
const ActivityService = require('../services/ActivityService');
const airportResolver = require('../utils/AirportCodeResolver');
const UnifiedRoute = require('../models/UnifiedRoute');

class TripHandlers {
    constructor(bot, userStates) {
        this.bot = bot;
        this.userStates = userStates;
        this.airportService = new AirportService();
    }

    getMainMenuKeyboard(chatId) {
        const keyboard = [
            ['📋 Мои маршруты'],
            ['⚙️ Настройки', '📊 Моя подписка'],
            ['ℹ️ Помощь']
        ];
        if (chatId === 341508411) {
            keyboard.push(['✅ Проверить сейчас']);
        }
        return {
            reply_markup: { keyboard, resize_keyboard: true, persistent: true }
        };
    }

    // ========================================
    // НАЧАЛО СОЗДАНИЯ ТРИПА
    // ========================================

    async handleCreateTrip(chatId) {
        ActivityService.logEvent(chatId, 'create_trip_start').catch(err => console.error('Activity log error:', err));

        this.userStates[chatId] = {
            step: 'trip_origin',
            tripData: {
                origin: null,
                legs: [],
                departure_start: null,
                departure_end: null,
                threshold_price: null
            }
        };

        await this._showTripOriginStep(chatId);
    }

    // ========================================
    // ОБРАБОТКА ШАГОВ
    // ========================================

    async handleTripStep(chatId, text) {
        const state = this.userStates[chatId];
        if (!state || !state.tripData) return false;

        try {
            switch (state.step) {
                // --- Города и маршрут ---
                case 'trip_origin':
                    return await this._handleTripOrigin(chatId, text, state);
                case 'trip_origin_search':
                    return await this._handleTripOriginSearch(chatId, text, state);
                case 'trip_origin_confirm':
                    return await this._handleAirportConfirm(chatId, text, state);
                case 'trip_origin_select':
                    return await this._handleAirportSelect(chatId, text, state);
                case 'trip_next_city':
                    return await this._handleNextCity(chatId, text, state);
                case 'trip_next_city_search':
                    return await this._handleNextCitySearch(chatId, text, state);
                case 'trip_next_city_confirm':
                    return await this._handleAirportConfirm(chatId, text, state);
                case 'trip_next_city_select':
                    return await this._handleAirportSelect(chatId, text, state);
                case 'trip_stay_min':
                    return await this._handleStayMin(chatId, text, state);
                case 'trip_stay_max':
                    return await this._handleStayMax(chatId, text, state);
                case 'trip_add_more':
                    return await this._handleAddMore(chatId, text, state);

                // --- Даты ---
                case 'trip_departure_start':
                    return await this._handleDepartureStart(chatId, text, state);
                case 'trip_departure_end':
                    return await this._handleDepartureEnd(chatId, text, state);

                // --- Выбор режима фильтров ---
                case 'trip_filter_mode':
                    return await this._handleFilterMode(chatId, text, state);

                // --- Одинаковые фильтры для всех (ручной ввод) ---
                case 'trip_all_adults':
                    return await this._handleAllAdults(chatId, text, state);
                case 'trip_all_children':
                    return await this._handleAllChildren(chatId, text, state);
                case 'trip_all_airline':
                    return await this._handleAllAirline(chatId, text, state);
                case 'trip_all_baggage':
                    return await this._handleAllBaggage(chatId, text, state);
                case 'trip_all_stops':
                    return await this._handleAllStops(chatId, text, state);
                case 'trip_all_layover':
                    return await this._handleAllLayover(chatId, text, state);

                // --- Выбор фильтров (пресет/ручной) ---
                case 'trip_leg_choose':
                    return await this._handleLegChoose(chatId, text, state);
                case 'trip_all_choose':
                    return await this._handleAllChoose(chatId, text, state);

                // --- Ручная настройка для каждого плеча ---
                case 'trip_leg_adults':
                    return await this._handleLegAdults(chatId, text, state);
                case 'trip_leg_children':
                    return await this._handleLegChildren(chatId, text, state);
                case 'trip_leg_airline':
                    return await this._handleLegAirline(chatId, text, state);
                case 'trip_leg_baggage':
                    return await this._handleLegBaggage(chatId, text, state);
                case 'trip_leg_stops':
                    return await this._handleLegStops(chatId, text, state);
                case 'trip_leg_layover':
                    return await this._handleLegLayover(chatId, text, state);

                // --- Бюджет и подтверждение ---
                case 'trip_threshold':
                    return await this._handleThreshold(chatId, text, state);
                case 'trip_confirm':
                    return await this._handleConfirm(chatId, text, state);
            }
        } catch (error) {
            console.error('Ошибка обработки шага трипа:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка: ' + error.message);
            delete this.userStates[chatId];
        }

        return false;
    }

    // ========================================
    // ОБЩИЕ ХЕЛПЕРЫ
    // ========================================

    _handleCancel(chatId) {
        delete this.userStates[chatId];
        this.bot.sendMessage(chatId, '❌ Создание маршрута отменено', this.getMainMenuKeyboard(chatId));
    }

    _parseAirlineInput(text) {
        if (text === '🌍 Любая') return null;
        const match = text.match(/\(([A-Z0-9]{2})\)/);
        return match ? match[1] : text.toUpperCase().substring(0, 2);
    }

    _formatLegFiltersSummary(leg) {
        const adults = leg.adults || 1;
        const children = leg.children || 0;

        // Passengers
        let pax = `👥${adults}взр`;
        if (children > 0) pax += `+${children}дет`;

        // Airline
        const airline = leg.airline
            ? `✈️${Formatters.getAirlineName(leg.airline)}`
            : '✈️Любая';

        // Baggage
        const baggage = leg.baggage ? '🧳багаж' : '🎒без багажа';

        // Stops — always shown
        let stops;
        if (leg.max_stops === 0) {
            stops = '🔄прямой';
        } else if (leg.max_stops === 1) {
            stops = leg.max_layover_hours ? `🔄до 1 пер.(${leg.max_layover_hours}ч)` : '🔄до 1 пер.';
        } else if (leg.max_stops === 2) {
            stops = '🔄до 2 пер.';
        } else {
            stops = '🔄любые пер.';
        }

        return `${pax} | ${airline} | ${baggage} | ${stops}`;
    }

    // ========================================
    // УНИФИЦИРОВАННЫЕ КЛАВИАТУРЫ ФИЛЬТРОВ
    // ========================================

    _airlineKeyboard() {
        return [
            ['🌍 Любая'],
            ['🌐 Аэрофлот (SU)', 'S7 Airlines (S7)'],
            ['Etihad (EY)', 'Emirates (EK)'],
            ['Flydubai (FZ)', 'Utair (UT)'],
            ['🔙 Назад', '❌ Отмена']
        ];
    }

    _adultsKeyboard() {
        return [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['🔙 Назад', '❌ Отмена']
        ];
    }

    _childrenKeyboard() {
        return [
            ['0 (без детей)'],
            ['1', '2', '3'],
            ['🔙 Назад', '❌ Отмена']
        ];
    }

    _baggageKeyboard() {
        return [
            ['🧳 С багажом 20 кг'],
            ['🎒 Без багажа'],
            ['🔙 Назад', '❌ Отмена']
        ];
    }

    _stopsKeyboard() {
        return [
            ['0 (прямой)'],
            ['1 (до 1)'],
            ['2 (до 2)'],
            ['🌐 Любое'],
            ['🔙 Назад', '❌ Отмена']
        ];
    }

    _layoverKeyboard() {
        return [
            ['5 ч', '10 ч', '15 ч'],
            ['24 ч'],
            ['🔙 Назад', '❌ Отмена']
        ];
    }

    _makeKeyboard(rows) {
        return {
            reply_markup: {
                keyboard: rows,
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };
    }

    // ========================================
    // ШАГ 1: Город отправления
    // ========================================

    async _showTripOriginStep(chatId) {
        const popularAirports = await this.airportService.getPopularOriginAirports(chatId, 6);
        const airportButtons = [];
        for (let i = 0; i < popularAirports.length; i += 2) {
            const row = [AirportFormatter.formatButtonText(popularAirports[i])];
            if (i + 1 < popularAirports.length) {
                row.push(AirportFormatter.formatButtonText(popularAirports[i + 1]));
            }
            airportButtons.push(row);
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ...airportButtons,
                    ['🔍 Поиск аэропорта'],
                    ['❌ Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        this.bot.sendMessage(
            chatId,
            '🗺️ СОСТАВНОЙ МАРШРУТ\n\n📍 Шаг 1: Откуда начинается путешествие?\n\nВыберите город отправления:',
            keyboard
        );
    }

    async _handleTripOrigin(chatId, text, state) {
        if (text === '❌ Отмена') {
            this._handleCancel(chatId);
            return true;
        }

        if (text === '🔍 Поиск аэропорта') {
            state.step = 'trip_origin_search';
            this.bot.sendMessage(chatId, '🔍 Введите название города или код аэропорта:', { reply_markup: { remove_keyboard: true } });
            return true;
        }

        const iataCode = AirportFormatter.parseAirportInput(text);
        if (iataCode) {
            const airport = await this.airportService.getAirportByCode(iataCode);
            if (airport) {
                state.tripData.origin = iataCode;
                state.tripData.origin_city = airport.city_name;
                await this._showNextCityStep(chatId, state);
                return true;
            }
        }

        await this._searchAndShowAirports(chatId, text, 'trip_origin');
        return true;
    }

    async _handleTripOriginSearch(chatId, text, state) {
        if (text === '🔙 Назад') {
            state.step = 'trip_origin';
            await this._showTripOriginStep(chatId);
            return true;
        }
        await this._searchAndShowAirports(chatId, text, 'trip_origin');
        return true;
    }

    // ========================================
    // ШАГ 2: Следующий город (цикл)
    // ========================================

    async _showNextCityStep(chatId, state) {
        const legNum = state.tripData.legs.length + 1;
        const lastCity = state.tripData.legs.length > 0
            ? state.tripData.legs[state.tripData.legs.length - 1].destination_city || state.tripData.legs[state.tripData.legs.length - 1].destination
            : state.tripData.origin_city || state.tripData.origin;

        const popularAirports = await this.airportService.getPopularDestinationAirports(chatId, 6);
        const airportButtons = [];
        for (let i = 0; i < popularAirports.length; i += 2) {
            const row = [AirportFormatter.formatButtonText(popularAirports[i])];
            if (i + 1 < popularAirports.length) {
                row.push(AirportFormatter.formatButtonText(popularAirports[i + 1]));
            }
            airportButtons.push(row);
        }

        const keyboard = {
            reply_markup: {
                keyboard: [
                    ...airportButtons,
                    ['🔍 Поиск аэропорта'],
                    ['🔙 Назад', '❌ Отмена']
                ],
                one_time_keyboard: true,
                resize_keyboard: true
            }
        };

        state.step = 'trip_next_city';

        let routePreview = state.tripData.origin;
        for (const leg of state.tripData.legs) {
            routePreview += ` → ${leg.destination}`;
        }

        this.bot.sendMessage(
            chatId,
            `🗺️ Маршрут: ${routePreview}\n\n` +
            `📍 Шаг 2: Куда дальше из ${lastCity}?\n\n` +
            `Нога ${legNum}: Выберите следующий город:`,
            keyboard
        );
    }

    async _handleNextCity(chatId, text, state) {
        if (text === '❌ Отмена') {
            this._handleCancel(chatId);
            return true;
        }

        if (text === '🔙 Назад') {
            // Go back: remove last leg if any, or go to origin
            if (state.tripData.legs.length > 0) {
                state.tripData.legs.pop();
                if (state.tripData.legs.length > 0) {
                    await this._showAddMoreStep(chatId, state);
                } else {
                    state.step = 'trip_origin';
                    await this._showTripOriginStep(chatId);
                }
            } else {
                state.step = 'trip_origin';
                await this._showTripOriginStep(chatId);
            }
            return true;
        }

        if (text === '🔍 Поиск аэропорта') {
            state.step = 'trip_next_city_search';
            this.bot.sendMessage(chatId, '🔍 Введите название города или код аэропорта:', { reply_markup: { remove_keyboard: true } });
            return true;
        }

        const iataCode = AirportFormatter.parseAirportInput(text);
        if (iataCode) {
            const airport = await this.airportService.getAirportByCode(iataCode);
            if (airport) {
                state._tempDestination = iataCode;
                state._tempDestinationCity = airport.city_name;
                await this._showStayMinStep(chatId, state);
                return true;
            }
        }

        await this._searchAndShowAirports(chatId, text, 'trip_next_city');
        return true;
    }

    async _handleNextCitySearch(chatId, text, state) {
        if (text === '🔙 Назад') {
            await this._showNextCityStep(chatId, state);
            return true;
        }
        await this._searchAndShowAirports(chatId, text, 'trip_next_city');
        return true;
    }

    // ========================================
    // ШАГ 2b: Дни пребывания
    // ========================================

    async _showStayMinStep(chatId, state) {
        state.step = 'trip_stay_min';
        const city = state._tempDestinationCity || state._tempDestination;

        const keyboard = this._makeKeyboard([
            ['1', '2', '3'],
            ['4', '5', '7'],
            ['10', '14'],
            ['🔙 Назад', '❌ Отмена']
        ]);

        this.bot.sendMessage(
            chatId,
            `📅 Минимум дней в ${city}?\n\n(Введите число или выберите из списка)`,
            keyboard
        );
    }

    async _handleStayMin(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            delete state._tempDestination;
            delete state._tempDestinationCity;
            await this._showNextCityStep(chatId, state);
            return true;
        }

        const days = parseInt(text);
        if (isNaN(days) || days < 1 || days > 60) {
            this.bot.sendMessage(chatId, '❌ Введите число от 1 до 60');
            return true;
        }

        state._tempMinDays = days;
        state.step = 'trip_stay_max';

        const suggestions = [days, days + 1, days + 2, days + 3].filter(d => d <= 60);

        const keyboard = this._makeKeyboard([
            suggestions.map(String),
            ['🔙 Назад', '❌ Отмена']
        ]);

        const city = state._tempDestinationCity || state._tempDestination;
        this.bot.sendMessage(
            chatId,
            `📅 Максимум дней в ${city}? (минимум: ${days})`,
            keyboard
        );

        return true;
    }

    async _handleStayMax(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            await this._showStayMinStep(chatId, state);
            return true;
        }

        const days = parseInt(text);
        if (isNaN(days) || days < state._tempMinDays || days > 60) {
            this.bot.sendMessage(chatId, `❌ Введите число от ${state._tempMinDays} до 60`);
            return true;
        }

        const origin = state.tripData.legs.length > 0
            ? state.tripData.legs[state.tripData.legs.length - 1].destination
            : state.tripData.origin;

        state.tripData.legs.push({
            origin: origin,
            destination: state._tempDestination,
            destination_city: state._tempDestinationCity,
            min_days: state._tempMinDays,
            max_days: days
        });

        delete state._tempDestination;
        delete state._tempDestinationCity;
        delete state._tempMinDays;

        await this._showAddMoreStep(chatId, state);
        return true;
    }

    // ========================================
    // ШАГ 2c: Добавить ещё или завершить
    // ========================================

    async _showAddMoreStep(chatId, state) {
        state.step = 'trip_add_more';

        const subscription = await SubscriptionService.getUserSubscription(chatId);
        const maxLegs = subscription.name === 'admin' ? 99 : subscription.name === 'plus' ? 7 : 5;

        let routePreview = state.tripData.origin;
        for (const leg of state.tripData.legs) {
            routePreview += ` → ${leg.destination}`;
        }

        const originCity = state.tripData.origin_city || state.tripData.origin;
        const buttons = [];

        if (state.tripData.legs.length < maxLegs - 1) {
            buttons.push(['➕ Добавить ещё город']);
        }

        buttons.push([`🏠 Вернуться в ${originCity}`]);
        buttons.push(['✅ Закончить здесь']);
        buttons.push(['🔙 Назад', '❌ Отмена']);

        let message = `🗺️ Маршрут: ${routePreview}\n\n`;
        for (let i = 0; i < state.tripData.legs.length; i++) {
            const leg = state.tripData.legs[i];
            message += `${i + 1}️⃣ ${leg.origin} → ${leg.destination}: ${leg.min_days}-${leg.max_days} дн.\n`;
        }
        message += `\nЧто дальше?`;

        if (state.tripData.legs.length >= maxLegs - 1) {
            message += `\n\n⚠️ Лимит подписки: максимум ${maxLegs} ног`;
        }

        this.bot.sendMessage(chatId, message, this._makeKeyboard(buttons));
    }

    async _handleAddMore(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            // Remove last leg and go back to previous city selection
            if (state.tripData.legs.length > 0) {
                state.tripData.legs.pop();
                if (state.tripData.legs.length > 0) {
                    await this._showAddMoreStep(chatId, state);
                } else {
                    await this._showNextCityStep(chatId, state);
                }
            }
            return true;
        }

        if (text === '➕ Добавить ещё город') {
            await this._showNextCityStep(chatId, state);
            return true;
        }

        const originCity = state.tripData.origin_city || state.tripData.origin;

        if (text === `🏠 Вернуться в ${originCity}`) {
            const lastDest = state.tripData.legs[state.tripData.legs.length - 1].destination;
            state.tripData.legs.push({
                origin: lastDest,
                destination: state.tripData.origin,
                destination_city: state.tripData.origin_city,
                min_days: null,
                max_days: null
            });
            await this._showDepartureStartStep(chatId, state);
            return true;
        }

        if (text === '✅ Закончить здесь') {
            await this._showDepartureStartStep(chatId, state);
            return true;
        }

        return false;
    }

    // ========================================
    // ШАГ 3: Даты вылета
    // ========================================

    async _showDepartureStartStep(chatId, state) {
        state.step = 'trip_departure_start';

        const keyboard = this._makeKeyboard([['🔙 Назад', '❌ Отмена']]);

        this.bot.sendMessage(
            chatId,
            '📅 Шаг 3: Начало диапазона вылета\n\nВведите дату начала диапазона (ДД.ММ.ГГГГ):\n\nНапример: 01.03.2025',
            keyboard
        );
    }

    async _handleDepartureStart(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            // Remove last leg if it's the return leg (no min/max days)
            const lastLeg = state.tripData.legs[state.tripData.legs.length - 1];
            if (lastLeg && lastLeg.min_days === null && lastLeg.max_days === null) {
                state.tripData.legs.pop();
            }
            await this._showAddMoreStep(chatId, state);
            return true;
        }

        const date = DateUtils.convertDateFormat(text);
        if (!date) {
            this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ');
            return true;
        }

        const dateObj = new Date(date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dateObj < today) {
            this.bot.sendMessage(chatId, '❌ Дата не может быть в прошлом');
            return true;
        }

        state.tripData.departure_start = date;
        state.step = 'trip_departure_end';

        const keyboard = this._makeKeyboard([['🔙 Назад', '❌ Отмена']]);

        this.bot.sendMessage(
            chatId,
            `📅 Начало: ${DateUtils.formatDateDisplay(date)}\n\n📅 Конец диапазона вылета?\n\nВведите дату (ДД.ММ.ГГГГ):`,
            keyboard
        );

        return true;
    }

    async _handleDepartureEnd(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            await this._showDepartureStartStep(chatId, state);
            return true;
        }

        const date = DateUtils.convertDateFormat(text);
        if (!date) {
            this.bot.sendMessage(chatId, '❌ Неверный формат даты. Используйте ДД.ММ.ГГГГ');
            return true;
        }

        if (new Date(date) <= new Date(state.tripData.departure_start)) {
            this.bot.sendMessage(chatId, '❌ Конец диапазона должен быть позже начала');
            return true;
        }

        state.tripData.departure_end = date;

        // Check API calls limit
        const fakeTrip = { departure_start: state.tripData.departure_start, departure_end: date };
        const fakeLegs = state.tripData.legs.map((l, i) => ({
            leg_order: i + 1, origin: l.origin, destination: l.destination,
            min_days: l.min_days, max_days: l.max_days
        }));

        const apiCalls = TripOptimizer.countApiCalls(fakeTrip, fakeLegs);
        const subscription = await SubscriptionService.getUserSubscription(chatId);

        if (apiCalls > subscription.max_combinations) {
            this.bot.sendMessage(
                chatId,
                `⚠️ Этот трип потребует ${apiCalls} проверок, а лимит подписки "${subscription.display_name}" — ${subscription.max_combinations}.\n\n` +
                `Попробуйте уменьшить диапазон дат или количество дней пребывания.`
            );
            await this._showDepartureStartStep(chatId, state);
            return true;
        }

        // Go to filter mode selection
        await this._showFilterModeStep(chatId, state);
        return true;
    }

    // ========================================
    // ШАГ 4: Выбор режима фильтров
    // ========================================

    async _showFilterModeStep(chatId, state) {
        state.step = 'trip_filter_mode';

        const buttons = [
            ['🔧 Фильтры для каждого плеча'],
            ['⚡ Фильтры на весь маршрут'],
            ['🔙 Назад', '❌ Отмена']
        ];

        this.bot.sendMessage(
            chatId,
            '✈️ Фильтры для плечей маршрута\n\nВыберите способ настройки:',
            this._makeKeyboard(buttons)
        );
    }

    async _handleFilterMode(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            await this._showDepartureEndBack(chatId, state);
            return true;
        }

        if (text === '🔧 Фильтры для каждого плеча') {
            state.tripData._filterMode = 'per_leg';
            state.tripData._currentLegIndex = 0;
            state.tripData._presets = await this._loadPresets(chatId);
            await this._showLegChooseStep(chatId, state);
            return true;
        }

        if (text === '⚡ Фильтры на весь маршрут') {
            state.tripData._filterMode = 'all';
            state.tripData._tempFilters = {};
            state.tripData._presets = await this._loadPresets(chatId);
            await this._showAllChooseStep(chatId, state);
            return true;
        }

        return false;
    }

    async _showDepartureEndBack(chatId, state) {
        state.step = 'trip_departure_end';
        const keyboard = this._makeKeyboard([['🔙 Назад', '❌ Отмена']]);
        this.bot.sendMessage(
            chatId,
            `📅 Начало: ${DateUtils.formatDateDisplay(state.tripData.departure_start)}\n\n📅 Конец диапазона вылета?\n\nВведите дату (ДД.ММ.ГГГГ):`,
            keyboard
        );
    }

    // ========================================
    // ОДИНАКОВЫЕ ФИЛЬТРЫ ДЛЯ ВСЕХ ПЛЕЧЕЙ (РУЧНОЙ ВВОД)
    // ========================================

    async _showAllAdultsStep(chatId, state) {
        state.step = 'trip_all_adults';
        this.bot.sendMessage(
            chatId,
            '👥 Количество взрослых пассажиров (от 18 лет)',
            this._makeKeyboard(this._adultsKeyboard())
        );
    }

    async _handleAllAdults(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            await this._showAllChooseStep(chatId, state);
            return true;
        }

        const adults = parseInt(text);
        if (isNaN(adults) || adults < 1 || adults > 6) {
            this.bot.sendMessage(chatId, '❌ Введите число от 1 до 6');
            return true;
        }

        state.tripData._tempFilters.adults = adults;
        state.step = 'trip_all_children';
        this.bot.sendMessage(
            chatId,
            '👶 Количество детей (до 18 лет)',
            this._makeKeyboard(this._childrenKeyboard())
        );
        return true;
    }

    async _handleAllChildren(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            await this._showAllAdultsStep(chatId, state);
            return true;
        }

        const children = text.startsWith('0') ? 0 : parseInt(text);
        if (isNaN(children) || children < 0 || children > 9) {
            this.bot.sendMessage(chatId, '❌ Введите число от 0 до 9');
            return true;
        }

        state.tripData._tempFilters.children = children;
        state.step = 'trip_all_airline';
        this.bot.sendMessage(
            chatId,
            '✈️ Авиакомпания\n\nВыберите предпочитаемую авиакомпанию или "Любая":',
            this._makeKeyboard(this._airlineKeyboard())
        );
        return true;
    }

    async _handleAllAirline(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_all_children';
            this.bot.sendMessage(chatId, '👶 Количество детей (до 18 лет)', this._makeKeyboard(this._childrenKeyboard()));
            return true;
        }

        state.tripData._tempFilters.airline = this._parseAirlineInput(text);
        state.step = 'trip_all_baggage';
        this.bot.sendMessage(chatId, '🧳 Багаж', this._makeKeyboard(this._baggageKeyboard()));
        return true;
    }

    async _handleAllBaggage(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_all_airline';
            this.bot.sendMessage(chatId, '✈️ Авиакомпания\n\nВыберите предпочитаемую авиакомпанию или "Любая":', this._makeKeyboard(this._airlineKeyboard()));
            return true;
        }

        state.tripData._tempFilters.baggage = text.includes('С багажом') ? 1 : 0;
        state.step = 'trip_all_stops';
        this.bot.sendMessage(chatId, '🔄 Пересадки', this._makeKeyboard(this._stopsKeyboard()));
        return true;
    }

    async _handleAllStops(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_all_baggage';
            this.bot.sendMessage(chatId, '🧳 Багаж', this._makeKeyboard(this._baggageKeyboard()));
            return true;
        }

        if (text.startsWith('0')) {
            state.tripData._tempFilters.max_stops = 0;
            state.tripData._tempFilters.max_layover_hours = null;
            this._applyFiltersToAllLegs(state);
            await this._showThresholdStep(chatId, state);
        } else if (text.startsWith('1')) {
            state.tripData._tempFilters.max_stops = 1;
            state.step = 'trip_all_layover';
            this.bot.sendMessage(chatId, '⏱ Максимальное время пересадки', this._makeKeyboard(this._layoverKeyboard()));
        } else if (text.startsWith('2')) {
            state.tripData._tempFilters.max_stops = 2;
            state.step = 'trip_all_layover';
            this.bot.sendMessage(chatId, '⏱ Максимальное время пересадки', this._makeKeyboard(this._layoverKeyboard()));
        } else {
            // Любое
            state.tripData._tempFilters.max_stops = null;
            state.tripData._tempFilters.max_layover_hours = null;
            this._applyFiltersToAllLegs(state);
            await this._showThresholdStep(chatId, state);
        }

        return true;
    }

    async _handleAllLayover(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_all_stops';
            this.bot.sendMessage(chatId, '🔄 Пересадки', this._makeKeyboard(this._stopsKeyboard()));
            return true;
        }

        const hours = parseInt(text);
        state.tripData._tempFilters.max_layover_hours = isNaN(hours) ? null : hours;

        this._applyFiltersToAllLegs(state);
        await this._showThresholdStep(chatId, state);
        return true;
    }

    _applyFiltersToAllLegs(state) {
        const f = state.tripData._tempFilters;
        for (const leg of state.tripData.legs) {
            leg.adults = f.adults;
            leg.children = f.children;
            leg.airline = f.airline;
            leg.baggage = f.baggage;
            leg.max_stops = f.max_stops;
            leg.max_layover_hours = f.max_layover_hours;
        }
        delete state.tripData._tempFilters;
        delete state.tripData._presets;
    }

    // ========================================
    // ЗАГРУЗКА ПРЕСЕТОВ И ЭКРАНЫ ВЫБОРА
    // ========================================

    async _loadPresets(chatId) {
        try {
            const routes = await UnifiedRoute.findNonArchivedByChatId(chatId);
            const trips = await Trip.findNonArchivedByChatId(chatId);

            const presets = [];
            const seenKeys = new Set();

            for (const r of routes) {
                const key = `${r.adults || 1}|${r.children || 0}|${r.airline || ''}|${r.baggage || 0}|${r.max_stops != null ? r.max_stops : ''}|${r.max_layover_hours || ''}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    presets.push({
                        adults: r.adults || 1,
                        children: r.children || 0,
                        airline: r.airline || null,
                        baggage: r.baggage || 0,
                        max_stops: r.max_stops != null ? r.max_stops : null,
                        max_layover_hours: r.max_layover_hours || null,
                        source: `${r.origin}→${r.destination}`
                    });
                }
            }

            for (const t of trips) {
                const legs = await TripLeg.getByTripId(t.id);
                for (const leg of legs) {
                    const key = `${leg.adults || 1}|${leg.children || 0}|${leg.airline || ''}|${leg.baggage || 0}|${leg.max_stops != null ? leg.max_stops : ''}|${leg.max_layover_hours || ''}`;
                    if (!seenKeys.has(key)) {
                        seenKeys.add(key);
                        presets.push({
                            adults: leg.adults || 1,
                            children: leg.children || 0,
                            airline: leg.airline || null,
                            baggage: leg.baggage || 0,
                            max_stops: leg.max_stops != null ? leg.max_stops : null,
                            max_layover_hours: leg.max_layover_hours || null,
                            source: `${leg.origin}→${leg.destination}`
                        });
                    }
                }
            }

            return presets;
        } catch (error) {
            console.error('Ошибка загрузки пресетов:', error);
            return [];
        }
    }

    // --- Per-leg choose step ---

    async _showLegChooseStep(chatId, state) {
        state.step = 'trip_leg_choose';
        const idx = state.tripData._currentLegIndex;
        const leg = state.tripData.legs[idx];
        const presets = state.tripData._presets || [];

        let message = `✈️ Плечо ${idx + 1}: ${leg.origin} → ${leg.destination}\n\nВыберите фильтры:\n\n`;
        const buttons = [];

        for (let i = 0; i < presets.length && i < 6; i++) {
            const p = presets[i];
            const label = this._formatLegFiltersSummary(p);
            message += `${i + 1}. ${label} ← ${p.source}\n`;
            buttons.push([`${i + 1}. ${label}`]);
        }

        // Show all previous legs with configured filters
        if (idx > 0) {
            const configuredLegs = [];
            for (let i = 0; i < idx; i++) {
                const prevLeg = state.tripData.legs[i];
                if (prevLeg.adults != null) {
                    configuredLegs.push({ index: i, leg: prevLeg });
                }
            }
            if (configuredLegs.length > 0) {
                message += '\nУже настроено:\n';
                for (const { index, leg: cl } of configuredLegs) {
                    const summary = this._formatLegFiltersSummary(cl);
                    message += `  Плечо ${index + 1} (${cl.origin}→${cl.destination}): ${summary}\n`;
                    buttons.push([`✅ Как у плеча ${index + 1}: ${summary}`]);
                }
            }
        }

        buttons.push(['✏️ Задать вручную']);
        buttons.push(['🔙 Назад', '❌ Отмена']);

        this.bot.sendMessage(chatId, message, this._makeKeyboard(buttons));
    }

    async _handleLegChoose(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            if (state.tripData._currentLegIndex > 0) {
                state.tripData._currentLegIndex--;
                await this._showLegChooseStep(chatId, state);
            } else {
                delete state.tripData._presets;
                await this._showFilterModeStep(chatId, state);
            }
            return true;
        }

        if (text === '✏️ Задать вручную') {
            await this._showLegAdultsStep(chatId, state);
            return true;
        }

        // "Как у плеча N"
        if (text.startsWith('✅ Как у плеча')) {
            const legNumMatch = text.match(/^✅ Как у плеча (\d+):/);
            if (!legNumMatch) return false;
            const sourceLegIndex = parseInt(legNumMatch[1]) - 1;
            const sourceLeg = state.tripData.legs[sourceLegIndex];
            if (!sourceLeg || sourceLeg.adults == null) return false;

            const idx = state.tripData._currentLegIndex;
            const leg = state.tripData.legs[idx];
            leg.adults = sourceLeg.adults;
            leg.children = sourceLeg.children;
            leg.airline = sourceLeg.airline;
            leg.baggage = sourceLeg.baggage;
            leg.max_stops = sourceLeg.max_stops;
            leg.max_layover_hours = sourceLeg.max_layover_hours;

            state.tripData._currentLegIndex++;
            if (state.tripData._currentLegIndex >= state.tripData.legs.length) {
                delete state.tripData._presets;
                await this._showThresholdStep(chatId, state);
            } else {
                await this._showLegChooseStep(chatId, state);
            }
            return true;
        }

        // Preset selection
        const presets = state.tripData._presets || [];
        const numMatch = text.match(/^(\d+)\./);
        if (numMatch) {
            const presetIndex = parseInt(numMatch[1]) - 1;
            if (presetIndex >= 0 && presetIndex < presets.length) {
                const idx = state.tripData._currentLegIndex;
                this._applyPresetToLeg(state.tripData.legs[idx], presets[presetIndex]);

                state.tripData._currentLegIndex++;
                if (state.tripData._currentLegIndex >= state.tripData.legs.length) {
                    delete state.tripData._presets;
                    await this._showThresholdStep(chatId, state);
                } else {
                    await this._showLegChooseStep(chatId, state);
                }
                return true;
            }
        }

        return false;
    }

    // --- All-legs choose step ---

    async _showAllChooseStep(chatId, state) {
        const presets = state.tripData._presets || [];

        // No presets — go straight to manual
        if (presets.length === 0) {
            await this._showAllAdultsStep(chatId, state);
            return;
        }

        state.step = 'trip_all_choose';

        let message = '⚡ Фильтры для всех плечей\n\nВыберите фильтры:\n\n';
        const buttons = [];

        for (let i = 0; i < presets.length && i < 6; i++) {
            const p = presets[i];
            const label = this._formatLegFiltersSummary(p);
            message += `${i + 1}. ${label} ← ${p.source}\n`;
            buttons.push([`${i + 1}. ${label}`]);
        }

        buttons.push(['✏️ Задать вручную']);
        buttons.push(['🔙 Назад', '❌ Отмена']);

        this.bot.sendMessage(chatId, message, this._makeKeyboard(buttons));
    }

    async _handleAllChoose(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            delete state.tripData._presets;
            await this._showFilterModeStep(chatId, state);
            return true;
        }

        if (text === '✏️ Задать вручную') {
            await this._showAllAdultsStep(chatId, state);
            return true;
        }

        // Preset selection
        const presets = state.tripData._presets || [];
        const numMatch = text.match(/^(\d+)\./);
        if (numMatch) {
            const presetIndex = parseInt(numMatch[1]) - 1;
            if (presetIndex >= 0 && presetIndex < presets.length) {
                this._applyPresetToAllLegs(state, presets[presetIndex]);
                delete state.tripData._presets;
                await this._showThresholdStep(chatId, state);
                return true;
            }
        }

        return false;
    }

    _applyPresetToLeg(leg, preset) {
        leg.adults = preset.adults;
        leg.children = preset.children;
        leg.airline = preset.airline;
        leg.baggage = preset.baggage;
        leg.max_stops = preset.max_stops;
        leg.max_layover_hours = preset.max_layover_hours;
    }

    _applyPresetToAllLegs(state, preset) {
        for (const leg of state.tripData.legs) {
            this._applyPresetToLeg(leg, preset);
        }
    }

    // ========================================
    // РУЧНАЯ НАСТРОЙКА ДЛЯ КАЖДОГО ПЛЕЧА
    // ========================================

    _getLegHeader(state) {
        const idx = state.tripData._currentLegIndex;
        const leg = state.tripData.legs[idx];
        return `✈️ Плечо ${idx + 1}: ${leg.origin} → ${leg.destination}\n\n`;
    }

    async _showLegAdultsStep(chatId, state) {
        state.step = 'trip_leg_adults';

        this.bot.sendMessage(
            chatId,
            this._getLegHeader(state) + '👥 Количество взрослых пассажиров (от 18 лет)',
            this._makeKeyboard(this._adultsKeyboard())
        );
    }

    async _handleLegAdults(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            await this._showLegChooseStep(chatId, state);
            return true;
        }

        const adults = parseInt(text);
        if (isNaN(adults) || adults < 1 || adults > 6) {
            this.bot.sendMessage(chatId, '❌ Введите число от 1 до 6');
            return true;
        }

        const idx = state.tripData._currentLegIndex;
        state.tripData.legs[idx].adults = adults;

        state.step = 'trip_leg_children';
        this.bot.sendMessage(
            chatId,
            this._getLegHeader(state) + '👶 Количество детей (до 18 лет)',
            this._makeKeyboard(this._childrenKeyboard())
        );
        return true;
    }

    async _handleLegChildren(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            await this._showLegAdultsStep(chatId, state);
            return true;
        }

        const children = text.startsWith('0') ? 0 : parseInt(text);
        if (isNaN(children) || children < 0 || children > 9) {
            this.bot.sendMessage(chatId, '❌ Введите число от 0 до 9');
            return true;
        }

        const idx = state.tripData._currentLegIndex;
        state.tripData.legs[idx].children = children;

        state.step = 'trip_leg_airline';
        this.bot.sendMessage(
            chatId,
            this._getLegHeader(state) + '✈️ Авиакомпания\n\nВыберите предпочитаемую авиакомпанию или "Любая":',
            this._makeKeyboard(this._airlineKeyboard())
        );
        return true;
    }

    async _handleLegAirline(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_leg_children';
            this.bot.sendMessage(chatId, this._getLegHeader(state) + '👶 Количество детей (до 18 лет)', this._makeKeyboard(this._childrenKeyboard()));
            return true;
        }

        const idx = state.tripData._currentLegIndex;
        state.tripData.legs[idx].airline = this._parseAirlineInput(text);

        state.step = 'trip_leg_baggage';
        this.bot.sendMessage(chatId, this._getLegHeader(state) + '🧳 Багаж', this._makeKeyboard(this._baggageKeyboard()));
        return true;
    }

    async _handleLegBaggage(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_leg_airline';
            this.bot.sendMessage(chatId, this._getLegHeader(state) + '✈️ Авиакомпания\n\nВыберите предпочитаемую авиакомпанию или "Любая":', this._makeKeyboard(this._airlineKeyboard()));
            return true;
        }

        const idx = state.tripData._currentLegIndex;
        state.tripData.legs[idx].baggage = text.includes('С багажом') ? 1 : 0;

        state.step = 'trip_leg_stops';
        this.bot.sendMessage(chatId, this._getLegHeader(state) + '🔄 Пересадки', this._makeKeyboard(this._stopsKeyboard()));
        return true;
    }

    async _handleLegStops(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_leg_baggage';
            this.bot.sendMessage(chatId, this._getLegHeader(state) + '🧳 Багаж', this._makeKeyboard(this._baggageKeyboard()));
            return true;
        }

        const idx = state.tripData._currentLegIndex;
        const leg = state.tripData.legs[idx];

        if (text.startsWith('0')) {
            leg.max_stops = 0;
            leg.max_layover_hours = null;
            // Skip layover step, go to next leg or threshold
            await this._finishLegFilters(chatId, state);
        } else if (text.startsWith('1')) {
            leg.max_stops = 1;
            state.step = 'trip_leg_layover';
            this.bot.sendMessage(chatId, this._getLegHeader(state) + '⏱ Максимальное время пересадки', this._makeKeyboard(this._layoverKeyboard()));
        } else if (text.startsWith('2')) {
            leg.max_stops = 2;
            state.step = 'trip_leg_layover';
            this.bot.sendMessage(chatId, this._getLegHeader(state) + '⏱ Максимальное время пересадки', this._makeKeyboard(this._layoverKeyboard()));
        } else {
            // Любое
            leg.max_stops = null;
            leg.max_layover_hours = null;
            await this._finishLegFilters(chatId, state);
        }

        return true;
    }

    async _handleLegLayover(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }
        if (text === '🔙 Назад') {
            state.step = 'trip_leg_stops';
            this.bot.sendMessage(chatId, this._getLegHeader(state) + '🔄 Пересадки', this._makeKeyboard(this._stopsKeyboard()));
            return true;
        }

        const idx = state.tripData._currentLegIndex;
        const hours = parseInt(text);
        state.tripData.legs[idx].max_layover_hours = isNaN(hours) ? null : hours;

        await this._finishLegFilters(chatId, state);
        return true;
    }

    async _finishLegFilters(chatId, state) {
        state.tripData._currentLegIndex++;
        if (state.tripData._currentLegIndex >= state.tripData.legs.length) {
            delete state.tripData._presets;
            await this._showThresholdStep(chatId, state);
        } else {
            await this._showLegChooseStep(chatId, state);
        }
    }

    // ========================================
    // ШАГ 5: Бюджет
    // ========================================

    async _showThresholdStep(chatId, state) {
        state.step = 'trip_threshold';

        const keyboard = this._makeKeyboard([
            ['20000', '30000', '50000'],
            ['70000', '100000', '150000'],
            ['🔙 Назад', '❌ Отмена']
        ]);

        this.bot.sendMessage(
            chatId,
            '💰 Общий бюджет на всё путешествие (в рублях)?\n\n' +
            'Это сумма за ВСЕ ноги и ВСЕХ пассажиров.\n\nВведите число или выберите:',
            keyboard
        );
    }

    async _handleThreshold(chatId, text, state) {
        if (text === '❌ Отмена') { this._handleCancel(chatId); return true; }

        if (text === '🔙 Назад') {
            // Go back to filter mode
            await this._showFilterModeStep(chatId, state);
            return true;
        }

        const price = parseInt(text.replace(/\s/g, ''));
        if (isNaN(price) || price < 1000) {
            this.bot.sendMessage(chatId, '❌ Введите число не менее 1000');
            return true;
        }

        state.tripData.threshold_price = price;
        await this._showConfirmStep(chatId, state);
        return true;
    }

    // ========================================
    // ШАГ 6: Подтверждение
    // ========================================

    async _showConfirmStep(chatId, state) {
        state.step = 'trip_confirm';
        await airportResolver.load();

        const td = state.tripData;
        const legs = td.legs;

        // Build route name
        let routeName = td.origin;
        for (const leg of legs) {
            routeName += ` → ${leg.destination}`;
        }

        // Count API calls
        const fakeTrip = { departure_start: td.departure_start, departure_end: td.departure_end };
        const fakeLegs = legs.map((l, i) => ({
            leg_order: i + 1, origin: l.origin, destination: l.destination,
            min_days: l.min_days, max_days: l.max_days
        }));
        const apiCalls = TripOptimizer.countApiCalls(fakeTrip, fakeLegs);

        let message = `🗺️ <b>${routeName}</b>\n`;
        message += `📅 ${DateUtils.formatDateDisplay(td.departure_start)} – ${DateUtils.formatDateDisplay(td.departure_end)}\n\n`;

        // Legs with per-leg filters
        for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];
            const legRouteName = airportResolver.formatRoute(leg.origin, leg.destination);

            let legLine = `${i + 1}️⃣ ${legRouteName}`;
            if (leg.min_days && leg.max_days) {
                legLine += `: ${leg.min_days}-${leg.max_days} дн.`;
            }
            legLine += ` | ${this._formatLegFiltersSummary(leg)}`;

            message += legLine + '\n';
        }

        message += `\n🔍 ${apiCalls} проверок (API-вызовов)\n`;
        message += `💰 Бюджет: ${Formatters.formatPrice(td.threshold_price)}\n`;

        message += '\n✅ Создать этот составной маршрут?';

        const keyboard = this._makeKeyboard([
            ['✅ Подтвердить'],
            ['🔙 Назад', '❌ Отменить']
        ]);

        this.bot.sendMessage(chatId, message, { ...keyboard, parse_mode: 'HTML' });
    }

    async _handleConfirm(chatId, text, state) {
        if (text === '❌ Отменить' || text === '❌ Отмена') {
            this._handleCancel(chatId);
            return true;
        }

        if (text === '🔙 Назад') {
            await this._showThresholdStep(chatId, state);
            return true;
        }

        if (text === '✅ Подтвердить') {
            try {
                const limits = await SubscriptionService.checkUserLimits(chatId, true);
                if (!limits.allowed) {
                    this.bot.sendMessage(chatId, limits.message, this.getMainMenuKeyboard(chatId));
                    delete this.userStates[chatId];
                    return true;
                }

                const td = state.tripData;

                // Build name
                let name = td.origin;
                for (const leg of td.legs) {
                    name += ` → ${leg.destination}`;
                }

                // Create trip (no filter fields in trip anymore)
                const tripId = await Trip.create(chatId, {
                    name,
                    departure_start: td.departure_start,
                    departure_end: td.departure_end,
                    threshold_price: td.threshold_price,
                    currency: 'RUB'
                });

                // Create legs with per-leg filters
                const legsToCreate = td.legs.map((leg, i) => ({
                    leg_order: i + 1,
                    origin: leg.origin,
                    destination: leg.destination,
                    min_days: leg.min_days,
                    max_days: leg.max_days,
                    adults: leg.adults || 1,
                    children: leg.children || 0,
                    airline: leg.airline || null,
                    baggage: leg.baggage || 0,
                    max_stops: leg.max_stops != null ? leg.max_stops : null,
                    max_layover_hours: leg.max_layover_hours || null
                }));

                await TripLeg.createMany(tripId, legsToCreate);

                ActivityService.logEvent(chatId, 'trip_created', {
                    tripId,
                    name,
                    legs: td.legs.length
                }).catch(err => console.error('Activity log error:', err));

                this.bot.sendMessage(
                    chatId,
                    `✅ Составной маршрут создан!\n\n🗺️ ${name}\n\nБот начнет проверять цены автоматически.`,
                    this.getMainMenuKeyboard(chatId)
                );

                delete this.userStates[chatId];
            } catch (error) {
                console.error('Ошибка создания трипа:', error);
                this.bot.sendMessage(chatId, '❌ Ошибка создания маршрута: ' + error.message, this.getMainMenuKeyboard(chatId));
                delete this.userStates[chatId];
            }
            return true;
        }

        return false;
    }

    // ========================================
    // ОБЩИЕ МЕТОДЫ ПОИСКА АЭРОПОРТОВ
    // ========================================

    async _handleAirportConfirm(chatId, text, state) {
        if (text === '❌ Отмена') {
            this._handleCancel(chatId);
            return true;
        }

        if (text === '✅ Да, использовать' && state.tempAirport) {
            const airport = state.tempAirport;
            const stepType = state.tempStepType;

            delete state.tempAirport;
            delete state.tempStepType;

            return await this._applyAirportSelection(chatId, airport, stepType, state);
        }

        if (text === '❌ Нет, искать другой') {
            const stepType = state.tempStepType;
            delete state.tempAirport;
            delete state.tempStepType;
            state.step = `${stepType}_search`;
            this.bot.sendMessage(chatId, '🔍 Введите название города или код аэропорта:', { reply_markup: { remove_keyboard: true } });
            return true;
        }

        if (text === '🔙 Назад') {
            const stepType = state.tempStepType;
            delete state.tempAirport;
            delete state.tempStepType;
            if (stepType === 'trip_origin') {
                state.step = 'trip_origin';
                await this._showTripOriginStep(chatId);
            } else {
                await this._showNextCityStep(chatId, state);
            }
            return true;
        }

        return false;
    }

    async _handleAirportSelect(chatId, text, state) {
        if (text === '❌ Отмена') {
            this._handleCancel(chatId);
            return true;
        }

        if (text === '🔙 Назад') {
            const stepType = state.tempStepType || (state.step.includes('origin') ? 'trip_origin' : 'trip_next_city');
            if (stepType === 'trip_origin') {
                state.step = 'trip_origin';
                await this._showTripOriginStep(chatId);
            } else {
                await this._showNextCityStep(chatId, state);
            }
            return true;
        }

        const iataCode = AirportFormatter.parseAirportInput(text);
        if (iataCode) {
            const airport = await this.airportService.getAirportByCode(iataCode);
            if (airport) {
                const stepType = state.step.replace('_select', '').replace('_confirm', '');
                return await this._applyAirportSelection(chatId, airport, stepType, state);
            }
        }

        this.bot.sendMessage(chatId, '❌ Аэропорт не распознан. Выберите из списка.');
        return true;
    }

    async _applyAirportSelection(chatId, airport, stepType, state) {
        if (stepType === 'trip_origin') {
            state.tripData.origin = airport.iata_code;
            state.tripData.origin_city = airport.city_name;
            await this._showNextCityStep(chatId, state);
            return true;
        }

        if (stepType === 'trip_next_city') {
            const lastDest = state.tripData.legs.length > 0
                ? state.tripData.legs[state.tripData.legs.length - 1].destination
                : state.tripData.origin;

            if (airport.iata_code === lastDest) {
                this.bot.sendMessage(chatId, '❌ Следующий город не может совпадать с предыдущим.');
                return true;
            }

            state._tempDestination = airport.iata_code;
            state._tempDestinationCity = airport.city_name;
            await this._showStayMinStep(chatId, state);
            return true;
        }

        return false;
    }

    async _searchAndShowAirports(chatId, query, stepType) {
        if (!query || query.trim().length < 2) {
            this.bot.sendMessage(chatId, '❌ Введите хотя бы 2 символа.', { reply_markup: { remove_keyboard: true } });
            return;
        }

        const searchingMsg = await this.bot.sendMessage(chatId, `🔍 Ищу аэропорты: "${query}"...`);

        try {
            const airports = await this.airportService.searchAirportsEnhanced(query, 8);
            const state = this.userStates[chatId];
            if (!state) return;

            await this.bot.deleteMessage(chatId, searchingMsg.message_id);

            if (airports.length === 0) {
                const keyboard = {
                    reply_markup: {
                        keyboard: [['🔙 Назад', '❌ Отмена']],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };
                this.bot.sendMessage(chatId, `❌ По запросу "${query}" аэропорты не найдены.\n\nПопробуйте другой запрос.`, keyboard);
                return;
            }

            if (airports.length === 1) {
                const airport = airports[0];
                const message = `✅ Найден: ${airport.airport_name} [${airport.iata_code}]\n${airport.city_name}, ${airport.country_name}\n\nИспользовать?`;
                const keyboard = {
                    reply_markup: {
                        keyboard: [['✅ Да, использовать'], ['❌ Нет, искать другой'], ['🔙 Назад', '❌ Отмена']],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };
                this.bot.sendMessage(chatId, message, keyboard);
                state.tempAirport = airport;
                state.tempStepType = stepType;
                state.step = `${stepType}_confirm`;
                return;
            }

            const message = AirportFormatter.createSearchResultsMessage(airports, query);
            const keyboard = AirportFormatter.createAirportsKeyboard(airports, false);
            keyboard.reply_markup.keyboard.push(['🔙 Назад', '❌ Отмена']);

            this.bot.sendMessage(chatId, message, keyboard);
            state.searchResults = airports;
            state.tempStepType = stepType;
            state.step = `${stepType}_select`;
        } catch (error) {
            console.error('Ошибка поиска аэропортов:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка при поиске: ' + error.message);
        }
    }
}

module.exports = TripHandlers;
