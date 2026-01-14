class DateUtils {
  static convertDateFormat(dateStr) {
    const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;

    const day = match[1];
    const month = match[2];
    const year = match[3];

    const date = new Date(year, month - 1, day);
    if (date.getFullYear() != year || date.getMonth() != month - 1 || date.getDate() != day) {
      return null;
    }

    return `${year}-${month}-${day}`;
  }

  static formatDateDisplay(apiDate) {
    if (!apiDate) return 'не указана';
    const parts = apiDate.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  static addDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static daysBetween(date1Str, date2Str) {
    const date1 = new Date(date1Str);
    const date2 = new Date(date2Str);
    const diffTime = Math.abs(date2 - date1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  static generateDateRange(startDate, endDate) {
    const dates = [];
    let current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  static generateFlexibleCombinations(departureStart, departureEnd, minDays, maxDays, maxCombinations = 50) {
    const departureDates = this.generateDateRange(departureStart, departureEnd);
    const combinations = [];

    for (const depDate of departureDates) {
      for (let days = minDays; days <= maxDays; days++) {
        const retDate = this.addDays(depDate, days);
        combinations.push({
          departure_date: depDate,
          return_date: retDate,
          days_in_country: days
        });

        if (combinations.length >= maxCombinations) {
          return combinations;
        }
      }
    }

    // Сначала проверяем выходные и праздники (там билеты дороже)
    combinations.sort((a, b) => {
      const dayA = new Date(a.departure_date).getDay();
      const dayB = new Date(b.departure_date).getDay();

      // Приоритет: будни > выходные
      if (dayA >= 1 && dayA <= 5 && (dayB === 0 || dayB === 6)) return -1;
      if (dayB >= 1 && dayB <= 5 && (dayA === 0 || dayA === 6)) return 1;

      return 0;
    });

    return combinations;
  }
}

module.exports = DateUtils;
