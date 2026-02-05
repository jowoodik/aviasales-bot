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
          <p class="subtitle">Статистика использования и эффективности</p>
        </div>

        <div id="analytics-loading" class="loading-state">
          <div class="spinner"></div>
          <p>Загрузка аналитики...</p>
        </div>

        <div id="analytics-content" style="display: none;">

          <!-- Общая статистика -->
          <div class="row mb-4" id="general-stats">
            <!-- Заполняется динамически -->
          </div>

          <!-- Секция: Маршруты -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">🛫 Популярные маршруты</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-lg-6">
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-top-routes"></canvas>
                  </div>
                </div>
                <div class="col-lg-6">
                  <div class="table-responsive" id="table-top-routes"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Направления -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">🌍 Топ направлений</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-lg-6">
                  <h6 class="text-center">По прилету</h6>
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-destinations"></canvas>
                  </div>
                </div>
                <div class="col-lg-6">
                  <h6 class="text-center">По вылету</h6>
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-origins"></canvas>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Цены -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">💰 Распределение цен</h5>
            </div>
            <div class="card-body">
              <div class="chart-container" style="height: 300px;">
                <canvas id="chart-price-distribution"></canvas>
              </div>
            </div>
          </div>

          <!-- Секция: Средние цены -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">📈 Средние цены по маршрутам</h5>
            </div>
            <div class="card-body">
              <div class="table-responsive" id="table-avg-prices"></div>
            </div>
          </div>

          <!-- Секция: Активность по времени -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">⏰ Активность проверок</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-lg-6">
                  <h6 class="text-center">По часам (последние 7 дней)</h6>
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-hourly-stats"></canvas>
                  </div>
                </div>
                <div class="col-lg-6">
                  <h6 class="text-center">По дням недели</h6>
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-weekday-stats"></canvas>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Пользователи -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">👥 Топ пользователей</h5>
            </div>
            <div class="card-body">
              <div class="table-responsive" id="table-top-users"></div>
            </div>
          </div>

          <!-- Секция: Динамика -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">📊 Динамика создания маршрутов</h5>
            </div>
            <div class="card-body">
              <div class="chart-container" style="height: 300px;">
                <canvas id="chart-route-trend"></canvas>
              </div>
            </div>
          </div>

          <!-- Секция: Лучшие предложения -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">🔥 Лучшие предложения (7 дней)</h5>
            </div>
            <div class="card-body">
              <div class="table-responsive" id="table-best-deals"></div>
            </div>
          </div>

          <!-- Секция: Успешность -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">✅ Успешность проверок</h5>
            </div>
            <div class="card-body">
              <div id="success-rate-info"></div>
            </div>
          </div>

          <!-- Секция: Подписки -->
          <div class="card mb-4">
            <div class="card-header">
              <h5 class="mb-0">💎 Статистика подписок</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-lg-6">
                  <div class="chart-container" style="height: 300px;">
                    <canvas id="chart-subscriptions"></canvas>
                  </div>
                </div>
                <div class="col-lg-6">
                  <div class="table-responsive" id="table-subscriptions"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Секция: Авиакомпании -->
          <div class="card mb-4">
            <div class="card-header">
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

            this.renderGeneralStats();
            this.renderTopRoutesChart();
            this.renderDestinationsChart();
            this.renderOriginsChart();
            this.renderPriceDistribution();
            this.renderAvgPricesTable();
            this.renderHourlyStats();
            this.renderWeekdayStats();
            this.renderTopUsersTable();
            this.renderRouteTrendChart();
            this.renderBestDealsTable();
            this.renderSuccessRate();
            this.renderSubscriptionsChart();
            this.renderAirlinesChart();

        } catch (error) {
            console.error('Error loading analytics:', error);
            showError('Ошибка загрузки аналитики: ' + error.message);
        }
    }

    renderGeneralStats() {
        const stats = this.analyticsData.generalStats;
        console.log(this.analyticsData);
        const container = document.getElementById('general-stats');

        const cards = [
            { label: 'Всего маршрутов', value: stats.total_routes || 0, icon: '🛫', color: 'primary' },
            { label: 'Активных', value: stats.active_routes || 0, icon: '✅', color: 'success' },
            { label: 'Фиксированных', value: stats.fixed_routes || 0, icon: '📅', color: 'info' },
            { label: 'Гибких', value: stats.flexible_routes || 0, icon: '🔄', color: 'warning' },
            { label: 'Пользователей', value: stats.total_users || 0, icon: '👥', color: 'secondary' },
            { label: 'Найдено билетов', value: stats.total_results || 0, icon: '🎫', color: 'success' },
            { label: 'Проверок выполнено', value: stats.total_checks || 0, icon: '🔍', color: 'primary' },
        ];

        container.innerHTML = cards.map(card => `
      <div class="col-lg-3 col-md-4 col-sm-6 mb-3">
        <div class="card border-${card.color}">
          <div class="card-body text-center">
            <div class="display-4 mb-2">${card.icon}</div>
            <h3 class="text-${card.color}">${formatNumber(card.value)}</h3>
            <p class="text-muted mb-0">${card.label}</p>
          </div>
        </div>
      </div>
    `).join('');
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

        // Таблица
        const html = `
      <table class="table table-sm table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>Маршрут</th>
            <th>Создано</th>
            <th>Активных</th>
            <th>Средний порог</th>
          </tr>
        </thead>
        <tbody>
          ${data.slice(0, 10).map((route, index) => `
            <tr>
              <td>${index + 1}</td>
              <td><strong>${this.formatRouteLabel(route)}</strong></td>
              <td>${route.count}</td>
              <td>${route.active_count}</td>
              <td>${formatNumber(Math.round(route.avg_threshold))} ₽</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
        tableContainer.innerHTML = html;

        // График - короткие метки для читаемости
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

        if (data.length === 0) return;

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

        if (data.length === 0) return;

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
            container.innerHTML = '<p class="text-muted">Нет данных за последние 30 дней</p>';
            return;
        }

        const html = `
      <table class="table table-sm table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>Маршрут</th>
            <th>Средняя цена</th>
            <th>Мин</th>
            <th>Макс</th>
            <th>Проверок</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td><strong>${this.formatRouteLabel(item)}</strong></td>
              <td>${formatNumber(Math.round(item.average_price))} ₽</td>
              <td>${formatNumber(Math.round(item.min_price))} ₽</td>
              <td>${formatNumber(Math.round(item.max_price))} ₽</td>
              <td>${item.price_count}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

        container.innerHTML = html;
    }

    renderHourlyStats() {
        const data = this.analyticsData.hourlyStats || [];

        const fullData = Array(24).fill(0);
        data.forEach(item => {
            fullData[item.hour] = item.checks;
        });

        this.charts.hourlyStats = ChartComponent.lineChart(
            'chart-hourly-stats',
            Array.from({length: 24}, (_, i) => `${i}:00`),
            [{
                label: 'Проверок',
                data: fullData,
                color: CONFIG.CHART_COLORS.WARNING
            }]
        );
        this.charts.hourlyStats.render();
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
                label: 'Проверок',
                data: fullData,
                color: CONFIG.CHART_COLORS.INFO
            }]
        );
        this.charts.weekdayStats.render();
    }

    renderTopUsersTable() {
        const data = this.analyticsData.topUsers || [];
        const container = document.getElementById('table-top-users');

        if (data.length === 0) {
            container.innerHTML = '<p class="text-muted">Нет данных</p>';
            return;
        }

        const html = `
      <table class="table table-sm table-hover">
        <thead>
          <tr>
            <th>#</th>
            <th>Chat ID</th>
            <th>Всего маршрутов</th>
            <th>Активных</th>
            <th>Гибких</th>
            <th>Подписка</th>
            <th>Первый маршрут</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((user, index) => `
            <tr>
              <td>${index + 1}</td>
              <td><code>${user.chat_id}</code></td>
              <td>${user.route_count}</td>
              <td>${user.active_count}</td>
              <td>${user.flexible_count}</td>
              <td>${user.subscription_type}</td>
              <td>${new Date(user.first_route_date).toLocaleDateString('ru-RU')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

        container.innerHTML = html;
    }

    renderRouteTrendChart() {
        const data = this.analyticsData.routeCreationTrend || [];

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
                    label: 'Гибких',
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
            container.innerHTML = '<p class="text-muted">Нет данных за последние 7 дней</p>';
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
            <th>Порог</th>
            <th>Экономия</th>
            <th>Авиакомпания</th>
            <th>Найдено</th>
          </tr>
        </thead>
        <tbody>
          ${data.slice(0, 15).map((deal, index) => `
            <tr>
              <td>${index + 1}</td>
              <td><strong>${this.formatRouteLabel(deal)}</strong></td>
              <td><small>${new Date(deal.departure_date).toLocaleDateString('ru-RU')}${deal.return_date ? ' - ' + new Date(deal.return_date).toLocaleDateString('ru-RU') : ''}</small></td>
              <td><strong>${formatNumber(Math.round(deal.total_price))} ₽</strong></td>
              <td>${formatNumber(Math.round(deal.threshold_price))} ₽</td>
              <td class="text-success"><strong>-${formatNumber(Math.round(deal.savings))} ₽</strong></td>
              <td>${deal.airline}</td>
              <td><small>${new Date(deal.found_at).toLocaleString('ru-RU')}</small></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

        container.innerHTML = html;
    }

    renderSuccessRate() {
        const data = this.analyticsData.checkSuccessRate || {};
        const container = document.getElementById('success-rate-info');

        const successRate = data.success_rate || 0;
        const totalChecks = data.total_checks || 0;
        const totalSuccess = data.total_success || 0;
        const totalFailed = data.total_failed || 0;

        const html = `
      <div class="row text-center">
        <div class="col-lg-3 col-md-6 mb-3">
          <div class="card border-primary">
            <div class="card-body">
              <h2 class="text-primary">${successRate.toFixed(1)}%</h2>
              <p class="text-muted mb-0">Успешность</p>
            </div>
          </div>
        </div>
        <div class="col-lg-3 col-md-6 mb-3">
          <div class="card">
            <div class="card-body">
              <h2>${formatNumber(totalChecks)}</h2>
              <p class="text-muted mb-0">Всего проверок</p>
            </div>
          </div>
        </div>
        <div class="col-lg-3 col-md-6 mb-3">
          <div class="card border-success">
            <div class="card-body">
              <h2 class="text-success">${formatNumber(totalSuccess)}</h2>
              <p class="text-muted mb-0">Успешных</p>
            </div>
          </div>
        </div>
        <div class="col-lg-3 col-md-6 mb-3">
          <div class="card border-danger">
            <div class="card-body">
              <h2 class="text-danger">${formatNumber(totalFailed)}</h2>
              <p class="text-muted mb-0">Неудачных</p>
            </div>
          </div>
        </div>
      </div>
    `;

        container.innerHTML = html;
    }

    renderSubscriptionsChart() {
        const data = this.analyticsData.subscriptionStats || [];
        const table = document.getElementById('table-subscriptions');

        this.charts.subscriptions = ChartComponent.pieChart(
            'chart-subscriptions',
            data.map(s => s.subscription_type),
            data.map(s => s.user_count),
            [CONFIG.CHART_COLORS.SUCCESS, CONFIG.CHART_COLORS.DANGER, CONFIG.CHART_COLORS.WARNING]
        );
        this.charts.subscriptions.render();

        // Таблица
        const tableHtml = `
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Подписка</th>
            <th>Пользователей</th>
            <th>Маршрутов</th>
            <th>Средний порог</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(sub => `
            <tr>
              <td><span class="badge badge-${sub.subscription_type === 'free' ? 'secondary' : 'success'}">${sub.subscription_type}</span></td>
              <td>${sub.user_count}</td>
              <td>${sub.route_count}</td>
              <td>${formatNumber(Math.round(sub.avg_threshold))} ₽</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

        table.innerHTML = tableHtml;
    }

    renderAirlinesChart() {
        const data = this.analyticsData.airlineStats || [];

        if (data.length === 0) {
            document.getElementById('chart-airlines').parentElement.innerHTML = '<p class="text-muted">Нет данных</p>';
            return;
        }

        this.charts.airlines = ChartComponent.barChart(
            'chart-airlines',
            data.map(a => a.airline),
            [{
                label: 'Количество маршрутов',
                data: data.map(a => a.count),
                color: CONFIG.CHART_COLORS.DANGER
            }]
        );
        this.charts.airlines.render();
    }
}

export default AnalyticsPage;