const { AIRLINES } = require('../config/constants');

module.exports = {
  formatPrice(price, currency = 'RUB') {
    return `${Math.floor(price).toLocaleString('ru-RU')} ${currency === 'RUB' ? '₽' : currency}`;
  },

  formatPassengers(adults, children = 0) {
    let text = `${adults} взр.`;
    if (children > 0) {
      text += `, ${children} дет.`;
    }
    return text;
  },

  getAirlineName(code) {
    return AIRLINES[code] || code || 'Любая';
  },

  parseAirportCode(text) {
    if (!text) return null;

    // Извлекаем код аэропорта из строки вида "SVX (Екатеринбург)" или просто "SVX"
    const match = text.match(/^([A-Z]{3})/i);
    if (match) {
      return match[1].toUpperCase();
    }

    // Если просто текст
    const code = text.trim().toUpperCase();
    if (code.length === 3 && /^[A-Z]{3}$/.test(code)) {
      return code;
    }

    return null;
  }
};
