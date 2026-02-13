// web/public/js/pages/checkStats.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import ChartComponent from '../components/chart.js';
import CONFIG from '../config.js';
import { showLoading, showError, formatDateTime, formatPrice } from '../utils/helpers.js';

class CheckStatsPage {
    constructor() {
        this.table = null;
        this.stats = [];
        this.charts = {};
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>📊 Статистика проверок</h2>
                        <p class="text-muted">Детальная информация о проверках маршрутов</p>
                    </div>
                </div>

                <!-- Summary Cards -->
                <div class="row g-3 mb-4">
                    <div class="col-md-3">
                        <div class="card">
                            <div class="card-body text-center">
                                <h6 class="text-muted">Всего проверок</h6>
                                <h3 class="mb-0" id="total-checks">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-success">
                            <div class="card-body text-center">
                                <h6 class="text-success">Успешных</h6>
                                <h3 class="mb-0 text-success" id="successful-checks">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-danger">
                            <div class="card-body text-center">
                                <h6 class="text-danger">Неудачных</h6>
                                <h3 class="mb-0 text-danger" id="failed-checks">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-info">
                            <div class="card-body text-center">
                                <h6 class="text-info">Success Rate</h6>
                                <h3 class="mb-0 text-info" id="success-rate">-</h3>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Chart -->
                <div class="row g-3 mb-4">
                    <div class="col-lg-12">
                        <div class="card">
                            <div class="card-header">
                                <h5 class="mb-0">📈 Динамика проверок по часам</h5>
                            </div>
                            <div class="card-body">
                                <canvas id="checks-timeline-chart" height="100"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Filters -->
                <div class="row mb-3">
                    <div class="col-md-4">
                        <label class="form-label">Период</label>
                        <select class="form-select" id="period-filter">
                            <option value="all">Все время</option>
                            <option value="24h" selected>Последние 24 часа</option>
                            <option value="7d">Последние 7 дней</option>
                            <option value="30d">Последние 30 дней</option>
                        </select>
                    </div>
                </div>

                <!-- Table -->
                <div id="check-stats-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadStats();
        this.attachFilterListeners();
    }

    async loadStats() {
        const container = document.getElementById('check-stats-table');
        showLoading(container);

        try {
            this.stats = await api.getCheckStats();
            this.updateSummary();
            this.renderChart();
            this.renderTable();
        } catch (error) {
            console.error('Error loading check stats:', error);
            showError(container, error);
        }
    }

    updateSummary() {
        const totalChecks = this.stats.reduce((sum, s) => sum + (s.successful_checks + s.failed_checks), 0);
        const successfulChecks = this.stats.reduce((sum, s) => sum + s.successful_checks, 0);
        const failedChecks = this.stats.reduce((sum, s) => sum + s.failed_checks, 0);
        const successRate = totalChecks > 0 ? ((successfulChecks / totalChecks) * 100).toFixed(1) : 0;

        document.getElementById('total-checks').textContent = totalChecks;
        document.getElementById('successful-checks').textContent = successfulChecks;
        document.getElementById('failed-checks').textContent = failedChecks;
        document.getElementById('success-rate').textContent = successRate + '%';
    }

    renderChart() {
        // Group by hour
        const hourlyData = this.groupByHour(this.stats);

        const labels = Object.keys(hourlyData).sort();
        const successData = labels.map(label => hourlyData[label].successful);
        const failedData = labels.map(label => hourlyData[label].failed);

        this.charts.timeline = new ChartComponent({
            canvasId: 'checks-timeline-chart',
            type: 'line',
            data: {
                labels: labels.map(l => this.formatHourLabel(l)),
                datasets: [
                    {
                        label: 'Успешные',
                        data: successData,
                        borderColor: CONFIG.CHART_COLORS.SUCCESS,
                        backgroundColor: CONFIG.CHART_COLORS.SUCCESS + '20',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Неудачные',
                        data: failedData,
                        borderColor: CONFIG.CHART_COLORS.DANGER,
                        backgroundColor: CONFIG.CHART_COLORS.DANGER + '20',
                        tension: 0.4,
                        fill: true
                    }
                ]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top'
                    }
                }
            }
        });

        this.charts.timeline.render();
    }

    groupByHour(stats) {
        const grouped = {};

        stats.forEach(stat => {
            if (!stat.check_timestamp) return;

            const date = new Date(stat.check_timestamp);
            const hour = date.toISOString().slice(0, 13); // YYYY-MM-DDTHH

            if (!grouped[hour]) {
                grouped[hour] = { successful: 0, failed: 0 };
            }

            grouped[hour].successful += stat.successful_checks || 0;
            grouped[hour].failed += stat.failed_checks || 0;
        });

        return grouped;
    }

    formatHourLabel(isoHour) {
        const date = new Date(isoHour + ':00:00');
        return date.toLocaleString('ru-RU', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    renderTable() {
        this.table = new Table({
            containerId: 'check-stats-table',
            title: 'Детали проверок',
            columns: CONFIG.TABLES.CHECK_STATS.columns,
            data: this.stats,
            actions: CONFIG.TABLES.CHECK_STATS.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadStats()
        });

        this.table.render();
    }

    async handleAction(action, id) {
        if (action === 'view') {
            const stat = this.stats.find(s => s.id == id);
            if (stat) {
                await this.viewCheckDetails(stat);
            }
        }
    }

    async viewCheckDetails(stat) {
        const modal = new Modal({
            title: `Проверка: ${stat.routename || 'Маршрут #' + stat.route_id}`,
            size: 'xl',
            body: this.renderTabbedContent(stat),
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
            `
        });

        modal.create();
        modal.show();

        // Load info tab immediately
        this.loadInfoTab(stat, modal.getBody());

        // Setup lazy loading
        this.setupTabHandlers(stat, modal.getBody());
    }

    renderTabbedContent(stat) {
        return `
            <ul class="nav nav-tabs" id="checkTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active text-dark" id="info-tab" data-bs-toggle="tab" data-bs-target="#info-pane" type="button" role="tab">
                        <i class="bi bi-info-circle"></i> Сводка
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="details-tab" data-bs-toggle="tab" data-bs-target="#details-pane" type="button" role="tab">
                        <i class="bi bi-list-check"></i> Детализация
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="route-tab" data-bs-toggle="tab" data-bs-target="#route-pane" type="button" role="tab">
                        <i class="bi bi-signpost-2"></i> Маршрут
                    </button>
                </li>
            </ul>
            <div class="tab-content pt-3" id="checkTabContent">
                <div class="tab-pane fade show active" id="info-pane" role="tabpanel">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="details-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="route-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
            </div>
        `;
    }

    setupTabHandlers(stat, container) {
        const tabs = container.querySelectorAll('[data-bs-toggle="tab"]');
        tabs.forEach(tab => {
            tab.addEventListener('shown.bs.tab', async (e) => {
                const targetId = e.target.getAttribute('data-bs-target');
                const pane = container.querySelector(targetId);

                if (pane && pane.dataset.loaded === 'false') {
                    pane.dataset.loaded = 'true';

                    switch (targetId) {
                        case '#details-pane':
                            await this.loadDetailsTab(stat, pane);
                            break;
                        case '#route-pane':
                            await this.loadRouteTab(stat, pane);
                            break;
                    }
                }
            });
        });
    }

    loadInfoTab(stat, container) {
        const infoPane = container.querySelector('#info-pane');
        const total = (stat.successful_checks || 0) + (stat.failed_checks || 0);
        const rate = total > 0 ? ((stat.successful_checks / total) * 100).toFixed(1) : '0';

        infoPane.innerHTML = `
            <div class="row g-3 mb-4">
                <div class="col-md-3">
                    <div class="card border-primary">
                        <div class="card-body text-center">
                            <h3 class="text-primary">${stat.total_combinations || total}</h3>
                            <small class="text-muted">Комбинаций</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-success">
                        <div class="card-body text-center">
                            <h3 class="text-success">${stat.successful_checks || 0}</h3>
                            <small class="text-muted">Успешных</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-danger">
                        <div class="card-body text-center">
                            <h3 class="text-danger">${stat.failed_checks || 0}</h3>
                            <small class="text-muted">Неудачных</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-info">
                        <div class="card-body text-center">
                            <h3 class="text-info">${rate}%</h3>
                            <small class="text-muted">Success Rate</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row g-3">
                <div class="col-md-6">
                    <h6>Информация о проверке</h6>
                    <table class="table table-sm">
                        <tr>
                            <td><strong>ID проверки:</strong></td>
                            <td>${stat.id}</td>
                        </tr>
                        <tr>
                            <td><strong>Route ID:</strong></td>
                            <td>${stat.route_id}</td>
                        </tr>
                        <tr>
                            <td><strong>Маршрут:</strong></td>
                            <td><strong>${stat.routename || '—'}</strong></td>
                        </tr>
                        <tr>
                            <td><strong>Chat ID:</strong></td>
                            <td><code>${stat.chatid || '—'}</code></td>
                        </tr>
                        <tr>
                            <td><strong>Время проверки:</strong></td>
                            <td>${stat.check_timestamp ? new Date(stat.check_timestamp).toLocaleString('ru-RU') : '—'}</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
    }

    async loadDetailsTab(stat, pane) {
        try {
            const data = await api.getCheckStatDetails(stat.id);
            const details = data.details || [];

            if (details.length === 0) {
                pane.innerHTML = '<p class="text-muted">Нет детальных данных по комбинациям для этой проверки</p>';
                return;
            }

            const statusColors = {
                'success': 'success',
                'found': 'success',
                'error': 'danger',
                'not_found': 'warning',
                'timeout': 'secondary'
            };
            const statusLabels = {
                'success': 'Найден',
                'found': 'Найден',
                'error': 'Ошибка',
                'not_found': 'Не найден',
                'timeout': 'Таймаут'
            };

            const successCount = details.filter(d => d.status === 'success' || d.status === 'found').length;
            const errorCount = details.filter(d => d.status === 'error').length;
            const notFoundCount = details.filter(d => d.status === 'not_found').length;

            pane.innerHTML = `
                <div class="row g-3 mb-3">
                    <div class="col-auto">
                        <span class="badge bg-success">Найдено: ${successCount}</span>
                    </div>
                    <div class="col-auto">
                        <span class="badge bg-danger">Ошибки: ${errorCount}</span>
                    </div>
                    <div class="col-auto">
                        <span class="badge bg-warning">Не найдено: ${notFoundCount}</span>
                    </div>
                    <div class="col-auto">
                        <span class="badge bg-secondary">Всего: ${details.length}</span>
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="table table-sm table-hover">
                        <thead>
                            <tr>
                                <th>Статус</th>
                                <th>Даты</th>
                                <th>Дней</th>
                                <th>Цена</th>
                                <th>Ошибка</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${details.map(d => {
                                const depDate = d.departure_date ? new Date(d.departure_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '?';
                                const retDate = d.return_date ? new Date(d.return_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';
                                const dates = retDate ? `${depDate} — ${retDate}` : depDate;
                                return `
                                    <tr>
                                        <td><span class="badge bg-${statusColors[d.status] || 'secondary'}">${statusLabels[d.status] || d.status}</span></td>
                                        <td><small>${dates}</small></td>
                                        <td>${d.days_in_country || '—'}</td>
                                        <td>${d.price ? formatPrice(d.price, d.currency) : '—'}</td>
                                        <td>${d.error_reason ? `<small class="text-danger">${d.error_reason}</small>` : '—'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <small class="text-muted">Показано ${details.length} комбинаций</small>
            `;
        } catch (error) {
            console.error('Error loading check details:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки деталей: ${error.message}</div>`;
        }
    }

    async loadRouteTab(stat, pane) {
        try {
            const route = await api.getRouteById(stat.route_id);

            const routeLabel = route.origin_city && route.destination_city
                ? `${route.origin_city} (${route.origin}) → ${route.destination_city} (${route.destination})`
                : `${route.origin} → ${route.destination}`;

            const dates = route.is_flexible
                ? `${route.departure_start || '?'} — ${route.departure_end || '?'}`
                : `${route.departure_date || '?'}${route.return_date ? ' — ' + route.return_date : ''}`;

            pane.innerHTML = `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6>Информация о маршруте</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>ID:</strong></td>
                                <td>${route.id}</td>
                            </tr>
                            <tr>
                                <td><strong>Маршрут:</strong></td>
                                <td><strong>${routeLabel}</strong></td>
                            </tr>
                            <tr>
                                <td><strong>Даты:</strong></td>
                                <td>${dates}</td>
                            </tr>
                            <tr>
                                <td><strong>Тип:</strong></td>
                                <td>${route.is_flexible ? '<span class="badge bg-info">Гибкий</span>' : '<span class="badge bg-secondary">Фиксированный</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Статус:</strong></td>
                                <td>${route.is_paused ? '<span class="badge bg-secondary">Пауза</span>' : '<span class="badge bg-success">Активен</span>'}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Параметры</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Порог цены:</strong></td>
                                <td><strong>${formatPrice(route.threshold_price, route.currency)}</strong></td>
                            </tr>
                            <tr>
                                <td><strong>Пассажиры:</strong></td>
                                <td>${route.adults || route.passengers_adults || 1} взр.</td>
                            </tr>
                            <tr>
                                <td><strong>Авиакомпания:</strong></td>
                                <td>${(route.airline || route.preferred_airline) === 'any' ? 'Любая' : (route.airline || route.preferred_airline || 'Любая')}</td>
                            </tr>
                            <tr>
                                <td><strong>Создан:</strong></td>
                                <td>${new Date(route.created_at).toLocaleString('ru-RU')}</td>
                            </tr>
                            <tr>
                                <td><strong>Последняя проверка:</strong></td>
                                <td>${route.last_check ? new Date(route.last_check).toLocaleString('ru-RU') : 'Не проверялся'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading route:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки маршрута: ${error.message}</div>`;
        }
    }

    attachFilterListeners() {
        const periodFilter = document.getElementById('period-filter');
        if (periodFilter) {
            periodFilter.addEventListener('change', () => {
                this.filterByPeriod(periodFilter.value);
            });
        }
    }

    filterByPeriod(period) {
        let cutoffDate = null;

        switch(period) {
            case '24h':
                cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                cutoffDate = null;
        }

        const filteredStats = cutoffDate
            ? this.stats.filter(s => new Date(s.check_timestamp) >= cutoffDate)
            : this.stats;

        this.table.updateData(filteredStats);

        // Update summary with filtered data
        const totalChecks = filteredStats.reduce((sum, s) => sum + (s.successful_checks + s.failed_checks), 0);
        const successfulChecks = filteredStats.reduce((sum, s) => sum + s.successful_checks, 0);
        const failedChecks = filteredStats.reduce((sum, s) => sum + s.failed_checks, 0);
        const successRate = totalChecks > 0 ? ((successfulChecks / totalChecks) * 100).toFixed(1) : 0;

        document.getElementById('total-checks').textContent = totalChecks;
        document.getElementById('successful-checks').textContent = successfulChecks;
        document.getElementById('failed-checks').textContent = failedChecks;
        document.getElementById('success-rate').textContent = successRate + '%';
    }

    destroy() {
        Object.values(this.charts).forEach(chart => {
            if (chart && chart.destroy) {
                chart.destroy();
            }
        });
        this.charts = {};
        this.table = null;
    }
}

export default CheckStatsPage;
