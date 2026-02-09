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
            const [statsData, users, routes, checkStats, monetizationStats, engagementStats, checkDuration] = await Promise.all([
                api.get('/analytics-main'),
                api.getUsers(),
                api.getRoutes(),
                api.getCheckStats(),
                api.get('/monetization-stats?period=30'),
                api.get('/engagement-stats?period=30'),
                api.get('/check-duration-by-hour?days=7')
            ]);

            this.renderContent(statsData, users, routes, checkStats, monetizationStats, engagementStats, checkDuration);
        } catch (error) {
            console.error('Dashboard error:', error);
            showError(content, error);
        }
    }

    renderContent(statsData, users, routes, checkStats, monetizationStats, engagementStats, checkDuration) {
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

                <!-- График длительности проверок -->
                <div class="row g-4 mb-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">⏱️ Длительность проверок по часам</h5>
                            </div>
                            <div class="card-body">
                                <canvas id="check-duration-chart"></canvas>
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

                <!-- Монетизация -->
                ${this.renderMonetization(monetizationStats || {})}

                <!-- Вовлеченность (Engagement) -->
                ${this.renderEngagement(engagementStats || {})}

                <!-- Воронки конверсии -->
                ${this.renderFunnels(statsData.funnels || {})}

                <!-- Charts Row -->
                <div class="row g-4 mb-4">
                    <div class="col-lg-8">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">📊 DAU - Активные пользователи по дням</h5>
                            </div>
                            <div class="card-body">
                                <canvas id="dau-history-chart" height="300"></canvas>
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

                <!-- Hourly Stats & Avg Prices -->
                <div class="row g-4 mb-4">
                    <div class="col-lg-6">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">⏰ Проверки по часам (7 дней)</h5>
                            </div>
                            <div class="card-body">
                                <canvas id="hourly-chart" height="250"></canvas>
                            </div>
                        </div>
                    </div>
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
                </div>

                <!-- Settings Activity -->
                <div class="row g-4 mt-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">⚙️ Статистика настроек (30 дней)</h5>
                            </div>
                            <div class="card-body">
                                ${this.renderSettingsActivity(statsData.settingsActivity || {})}
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

        // Render hourly chart
        this.renderHourlyChart(statsData.hourlyStats || []);

        // Render check duration chart
        this.renderCheckDurationChart(checkDuration.checkDuration || []);
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
        // DAU History Chart - реальная активность пользователей
        const dauHistory = statsData.dauHistory || [];

        // Подготавливаем данные для графика
        let dauLabels = [];
        let dauData = [];

        if (dauHistory.length > 0) {
            dauLabels = dauHistory.map(d => {
                const date = new Date(d.date);
                return date.toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
            });
            dauData = dauHistory.map(d => d.users);
        } else {
            // Если нет данных, показываем последние 7 дней с нулями
            const last7Days = this.getLast7Days();
            dauLabels = last7Days.map(d => new Date(d).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' }));
            dauData = last7Days.map(() => 0);
        }

        this.charts.dauHistory = ChartComponent.lineChart(
            'dau-history-chart',
            dauLabels,
            [{
                label: 'Активные пользователи (DAU)',
                data: dauData,
                color: CONFIG.CHART_COLORS.SUCCESS
            }]
        );
        this.charts.dauHistory.render();

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

    renderSettingsActivity(settingsActivity) {
        const timezoneChanges = settingsActivity.timezoneChanges || 0;
        const notificationToggles = settingsActivity.notificationToggles || 0;
        const nightModeToggles = settingsActivity.nightModeToggles || 0;
        const notificationsEnabled = settingsActivity.notificationsEnabled || 0;
        const notificationsDisabled = settingsActivity.notificationsDisabled || 0;
        const nightModeEnabled = settingsActivity.nightModeEnabled || 0;
        const nightModeDisabled = settingsActivity.nightModeDisabled || 0;

        return `
            <div class="row text-center">
                <div class="col-md-3">
                    <div class="card border-primary mb-3">
                        <div class="card-body">
                            <h3 class="text-primary">${timezoneChanges}</h3>
                            <p class="text-muted mb-0">🌍 Смена таймзоны</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-info mb-3">
                        <div class="card-body">
                            <h3 class="text-info">${notificationToggles}</h3>
                            <p class="text-muted mb-0">🔔 Переключений уведомлений</p>
                            <small class="text-success">✅ Вкл: ${notificationsEnabled}</small><br>
                            <small class="text-danger">🔕 Выкл: ${notificationsDisabled}</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-warning mb-3">
                        <div class="card-body">
                            <h3 class="text-warning">${nightModeToggles}</h3>
                            <p class="text-muted mb-0">🌙 Переключений ночного режима</p>
                            <small class="text-success">✅ Вкл: ${nightModeEnabled}</small><br>
                            <small class="text-danger">❌ Выкл: ${nightModeDisabled}</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-secondary mb-3">
                        <div class="card-body">
                            <h3 class="text-secondary">${timezoneChanges + notificationToggles + nightModeToggles}</h3>
                            <p class="text-muted mb-0">⚙️ Всего изменений</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderFunnels(funnels) {
        const routes = funnels.routes || {
            started_creation: 0,
            selected_airports: 0,
            selected_search_type: 0,
            selected_has_return: 0,
            selected_dates: 0,
            selected_airline: 0,
            selected_adults: 0,
            selected_children: 0,
            selected_baggage: 0,
            selected_max_stops: 0,
            selected_max_layover: 0,
            selected_budget: 0,
            completed_creation: 0
        };
        const subscription = funnels.subscription || { viewed_subscription: 0, upgrade_attempts: 0 };

        // Рассчитываем проценты от базы (начали создание = 100%)
        const routesBase = routes.started_creation || 1;
        const airportsPercent = Math.round((routes.selected_airports / routesBase) * 100);
        const searchTypePercent = Math.round((routes.selected_search_type / routesBase) * 100);
        const hasReturnPercent = Math.round((routes.selected_has_return / routesBase) * 100);
        const datesPercent = Math.round((routes.selected_dates / routesBase) * 100);
        const airlinePercent = Math.round((routes.selected_airline / routesBase) * 100);
        const adultsPercent = Math.round((routes.selected_adults / routesBase) * 100);
        const childrenPercent = Math.round((routes.selected_children / routesBase) * 100);
        const baggagePercent = Math.round((routes.selected_baggage / routesBase) * 100);
        const maxStopsPercent = Math.round((routes.selected_max_stops / routesBase) * 100);
        const maxLayoverPercent = Math.round((routes.selected_max_layover / routesBase) * 100);
        const budgetPercent = Math.round((routes.selected_budget / routesBase) * 100);
        const completedPercent = Math.round((routes.completed_creation / routesBase) * 100);

        // Вычисляем drop-off на критичных шагах
        const dropAirports = Math.round(((routesBase - routes.selected_airports) / routesBase) * 100);
        const dropDates = Math.round(((routes.selected_has_return - routes.selected_dates) / Math.max(routes.selected_has_return, 1)) * 100);
        const dropBudget = Math.round(((routes.selected_max_stops - routes.selected_budget) / Math.max(routes.selected_max_stops, 1)) * 100);

        // Рассчитываем проценты для воронки подписки
        const subscriptionBase = subscription.viewed_subscription || 1;
        const upgradePercent = Math.round((subscription.upgrade_attempts / subscriptionBase) * 100);

        // Средняя конверсия попыток в маршрут
        const attemptsPerRoute = routesBase > 0 && routes.completed_creation > 0
            ? (routesBase / routes.completed_creation).toFixed(1)
            : '—';

        return `
            <div class="row g-4 mb-4">
                <div class="col-lg-8">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5 class="mb-0">📊 Детальная воронка создания маршрута (30 дней)</h5>
                            <span class="badge bg-info">Попыток на маршрут: ${attemptsPerRoute}</span>
                        </div>
                        <div class="card-body" style="max-height: 600px; overflow-y: auto;">
                            <!-- Начало воронки -->
                            <div class="funnel-step mb-2">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><strong>🎬 Начали создание</strong></span>
                                    <span class="badge bg-primary">${routes.started_creation} (100%)</span>
                                </div>
                                <div class="progress" style="height: 22px;">
                                    <div class="progress-bar bg-primary" style="width: 100%;"></div>
                                </div>
                            </div>

                            <div class="text-center text-muted" style="font-size: 0.8em;">↓ ${dropAirports > 15 ? `<span class="text-danger">дроп ${dropAirports}%</span>` : ''}</div>

                            <!-- Выбор направления -->
                            <div class="funnel-step mb-2">
                                <div class="d-flex justify-content-between mb-1">
                                    <span>✈️ Выбрали аэропорты</span>
                                    <span class="badge bg-info">${routes.selected_airports} (${airportsPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 20px;">
                                    <div class="progress-bar bg-info" style="width: ${airportsPercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 📅 Тип поиска (фикс/гибкий)</small></span>
                                    <span class="badge bg-secondary">${routes.selected_search_type} (${searchTypePercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${searchTypePercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 🔄 Тип билета (туда/обратно)</small></span>
                                    <span class="badge bg-secondary">${routes.selected_has_return} (${hasReturnPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${hasReturnPercent}%;"></div>
                                </div>
                            </div>

                            <div class="text-center text-muted" style="font-size: 0.8em;">↓ ${dropDates > 20 ? `<span class="text-danger">дроп ${dropDates}% 🚨</span>` : ''}</div>

                            <div class="funnel-step mb-2">
                                <div class="d-flex justify-content-between mb-1">
                                    <span>📆 Выбрали даты</span>
                                    <span class="badge bg-warning">${routes.selected_dates} (${datesPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 20px;">
                                    <div class="progress-bar bg-warning" style="width: ${datesPercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <!-- Параметры поиска -->
                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 🛫 Авиакомпания</small></span>
                                    <span class="badge bg-secondary">${routes.selected_airline} (${airlinePercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${airlinePercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 👥 Взрослые</small></span>
                                    <span class="badge bg-secondary">${routes.selected_adults} (${adultsPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${adultsPercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 👶 Дети</small></span>
                                    <span class="badge bg-secondary">${routes.selected_children} (${childrenPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${childrenPercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 🧳 Багаж</small></span>
                                    <span class="badge bg-secondary">${routes.selected_baggage} (${baggagePercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${baggagePercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <div class="funnel-step mb-2" style="margin-left: 15px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ 🔀 Пересадки</small></span>
                                    <span class="badge bg-secondary">${routes.selected_max_stops} (${maxStopsPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${maxStopsPercent}%;"></div>
                                </div>
                            </div>
                            ${routes.selected_max_layover > 0 ? `
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>
                            <div class="funnel-step mb-2" style="margin-left: 30px;">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><small>├─ ⏱️ Время пересадки</small></span>
                                    <span class="badge bg-secondary">${routes.selected_max_layover} (${maxLayoverPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 16px;">
                                    <div class="progress-bar bg-secondary" style="width: ${maxLayoverPercent}%;"></div>
                                </div>
                            </div>
                            ` : ''}

                            <div class="text-center text-muted" style="font-size: 0.8em;">↓ ${dropBudget > 20 ? `<span class="text-danger">дроп ${dropBudget}% 🚨</span>` : ''}</div>

                            <div class="funnel-step mb-2">
                                <div class="d-flex justify-content-between mb-1">
                                    <span>💰 Указали бюджет</span>
                                    <span class="badge bg-warning">${routes.selected_budget} (${budgetPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 20px;">
                                    <div class="progress-bar bg-warning" style="width: ${budgetPercent}%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted" style="font-size: 0.8em;">↓</div>

                            <!-- Завершение -->
                            <div class="funnel-step">
                                <div class="d-flex justify-content-between mb-1">
                                    <span><strong>✅ Завершили создание</strong></span>
                                    <span class="badge bg-success">${routes.completed_creation} (${completedPercent}%)</span>
                                </div>
                                <div class="progress" style="height: 22px;">
                                    <div class="progress-bar bg-success" style="width: ${completedPercent}%;"></div>
                                </div>
                            </div>

                            <div class="mt-3 alert alert-info mb-0">
                                <small>
                                    <strong>💡 Как читать воронку:</strong><br>
                                    • Все % считаются от "Начали создание" (базовый уровень)<br>
                                    • Дроп >15% = потенциальная проблема в UX<br>
                                    • "Попыток на маршрут" показывает friction в процессе
                                </small>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="card">
                        <div class="card-header">
                            <h5 class="mb-0">💎 Воронка подписки (30 дней)</h5>
                        </div>
                        <div class="card-body">
                            <div class="funnel-step mb-3">
                                <div class="d-flex justify-content-between mb-1">
                                    <span>Просмотрели подписку</span>
                                    <span class="badge bg-primary">${subscription.viewed_subscription} (100%)</span>
                                </div>
                                <div class="progress" style="height: 25px;">
                                    <div class="progress-bar bg-primary" style="width: 100%;"></div>
                                </div>
                            </div>
                            <div class="text-center text-muted mb-2">↓</div>
                            <div class="funnel-step">
                                <div class="d-flex justify-content-between mb-1">
                                    <span>Попытка апгрейда</span>
                                    <span class="badge bg-success">${subscription.upgrade_attempts} (${upgradePercent}%)</span>
                                </div>
                                <div class="progress" style="height: 25px;">
                                    <div class="progress-bar bg-success" style="width: ${upgradePercent}%;"></div>
                                </div>
                            </div>
                            <div class="mt-4 text-muted">
                                <small>* Воронка показывает конверсию пользователей в монетизацию</small>
                            </div>
                        </div>
                    </div>
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

    renderHourlyChart(hourlyStats) {
        // Подготавливаем данные для всех 24 часов
        const hoursData = new Array(24).fill(0);
        hourlyStats.forEach(stat => {
            if (stat.hour >= 0 && stat.hour < 24) {
                hoursData[stat.hour] = stat.checks;
            }
        });

        const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

        this.charts.hourly = ChartComponent.barChart(
            'hourly-chart',
            labels,
            [{
                label: 'Проверки',
                data: hoursData,
                color: CONFIG.CHART_COLORS.INFO
            }]
        );
        this.charts.hourly.render();
    }

    renderCheckDurationChart(checkDurationData) {
        if (!checkDurationData || checkDurationData.length === 0) {
            return;
        }

        // Подготовка данных для графика
        const labels = checkDurationData.map(item => {
            // Форматируем дату-время в читаемый вид
            const date = new Date(item.hour.replace(' ', 'T'));
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const hours = date.getHours().toString().padStart(2, '0');
            return `${day}.${month} ${hours}:00`;
        });

        const durations = checkDurationData.map(item => item.duration_minutes);
        const checksCount = checkDurationData.map(item => item.checks_count);

        // Создаем график с двумя осями Y
        this.charts.checkDuration = new ChartComponent({
            canvasId: 'check-duration-chart',
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Длительность (мин)',
                        data: durations,
                        borderColor: CONFIG.CHART_COLORS.PRIMARY,
                        backgroundColor: `${CONFIG.CHART_COLORS.PRIMARY}20`,
                        tension: 0.4,
                        yAxisID: 'y',
                        fill: true
                    },
                    {
                        label: 'Кол-во проверок',
                        data: checksCount,
                        borderColor: CONFIG.CHART_COLORS.SUCCESS,
                        backgroundColor: `${CONFIG.CHART_COLORS.SUCCESS}20`,
                        tension: 0.4,
                        yAxisID: 'y1',
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Длительность (минуты)'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Количество проверок'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
        this.charts.checkDuration.render();
    }

    renderMonetization(monetizationStats) {
        const totalClicks = monetizationStats.totalClicks || 0;
        const clicksPerUser = monetizationStats.clicksPerUser || 0;
        const ctr = monetizationStats.ctr || 0;
        const topRoutes = monetizationStats.topRoutesByClicks || [];
        const totalNotifications = monetizationStats.totalNotifications || 0;

        // Конверсия: просмотр уведомления → клик
        const conversionRate = totalNotifications > 0
            ? ((totalClicks / totalNotifications) * 100).toFixed(1)
            : 0;

        return `
            <div class="row g-4 mb-4">
                <div class="col-12">
                    <div class="card border-success">
                        <div class="card-header bg-success text-white">
                            <h5 class="mb-0">💰 Монетизация - Клики по партнерским ссылкам (30 дней)</h5>
                        </div>
                        <div class="card-body">
                            <div class="row text-center mb-4">
                                <div class="col-md-3">
                                    <h2 class="text-success mb-0">${totalClicks}</h2>
                                    <p class="text-muted mb-0">
                                        Всего кликов
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Количество кликов по кнопкам 'Купить билет' или 'Посмотреть билет' в уведомлениях и отчетах. Каждый клик отслеживается и может приносить партнерскую комиссию от Aviasales.">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">по ссылкам Aviasales</small>
                                </div>
                                <div class="col-md-3">
                                    <h2 class="text-primary mb-0">${ctr}%</h2>
                                    <p class="text-muted mb-0">
                                        CTR
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Click-Through Rate (CTR) — процент кликов по партнерским ссылкам от общего количества отправленных уведомлений. Показывает, насколько эффективно уведомления конвертируются в клики. Хороший CTR: 10-20%">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">клики / уведомления</small>
                                </div>
                                <div class="col-md-3">
                                    <h2 class="text-info mb-0">${clicksPerUser}</h2>
                                    <p class="text-muted mb-0">
                                        Кликов/пользователь
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Среднее количество кликов на одного активного пользователя. Показывает вовлеченность пользователей. Высокое значение означает, что пользователи активно интересуются предложениями.">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">среднее значение</small>
                                </div>
                                <div class="col-md-3">
                                    <h2 class="text-warning mb-0">${conversionRate}%</h2>
                                    <p class="text-muted mb-0">
                                        Конверсия
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Процент пользователей, которые кликнули на ссылку после получения уведомления. Это ключевая метрика монетизации — чем выше конверсия, тем больше потенциальный доход от партнерской программы.">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">уведомление → клик</small>
                                </div>
                            </div>

                            ${topRoutes.length > 0 ? `
                                <div class="row">
                                    <div class="col-12">
                                        <h6 class="text-muted mb-3">📍 Топ-5 направлений по кликам:</h6>
                                        <div class="table-responsive">
                                            <table class="table table-sm table-hover">
                                                <thead>
                                                    <tr>
                                                        <th>#</th>
                                                        <th>Направление</th>
                                                        <th>Кликов</th>
                                                        <th>Средняя цена</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${topRoutes.slice(0, 5).map((route, index) => `
                                                        <tr>
                                                            <td><span class="badge bg-success rounded-circle">${index + 1}</span></td>
                                                            <td><strong>${route.origin || 'N/A'} → ${route.destination || 'N/A'}</strong></td>
                                                            <td><span class="badge bg-primary">${route.clicks}</span></td>
                                                            <td>${route.avgPrice ? Math.round(route.avgPrice).toLocaleString() + ' ₽' : 'N/A'}</td>
                                                        </tr>
                                                    `).join('')}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            ` : `
                                <div class="alert alert-info mb-0">
                                    <i class="bi bi-info-circle me-2"></i>
                                    <strong>Пока нет данных о кликах.</strong> Статистика появится после первых кликов пользователей по партнерским ссылкам.
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderEngagement(engagementStats) {
        const stickiness = engagementStats.stickiness || 0;
        const activeRoutesPerUser = engagementStats.activeRoutesPerUser || 0;
        const retention = engagementStats.retention || { d1: 0, d7: 0, d30: 0 };

        return `
            <div class="row g-4 mb-4">
                <div class="col-12">
                    <div class="card border-info">
                        <div class="card-header bg-info text-white">
                            <h5 class="mb-0">🎯 Вовлеченность пользователей (30 дней)</h5>
                        </div>
                        <div class="card-body">
                            <div class="row text-center mb-4">
                                <div class="col-md-4">
                                    <h2 class="text-info mb-0">${stickiness}%</h2>
                                    <p class="text-muted mb-0">
                                        Stickiness
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Липкость продукта = DAU/MAU × 100%. Показывает, как часто пользователи возвращаются. Хороший показатель: >20%. Отличный: >50%">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">DAU / MAU</small>
                                </div>
                                <div class="col-md-4">
                                    <h2 class="text-primary mb-0">${activeRoutesPerUser}</h2>
                                    <p class="text-muted mb-0">
                                        Маршрутов/юзер
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Среднее количество активных маршрутов на одного активного пользователя. Показывает глубину использования продукта.">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">активных маршрутов</small>
                                </div>
                                <div class="col-md-4">
                                    <h2 class="text-warning mb-0">${retention.d7}%</h2>
                                    <p class="text-muted mb-0">
                                        Retention D7
                                        <span class="badge bg-light text-dark"
                                              style="cursor: help; font-weight: normal;"
                                              title="Процент пользователей, вернувшихся через 7 дней после первого визита. Ключевая метрика удержания.">
                                            ℹ️
                                        </span>
                                    </p>
                                    <small class="text-muted">возвращаемость</small>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-12">
                                    <h6 class="text-muted mb-3">📊 Retention (возвращаемость пользователей):</h6>
                                    <div class="row text-center">
                                        <div class="col-4">
                                            <div class="card bg-light">
                                                <div class="card-body py-3">
                                                    <h3 class="mb-0 ${retention.d1 >= 40 ? 'text-success' : retention.d1 >= 20 ? 'text-warning' : 'text-danger'}">${retention.d1}%</h3>
                                                    <p class="mb-0 text-muted"><strong>D1</strong> (день 1)</p>
                                                    <small class="text-muted">Вернулись на след. день</small>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-4">
                                            <div class="card bg-light">
                                                <div class="card-body py-3">
                                                    <h3 class="mb-0 ${retention.d7 >= 25 ? 'text-success' : retention.d7 >= 15 ? 'text-warning' : 'text-danger'}">${retention.d7}%</h3>
                                                    <p class="mb-0 text-muted"><strong>D7</strong> (неделя)</p>
                                                    <small class="text-muted">Вернулись через неделю</small>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-4">
                                            <div class="card bg-light">
                                                <div class="card-body py-3">
                                                    <h3 class="mb-0 ${retention.d30 >= 15 ? 'text-success' : retention.d30 >= 8 ? 'text-warning' : 'text-danger'}">${retention.d30}%</h3>
                                                    <p class="mb-0 text-muted"><strong>D30</strong> (месяц)</p>
                                                    <small class="text-muted">Вернулись через месяц</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="mt-3">
                                        <small class="text-muted">
                                            💡 <strong>Справка:</strong>
                                            <span class="text-success">Зеленый</span> = хорошо,
                                            <span class="text-warning">Желтый</span> = средне,
                                            <span class="text-danger">Красный</span> = требует внимания
                                        </small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
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
