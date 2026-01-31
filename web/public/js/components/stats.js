// web/public/js/components/stats.js

import { formatNumber, escapeHtml } from '../utils/helpers.js';

class StatsCard {
    constructor(config) {
        this.config = {
            containerId: config.containerId,
            stats: config.stats || []
        };
    }

    render() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return;

        const html = `
            <div class="row g-3">
                ${this.config.stats.map(stat => this.renderStatCard(stat)).join('')}
            </div>
        `;

        container.innerHTML = html;
    }

    renderStatCard(stat) {
        const iconClasses = {
            primary: 'primary',
            success: 'success',
            danger: 'danger',
            warning: 'warning',
            info: 'info'
        };

        const iconClass = iconClasses[stat.variant] || 'primary';

        return `
            <div class="col-md-6 col-lg-${stat.cols || '3'}">
                <div class="stat-card">
                    <div class="stat-card-icon ${iconClass}">
                        <i class="bi ${stat.icon}"></i>
                    </div>
                    <div class="stat-value">${formatNumber(stat.value)}</div>
                    <div class="stat-label">${escapeHtml(stat.label)}</div>
                    ${stat.sublabel ? `<small class="stat-sublabel">${escapeHtml(stat.sublabel)}</small>` : ''}
                    ${stat.trend ? this.renderTrend(stat.trend) : ''}
                </div>
            </div>
        `;
    }

    renderTrend(trend) {
        const isPositive = trend > 0;
        const icon = isPositive ? 'bi-arrow-up' : 'bi-arrow-down';
        const color = isPositive ? 'success' : 'danger';

        return `
            <div class="mt-2">
                <small class="text-${color}">
                    <i class="bi ${icon}"></i>
                    ${Math.abs(trend)}%
                </small>
                <small class="text-muted ms-1">за период</small>
            </div>
        `;
    }

    update(stats) {
        this.config.stats = stats;
        this.render();
    }
}

export default StatsCard;
