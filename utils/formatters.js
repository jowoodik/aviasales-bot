const { AIRLINES, AIRPORTS } = require('../config/constants');

class Formatters {
  static getAirlineName(code) {
    return AIRLINES[code] || code || 'Любая';
  }

  static getAirportName(code) {
    return AIRPORTS[code] || code;
  }

  static formatPrice(price, currency = 'RUB') {
    return `${Math.round(price).toLocaleString('ru-RU')} ${currency}`;
  }

  static formatPassengers(adults, children) {
    let text = `${adults} взр.`;
    if (children > 0) {
      text += `, ${children} дет.`;
    }
    return text;
  }

  static formatStops(maxStops) {
    if (maxStops === 0) return 'Прямой';
    if (maxStops === 99) return 'Любое';
    return `≤${maxStops}`;
  }

  static parseAirportCode(text) {
    const match = text.match(/\(([A-Z]{3})\)/);
    if (match) return match[1];

    const code = text.toUpperCase().trim();
    if (code.length === 3) return code;

    return null;
  }
}

module.exports = Formatters;
