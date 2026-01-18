const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const PriceAnalytics = require('./PriceAnalytics');
const DateUtils = require('../utils/dateUtils');
const { createCanvas, loadImage } = require('canvas');

class ChartGenerator {
  // constructor() {
  //   this.width = 1400;
  //   this.height = 700;
  //   this.chartJSNodeCanvas = new ChartJSNodeCanvas({
  //     width: this.width,
  //     height: this.height,
  //     backgroundColour: 'white'
  //   });
  // }

  /**
   * Форматирование времени с учетом часового пояса Екатеринбург (+5 UTC)
   */
  formatTimeAgo(dateString) {
    if (!dateString) return '';
    const utcDate = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
    const options = {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Yekaterinburg',
      hour12: false
    };
    return utcDate.toLocaleString('ru-RU', options);
  }
  constructor() {
    this.width = 2000;
    this.height = 900;
    this.chartJSNodeCanvas = new ChartJSNodeCanvas({
      width: this.width,
      height: this.height,
      backgroundColour: 'white'
    });
  }

  /**
   * 🔥 Генерация тепловой карты (часы × дни недели) с помощью чистого Canvas
   */
  async generateHeatmapChart(route, chatId, routeType = 'regular') {
    try {
      console.log(`🔥 Генерация тепловой карты для маршрута #${route.id}`);

      const priceHistory = routeType === 'regular'
        ? await this.getRegularRoutePriceHistory(route.id, chatId)
        : await this.getFlexibleRoutePriceHistory(route.id, chatId);

      if (!priceHistory || priceHistory.length === 0) {
        console.log('⚠️ Нет данных для тепловой карты');
        return null;
      }

      console.log(`🔥 Найдено ${priceHistory.length} точек данных для тепловой карты`);

      // Создаем матрицу 7 дней × 24 часа (минимальные цены)
      const matrix = this.createHeatmapMatrix(priceHistory);

      // Находим min/max для цветовой шкалы
      let allPrices = [];
      matrix.forEach(day => {
        day.forEach(price => {
          if (price !== null) allPrices.push(price);
        });
      });

      if (allPrices.length === 0) {
        console.log('⚠️ Недостаточно данных для тепловой карты');
        return null;
      }

      const minPrice = Math.min(...allPrices);
      const maxPrice = Math.max(...allPrices);
      const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

      // Создаем canvas вручную
      const canvas = createCanvas(this.width, this.height);
      const ctx = canvas.getContext('2d');

      // Заполняем фон белым
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, this.width, this.height);

      // Параметры тепловой карты
      const margin = {
        top: 150,
        right: 100,
        bottom: 120,
        left: 150
      };

      const chartWidth = this.width - margin.left - margin.right;
      const chartHeight = this.height - margin.top - margin.bottom;

      const cellWidth = chartWidth / 24;
      const cellHeight = chartHeight / 7;

      // Рисуем заголовок
      ctx.fillStyle = '#000';
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`Тепловая карта цен: ${route.origin} → ${route.destination}`,
        this.width / 2, margin.top - 80);

      ctx.font = '16px Arial';
      ctx.fillText(`Минимальные цены по часам и дням недели | Всего проверок: ${priceHistory.length}`,
        this.width / 2, margin.top - 40);

      // Легенда цветов
      ctx.font = '14px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('🟢 Зеленый = дешево', margin.left, margin.top - 20);
      ctx.fillText('🟡 Желтый = средне', margin.left + 250, margin.top - 20);
      ctx.fillText('🔴 Красный = дорого', margin.left + 500, margin.top - 20);

      // Рисуем ячейки тепловой карты
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const price = matrix[day][hour];
          const x = margin.left + hour * cellWidth;
          const y = margin.top + day * cellHeight;

          // Цвет ячейки
          let color = 'rgba(220, 220, 220, 0.3)'; // Серый для отсутствующих данных
          if (price !== null && price > 0) {
            color = this.getHeatmapColor(price, minPrice, maxPrice);
          }

          // Рисуем ячейку
          ctx.fillStyle = color;
          ctx.fillRect(x, y, cellWidth, cellHeight);
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellWidth, cellHeight);

          // Добавляем цену в ячейку
          if (price !== null && price > 0) {
            // Определяем цвет текста в зависимости от яркости фона
            const rgb = this.hexToRgb(color);
            const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
            const textColor = brightness < 128 ? 'white' : 'black';

            // Форматируем цену
            let formattedPrice;
            if (price >= 1000000) {
              formattedPrice = `${Math.floor(price / 1000000)}M`;
            } else if (price >= 10000) {
              formattedPrice = `${Math.floor(price / 1000)}k`;
            } else if (price >= 1000) {
              const kValue = price / 1000;
              formattedPrice = `${kValue.toFixed(1)}k`.replace('.0k', 'k');
            } else {
              formattedPrice = Math.floor(price).toString();
            }

            // Рисуем текст
            ctx.fillStyle = textColor;
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(
              formattedPrice,
              x + cellWidth / 2,
              y + cellHeight / 2
            );
          }
        }
      }

      // Рисуем подписи по оси X (часы)
      ctx.fillStyle = '#000';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (let hour = 0; hour < 24; hour++) {
        const x = margin.left + hour * cellWidth + cellWidth / 2;
        const y = margin.top + chartHeight + 10;

        // Показываем каждый час
        ctx.fillText(`${hour}:00`, x, y);
      }

      // Подпись оси X
      ctx.font = 'bold 18px Arial';
      ctx.fillText(
        'Время суток (часы по Екатеринбургу)',
        margin.left + chartWidth / 2,
        margin.top + chartHeight + 50
      );

      // Рисуем подписи по оси Y (дни недели)
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let day = 0; day < 7; day++) {
        const x = margin.left - 10;
        const y = margin.top + day * cellHeight + cellHeight / 2;

        ctx.font = 'bold 18px Arial';
        ctx.fillText(days[day], x, y);
      }

      // Подпись оси Y
      ctx.save();
      ctx.translate(margin.left - 100, margin.top + chartHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('День недели', 0, 0);
      ctx.restore();

      // Добавляем сетку
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;

      // Вертикальные линии
      for (let hour = 0; hour <= 24; hour++) {
        const x = margin.left + hour * cellWidth;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + chartHeight);
        ctx.stroke();
      }

      // Горизонтальные линии
      for (let day = 0; day <= 7; day++) {
        const y = margin.top + day * cellHeight;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartWidth, y);
        ctx.stroke();
      }

      // Конвертируем canvas в буфер
      console.log(`✅ Тепловая карта готова`);
      const imageBuffer = canvas.toBuffer('image/png');
      return imageBuffer;

    } catch (error) {
      console.error('❌ Ошибка генерации тепловой карты:', error);
      throw error;
    }
  }

  /**
   * Преобразует цвет из rgba/hex в rgb объект
   */
  hexToRgb(color) {
    // Если цвет в формате rgba(r, g, b, a)
    if (color.startsWith('rgba')) {
      const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3])
        };
      }
    }
    // Если цвет в формате rgb(r, g, b)
    else if (color.startsWith('rgb')) {
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3])
        };
      }
    }
    // По умолчанию серый
    return { r: 220, g: 220, b: 220 };
  }

  /**
   * Получение цвета для тепловой карты (обновленная версия)
   * Светлый (дешево) → Темный (дорого)
   */
  getHeatmapColor(price, minPrice, maxPrice) {
    if (!price || price === 0) return 'rgba(220, 220, 220, 0.3)';

    const range = maxPrice - minPrice;
    if (range === 0) return 'rgb(220, 255, 220)'; // Светло-зеленый для одинаковых цен

    const normalized = (price - minPrice) / range; // 0 (дешево) → 1 (дорого)

    let r, g, b;

    if (normalized < 0.33) {
      // Светло-салатовый → Зеленый (самые дешевые)
      const t = normalized / 0.33;
      r = Math.floor(220 - (220 - 144) * t); // 220 → 144
      g = Math.floor(255 - (255 - 238) * t); // 255 → 238
      b = Math.floor(220 - (220 - 144) * t); // 220 → 144
    } else if (normalized < 0.66) {
      // Зеленый → Оранжевый (средние цены)
      const t = (normalized - 0.33) / 0.33;
      r = Math.floor(144 + (255 - 144) * t); // 144 → 255
      g = Math.floor(238 - (238 - 165) * t); // 238 → 165
      b = Math.floor(144 - (144 - 0) * t);   // 144 → 0
    } else {
      // Оранжевый → Темно-красный (самые дорогие)
      const t = (normalized - 0.66) / 0.34;
      r = 255; // Остается 255
      g = Math.floor(165 - (165 - 69) * t);  // 165 → 69
      b = 0; // Остается 0
    }

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Создание матрицы данных для тепловой карты (МИНИМАЛЬНЫЕ ЦЕНЫ)
   */
  createHeatmapMatrix(priceHistory) {
    const matrix = Array(7).fill(null).map(() =>
      Array(24).fill(null).map(() => [])
    );

    priceHistory.forEach(item => {
      const date = new Date(item.found_at + 'Z');
      const ekbDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));

      const dayOfWeek = (ekbDate.getDay() + 6) % 7; // 0=Пн, 6=Вс
      const hour = ekbDate.getHours();

      matrix[dayOfWeek][hour].push(item.price);
    });

    const minMatrix = matrix.map(day =>
      day.map(hourPrices => {
        if (hourPrices.length === 0) return null;
        return Math.min(...hourPrices);
      })
    );

    return minMatrix;
  }

  /**
   * Форматирование данных для тепловой карты
   */
  formatHeatmapData(matrix) {
    const data = [];
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    matrix.forEach((day, dayIndex) => {
      day.forEach((price, hour) => {
        if (price !== null) {
          data.push({
            day: days[dayIndex],
            hour: hour,
            price: price
          });
        }
      });
    });

    return data;
  }

  /**
   * Генерация графика цен для обычного маршрута с min/max
   */
  async generateRegularRoutePriceChart(route, chatId) {
    try {
      console.log(`📊 Генерация графика для маршрута #${route.id}`);

      const priceHistory = await this.getRegularRoutePriceHistory(route.id, chatId);

      if (!priceHistory || priceHistory.length === 0) {
        console.log('⚠️ Нет данных для графика');
        return null;
      }

      console.log(`📊 Найдено ${priceHistory.length} точек данных`);

      const groupedData = this.groupByDateTime(priceHistory);

      const labels = Object.keys(groupedData).map(dateStr => {
        return this.formatTimeAgo(dateStr.replace('Z', ''));
      });

      const minPrices = Object.values(groupedData).map(g => g.min);
      const maxPrices = Object.values(groupedData).map(g => g.max);

      const configuration = {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: `Мин. цена: ${route.origin} → ${route.destination}`,
              data: minPrices,
              borderColor: 'rgb(34, 139, 34)',
              backgroundColor: 'rgba(34, 139, 34, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: Object.keys(groupedData).length > 100 ? 0 : 2,
              pointHoverRadius: 4,
              borderWidth: 2
            },
            {
              label: `Макс. цена`,
              data: maxPrices,
              borderColor: 'rgb(220, 20, 60)',
              backgroundColor: 'rgba(220, 20, 60, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: Object.keys(groupedData).length > 100 ? 0 : 2,
              pointHoverRadius: 4,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: false,
          animation: { duration: 0 },
          plugins: {
            title: {
              display: true,
              text: `График цен: ${route.origin} → ${route.destination}`,
              font: { size: 22, weight: 'bold' },
              padding: 20
            },
            legend: {
              display: true,
              position: 'top',
              labels: { font: { size: 14 } }
            },
            subtitle: {
              display: true,
              text: `Всего проверок: ${priceHistory.length} | ${DateUtils.formatDateDisplay(route.departure_date)} → ${DateUtils.formatDateDisplay(route.return_date)}`,
              font: { size: 12 },
              padding: { bottom: 10 }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${Math.floor(context.parsed.y).toLocaleString('ru-RU')} ₽`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: false,
              ticks: {
                callback: function(value) {
                  return Math.floor(value).toLocaleString('ru-RU') + ' ₽';
                },
                font: { size: 11 },
                maxTicksLimit: 10
              },
              title: {
                display: true,
                text: 'Цена (₽)',
                font: { size: 14, weight: 'bold' }
              }
            },
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 45,
                font: { size: 9 },
                autoSkip: true,
                maxTicksLimit: 20
              },
              title: {
                display: true,
                text: 'Дата и время проверки',
                font: { size: 14, weight: 'bold' }
              }
            }
          }
        }
      };

      if (route.threshold_price) {
        configuration.data.datasets.push({
          label: `Порог: ${Math.floor(route.threshold_price).toLocaleString('ru-RU')} ₽`,
          data: Array(labels.length).fill(route.threshold_price),
          borderColor: 'rgb(255, 99, 132)',
          borderDash: [5, 5],
          borderWidth: 2,
          fill: false,
          pointRadius: 0
        });
      }

      console.log(`✅ График готов: ${Object.keys(groupedData).length} временных точек`);
      const imageBuffer = await this.chartJSNodeCanvas.renderToBuffer(configuration);
      return imageBuffer;

    } catch (error) {
      console.error('❌ Ошибка генерации графика:', error);
      throw error;
    }
  }

  /**
   * Генерация графика цен для гибкого маршрута с min/max
   */
  async generateFlexibleRoutePriceChart(route, chatId) {
    try {
      console.log(`📊 Генерация графика для гибкого маршрута #${route.id}`);

      const priceHistory = await this.getFlexibleRoutePriceHistory(route.id, chatId);

      if (!priceHistory || priceHistory.length === 0) {
        console.log('⚠️ Нет данных для графика');
        return null;
      }

      console.log(`📊 Найдено ${priceHistory.length} точек данных`);

      const groupedData = this.groupByDateTime(priceHistory);

      const labels = Object.keys(groupedData).map(dateStr => {
        return this.formatTimeAgo(dateStr.replace('Z', ''));
      });

      const minPrices = Object.values(groupedData).map(g => g.min);
      const maxPrices = Object.values(groupedData).map(g => g.max);

      const configuration = {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: `Мин. цена: ${route.origin} → ${route.destination}`,
              data: minPrices,
              borderColor: 'rgb(34, 139, 34)',
              backgroundColor: 'rgba(34, 139, 34, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: Object.keys(groupedData).length > 100 ? 0 : 2,
              pointHoverRadius: 4,
              borderWidth: 2
            },
            {
              label: `Макс. цена`,
              data: maxPrices,
              borderColor: 'rgb(220, 20, 60)',
              backgroundColor: 'rgba(220, 20, 60, 0.1)',
              tension: 0.3,
              fill: false,
              pointRadius: Object.keys(groupedData).length > 100 ? 0 : 2,
              pointHoverRadius: 4,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: false,
          animation: { duration: 0 },
          plugins: {
            title: {
              display: true,
              text: `График цен (гибкий): ${route.origin} → ${route.destination}`,
              font: { size: 22, weight: 'bold' },
              padding: 20
            },
            legend: {
              display: true,
              position: 'top',
              labels: { font: { size: 14 } }
            },
            subtitle: {
              display: true,
              text: `Всего проверок: ${priceHistory.length} | ${DateUtils.formatDateDisplay(route.departure_start)} - ${DateUtils.formatDateDisplay(route.departure_end)}`,
              font: { size: 12 },
              padding: { bottom: 10 }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${Math.floor(context.parsed.y).toLocaleString('ru-RU')} ₽`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: false,
              ticks: {
                callback: function(value) {
                  return Math.floor(value).toLocaleString('ru-RU') + ' ₽';
                },
                font: { size: 11 },
                maxTicksLimit: 10
              },
              title: {
                display: true,
                text: 'Цена (₽)',
                font: { size: 14, weight: 'bold' }
              }
            },
            x: {
              ticks: {
                maxRotation: 45,
                minRotation: 45,
                font: { size: 9 },
                autoSkip: true,
                maxTicksLimit: 20
              },
              title: {
                display: true,
                text: 'Дата и время проверки',
                font: { size: 14, weight: 'bold' }
              }
            }
          }
        }
      };

      if (route.threshold_price) {
        configuration.data.datasets.push({
          label: `Порог: ${Math.floor(route.threshold_price).toLocaleString('ru-RU')} ₽`,
          data: Array(labels.length).fill(route.threshold_price),
          borderColor: 'rgb(255, 99, 132)',
          borderDash: [5, 5],
          borderWidth: 2,
          fill: false,
          pointRadius: 0
        });
      }

      console.log(`✅ График готов: ${Object.keys(groupedData).length} временных точек`);
      const imageBuffer = await this.chartJSNodeCanvas.renderToBuffer(configuration);
      return imageBuffer;

    } catch (error) {
      console.error('❌ Ошибка генерации графика:', error);
      throw error;
    }
  }

  /**
   * Группировка по дате и времени с вычислением min/max
   */
  groupByDateTime(data) {
    const grouped = {};

    data.forEach(item => {
      const date = new Date(item.found_at + 'Z');
      date.setSeconds(0, 0);
      const key = date.toISOString();

      if (!grouped[key]) {
        grouped[key] = {
          min: item.price,
          max: item.price,
          prices: [item.price]
        };
      } else {
        grouped[key].prices.push(item.price);
        grouped[key].min = Math.min(grouped[key].min, item.price);
        grouped[key].max = Math.max(grouped[key].max, item.price);
      }
    });

    const sortedKeys = Object.keys(grouped).sort();
    const result = {};
    sortedKeys.forEach(key => {
      result[key] = grouped[key];
    });

    return result;
  }

  /**
   * Получение истории цен для обычного маршрута
   */
  async getRegularRoutePriceHistory(routeId, chatId) {
    return new Promise((resolve, reject) => {
      const db = require('../config/database');
      db.all(`
        SELECT price, found_at, airline
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ? AND route_type = 'regular'
        ORDER BY found_at ASC
      `, [routeId, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Получение истории цен для гибкого маршрута
   */
  async getFlexibleRoutePriceHistory(routeId, chatId) {
    return new Promise((resolve, reject) => {
      const db = require('../config/database');
      db.all(`
        SELECT price, found_at, airline
        FROM price_analytics
        WHERE route_id = ? AND chat_id = ? AND route_type = 'flexible'
        ORDER BY found_at ASC
      `, [routeId, chatId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = ChartGenerator;
