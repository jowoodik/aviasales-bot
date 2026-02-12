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

        // 1. One-way items для каждой ноги
        for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];
            const dateRange = legDateRanges[i];

            if (!dateRange || dateRange.length === 0) continue;

            for (const dateStr of dateRange) {
                const url = api.generateSearchLink({
                    origin: leg.origin,
                    destination: leg.destination,
                    departure_date: dateStr,
                    return_date: null,
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
                    max_layover_hours: leg.max_layover_hours || null,
                    isRoundTrip: false
                });
            }
        }

        // 2. Round-trip items для пар ног (туда-обратно дешевле чем два one-way)
        const pairs = this._detectRoundTripPairs(legs);

        for (const pair of pairs) {
            const outLeg = legs[pair.outIndex];
            const outDateRange = legDateRanges[pair.outIndex];

            if (!outDateRange || outDateRange.length === 0) continue;

            // Кумулятивный min/max дней между outbound и return ногами
            let cumMin = 0, cumMax = 0;
            for (let k = pair.outIndex; k < pair.retIndex; k++) {
                cumMin += legs[k].min_days || 0;
                cumMax += legs[k].max_days || 0;
            }

            for (const depDateStr of outDateRange) {
                const depDate = new Date(depDateStr);

                // Диапазон дат возврата
                const retStart = new Date(depDate);
                retStart.setDate(retStart.getDate() + cumMin);

                const retEnd = new Date(depDate);
                retEnd.setDate(retEnd.getDate() + cumMax);

                const retCurrent = new Date(retStart);
                while (retCurrent <= retEnd) {
                    // Фильтруем прошедшие даты
                    if (today && retCurrent < today) {
                        retCurrent.setDate(retCurrent.getDate() + 1);
                        continue;
                    }

                    const retDateStr = this._formatDate(retCurrent);

                    const url = api.generateSearchLink({
                        origin: outLeg.origin,
                        destination: outLeg.destination,
                        departure_date: depDateStr,
                        return_date: retDateStr,
                        adults: outLeg.adults || 1,
                        children: outLeg.children || 0,
                        airline: outLeg.airline
                    });

                    items.push({
                        url,
                        tripId: trip.id,
                        legOrder: outLeg.leg_order,
                        departureDate: depDateStr,
                        returnDate: retDateStr,
                        origin: outLeg.origin,
                        destination: outLeg.destination,
                        airline: outLeg.airline || null,
                        baggage: outLeg.baggage === 1,
                        max_stops: outLeg.max_stops != null ? outLeg.max_stops : null,
                        max_layover_hours: outLeg.max_layover_hours || null,
                        isRoundTrip: true,
                        outLegOrder: outLeg.leg_order,
                        retLegOrder: legs[pair.retIndex].leg_order
                    });

                    retCurrent.setDate(retCurrent.getDate() + 1);
                }
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
     * @param {Map|null} roundTripPrices - Map<pairKey, Map<depDate, Map<retDate, {price, searchLink}>>>
     * @returns {Object|null} {totalPrice, legs: [{legOrder, departureDate, price, searchLink, origin, destination, isRoundTrip}]}
     */
    static findBestCombination(trip, legs, pricesByLeg, roundTripPrices = null) {
        let bestCombo = null;
        let bestPrice = Infinity;

        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);

        // Построить lookup: retLegOrder → pair info
        const returnLegPairMap = new Map();
        if (roundTripPrices && roundTripPrices.size > 0) {
            const pairs = this._detectRoundTripPairs(legs);
            for (const pair of pairs) {
                const pairKey = `${pair.outLegOrder}-${pair.retLegOrder}`;
                if (roundTripPrices.has(pairKey)) {
                    returnLegPairMap.set(pair.retLegOrder, {
                        outLegOrder: pair.outLegOrder,
                        pairKey
                    });
                }
            }
        }

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
                        legs: currentLegs.map(l => ({ ...l }))
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
                const prevLeg = legs[legIndex - 1];
                startDate = new Date(currentDate);
                startDate.setDate(startDate.getDate() + (prevLeg.min_days || 0));

                endDate = new Date(currentDate);
                endDate.setDate(endDate.getDate() + (prevLeg.max_days || 0));
            }

            // Проверяем, является ли эта нога return-ногой RT пары
            const rtPairInfo = returnLegPairMap.get(leg.leg_order);

            // Перебираем все доступные даты в диапазоне
            const current = new Date(startDate);
            while (current <= endDate) {
                const dateStr = this._formatDate(current);
                const priceData = legPrices.get(dateStr);

                // Вариант 1: one-way цена
                if (priceData && priceData.price > 0) {
                    currentLegs.push({
                        legOrder: leg.leg_order,
                        departureDate: dateStr,
                        price: priceData.price,
                        searchLink: priceData.searchLink || null,
                        airline: priceData.airline || null,
                        origin: leg.origin,
                        destination: leg.destination,
                        isRoundTrip: false
                    });

                    search(legIndex + 1, current, currentLegs, currentTotal + priceData.price);

                    currentLegs.pop();
                }

                // Вариант 2: round-trip цена (если это return-нога пары)
                if (rtPairInfo) {
                    const rtMap = roundTripPrices.get(rtPairInfo.pairKey);
                    if (rtMap) {
                        // Найти outbound ногу в текущей комбинации
                        const outEntry = currentLegs.find(l => l.legOrder === rtPairInfo.outLegOrder);
                        if (outEntry) {
                            const depDateMap = rtMap.get(outEntry.departureDate);
                            if (depDateMap) {
                                const rtData = depDateMap.get(dateStr);
                                if (rtData && rtData.price > 0) {
                                    // RT цена заменяет оба one-way: убираем outbound one-way, ставим RT
                                    const adjustedTotal = currentTotal - outEntry.price + rtData.price;

                                    if (adjustedTotal < bestPrice) {
                                        // Сохраняем оригинальные данные outbound ноги
                                        const origOutPrice = outEntry.price;
                                        const origOutLink = outEntry.searchLink;
                                        const origOutIsRT = outEntry.isRoundTrip;

                                        // Временно меняем outbound на RT
                                        outEntry.price = rtData.price;
                                        outEntry.searchLink = rtData.searchLink;
                                        outEntry.isRoundTrip = true;

                                        currentLegs.push({
                                            legOrder: leg.leg_order,
                                            departureDate: dateStr,
                                            price: 0, // включено в RT цену outbound ноги
                                            searchLink: rtData.searchLink,
                                            airline: priceData?.airline || null,
                                            origin: leg.origin,
                                            destination: leg.destination,
                                            isRoundTrip: true,
                                            coveredByRoundTrip: rtPairInfo.outLegOrder
                                        });

                                        search(legIndex + 1, current, currentLegs, adjustedTotal);

                                        currentLegs.pop();

                                        // Восстанавливаем outbound ногу
                                        outEntry.price = origOutPrice;
                                        outEntry.searchLink = origOutLink;
                                        outEntry.isRoundTrip = origOutIsRT;
                                    }
                                }
                            }
                        }
                    }
                }

                current.setDate(current.getDate() + 1);
            }
        };

        search(0, null, [], 0);

        return bestCombo;
    }

    /**
     * Подсчет API-вызовов для трипа (one-way + round-trip)
     */
    static countApiCalls(trip, legs) {
        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);
        const baseDays = Math.ceil((depEnd - depStart) / (1000 * 60 * 60 * 24)) + 1;

        let oneWayCalls = 0;

        for (let i = 0; i < legs.length; i++) {
            if (i === 0) {
                oneWayCalls += baseDays;
            } else {
                let cumulativeMinDays = 0;
                let cumulativeMaxDays = 0;

                for (let j = 0; j < i; j++) {
                    cumulativeMinDays += legs[j].min_days || 0;
                    cumulativeMaxDays += legs[j].max_days || 0;
                }

                const rangeSize = baseDays + (cumulativeMaxDays - cumulativeMinDays);
                oneWayCalls += rangeSize;
            }
        }

        // Round-trip вызовы для пар ног
        let rtCalls = 0;
        const pairs = this._detectRoundTripPairs(legs);

        for (const pair of pairs) {
            // Кол-во дат вылета для outbound ноги
            let outLegDates;
            if (pair.outIndex === 0) {
                outLegDates = baseDays;
            } else {
                let cumMin = 0, cumMax = 0;
                for (let j = 0; j < pair.outIndex; j++) {
                    cumMin += legs[j].min_days || 0;
                    cumMax += legs[j].max_days || 0;
                }
                outLegDates = baseDays + (cumMax - cumMin);
            }

            // Кол-во дат возврата на каждую дату вылета
            let cumMinBetween = 0, cumMaxBetween = 0;
            for (let k = pair.outIndex; k < pair.retIndex; k++) {
                cumMinBetween += legs[k].min_days || 0;
                cumMaxBetween += legs[k].max_days || 0;
            }
            const returnDatesPerDep = cumMaxBetween - cumMinBetween + 1;

            rtCalls += outLegDates * returnDatesPerDep;
        }

        return oneWayCalls + rtCalls;
    }

    /**
     * Детальный подсчет API-вызовов (one-way + round-trip отдельно)
     */
    static countApiCallsDetailed(trip, legs) {
        const depStart = new Date(trip.departure_start);
        const depEnd = new Date(trip.departure_end);
        const baseDays = Math.ceil((depEnd - depStart) / (1000 * 60 * 60 * 24)) + 1;

        let oneWayCalls = 0;
        for (let i = 0; i < legs.length; i++) {
            if (i === 0) {
                oneWayCalls += baseDays;
            } else {
                let cumMin = 0, cumMax = 0;
                for (let j = 0; j < i; j++) {
                    cumMin += legs[j].min_days || 0;
                    cumMax += legs[j].max_days || 0;
                }
                oneWayCalls += baseDays + (cumMax - cumMin);
            }
        }

        const pairs = this._detectRoundTripPairs(legs);
        let rtCalls = 0;
        const pairDetails = [];

        for (const pair of pairs) {
            let outLegDates;
            if (pair.outIndex === 0) {
                outLegDates = baseDays;
            } else {
                let cumMin = 0, cumMax = 0;
                for (let j = 0; j < pair.outIndex; j++) {
                    cumMin += legs[j].min_days || 0;
                    cumMax += legs[j].max_days || 0;
                }
                outLegDates = baseDays + (cumMax - cumMin);
            }

            let cumMinBetween = 0, cumMaxBetween = 0;
            for (let k = pair.outIndex; k < pair.retIndex; k++) {
                cumMinBetween += legs[k].min_days || 0;
                cumMaxBetween += legs[k].max_days || 0;
            }
            const returnDatesPerDep = cumMaxBetween - cumMinBetween + 1;
            const pairCalls = outLegDates * returnDatesPerDep;

            rtCalls += pairCalls;
            pairDetails.push({
                outLeg: legs[pair.outIndex],
                retLeg: legs[pair.retIndex],
                calls: pairCalls
            });
        }

        return { oneWay: oneWayCalls, roundTrip: rtCalls, total: oneWayCalls + rtCalls, pairs: pairDetails };
    }

    /**
     * Определить пары ног для round-trip поиска
     * Пара: origin/destination совпадают в обратном порядке + одинаковые фильтры
     */
    static _detectRoundTripPairs(legs) {
        const pairs = [];
        const used = new Set();

        // Ищем пары с наименьшим расстоянием между ногами
        for (let gap = 1; gap < legs.length; gap++) {
            for (let i = 0; i < legs.length - gap; i++) {
                const j = i + gap;
                if (used.has(i) || used.has(j)) continue;

                const outLeg = legs[i];
                const retLeg = legs[j];

                if (outLeg.origin === retLeg.destination &&
                    outLeg.destination === retLeg.origin &&
                    this._filtersMatch(outLeg, retLeg)) {
                    pairs.push({
                        outIndex: i,
                        retIndex: j,
                        outLegOrder: outLeg.leg_order,
                        retLegOrder: retLeg.leg_order
                    });
                    used.add(i);
                    used.add(j);
                }
            }
        }

        return pairs;
    }

    /**
     * Проверка совпадения фильтров для round-trip пары
     */
    static _filtersMatch(legA, legB) {
        return (legA.adults || 1) === (legB.adults || 1) &&
               (legA.children || 0) === (legB.children || 0) &&
               (legA.airline || null) === (legB.airline || null) &&
               (legA.baggage ? 1 : 0) === (legB.baggage ? 1 : 0) &&
               (legA.max_stops != null ? legA.max_stops : -1) === (legB.max_stops != null ? legB.max_stops : -1) &&
               (legA.max_layover_hours || null) === (legB.max_layover_hours || null);
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
