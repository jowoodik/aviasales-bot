// web/public/js/pages/checkStats.js

import api from '../api.js';
import Table from '../components/table.js';
import ChartComponent from '../components/chart.js';
import CONFIG from '../config.js';
import { showLoading, showError, formatDateTime } from '../utils/helpers.js';

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

    handleAction(action, id) {
        // For now, just view details
        if (action === 'view') {
            const stat = this.stats.find(s => s.route_id == id);
            if (stat) {
                window.location.hash = `#routes?view=${stat.route_id}`;
            }
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
