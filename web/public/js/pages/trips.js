// web/public/js/pages/trips.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatPrice, formatDate, formatDateTime } from '../utils/helpers.js';
import airportService from '../services/airportService.js';

class TripsPage {
    constructor() {
        this.table = null;
        this.trips = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2><i class="bi bi-map"></i> Составные маршруты</h2>
                        <p class="text-muted">Управление многоплечевыми поездками</p>
                    </div>
                </div>

                <div id="trips-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadTrips();
    }

    async loadTrips() {
        const container = document.getElementById('trips-table');
        showLoading(container);

        try {
            const trips = await api.getTrips();
            this.trips = trips;
            this.renderTable();
        } catch (error) {
            console.error('Error loading trips:', error);
            showError(container, error);
        }
    }

    renderTable() {
        this.table = new Table({
            containerId: 'trips-table',
            title: 'Составные маршруты',
            columns: CONFIG.TABLES.TRIPS.columns,
            data: this.trips,
            actions: CONFIG.TABLES.TRIPS.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadTrips()
        });

        this.table.render();
    }

    async handleAction(action, id) {
        const trip = this.trips.find(t => t.id == id);
        if (!trip) return;

        switch (action) {
            case 'view':
                await this.viewTrip(trip);
                break;
            case 'pause':
                await this.togglePauseTrip(trip);
                break;
            case 'delete':
                await this.deleteTrip(trip);
                break;
        }
    }

    formatLegRoute(leg) {
        const originCity = leg.origin_city || airportService.getCityName(leg.origin);
        const destCity = leg.destination_city || airportService.getCityName(leg.destination);
        const originLabel = originCity !== leg.origin ? `${originCity} (${leg.origin})` : leg.origin;
        const destLabel = destCity !== leg.destination ? `${destCity} (${leg.destination})` : leg.destination;
        return `${originLabel} → ${destLabel}`;
    }

    async viewTrip(trip) {
        const modal = new Modal({
            title: trip.name || `Trip #${trip.id}`,
            size: 'xl',
            body: `
                <div class="text-center py-3">
                    <div class="spinner-border spinner-border-sm" role="status"></div>
                    <span class="ms-2">Загрузка...</span>
                </div>
            `,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-warning" id="pause-trip-btn">
                    <i class="bi bi-${trip.is_paused ? 'play-fill' : 'pause-fill'}"></i>
                    ${trip.is_paused ? 'Возобновить' : 'Приостановить'}
                </button>
            `
        });

        modal.create();
        modal.show();

        // Load full trip details
        try {
            const tripDetail = await api.getTripById(trip.id);
            modal.setBody(this.renderTripTabs(tripDetail));

            // Setup tab handlers
            this.setupTabHandlers(tripDetail, modal.getBody());

        } catch (error) {
            modal.setBody(`<div class="alert alert-danger">Ошибка загрузки: ${error.message}</div>`);
        }

        // Pause button handler
        const pauseBtn = modal.getElement().querySelector('#pause-trip-btn');
        pauseBtn.addEventListener('click', () => {
            modal.hide();
            this.togglePauseTrip(trip);
        });
    }

    renderTripTabs(trip) {
        return `
            <ul class="nav nav-tabs" id="tripTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active text-dark" id="trip-info-tab" data-bs-toggle="tab" data-bs-target="#trip-info-pane" type="button" role="tab">
                        <i class="bi bi-info-circle"></i> Информация
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="trip-legs-tab" data-bs-toggle="tab" data-bs-target="#trip-legs-pane" type="button" role="tab">
                        <i class="bi bi-signpost-split"></i> Плечи маршрута
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="trip-results-tab" data-bs-toggle="tab" data-bs-target="#trip-results-pane" type="button" role="tab">
                        <i class="bi bi-trophy"></i> Лучшие результаты
                    </button>
                </li>
            </ul>
            <div class="tab-content pt-3" id="tripTabContent">
                <div class="tab-pane fade show active" id="trip-info-pane" role="tabpanel">
                    ${this.renderInfoTab(trip)}
                </div>
                <div class="tab-pane fade" id="trip-legs-pane" role="tabpanel" data-loaded="false">
                    ${this.renderLegsTab(trip)}
                </div>
                <div class="tab-pane fade" id="trip-results-pane" role="tabpanel" data-loaded="false">
                    ${this.renderResultsTab(trip)}
                </div>
            </div>
        `;
    }

    setupTabHandlers(trip, container) {
        // All tabs are rendered immediately, no lazy loading needed
    }

    renderInfoTab(trip) {
        const statusBadge = trip.is_paused
            ? '<span class="badge bg-secondary">Пауза</span>'
            : trip.is_archived
                ? '<span class="badge bg-dark">В архиве</span>'
                : '<span class="badge bg-success">Активен</span>';

        return `
            <div class="row g-3">
                <div class="col-md-6">
                    <h6>Основная информация</h6>
                    <table class="table table-sm">
                        <tr><td><strong>ID:</strong></td><td>${trip.id}</td></tr>
                        <tr><td><strong>Chat ID:</strong></td><td><code>${trip.chat_id}</code></td></tr>
                        <tr><td><strong>Название:</strong></td><td>${trip.name || '—'}</td></tr>
                        <tr><td><strong>Статус:</strong></td><td>${statusBadge}</td></tr>
                        <tr><td><strong>Создан:</strong></td><td>${formatDateTime(trip.created_at)}</td></tr>
                        <tr><td><strong>Последняя проверка:</strong></td><td>${trip.last_check ? formatDateTime(trip.last_check) : '—'}</td></tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>Параметры поиска</h6>
                    <table class="table table-sm">
                        <tr><td><strong>Даты вылета:</strong></td><td>${trip.departure_start || '—'} — ${trip.departure_end || '—'}</td></tr>
                        <tr><td><strong>Бюджет:</strong></td><td>${trip.threshold_price ? formatPrice(trip.threshold_price, trip.currency) : '—'}</td></tr>
                        <tr><td><strong>Валюта:</strong></td><td>${trip.currency || 'RUB'}</td></tr>
                    </table>
                    <p class="text-muted small">Фильтры (пассажиры, багаж, пересадки) задаются на уровне каждого плеча — см. вкладку "Плечи маршрута"</p>
                </div>
            </div>
        `;
    }

    renderLegsTab(trip) {
        const legs = trip.legs || [];

        if (legs.length === 0) {
            return '<p class="text-muted">Нет данных о плечах маршрута</p>';
        }

        const rows = legs.map(leg => {
            const originCity = leg.origin_city || airportService.getCityName(leg.origin);
            const destCity = leg.destination_city || airportService.getCityName(leg.destination);
            const originLabel = originCity !== leg.origin ? `${originCity} (${leg.origin})` : leg.origin;
            const destLabel = destCity !== leg.destination ? `${destCity} (${leg.destination})` : leg.destination;

            const adults = leg.adults || 1;
            const children = leg.children || 0;
            const pax = children > 0 ? `${adults} + ${children} дет` : `${adults}`;
            const airline = leg.airline || 'Любая';
            const baggage = leg.baggage ? 'Да' : 'Нет';
            let stops = '—';
            if (leg.max_stops === 0) stops = 'Прямой';
            else if (leg.max_stops === 1) stops = 'До 1';
            else if (leg.max_stops === 2) stops = 'До 2';
            else if (leg.max_stops !== null && leg.max_stops !== undefined) stops = `До ${leg.max_stops}`;
            const layover = leg.max_layover_hours ? `${leg.max_layover_hours}ч` : '—';

            return `
                <tr>
                    <td><span class="badge bg-primary">${leg.leg_order}</span></td>
                    <td>${originLabel}</td>
                    <td>${destLabel}</td>
                    <td>${leg.min_days !== null && leg.min_days !== undefined ? leg.min_days : '—'}</td>
                    <td>${leg.max_days !== null && leg.max_days !== undefined ? leg.max_days : '—'}</td>
                    <td>${pax}</td>
                    <td>${airline}</td>
                    <td>${baggage}</td>
                    <td>${stops}</td>
                    <td>${layover}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="table-responsive">
                <table class="table table-sm table-hover">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Откуда</th>
                            <th>Куда</th>
                            <th>Мин. дней</th>
                            <th>Макс. дней</th>
                            <th>Пасс.</th>
                            <th>А/К</th>
                            <th>Багаж</th>
                            <th>Пересадки</th>
                            <th>Пересадка макс.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderResultsTab(trip) {
        const results = trip.results || [];

        if (results.length === 0) {
            return '<p class="text-muted">Пока нет результатов поиска</p>';
        }

        return results.map((result, index) => {
            const legRows = (result.legs || []).map(leg => {
                const legInfo = (trip.legs || []).find(l => l.leg_order === leg.leg_order);
                const origin = legInfo ? legInfo.origin : `Плечо ${leg.leg_order}`;
                const destination = legInfo ? legInfo.destination : '';
                const route = legInfo ? `${origin}→${destination}` : origin;

                return `
                    <tr>
                        <td><small>Плечо ${leg.leg_order}: ${route}</small></td>
                        <td><small>${leg.departure_date || '—'}</small></td>
                        <td><small>${leg.airline || '—'}</small></td>
                        <td><small><strong>${leg.price ? formatPrice(leg.price, trip.currency) : '—'}</strong></small></td>
                        <td>
                            ${leg.search_link ? `<a href="${leg.search_link}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="bi bi-box-arrow-up-right"></i></a>` : '—'}
                        </td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="card mb-3">
                    <div class="card-header d-flex justify-content-between align-items-center py-2">
                        <strong>Результат #${index + 1} — ${formatPrice(result.total_price, trip.currency)}</strong>
                        <small class="text-muted">${result.found_at ? formatDateTime(result.found_at) : ''}</small>
                    </div>
                    <div class="card-body p-0">
                        <table class="table table-sm mb-0">
                            <thead>
                                <tr>
                                    <th><small>Маршрут</small></th>
                                    <th><small>Дата</small></th>
                                    <th><small>А/К</small></th>
                                    <th><small>Цена</small></th>
                                    <th><small>Ссылка</small></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${legRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }).join('');
    }

    async togglePauseTrip(trip) {
        const newStatus = !trip.is_paused;
        const action = newStatus ? 'приостановить' : 'возобновить';

        const confirmed = await showConfirm(
            `${action.charAt(0).toUpperCase() + action.slice(1)} трип "${trip.name || 'ID: ' + trip.id}"?`,
            null,
            'Подтверждение'
        );

        if (!confirmed) return;

        try {
            await api.toggleTrip(trip.id, newStatus);
            showToast(`Трип ${newStatus ? 'приостановлен' : 'возобновлен'}`, 'success');
            await this.loadTrips();
        } catch (error) {
            console.error('Error toggling trip:', error);
            showToast('Ошибка: ' + error.message, 'danger');
        }
    }

    async deleteTrip(trip) {
        const confirmed = await showConfirm(
            `Удалить трип "${trip.name || 'ID: ' + trip.id}"? Это действие нельзя отменить.`,
            null,
            'Удаление трипа'
        );

        if (!confirmed) return;

        try {
            await api.deleteTrip(trip.id);
            showToast('Трип удален', 'success');
            await this.loadTrips();
        } catch (error) {
            console.error('Error deleting trip:', error);
            showToast('Ошибка: ' + error.message, 'danger');
        }
    }
}

export default TripsPage;
