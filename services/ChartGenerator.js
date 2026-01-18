const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const PriceAnalytics = require('./PriceAnalytics');
const DateUtils = require('../utils/dateUtils');

class ChartGenerator {
  constructor() {
    this.width = 1400;
    this.height = 700;
    this.chartJSNodeCanvas = new ChartJSNodeCanvas({
      width: this.width,
      height: this.height,
      backgroundColour: 'white'
    });
  }

  /**
   * Форматирование времени с учетом часового пояса Екатеринбург (+5 UTC)
   */
  formatTimeAgo(dateString) {
    if (!dateString) return '';
    // Добавляем Z если его нет (время в базе - UTC без указания пояса)
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

      // Группируем по дате и времени для min/max
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

      // Добавляем линию порога
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
      const date = new Date(item.found_at + 'Z'); // Добавляем Z для UTC
      // Округляем до минуты для группировки
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

    // Сортируем по времени
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
