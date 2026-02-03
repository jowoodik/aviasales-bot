// web/public/js/pages/dashboard.js

import api from '../api.js';
import StatsCard from '../components/stats.js';
import ChartComponent from '../components/chart.js';
import { showLoading, showError, showToast, formatRelativeTime } from '../utils/helpers.js';
import CONFIG from '../config.js';

class DashboardPage {
    constructor() {
        this.stats = null;
        this.charts = {};
    }

    async render() {
        const content = document.getElementById('main-content');
        showLoading(content);

        try {
            // Fetch all required data
            const [statsData, users, routes, checkStats] = await Promise.all([
                api.get('/analytics-main'),
                api.getUsers(),
                api.getRoutes(),
                api.getCheckStats()
            ]);

            this.renderContent(statsData, users, routes, checkStats);
        } catch (error) {
            console.error('Dashboard error:', error);
            showError(content, error);
        }
    }

    renderContent(statsData, users, routes, checkStats) {
        const content = document.getElementById('main-content');

        // Статистика проверок из API
        const apiCheckStats = statsData.checkStats || {};
        const successRate = apiCheckStats.total_combinations > 0
            ? ((apiCheckStats.successful_checks / apiCheckStats.total_combinations) * 100).toFixed(1)
            : 0;

        // DAU/WAU/MAU
        const userActivity = statsData.userActivity || { dau: 0, wau: 0, mau: 0 };

        // Комбинации
        const combinations = statsData.combinations || { total: 0, fixed: 0, flexible: 0 };

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>Панель управления</h2>
                        <p class="text-muted">Общая статистика системы</p>
                    </div>
                </div>

                <!-- Stats Cards -->
                <div id="stats-cards" class="mb-4"></div>

                <!-- Комбинации и проверки -->
                <div class="row g-4 mb-4">
                    <div class="col-lg-6">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">🔢 Комбинации для проверки</h5>
                            </div>
                            <div class="card-body">
                                <div class="row text-center">
                                    <div class="col-4">
                                        <h3 class="text-primary mb-0">${combinations.total.toLocaleString()}</h3>
                                        <small class="text-muted">Всего</small>
                                    </div>
                                    <div class="col-4">
                                        <h3 class="text-info mb-0">${combinations.fixed.toLocaleString()}</h3>
                                        <small class="text-muted">Фиксированные</small>
                                    </div>
                                    <div class="col-4">
                                        <h3 class="text-warning mb-0">${combinations.flexible.toLocaleString()}</h3>
                                        <small class="text-muted">Гибкие</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-6">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <h5 class="mb-0">📋 Статистика проверок</h5>
                                <a href="#check-stats" class="btn btn-sm btn-outline-secondary">Подробнее</a>
                            </div>
                            <div class="card-body">
                                <div class="row text-center">
                                    <div class="col-3">
                                        <h3 class="text-primary mb-0">${apiCheckStats.total_check_runs?.toLocaleString() || 0}</h3>
                                        <small class="text-muted">Проверок</small>
                                    </div>
                                    <div class="col-3">
                                        <h3 class="text-success mb-0">${apiCheckStats.successful_checks?.toLocaleString() || 0}</h3>
                                        <small class="text-muted">Успешных</small>
                                    </div>
                                    <div class="col-3">
                                        <h3 class="text-danger mb-0">${apiCheckStats.failed_checks?.toLocaleString() || 0}</h3>
                                        <small class="text-muted">Неудачных</small>
                                    </div>
                                    <div class="col-3">
                                        <h3 class="text-info mb-0">${successRate}%</h3>
                                        <small class="text-muted">Success Rate</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- DAU/WAU/MAU -->
                <div class="row g-4 mb-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">👥 Активность пользователей</h5>
                            </div>
                            <div class="card-body">
                                <div class="row text-center">
                                    <div class="col-4">
                                        <h2 class="text-success mb-0">${userActivity.dau}</h2>
                                        <p class="text-muted mb-0">DAU</p>
                                        <small class="text-muted">за последние 24 часа</small>
                                    </div>
                                    <div class="col-4">
                                        <h2 class="text-primary mb-0">${userActivity.wau}</h2>
                                        <p class="text-muted mb-0">WAU</p>
                                        <small class="text-muted">за последние 7 дней</small>
                                    </div>
                                    <div class="col-4">
                                        <h2 class="text-info mb-0">${userActivity.mau}</h2>
                                        <p class="text-muted mb-0">MAU</p>
                                        <small class="text-muted">за последние 30 дней</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Charts Row -->
                <div class="row g-4 mb-4">
                    <div class="col-lg-8">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">📊 Активность по дням</h5>
                            </div>
                            <div class="card-body">
                                <canvas id="activity-chart" height="300"></canvas>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">📈 Распределение подписок</h5>
                            </div>
                            <div class="card-body">
                                <canvas id="subscriptions-chart" height="300"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tables Row -->
                <div class="row g-4">
                    <div class="col-lg-6">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <h5 class="mb-0">👑 Топ пользователей</h5>
                                <a href="#users" class="btn btn-sm btn-outline-primary">Все</a>
                            </div>
                            <div class="card-body">
                                ${this.renderTopUsers(statsData.topUsers || [])}
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-6">
                        <div class="card">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <h5 class="mb-0">✈️ Популярные маршруты</h5>
                                <a href="#routes" class="btn btn-sm btn-outline-primary">Все</a>
                            </div>
                            <div class="card-body">
                                ${this.renderTopRoutes(statsData.topRoutes || [])}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Recent Activity -->
                <div class="row g-4 mt-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">🕐 Последняя активность</h5>
                            </div>
                            <div class="card-body">
                                ${this.renderRecentActivity(checkStats)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = html;

        // Render stats cards
        this.renderStatsCards(statsData, users, routes);

        // Render charts
        this.renderCharts(statsData, routes);
    }

    renderStatsCards(statsData, users, routes) {
        const activeRoutes = routes.filter(r => !r.is_paused).length;
        const flexibleRoutes = routes.filter(r => r.is_flexible).length;

        const stats = [
            {
                icon: 'bi-people-fill',
                value: users.length,
                label: 'Пользователи',
                sublabel: 'Всего зарегистрировано',
                variant: 'primary',
                cols: '3'
            },
            {
                icon: 'bi-airplane-fill',
                value: routes.length,
                label: 'Маршруты',
                sublabel: `${activeRoutes} активных`,
                variant: 'success',
                cols: '3'
            },
            {
                icon: 'bi-star-fill',
                value: flexibleRoutes,
                label: 'Гибкие маршруты',
                sublabel: `${routes.length - flexibleRoutes} фиксированных`,
                variant: 'info',
                cols: '3'
            },
            {
                icon: 'bi-graph-up',
                value: users.length ? (routes.length / users.length).toFixed(1) : 0,
                label: 'Среднее маршрутов',
                sublabel: 'На пользователя',
                variant: 'warning',
                cols: '3'
            }
        ];

        const statsCard = new StatsCard({
            containerId: 'stats-cards',
            stats: stats
        });

        statsCard.render();
    }

    renderCharts(statsData, routes) {
        // Activity Chart (last 7 days)
        const last7Days = this.getLast7Days();
        const activityData = last7Days.map(date => {
            return routes.filter(r => {
                const created = new Date(r.created_at).toISOString().split('T')[0];
                return created === date;
            }).length;
        });

        this.charts.activity = ChartComponent.lineChart(
            'activity-chart',
            last7Days.map(d => new Date(d).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })),
            [{
                label: 'Новые маршруты',
                data: activityData,
                color: CONFIG.CHART_COLORS.PRIMARY
            }]
        );
        this.charts.activity.render();

        // Subscriptions Chart - используем данные из API (по пользователям)
        const subscriptionStats = statsData.subscriptionStats || [];
        const labels = [];
        const values = [];

        // Сортируем по количеству пользователей
        subscriptionStats.forEach(sub => {
            const typeName = sub.subscription_type === 'free' ? 'Free' :
                             sub.subscription_type === 'plus' ? 'Plus' :
                             sub.subscription_type === 'admin' ? 'Admin' : sub.subscription_type;
            labels.push(typeName);
            values.push(sub.user_count);
        });

        // Если нет данных, показываем пустой график
        if (labels.length === 0) {
            labels.push('Нет данных');
            values.push(0);
        }

        this.charts.subscriptions = ChartComponent.doughnutChart(
            'subscriptions-chart',
            labels,
            values,
            [CONFIG.CHART_COLORS.INFO, CONFIG.CHART_COLORS.SUCCESS, CONFIG.CHART_COLORS.PURPLE, CONFIG.CHART_COLORS.WARNING]
        );
        this.charts.subscriptions.render();
    }

    renderTopUsers(topUsers) {
        if (!topUsers || topUsers.length === 0) {
            return '<p class="text-muted">Нет данных</p>';
        }

        return `
            <div class="list-group list-group-flush">
                ${topUsers.slice(0, 5).map((user, index) => `
                    <div class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <span class="badge bg-primary rounded-circle me-2">${index + 1}</span>
                            <code>${user.chatid}</code>
                        </div>
                        <span class="badge bg-primary rounded-pill">${user.routecount} маршрутов</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderTopRoutes(topRoutes) {
        if (!topRoutes || topRoutes.length === 0) {
            return '<p class="text-muted">Нет данных</p>';
        }

        return `
            <div class="list-group list-group-flush">
                ${topRoutes.slice(0, 5).map((route, index) => `
                    <div class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <span class="badge bg-success rounded-circle me-2">${index + 1}</span>
                            <strong>${route.origin} → ${route.destination}</strong>
                        </div>
                        <span class="badge bg-success rounded-pill">${route.count}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderRecentActivity(checkStats) {
        if (!checkStats || checkStats.length === 0) {
            return '<p class="text-muted">Нет последней активности</p>';
        }

        return `
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Маршрут</th>
                            <th>Успешных</th>
                            <th>Неудачных</th>
                            <th>Время</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${checkStats.slice(0, 10).map(stat => `
                            <tr>
                                <td>${stat.routename}</td>
                                <td><span class="badge bg-success">${stat.successful_checks}</span></td>
                                <td><span class="badge bg-danger">${stat.failed_checks}</span></td>
                                <td><small class="text-muted">${formatRelativeTime(stat.check_timestamp)}</small></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    getLast7Days() {
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dates.push(date.toISOString().split('T')[0]);
        }
        return dates;
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

export default DashboardPage;
