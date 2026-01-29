const { AIRLINES } = require('../config/constants');
const { formatDateDisplay } = require('./dateUtils');

class Formatters {
  /**
   * Парсинг кода аэропорта из текста
   */
  static parseAirportCode(text) {
    if (!text) return null;

    const trimmed = text.trim();

    // Случай 1: Текст в формате "Город (КОД)" или "КОД (Город)"
    const matchBrackets = trimmed.match(/\(([A-Z]{3})\)/);
    if (matchBrackets) {
      return matchBrackets[1].toUpperCase();
    }

    // Случай 2: Просто код аэропорта (3 заглавные буквы)
    if (/^[A-Z]{3}$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    // Случай 3: Код в начале или конце строки с пробелом
    const parts = trimmed.split(' ');
    for (const part of parts) {
      if (/^[A-Z]{3}$/.test(part)) {
        return part.toUpperCase();
      }
    }

    // Случай 4: Попробуем извлечь 3 заглавные буквы из любого места
    const matchAnywhere = trimmed.match(/[A-Z]{3}/);
    if (matchAnywhere) {
      return matchAnywhere[0].toUpperCase();
    }

    return null;
  }

  /**
   * Получить название авиакомпании
   */
  static getAirlineName(code) {
    if (!code) return 'Любая';
    return AIRLINES[code] || code;
  }

  /**
   * Форматирование пассажиров
   */
  static formatPassengers(adults, children) {
    let result = `${adults} ${this._pluralize(adults, 'взрослый', 'взрослых', 'взрослых')}`;

    if (children > 0) {
      result += `, ${children} ${this._pluralize(children, 'ребенок', 'ребенка', 'детей')}`;
    }

    return result;
  }

  /**
   * Форматирование цены
   */
  static formatPrice(price, currency = 'RUB') {
    if (!price) return 'н/д';

    const formatted = Math.round(price).toLocaleString('ru-RU');

    const symbols = {
      'RUB': '₽',
      'USD': '$',
      'EUR': '€',
      'KZT': '₸',
      'UAH': '₴'
    };

    return `${formatted} ${symbols[currency] || currency}`;
  }

  /**
   * Форматирование диапазона дат
   */
  static formatDateRange(startDate, endDate) {
    const start = this._formatShortDate(startDate);
    const end = this._formatShortDate(endDate);
    return `${start} - ${end}`;
  }

  /**
   * Короткий формат даты (ДД.ММ)
   */
  static _formatShortDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}`;
  }

  /**
   * Склонение числительных
   */
  static _pluralize(number, one, two, five) {
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

  /**
   * Форматирование маршрута для краткого отображения
   */
  static formatRoutePreview(route) {
    let preview = `${route.origin} → ${route.destination}`;

    if (route.is_flexible) {
      const start = this._formatShortDate(route.departure_start);
      const end = this._formatShortDate(route.departure_end);
      preview += ` ${start}-${end}`;

      if (route.has_return) {
        preview += ` (${route.min_days}-${route.max_days}д)`;
      }
    } else if (route.has_return) {
      const dep = this._formatShortDate(route.departure_date);
      const ret = this._formatShortDate(route.return_date);
      preview += ` ${dep}-${ret}`;
    } else {
      const dep = this._formatShortDate(route.departure_date);
      preview += ` ${dep}→`;
    }

    return preview;
  }

  /**
   * Форматирование информации о маршруте
   */
  static formatRouteInfo(route) {
    let info = `🛫 *${route.origin}* → 🛬 *${route.destination}*\n`;
    info += `📅 Тип: ${route.is_flexible ? 'Гибкий' : 'Обычный'}\n`;

    if (route.is_flexible) {
      info += `📆 Вылет: ${formatDateDisplay(route.departure_start)} - ${formatDateDisplay(route.departure_end)}\n`;
      if (route.return_start) {
        info += `🔙 Возврат: ${formatDateDisplay(route.return_start)} - ${formatDateDisplay(route.return_end)}\n`;
      }
      if (route.min_days && route.max_days) {
        info += `⏱ Дни: ${route.min_days}-${route.max_days}\n`;
      }
    } else {
      info += `📆 Вылет: ${formatDateDisplay(route.departure_date)}\n`;
      if (route.return_date) {
        info += `🔙 Возврат: ${formatDateDisplay(route.return_date)}\n`;
      }
    }

    info += `👥 Пассажиры: ${route.adults} взр`;
    if (route.children > 0) {
      info += ` + ${route.children} реб`;
    }
    info += `\n`;

    if (route.airline) {
      info += `✈️ Авиакомпания: ${route.airline}\n`;
    }

    if (route.baggage) {
      info += `🧳 Багаж: требуется\n`;
    }

    if (route.max_stops !== null) {
      info += `🔄 Макс. пересадок: ${route.max_stops}\n`;
    }

    info += `💰 Порог: *${route.threshold_price.toLocaleString('ru-RU')} ₽*\n`;
    info += `📊 Статус: ${route.is_paused ? '⏸ Приостановлен' : '✅ Активен'}`;

    return info;
  }

  /**
   * Форматирование списка результатов
   */
  static formatResultsList(route, results) {
    let message = `📊 *Результаты для маршрута*\n`;
    message += `${route.origin} → ${route.destination}\n\n`;

    if (results.length === 0) {
      return message + '❌ Результатов пока нет';
    }

    message += `Найдено результатов: ${results.length}\n\n`;

    results.slice(0, 10).forEach((result, index) => {
      message += `${index + 1}. 💰 *${result.total_price.toLocaleString('ru-RU')} ₽*\n`;
      message += `   📅 ${formatDateDisplay(result.departure_date)}`;

      if (result.return_date) {
        message += ` - ${formatDateDisplay(result.return_date)}`;
      }

      if (result.days_in_country) {
        message += ` (${result.days_in_country} дн.)`;
      }

      message += `\n`;

      if (result.airline && result.airline !== 'ANY') {
        message += `   ✈️ ${result.airline}\n`;
      }

      message += `   🕐 ${this.formatTimeAgo(result.found_at)}\n`;

      if (result.search_link) {
        message += `   🔗 [Открыть поиск](${result.search_link})\n`;
      }

      message += `\n`;
    });

    if (results.length > 10) {
      message += `\n_...и еще ${results.length - 10} результатов_`;
    }

    return message;
  }

  /**
   * Форматирование времени назад
   */
  static formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин. назад`;
    if (diffHours < 24) return `${diffHours} ч. назад`;
    return `${diffDays} дн. назад`;
  }

  /**
   * Форматирование уведомления о цене
   */
  static formatPriceAlert(route, priceData, combination) {
    let message = `🔥 *НАЙДЕНА ВЫГОДНАЯ ЦЕНА!*\n\n`;
    message += `✈️ ${route.origin} → ${route.destination}\n`;
    message += `📅 ${formatDateDisplay(combination.departure_date)}`;

    if (combination.return_date) {
      message += ` - ${formatDateDisplay(combination.return_date)}`;
    }

    if (combination.days_in_country) {
      message += ` (${combination.days_in_country} дн.)`;
    }

    message += `\n\n`;
    message += `💰 Цена: *${this.formatPrice(priceData.price, priceData.currency)}*\n`;
    message += `📊 Ваш порог: ${this.formatPrice(route.threshold_price)}\n`;

    const discount = route.threshold_price - priceData.price;
    if (discount > 0) {
      message += `🎉 Выгода: *${this.formatPrice(discount)}*\n`;
    }

    message += `\n`;

    if (priceData.airline && priceData.airline !== 'ANY') {
      message += `✈️ Авиакомпания: ${priceData.airline}\n`;
    }

    if (priceData.link) {
      message += `\n🔗 [Открыть на Aviasales](${priceData.link})`;
    }

    return message;
  }
}

module.exports = Formatters;
