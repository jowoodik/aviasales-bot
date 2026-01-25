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
}

module.exports = AviasalesAPI;
