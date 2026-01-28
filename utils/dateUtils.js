class DateUtils {
  /**
   * Конвертация из ДД-ММ-ГГГГ в YYYY-MM-DD
   */
  static convertDateFormat(input) {
    const trimmed = input.trim();

    // Проверяем разные форматы
    const patterns = [
      /^(\d{2})-(\d{2})-(\d{4})$/,  // ДД-ММ-ГГГГ
      /^(\d{2})\.(\d{2})\.(\d{4})$/, // ДД.ММ.ГГГГ
      /^(\d{2})\/(\d{2})\/(\d{4})$/  // ДД/ММ/ГГГГ
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const day = match[1];
        const month = match[2];
        const year = match[3];

        // Валидация
        const d = parseInt(day);
        const m = parseInt(month);
        const y = parseInt(year);

        if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2000 || y > 2100) {
          return null;
        }

        return `${year}-${month}-${day}`;
      }
    }

    return null;
  }

  /**
   * Форматирование для отображения (ДД.ММ.ГГГГ)
   */
  static formatDateDisplay(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
  }

  /**
   * Получить текущую дату в формате YYYY-MM-DD
   */
  static getCurrentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Добавить дни к дате
   */
  static addDays(dateString, days) {
    const date = new Date(dateString);
    date.setDate(date.getDate() + days);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * Разница в днях между двумя датами
   */
  static daysDifference(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}

module.exports = DateUtils;
