// web/public/js/pages/routes.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatPrice } from '../utils/helpers.js';

class RoutesPage {
    constructor() {
        this.table = null;
        this.routes = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>✈️ Управление маршрутами</h2>
                        <p class="text-muted">Просмотр, создание и редактирование маршрутов</p>
                    </div>
                </div>

                <div id="routes-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadRoutes();
    }

    async loadRoutes() {
        const container = document.getElementById('routes-table');
        showLoading(container);

        try {
            const routes = await api.getRoutes();
            this.routes = routes.map(route => ({
                ...route,
                route: `${route.origin} → ${route.destination}`, // создаем поле route
                dates: {
                    departure: route.departure_date,
                    return: route.return_date
                }
            }));

            this.renderTable();
        } catch (error) {
            console.error('Error loading routes:', error);
            showError(container, error);
        }
    }

    renderTable() {
        this.table = new Table({
            containerId: 'routes-table',
            title: 'Список маршрутов',
            columns: CONFIG.TABLES.ROUTES.columns,
            data: this.routes,
            actions: CONFIG.TABLES.ROUTES.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadRoutes(),
            onCreate: () => this.createRoute()
        });

        console.log(this.table);

        this.table.render();
    }

    async handleAction(action, id) {
        const route = this.routes.find(r => r.id == id);
        if (!route) return;

        switch (action) {
            case 'view':
                await this.viewRoute(route);
                break;
            case 'edit':
                await this.editRoute(route);
                break;
            case 'pause':
                await this.togglePauseRoute(route);
                break;
            case 'delete':
                await this.deleteRoute(route);
                break;
        }
    }

    async viewRoute(route) {
        const modal = new Modal({
            title: `${route.origin} → ${route.destination}`,
            size: 'lg',
            body: '<div id="route-details-content">Загрузка...</div>',
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-warning" id="pause-route-btn">
                    <i class="bi bi-${route.is_paused ? 'play-fill' : 'pause-fill'}"></i>
                    ${route.is_paused ? 'Возобновить' : 'Приостановить'}
                </button>
                <button type="button" class="btn btn-primary" id="edit-route-btn">
                    <i class="bi bi-pencil"></i> Редактировать
                </button>
            `
        });

        modal.create();
        modal.show();

        const detailsContent = modal.getBody();
        detailsContent.innerHTML = this.renderRouteDetails(route);

        // Load best tickets
        try {
            const tickets = await this.getRouteTickets(route.id);
            const ticketsSection = detailsContent.querySelector('#route-tickets');
            if (ticketsSection && tickets.length > 0) {
                ticketsSection.innerHTML = this.renderBestTickets(tickets);
            }
        } catch (error) {
            console.error('Error loading tickets:', error);
        }

        // Event handlers
        const pauseBtn = modal.getElement().querySelector('#pause-route-btn');
        pauseBtn.addEventListener('click', () => {
            modal.hide();
            this.togglePauseRoute(route);
        });

        const editBtn = modal.getElement().querySelector('#edit-route-btn');
        editBtn.addEventListener('click', () => {
            modal.hide();
            this.editRoute(route);
        });
    }

    renderRouteDetails(route) {
        return `
            <div class="row g-3">
                <div class="col-md-6">
                    <h6>Основная информация</h6>
                    <table class="table table-sm">
                        <tr>
                            <td><strong>ID:</strong></td>
                            <td>${route.id}</td>
                        </tr>
                        <tr>
                            <td><strong>Chat ID:</strong></td>
                            <td><code>${route.chat_id}</code></td>
                        </tr>
                        <tr>
                            <td><strong>Маршрут:</strong></td>
                            <td><strong>${route.origin} → ${route.destination}</strong></td>
                        </tr>
                        <tr>
                            <td><strong>Тип:</strong></td>
                            <td>${route.is_flexible ? '<span class="badge bg-info">Гибкий</span>' : '<span class="badge bg-secondary">Фиксированный</span>'}</td>
                        </tr>
                        <tr>
                            <td><strong>Обратный билет:</strong></td>
                            <td>${route.has_return ? 'Да' : 'Нет'}</td>
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
                        ${this.renderRouteDates(route)}
                        <tr>
                            <td><strong>Пассажиры:</strong></td>
                            <td>${route.adults} взр.${route.children > 0 ? `, ${route.children} дет.` : ''}</td>
                        </tr>
                        <tr>
                            <td><strong>Авиакомпания:</strong></td>
                            <td>${route.airline === 'any' ? 'Любая' : route.airline}</td>
                        </tr>
                        <tr>
                            <td><strong>Багаж:</strong></td>
                            <td>${route.baggage ? '20 кг' : 'Только ручная кладь'}</td>
                        </tr>
                        <tr>
                            <td><strong>Макс. пересадок:</strong></td>
                            <td>${route.max_stops === 99 ? 'Любое' : route.max_stops}</td>
                        </tr>
                        <tr>
                            <td><strong>Порог цены:</strong></td>
                            <td><strong>${formatPrice(route.threshold_price, route.currency)}</strong></td>
                        </tr>
                    </table>
                </div>
            </div>
            
            <div class="mt-4">
                <h6>Лучшие предложения</h6>
                <div id="route-tickets">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
            </div>

            <div class="mt-3">
                <small class="text-muted">
                    Создан: ${new Date(route.created_at).toLocaleString('ru-RU')}<br>
                    Последняя проверка: ${route.last_check ? new Date(route.last_check).toLocaleString('ru-RU') : 'Не проверялся'}
                </small>
            </div>
        `;
    }

    renderRouteDates(route) {
        console.log(route);
        if (route.is_flexible) {
            return `
                <tr>
                    <td><strong>Диапазон вылета:</strong></td>
                    <td>${route.departure_start} - ${route.departure_end}</td>
                </tr>
                <tr>
                    <td><strong>Дни в стране:</strong></td>
                    <td>${route.min_days} - ${route.max_days} дней</td>
                </tr>
            `;
        } else {
            return `
                <tr>
                    <td><strong>Дата вылета:</strong></td>
                    <td>${route.departure_date}</td>
                </tr>
                ${route.has_return ? `
                    <tr>
                        <td><strong>Дата возврата:</strong></td>
                        <td>${route.return_date}</td>
                    </tr>
                ` : ''}
            `;
        }
    }

    renderBestTickets(tickets) {
        if (tickets.length === 0) {
            return '<p class="text-muted">Нет найденных предложений</p>';
        }

        return `
            <div class="list-group">
                ${tickets.slice(0, 5).map(ticket => `
                    <div class="list-group-item">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="mb-1">${formatPrice(ticket.total_price, ticket.currency || 'RUB')}</h6>
                                <small class="text-muted">
                                    ${ticket.departure_date}${ticket.return_date ? ' - ' + ticket.return_date : ''}<br>
                                    ${ticket.airline || 'N/A'}
                                    ${ticket.days_in_country ? `• ${ticket.days_in_country} дней` : ''}
                                </small>
                            </div>
                            ${ticket.search_link ? `
                                <a href="${ticket.search_link}" target="_blank" class="btn btn-sm btn-primary">
                                    Открыть <i class="bi bi-box-arrow-up-right"></i>
                                </a>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    async getRouteTickets(routeId) {
        try {
            // This needs to be added to server.js
            const response = await api.get(`/routes/${routeId}/tickets`);
            return response;
        } catch (error) {
            console.error('Error loading tickets:', error);
            return [];
        }
    }

    async createRoute() {
        const formData = await Modal.form({
            title: 'Создать новый маршрут',
            size: 'lg',
            fields: [
                {
                    name: 'chat_id',
                    label: 'Chat ID пользователя',
                    type: 'number',
                    required: true,
                    placeholder: 'Введите Telegram Chat ID'
                },
                {
                    name: 'origin',
                    label: 'Откуда (код IATA)',
                    type: 'text',
                    required: true,
                    placeholder: 'Например: SVX'
                },
                {
                    name: 'destination',
                    label: 'Куда (код IATA)',
                    type: 'text',
                    required: true,
                    placeholder: 'Например: DXB'
                },
                {
                    name: 'is_flexible',
                    label: 'Тип маршрута',
                    type: 'select',
                    required: true,
                    options: [
                        { value: '0', label: 'Фиксированный' },
                        { value: '1', label: 'Гибкий' }
                    ]
                },
                {
                    name: 'has_return',
                    label: 'Обратный билет',
                    type: 'select',
                    required: true,
                    options: [
                        { value: '1', label: 'Туда-обратно' },
                        { value: '0', label: 'В одну сторону' }
                    ]
                },
                {
                    name: 'departure_date',
                    label: 'Дата вылета (для фиксированного)',
                    type: 'date',
                    help: 'Заполните для фиксированного маршрута'
                },
                {
                    name: 'return_date',
                    label: 'Дата возврата (для фиксированного)',
                    type: 'date',
                    help: 'Заполните если есть обратный билет'
                },
                {
                    name: 'threshold_price',
                    label: 'Пороговая цена',
                    type: 'number',
                    required: true,
                    value: 50000,
                    min: 0
                },
                {
                    name: 'currency',
                    label: 'Валюта',
                    type: 'select',
                    value: 'RUB',
                    options: CONFIG.CURRENCIES.map(c => ({ value: c, label: c }))
                },
                {
                    name: 'adults',
                    label: 'Взрослые',
                    type: 'number',
                    value: 1,
                    min: 1,
                    max: 9,
                    required: true
                },
                {
                    name: 'airline',
                    label: 'Авиакомпания',
                    type: 'select',
                    value: 'any',
                    options: CONFIG.AIRLINES.map(a => ({ value: a.code, label: a.name }))
                }
            ]
        });

        if (!formData) return;

        try {
            const routeData = {
                chat_id: parseInt(formData.chat_id),
                origin: formData.origin.toUpperCase(),
                destination: formData.destination.toUpperCase(),
                is_flexible: parseInt(formData.is_flexible),
                has_return: parseInt(formData.has_return),
                departure_date: formData.departure_date || null,
                return_date: formData.return_date || null,
                threshold_price: parseFloat(formData.threshold_price),
                currency: formData.currency,
                adults: parseInt(formData.adults),
                children: 0,
                airline: formData.airline,
                baggage: 1,
                max_stops: 99,
                max_layover_hours: null,
                is_paused: 0
            };

            await api.createRoute(routeData);
            showToast('Маршрут успешно создан', 'success');
            await this.loadRoutes();
        } catch (error) {
            console.error('Error creating route:', error);
            showToast('Ошибка создания маршрута: ' + error.message, 'danger');
        }
    }

    async editRoute(route) {
        const formData = await Modal.form({
            title: `Редактировать маршрут #${route.id}`,
            size: 'md',
            fields: [
                {
                    name: 'threshold_price',
                    label: 'Пороговая цена',
                    type: 'number',
                    value: route.threshold_price,
                    required: true,
                    min: 0
                },
                {
                    name: 'is_paused',
                    label: 'Статус',
                    type: 'select',
                    value: route.is_paused.toString(),
                    options: [
                        { value: '0', label: 'Активен' },
                        { value: '1', label: 'На паузе' }
                    ]
                },
                {
                    name: 'adults',
                    label: 'Взрослые',
                    type: 'number',
                    value: route.adults,
                    min: 1,
                    max: 9
                },
                {
                    name: 'children',
                    label: 'Дети',
                    type: 'number',
                    value: route.children,
                    min: 0,
                    max: 9
                },
                {
                    name: 'airline',
                    label: 'Авиакомпания',
                    type: 'select',
                    value: route.airline,
                    options: CONFIG.AIRLINES.map(a => ({ value: a.code, label: a.name }))
                },
                {
                    name: 'baggage',
                    label: 'Багаж',
                    type: 'select',
                    value: route.baggage.toString(),
                    options: [
                        { value: '0', label: 'Только ручная кладь' },
                        { value: '1', label: '20 кг багаж' }
                    ]
                },
                {
                    name: 'max_stops',
                    label: 'Макс. пересадок',
                    type: 'select',
                    value: route.max_stops.toString(),
                    options: [
                        { value: '0', label: 'Без пересадок' },
                        { value: '1', label: '1 пересадка' },
                        { value: '2', label: '2 пересадки' },
                        { value: '99', label: 'Любое количество' }
                    ]
                }
            ]
        });

        if (!formData) return;

        try {
            const updateData = {
                threshold_price: parseFloat(formData.threshold_price),
                is_paused: parseInt(formData.is_paused),
                adults: parseInt(formData.adults),
                children: parseInt(formData.children),
                airline: formData.airline,
                baggage: parseInt(formData.baggage),
                max_stops: parseInt(formData.max_stops)
            };

            await api.updateRoute(route.id, updateData);
            showToast('Маршрут успешно обновлен', 'success');
            await this.loadRoutes();
        } catch (error) {
            console.error('Error updating route:', error);
            showToast('Ошибка обновления маршрута: ' + error.message, 'danger');
        }
    }

    async togglePauseRoute(route) {
        try {
            const newStatus = !route.is_paused;
            await api.pauseRoute(route.id, newStatus);
            showToast(
                newStatus ? 'Маршрут приостановлен' : 'Маршрут возобновлен',
                'success'
            );
            await this.loadRoutes();
        } catch (error) {
            console.error('Error toggling route:', error);
            showToast('Ошибка изменения статуса: ' + error.message, 'danger');
        }
    }

    async deleteRoute(route) {
        const confirmed = await showConfirm(
            `Вы уверены, что хотите удалить маршрут ${route.origin} → ${route.destination}?\n\nЭто действие удалит все результаты проверок!`,
            null,
            'Удаление маршрута'
        );

        if (!confirmed) return;

        try {
            await api.deleteRoute(route.id);
            showToast('Маршрут успешно удален', 'success');
            await this.loadRoutes();
        } catch (error) {
            console.error('Error deleting route:', error);
            showToast('Ошибка удаления маршрута: ' + error.message, 'danger');
        }
    }

    destroy() {
        this.table = null;
    }
}

export default RoutesPage;
