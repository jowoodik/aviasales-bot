const axios = require('axios');

class AviasalesAPI {
  constructor(token, marker) {
    this.token = token;
    this.marker = marker || '12345';
    this.baseURL = 'https://api.travelpayouts.com';
  }

  generateSearchLink(params) {
    const baseLink = 'https://www.aviasales.ru/search';

    const formatDate = (dateStr) => {
      const [year, month, day] = dateStr.split('-');
      return `${day}${month}`;
    };

    const depDate = formatDate(params.departure_date);
    const retDate = formatDate(params.return_date);

    // Формат: /ORIGIN_DATE_DEST_DATE_ADULTS_CHILDREN_INFANTS
    const path = `/${params.origin}${depDate}${params.destination}${retDate}${params.adults || 1}${params.children || 0}0`;

    // Дополнительные параметры
    const searchParams = new URLSearchParams({
      marker: this.marker,
      with_request: true
    });

    // Класс обслуживания
    if (params.cabin_class) {
      searchParams.append('cabin', params.cabin_class); // economy, business, first
    }

    // Конкретная авиакомпания
    if (params.airline) {
      searchParams.append('airlines', params.airline); // EK, EY, SU и т.д.
    }

    // Количество пересадок
    if (params.max_stops !== undefined) {
      if (params.max_stops === 0) {
        searchParams.append('segments', '0'); // Только прямые
      } else if (params.max_stops <= 2) {
        searchParams.append('max_stops', params.max_stops);
      }
    }

    // Багаж (передается как фильтр на сайте)
    if (params.baggage) {
      searchParams.append('baggage', '1'); // С багажом
    }

    // Гибкие даты (±1-3 дня)
    if (params.flexible_dates) {
      searchParams.append('flexible', params.flexible_dates); // 1, 2, 3
    }

    // Сортировка (по умолчанию по цене)
    searchParams.append('sort', 'price'); // price, duration, rating

    // Источник трафика
    searchParams.append('utm_source', 'telegram_bot');
    searchParams.append('utm_medium', 'bot');

    return `${baseLink}${path}?${searchParams.toString()}`;
  }

  async searchFlights(params) {
    try {
      const response = await axios.get(`${this.baseURL}/aviasales/v3/prices_for_dates`, {
        params: {
          origin: params.origin,
          destination: params.destination,
          departure_at: params.departure_date,
          return_at: params.return_date,
          currency: params.currency || 'RUB',
          token: this.token,
          sorting: 'price',
          direct: params.max_stops === 0 ? true : false,
          limit: 30,
          page: 1,
          // Добавляем класс обслуживания
          ...(params.cabin_class && { cabin_class: params.cabin_class })
        },
        headers: {
          'Accept-Encoding': 'gzip,deflate'
        }
      });

      if (!response.data.success || !response.data.data) {
        return [];
      }

      let filtered = this.filterResults(response.data.data, params);

      filtered = filtered.map(ticket => ({
        ...ticket,
        search_link: this.generateSearchLink({
          ...params,
          departure_date: params.departure_date,
          return_date: params.return_date
        }),
        base_price: ticket.price,
        estimated_total: this.estimateTotalPrice(
          ticket.price,
          params.adults,
          params.children,
          params.baggage
        ),
        passengers: {
          adults: params.adults,
          children: params.children
        }
      }));

      return filtered;
    } catch (error) {
      console.error('❌ Ошибка API:', error.response?.data || error.message);
      return null;
    }
  }

  filterResults(data, params) {
    if (!Array.isArray(data) || data.length === 0) return [];

    let filtered = data;

    if (params.airline) {
      filtered = filtered.filter(ticket => ticket.airline === params.airline);
    }

    if (params.max_stops !== undefined && params.max_stops !== 99) {
      filtered = filtered.filter(ticket => (ticket.transfers || 0) <= params.max_stops);
    }

    filtered.sort((a, b) => a.price - b.price);

    return filtered.slice(0, 10);
  }

  estimateTotalPrice(basePrice, adults, children, includeBaggage) {
    const adultPrice = basePrice * adults;
    const childPrice = basePrice * 0.75 * children;

    let subtotal = adultPrice + childPrice;

    if (includeBaggage) {
      const totalPassengers = adults + children;
      const baggagePerPerson = 2000;
      subtotal += totalPassengers * baggagePerPerson;
    }

    return Math.round(subtotal);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AviasalesAPI;
