import api from '../api.js';
import ChartComponent from '../components/chart.js';
import CONFIG from '../config.js';
import { showLoading, showError, formatNumber } from '../utils/helpers.js';
import airportService from '../services/airportService.js';

class AnalyticsPage {
    constructor() {
        this.charts = {};
        this.analyticsData = null;
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
      <div class="analytics-page">
        <div class="page-header">
          <h1>📊 Детальная аналитика</h1>
          <p class="subtitle">Глубокий анализ маршрутов, цен и трендов</p>
        </div>

        <div id="analytics-loading" class="loading-state">
          <div class="spinner"></div>
          <p>Загрузка аналитики...</p>
        </div>

        <div id="analytics-content" style="display: none;">

          <!-- Секция: Популярные маршруты -->
          <div class="card mb-4">
            <div class="card-header bg-primary text-white">
              <h5 class="mb-0">🛫 Популярные маршруты</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-lg-6">
                  <div class="chart-container" style="height: 350px;">
                    <canvas id="chart-top-routes"></canvas>
                  </div>
                </div>
                <div class="col-lg-6">
                  <div class="table-responsive" id="table-top-routes"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Топ направлений -->
          <div class="card mb-4">
            <div class="card-header bg-info text-white">
              <h5 class="mb-0">🌍 География полетов</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-lg-6">
                  <h6 class="text-center">Топ городов прилета</h6>
                  <div class="chart-container" style="height: 350px;">
                    <canvas id="chart-destinations"></canvas>
                  </div>
                </div>
                <div class="col-lg-6">
                  <h6 class="text-center">Топ городов вылета</h6>
                  <div class="chart-container" style="height: 350px;">
                    <canvas id="chart-origins"></canvas>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Ценовая аналитика -->
          <div class="row g-4 mb-4">
            <div class="col-lg-6">
              <div class="card h-100">
                <div class="card-header bg-success text-white">
                  <h5 class="mb-0">💰 Распределение бюджетов</h5>
                </div>
                <div class="card-body">
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-price-distribution"></canvas>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-lg-6">
              <div class="card h-100">
                <div class="card-header bg-warning">
                  <h5 class="mb-0">✈️ Популярные авиакомпании</h5>
                </div>
                <div class="card-body">
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-airlines"></canvas>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Средние цены -->
          <div class="card mb-4">
            <div class="card-header bg-secondary text-white">
              <h5 class="mb-0">📈 Ценовая аналитика по направлениям (30 дней)</h5>
            </div>
            <div class="card-body">
              <div class="table-responsive" id="table-avg-prices"></div>
            </div>
          </div>

          <!-- Секция: Лучшие предложения -->
          <div class="card mb-4">
            <div class="card-header bg-danger text-white">
              <h5 class="mb-0">🔥 Лучшие предложения недели</h5>
            </div>
            <div class="card-body">
              <div class="table-responsive" id="table-best-deals"></div>
            </div>
          </div>

          <!-- Секция: Временной анализ -->
          <div class="row g-4 mb-4">
            <div class="col-lg-8">
              <div class="card h-100">
                <div class="card-header">
                  <h5 class="mb-0">📊 Динамика создания маршрутов (30 дней)</h5>
                </div>
                <div class="card-body">
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-route-trend"></canvas>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-lg-4">
              <div class="card h-100">
                <div class="card-header">
                  <h5 class="mb-0">📅 Активность по дням недели</h5>
                </div>
                <div class="card-body">
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-weekday-stats"></canvas>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

        content.innerHTML = html;
        await this.loadAnalytics();
    }

    async loadAnalytics() {
        try {
            showLoading('Загрузка данных...');

            const response = await api.get('/analytics');

            if (!response.success) {
                throw new Error('Ошибка загрузки аналитики');
            }

            this.analyticsData = response;

            document.getElementById('analytics-loading').style.display = 'none';
            document.getElementById('analytics-content').style.display = 'block';

            // Рендерим только уникальные для Analytics данные
            this.renderTopRoutesChart();
            this.renderDestinationsChart();
            this.renderOriginsChart();
            this.renderPriceDistribution();
            this.renderAvgPricesTable();
            this.renderWeekdayStats();
            this.renderRouteTrendChart();
            this.renderBestDealsTable();
            this.renderAirlinesChart();

        } catch (error) {
            console.error('Error loading analytics:', error);
            showError('Ошибка загрузки аналитики: ' + error.message);
        }
    }

    formatRouteLabel(route) {
        if (route.origin_city && route.destination_city) {
            return `${route.origin_city} (${route.origin}) → ${route.destination_city} (${route.destination})`;
        }
        return `${route.origin} → ${route.destination}`;
    }

    formatCityLabel(code, cityName) {
        if (cityName && cityName !== code) {
            return `${cityName} (${code})`;
        }
        return airportService.formatCode(code);
    }

    renderTopRoutesChart() {
        const data = this.analyticsData.topRoutes || [];
        const tableContainer = document.getElementById('table-top-routes');

        if (data.length === 0) {
            tableContainer.innerHTML = '<p class="text-muted">Нет данных</p>';
            return;
        }

        // Таблица с расширенной информацией
        const html = `
      <table class="table table-sm table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>Маршрут</th>
            <th>Всего</th>
            <th>Активных</th>
            <th>Гибких</th>
            <th>Средний бюджет</th>
          </tr>
        </thead>
        <tbody>
          ${data.slice(0, 10).map((route, index) => `
            <tr>
              <td><span class="badge bg-primary rounded-circle">${index + 1}</span></td>
              <td><strong>${this.formatRouteLabel(route)}</strong></td>
              <td><span class="badge bg-secondary">${route.count}</span></td>
              <td><span class="badge bg-success">${route.active_count}</span></td>
              <td><span class="badge bg-info">${route.flexible_count || 0}</span></td>
              <td>${formatNumber(Math.round(route.avg_threshold))} ₽</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
        tableContainer.innerHTML = html;

        // График
        this.charts.topRoutes = ChartComponent.barChart(
            'chart-top-routes',
            data.slice(0, 10).map(r => r.origin_city ? `${r.origin_city} → ${r.destination_city}` : `${r.origin}-${r.destination}`),
            [{
                label: 'Количество маршрутов',
                data: data.slice(0, 10).map(r => r.count),
                color: CONFIG.CHART_COLORS.PRIMARY
            }]
        );
        this.charts.topRoutes.render();
    }

    renderDestinationsChart() {
        const data = this.analyticsData.topDestinations || [];

        if (data.length === 0) {
            document.getElementById('chart-destinations').parentElement.innerHTML = '<p class="text-muted text-center">Нет данных</p>';
            return;
        }

        this.charts.destinations = ChartComponent.doughnutChart(
            'chart-destinations',
            data.slice(0, 10).map(d => this.formatCityLabel(d.destination, d.destination_city)),
            data.slice(0, 10).map(d => d.count),
            Object.values(CONFIG.CHART_COLORS)
        );
        this.charts.destinations.render();
    }

    renderOriginsChart() {
        const data = this.analyticsData.topOrigins || [];

        if (data.length === 0) {
            document.getElementById('chart-origins').parentElement.innerHTML = '<p class="text-muted text-center">Нет данных</p>';
            return;
        }

        this.charts.origins = ChartComponent.doughnutChart(
            'chart-origins',
            data.slice(0, 10).map(d => this.formatCityLabel(d.origin, d.origin_city)),
            data.slice(0, 10).map(d => d.count),
            Object.values(CONFIG.CHART_COLORS)
        );
        this.charts.origins.render();
    }

    renderPriceDistribution() {
        const data = this.analyticsData.priceDistribution || [];

        if (data.length === 0) {
            document.getElementById('chart-price-distribution').parentElement.innerHTML = '<p class="text-muted text-center">Нет данных</p>';
            return;
        }

        this.charts.priceDistribution = ChartComponent.barChart(
            'chart-price-distribution',
            data.map(d => d.range),
            [{
                label: 'Количество маршрутов',
                data: data.map(d => d.count),
                color: CONFIG.CHART_COLORS.SUCCESS
            }]
        );
        this.charts.priceDistribution.render();
    }

    renderAvgPricesTable() {
        const data = this.analyticsData.avgPrices || [];
        const container = document.getElementById('table-avg-prices');

        if (data.length === 0) {
            container.innerHTML = `
                <div class="alert alert-info mb-0">
                    <i class="bi bi-info-circle me-2"></i>
                    <strong>Пока нет ценовых данных.</strong> Статистика появится после первых найденных билетов.
                </div>
            `;
            return;
        }

        const html = `
      <table class="table table-sm table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>Маршрут</th>
            <th>Средняя</th>
            <th>Минимум</th>
            <th>Максимум</th>
            <th>Разброс</th>
            <th>Находок</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((item, index) => {
            const spread = item.max_price - item.min_price;
            const spreadPercent = ((spread / item.average_price) * 100).toFixed(0);
            return `
            <tr>
              <td><span class="badge bg-secondary rounded-circle">${index + 1}</span></td>
              <td><strong>${this.formatRouteLabel(item)}</strong></td>
              <td><strong>${formatNumber(Math.round(item.average_price))} ₽</strong></td>
              <td><span class="text-success">${formatNumber(Math.round(item.min_price))} ₽</span></td>
              <td><span class="text-danger">${formatNumber(Math.round(item.max_price))} ₽</span></td>
              <td>
                <span class="badge ${spreadPercent > 50 ? 'bg-danger' : spreadPercent > 25 ? 'bg-warning' : 'bg-success'}">
                  ±${spreadPercent}%
                </span>
              </td>
              <td>${item.price_count}</td>
            </tr>
          `}).join('')}
        </tbody>
      </table>
    `;

        container.innerHTML = html;
    }

    renderWeekdayStats() {
        const data = this.analyticsData.weekdayStats || [];

        const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const fullData = Array(7).fill(0);
        data.forEach(item => {
            fullData[item.weekday] = item.checks;
        });

        this.charts.weekdayStats = ChartComponent.barChart(
            'chart-weekday-stats',
            weekdays,
            [{
                label: 'Создано маршрутов',
                data: fullData,
                color: CONFIG.CHART_COLORS.INFO
            }]
        );
        this.charts.weekdayStats.render();
    }

    renderRouteTrendChart() {
        const data = this.analyticsData.routeCreationTrend || [];

        if (data.length === 0) {
            document.getElementById('chart-route-trend').parentElement.innerHTML = '<p class="text-muted text-center">Нет данных</p>';
            return;
        }

        this.charts.routeTrend = ChartComponent.lineChart(
            'chart-route-trend',
            data.map(d => new Date(d.date).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })),
            [
                {
                    label: 'Всего маршрутов',
                    data: data.map(d => d.count),
                    color: CONFIG.CHART_COLORS.PRIMARY
                },
                {
                    label: 'Гибкие маршруты',
                    data: data.map(d => d.flexible_count),
                    color: CONFIG.CHART_COLORS.DANGER
                }
            ]
        );
        this.charts.routeTrend.render();
    }

    renderBestDealsTable() {
        const data = this.analyticsData.bestDeals || [];
        const container = document.getElementById('table-best-deals');

        if (data.length === 0) {
            container.innerHTML = `
                <div class="alert alert-info mb-0">
                    <i class="bi bi-info-circle me-2"></i>
                    <strong>Пока нет выгодных предложений за последние 7 дней.</strong> Они появятся, когда будут найдены билеты ниже средней цены по направлению.
                </div>
            `;
            return;
        }

        const html = `
      <table class="table table-sm table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>Маршрут</th>
            <th>Даты</th>
            <th>Цена</th>
            <th>Средняя</th>
            <th>Экономия</th>
            <th>%</th>
            <th>Авиакомпания</th>
          </tr>
        </thead>
        <tbody>
          ${data.slice(0, 15).map((deal, index) => {
            const savingsPercent = ((deal.savings / deal.avg_price) * 100).toFixed(0);
            return `
            <tr>
              <td><span class="badge ${index < 3 ? 'bg-danger' : 'bg-secondary'} rounded-circle">${index + 1}</span></td>
              <td><strong>${this.formatRouteLabel(deal)}</strong></td>
              <td><small>${new Date(deal.departure_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}${deal.return_date ? ' - ' + new Date(deal.return_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''}</small></td>
              <td><strong class="text-success">${formatNumber(Math.round(deal.total_price))} ₽</strong></td>
              <td><span class="text-muted">${formatNumber(Math.round(deal.avg_price))} ₽</span></td>
              <td><strong class="text-success">-${formatNumber(Math.round(deal.savings))} ₽</strong></td>
              <td><span class="badge bg-success">-${savingsPercent}%</span></td>
              <td><small>${deal.airline || 'N/A'}</small></td>
            </tr>
          `}).join('')}
        </tbody>
      </table>
      <div class="mt-3">
        <small class="text-muted">
          <i class="bi bi-info-circle me-1"></i>
          Показаны уникальные направления с лучшими ценами ниже средней. По каждому направлению выбрано наиболее выгодное предложение.
        </small>
      </div>
    `;

        container.innerHTML = html;
    }

    renderAirlinesChart() {
        const data = this.analyticsData.airlineStats || [];

        if (data.length === 0) {
            document.getElementById('chart-airlines').parentElement.innerHTML = '<p class="text-muted text-center">Нет данных</p>';
            return;
        }

        this.charts.airlines = ChartComponent.barChart(
            'chart-airlines',
            data.slice(0, 10).map(a => a.airline || 'Любая'),
            [{
                label: 'Количество маршрутов',
                data: data.slice(0, 10).map(a => a.count),
                color: CONFIG.CHART_COLORS.DANGER
            }]
        );
        this.charts.airlines.render();
    }

    destroy() {
        // Cleanup charts
        Object.values(this.charts).forEach(chart => {
            if (chart && chart.destroy) {
                chart.destroy();
            }
        });
        this.charts = {};
    }
}

export default AnalyticsPage;