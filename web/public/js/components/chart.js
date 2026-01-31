// web/public/js/components/chart.js

import CONFIG from '../config.js';

class ChartComponent {
    constructor(config) {
        this.config = {
            canvasId: config.canvasId,
            type: config.type || 'line',
            data: config.data || {},
            options: config.options || {}
        };

        this.chart = null;
    }

    render() {
        const canvas = document.getElementById(this.config.canvasId);
        if (!canvas) {
            console.error(`Canvas with id ${this.config.canvasId} not found`);
            return;
        }

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
        }

        const ctx = canvas.getContext('2d');

        const defaultOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        };

        const mergedOptions = this.mergeOptions(defaultOptions, this.config.options);

        this.chart = new Chart(ctx, {
            type: this.config.type,
            data: this.config.data,
            options: mergedOptions
        });
    }

    mergeOptions(defaults, custom) {
        return {
            ...defaults,
            ...custom,
            plugins: {
                ...defaults.plugins,
                ...custom.plugins
            }
        };
    }

    update(data) {
        if (this.chart) {
            this.chart.data = data;
            this.chart.update();
        }
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    // Static helper methods for creating common chart types
    static lineChart(canvasId, labels, datasets) {
        return new ChartComponent({
            canvasId,
            type: 'line',
            data: {
                labels,
                datasets: datasets.map((dataset, index) => ({
                    label: dataset.label,
                    data: dataset.data,
                    borderColor: dataset.color || CONFIG.CHART_COLORS.PRIMARY,
                    backgroundColor: dataset.backgroundColor || `${dataset.color || CONFIG.CHART_COLORS.PRIMARY}20`,
                    tension: 0.4,
                    fill: dataset.fill !== false
                }))
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    static barChart(canvasId, labels, datasets) {
        return new ChartComponent({
            canvasId,
            type: 'bar',
            data: {
                labels,
                datasets: datasets.map((dataset, index) => ({
                    label: dataset.label,
                    data: dataset.data,
                    backgroundColor: dataset.color || CONFIG.CHART_COLORS.PRIMARY
                }))
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    static pieChart(canvasId, labels, data, colors) {
        return new ChartComponent({
            canvasId,
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors || Object.values(CONFIG.CHART_COLORS)
                }]
            }
        });
    }

    static doughnutChart(canvasId, labels, data, colors) {
        return new ChartComponent({
            canvasId,
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors || Object.values(CONFIG.CHART_COLORS)
                }]
            }
        });
    }
}

export default ChartComponent;
