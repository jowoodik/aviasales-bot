const TimezoneUtils = require('../utils/timezoneUtils');

class TripOptimizer {
    /**
     * Генерация batch items для проверки цен по всем ногам трипа
     * @param {Object} trip - объект трипа
     * @param {Array} legs - ноги трипа (отсортированы по leg_order)
     * @param {Object} userSettings - настройки пользователя
     * @param {Object} api - AviasalesAPI instance
     * @returns {Array} массив {url, tripId, legOrder, departureDate, origin, destination, airline, baggage, max_stops, max_layover_hours}
     */
    static generateBatchItems(trip, legs, userSettings, api) {
        const items = [];

        // Получаем today в таймзоне пользователя
        const today = this._getTodayInTimezone(userSettings);

        // Для каждой ноги генерируем диапазон допустимых дат
        const legDateRanges = this._calculateLegDateRanges(trip, legs, today);

        for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];
            const dateRange = legDateRanges[i];

            if (!dateRange || dateRange.length === 0) continue;

            for (const dateStr of dateRange) {
                const url = api.generateSearchLink({
                    origin: leg.origin,
                    destination: leg.destination,
                    departure_date: dateStr,
                    return_date: null, // one-way для каждой ноги
                    adults: leg.adults || 1,
                    children: leg.children || 0,
                    airline: leg.airline
                });

                items.push({
                    url,
                    tripId: trip.id,
                    legOrder: leg.leg_order,
                    departureDate: dateStr,
                    origin: leg.origin,
                    destination: leg.destination,
                    airline: leg.airline || null,
                    baggage: leg.baggage === 1,
                    max_stops: leg.max_stops != null ? leg.max_stops : null,
                    max_layover_hours: leg.max_layover_hours || null
                });
            }
        }

        return items;
    }

    /**
     * Рассчитать диапазоны допустимых дат для каждой ноги
     */
    static _calculateLegDateRanges(trip, legs, today) {
        const ranges = [];
        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);

        // Фильтруем прошедшие даты
        const effectiveStart = today && today > depStart ? new Date(today) : new Date(depStart);

        if (effectiveStart > depEnd) {
            return legs.map(() => []);
        }

        for (let i = 0; i < legs.length; i++) {
            let rangeStart, rangeEnd;

            if (i === 0) {
                // Первая нога: вылет в диапазоне departure_start — departure_end
                rangeStart = new Date(effectiveStart);
                rangeEnd = new Date(depEnd);
            } else {
                // Последующие ноги: дата = departure_start + сумма min_days предыдущих ног ... departure_end + сумма max_days
                let cumulativeMinDays = 0;
                let cumulativeMaxDays = 0;

                for (let j = 0; j < i; j++) {
                    cumulativeMinDays += legs[j].min_days || 0;
                    cumulativeMaxDays += legs[j].max_days || 0;
                }

                rangeStart = new Date(effectiveStart);
                rangeStart.setDate(rangeStart.getDate() + cumulativeMinDays);

                rangeEnd = new Date(depEnd);
                rangeEnd.setDate(rangeEnd.getDate() + cumulativeMaxDays);
            }

            // Фильтруем прошедшие даты
            if (today && rangeStart < today) {
                rangeStart = new Date(today);
            }

            const dates = [];
            const current = new Date(rangeStart);
            while (current <= rangeEnd) {
                dates.push(this._formatDate(current));
                current.setDate(current.getDate() + 1);
            }

            ranges.push(dates);
        }

        return ranges;
    }

    /**
     * Найти лучшую комбинацию дат по всем ногам (офлайн-оптимизация)
     * @param {Object} trip - объект трипа
     * @param {Array} legs - ноги трипа
     * @param {Map} pricesByLeg - Map<legOrder, Map<dateStr, {price, searchLink, airline}>>
     * @returns {Object|null} {totalPrice, legs: [{legOrder, departureDate, price, searchLink, origin, destination}]}
     */
    static findBestCombination(trip, legs, pricesByLeg) {
        let bestCombo = null;
        let bestPrice = Infinity;

        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);

        // Рекурсивный перебор с backtracking
        const search = (legIndex, currentDate, currentLegs, currentTotal) => {
            // Early pruning
            if (currentTotal >= bestPrice) return;

            if (legIndex >= legs.length) {
                // Нашли полную комбинацию
                if (currentTotal < bestPrice) {
                    bestPrice = currentTotal;
                    bestCombo = {
                        totalPrice: currentTotal,
                        legs: [...currentLegs]
                    };
                }
                return;
            }

            const leg = legs[legIndex];
            const legPrices = pricesByLeg.get(leg.leg_order);
            if (!legPrices) return;

            // Определяем диапазон дат для этой ноги
            let startDate, endDate;

            if (legIndex === 0) {
                startDate = new Date(depStart);
                endDate = new Date(depEnd);
            } else {
                // Дата старта = предыдущая дата + min_days предыдущей ноги
                const prevLeg = legs[legIndex - 1];
                startDate = new Date(currentDate);
                startDate.setDate(startDate.getDate() + (prevLeg.min_days || 0));

                endDate = new Date(currentDate);
                endDate.setDate(endDate.getDate() + (prevLeg.max_days || 0));
            }

            // Перебираем все доступные даты в диапазоне
            const current = new Date(startDate);
            while (current <= endDate) {
                const dateStr = this._formatDate(current);
                const priceData = legPrices.get(dateStr);

                if (priceData && priceData.price > 0) {
                    currentLegs.push({
                        legOrder: leg.leg_order,
                        departureDate: dateStr,
                        price: priceData.price,
                        searchLink: priceData.searchLink || null,
                        airline: priceData.airline || null,
                        origin: leg.origin,
                        destination: leg.destination
                    });

                    search(legIndex + 1, current, currentLegs, currentTotal + priceData.price);

                    currentLegs.pop();
                }

                current.setDate(current.getDate() + 1);
            }
        };

        search(0, null, [], 0);

        return bestCombo;
    }

    /**
     * Подсчет API-вызовов для трипа
     */
    static countApiCalls(trip, legs) {
        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);
        const baseDays = Math.ceil((depEnd - depStart) / (1000 * 60 * 60 * 24)) + 1;

        let totalCalls = 0;

        for (let i = 0; i < legs.length; i++) {
            if (i === 0) {
                totalCalls += baseDays;
            } else {
                // Считаем дополнительные дни от cumulative min/max days
                let cumulativeMinDays = 0;
                let cumulativeMaxDays = 0;

                for (let j = 0; j < i; j++) {
                    cumulativeMinDays += legs[j].min_days || 0;
                    cumulativeMaxDays += legs[j].max_days || 0;
                }

                const rangeSize = baseDays + (cumulativeMaxDays - cumulativeMinDays);
                totalCalls += rangeSize;
            }
        }

        return totalCalls;
    }

    /**
     * Подсчет офлайн-комбинаций
     */
    static countTripCombinations(trip, legs) {
        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);
        const baseDays = Math.ceil((depEnd - depStart) / (1000 * 60 * 60 * 24)) + 1;

        let combos = baseDays;
        for (let i = 0; i < legs.length - 1; i++) {
            const stayRange = (legs[i].max_days || 0) - (legs[i].min_days || 0) + 1;
            combos *= stayRange;
        }

        return combos;
    }

    static _getTodayInTimezone(userSettings) {
        try {
            const timezone = userSettings?.timezone || 'Asia/Yekaterinburg';
            const userNow = TimezoneUtils.getCurrentTimeInTimezone(timezone);
            userNow.setHours(0, 0, 0, 0);
            return userNow;
        } catch (error) {
            const fallback = new Date();
            fallback.setHours(0, 0, 0, 0);
            return fallback;
        }
    }

    static _formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}

module.exports = TripOptimizer;
