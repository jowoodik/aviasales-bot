// web/public/js/pages/routes.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatPrice, formatNumber } from '../utils/helpers.js';
import airportService from '../services/airportService.js';

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
                route: `${route.origin} → ${route.destination}`,
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

    formatRouteTitle(route) {
        if (route.origin_city) {
            return `${route.origin_city} (${route.origin}) → ${route.destination_city} (${route.destination})`;
        }
        return airportService.formatRoute(route.origin, route.destination);
    }

    async viewRoute(route) {
        const routeTitle = this.formatRouteTitle(route);

        const modal = new Modal({
            title: routeTitle,
            size: 'xl',
            body: this.renderTabbedContent(route),
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

        // Load info tab content immediately
        this.loadInfoTab(route, modal.getBody());

        // Setup tab click handlers for lazy loading
        this.setupTabHandlers(route, modal.getBody());

        // Event handlers for footer buttons
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

    renderTabbedContent(route) {
        return `
            <ul class="nav nav-tabs" id="routeTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active text-dark" id="info-tab" data-bs-toggle="tab" data-bs-target="#info-pane" type="button" role="tab">
                        <i class="bi bi-info-circle"></i> Информация
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="user-tab" data-bs-toggle="tab" data-bs-target="#user-pane" type="button" role="tab">
                        <i class="bi bi-person"></i> Пользователь
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="checks-tab" data-bs-toggle="tab" data-bs-target="#checks-pane" type="button" role="tab">
                        <i class="bi bi-check-circle"></i> Проверки
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="notifications-tab" data-bs-toggle="tab" data-bs-target="#notifications-pane" type="button" role="tab">
                        <i class="bi bi-bell"></i> Уведомления
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="prices-tab" data-bs-toggle="tab" data-bs-target="#prices-pane" type="button" role="tab">
                        <i class="bi bi-graph-up"></i> Цены
                    </button>
                </li>
            </ul>
            <div class="tab-content pt-3" id="routeTabContent">
                <div class="tab-pane fade show active" id="info-pane" role="tabpanel">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="user-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="checks-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="notifications-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="prices-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
            </div>
        `;
    }

    setupTabHandlers(route, container) {
        const tabs = container.querySelectorAll('[data-bs-toggle="tab"]');
        tabs.forEach(tab => {
            tab.addEventListener('shown.bs.tab', async (e) => {
                const targetId = e.target.getAttribute('data-bs-target');
                const pane = container.querySelector(targetId);

                if (pane && pane.dataset.loaded === 'false') {
                    pane.dataset.loaded = 'true';

                    switch (targetId) {
                        case '#user-pane':
                            await this.loadUserTab(route, pane);
                            break;
                        case '#checks-pane':
                            await this.loadChecksTab(route, pane);
                            break;
                        case '#notifications-pane':
                            await this.loadNotificationsTab(route, pane);
                            break;
                        case '#prices-pane':
                            await this.loadPricesTab(route, pane);
                            break;
                    }
                }
            });
        });
    }

    async loadInfoTab(route, container) {
        const infoPane = container.querySelector('#info-pane');
        const routeDisplay = this.formatRouteTitle(route);

        infoPane.innerHTML = `
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
                            <td><strong>${routeDisplay}</strong></td>
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

        // Load best tickets
        try {
            const tickets = await this.getRouteTickets(route.id);
            const ticketsSection = infoPane.querySelector('#route-tickets');
            if (ticketsSection) {
                ticketsSection.innerHTML = tickets.length > 0
                    ? this.renderBestTickets(tickets)
                    : '<p class="text-muted">Нет найденных предложений</p>';
            }
        } catch (error) {
            console.error('Error loading tickets:', error);
        }
    }

    async loadUserTab(route, pane) {
        try {
            const userStats = await api.getUserStats(route.chat_id);

            pane.innerHTML = `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6>Информация о пользователе</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${route.chat_id}</code></td>
                            </tr>
                            <tr>
                                <td><strong>Подписка:</strong></td>
                                <td><span class="badge bg-${userStats.subscription_type === 'free' ? 'secondary' : 'success'}">${userStats.subscription_type || 'free'}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Таймзона:</strong></td>
                                <td>${userStats.timezone || 'Europe/Moscow'}</td>
                            </tr>
                            <tr>
                                <td><strong>Уведомления:</strong></td>
                                <td>${userStats.notifications_enabled !== false ? '<span class="badge bg-success">Вкл</span>' : '<span class="badge bg-secondary">Выкл</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Ночной режим:</strong></td>
                                <td>${userStats.night_mode ? '<span class="badge bg-success">Вкл</span>' : '<span class="badge bg-secondary">Выкл</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Дайджест:</strong></td>
                                <td>${userStats.digest_enabled ? '<span class="badge bg-success">Вкл</span>' : '<span class="badge bg-secondary">Выкл</span>'}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Статистика пользователя</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Всего маршрутов:</strong></td>
                                <td>${userStats.total_routes || 0}</td>
                            </tr>
                            <tr>
                                <td><strong>Активных:</strong></td>
                                <td>${userStats.active_routes || 0}</td>
                            </tr>
                            <tr>
                                <td><strong>Гибких:</strong></td>
                                <td>${userStats.flexible_routes || 0}</td>
                            </tr>
                            <tr>
                                <td><strong>Получено уведомлений:</strong></td>
                                <td>${userStats.notifications_received || 0}</td>
                            </tr>
                            <tr>
                                <td><strong>Зарегистрирован:</strong></td>
                                <td>${userStats.created_at ? new Date(userStats.created_at).toLocaleDateString('ru-RU') : 'N/A'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading user stats:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки данных пользователя: ${error.message}</div>`;
        }
    }

    async loadChecksTab(route, pane) {
        try {
            const data = await api.getRouteCheckStats(route.id);
            const { summary, recent } = data;

            const successRate = summary.avg_success_rate ? summary.avg_success_rate.toFixed(1) : '0';

            pane.innerHTML = `
                <div class="row g-3 mb-4">
                    <div class="col-md-3">
                        <div class="card border-primary">
                            <div class="card-body text-center">
                                <h3 class="text-primary">${summary.total_checks || 0}</h3>
                                <small class="text-muted">Всего проверок</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-success">
                            <div class="card-body text-center">
                                <h3 class="text-success">${summary.total_success || 0}</h3>
                                <small class="text-muted">Успешных</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-danger">
                            <div class="card-body text-center">
                                <h3 class="text-danger">${summary.total_failed || 0}</h3>
                                <small class="text-muted">Неудачных</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-info">
                            <div class="card-body text-center">
                                <h3 class="text-info">${successRate}%</h3>
                                <small class="text-muted">Success Rate</small>
                            </div>
                        </div>
                    </div>
                </div>

                <h6>Последние проверки</h6>
                ${recent.length > 0 ? `
                    <div class="table-responsive">
                        <table class="table table-sm table-hover">
                            <thead>
                                <tr>
                                    <th>Время</th>
                                    <th>Комбинаций</th>
                                    <th>Успешных</th>
                                    <th>Неудачных</th>
                                    <th>Успешность</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${recent.map(check => {
                                    const rate = check.total_combinations > 0
                                        ? ((check.successful_checks / check.total_combinations) * 100).toFixed(0)
                                        : 0;
                                    return `
                                        <tr>
                                            <td>${new Date(check.check_timestamp).toLocaleString('ru-RU')}</td>
                                            <td>${check.total_combinations}</td>
                                            <td><span class="text-success">${check.successful_checks}</span></td>
                                            <td><span class="text-danger">${check.failed_checks}</span></td>
                                            <td><span class="badge bg-${rate >= 80 ? 'success' : rate >= 50 ? 'warning' : 'danger'}">${rate}%</span></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted">Нет данных о проверках</p>'}

                ${summary.last_check_time ? `
                    <small class="text-muted">Последняя проверка: ${new Date(summary.last_check_time).toLocaleString('ru-RU')}</small>
                ` : ''}
            `;
        } catch (error) {
            console.error('Error loading check stats:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки статистики проверок: ${error.message}</div>`;
        }
    }

    async loadNotificationsTab(route, pane) {
        try {
            const notifications = await api.getRouteNotifications(route.id);

            if (notifications.length === 0) {
                pane.innerHTML = '<p class="text-muted">Уведомления по этому маршруту не отправлялись</p>';
                return;
            }

            const priorityColors = {
                'CRITICAL': 'danger', 'HIGH': 'warning', 'MEDIUM': 'info', 'LOW': 'secondary'
            };
            const typeLabels = {
                'instant': 'Мгновенное', 'digest': 'Дайджест', 'report': 'Отчёт'
            };

            pane.innerHTML = `
                <div class="table-responsive">
                    <table class="table table-sm table-hover">
                        <thead>
                            <tr>
                                <th>Время</th>
                                <th>Тип</th>
                                <th>Приоритет</th>
                                <th>Цена</th>
                                <th>Тихое</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${notifications.map(n => `
                                <tr>
                                    <td>${new Date(n.sent_at).toLocaleString('ru-RU')}</td>
                                    <td><span class="badge bg-primary">${typeLabels[n.message_type] || n.message_type}</span></td>
                                    <td><span class="badge bg-${priorityColors[n.priority] || 'secondary'}">${n.priority}</span></td>
                                    <td>${n.price ? formatPrice(n.price, 'RUB') : '-'}</td>
                                    <td>${n.disable_notification ? '<i class="bi bi-volume-mute text-muted"></i>' : '<i class="bi bi-volume-up text-success"></i>'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <small class="text-muted">Показаны последние ${notifications.length} уведомлений</small>
            `;
        } catch (error) {
            console.error('Error loading notifications:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки уведомлений: ${error.message}</div>`;
        }
    }

    async loadPricesTab(route, pane) {
        try {
            const data = await api.getRoutePriceHistory(route.id);
            const { summary, trend } = data;

            if (!summary || summary.data_points === 0) {
                pane.innerHTML = '<p class="text-muted">Нет данных о ценах для этого маршрута</p>';
                return;
            }

            pane.innerHTML = `
                <div class="row g-3 mb-4">
                    <div class="col-md-3">
                        <div class="card border-success">
                            <div class="card-body text-center">
                                <h3 class="text-success">${formatNumber(Math.round(summary.min_price))} ₽</h3>
                                <small class="text-muted">Минимум</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-primary">
                            <div class="card-body text-center">
                                <h3 class="text-primary">${formatNumber(Math.round(summary.avg_price))} ₽</h3>
                                <small class="text-muted">Средняя</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-danger">
                            <div class="card-body text-center">
                                <h3 class="text-danger">${formatNumber(Math.round(summary.max_price))} ₽</h3>
                                <small class="text-muted">Максимум</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card">
                            <div class="card-body text-center">
                                <h3>${summary.data_points}</h3>
                                <small class="text-muted">Точек данных</small>
                            </div>
                        </div>
                    </div>
                </div>

                <h6>Тренд цен за 30 дней</h6>
                ${trend.length > 0 ? `
                    <div class="table-responsive">
                        <table class="table table-sm table-hover">
                            <thead>
                                <tr>
                                    <th>Дата</th>
                                    <th>Мин. цена</th>
                                    <th>Средняя</th>
                                    <th>Проверок</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${trend.map(day => `
                                    <tr>
                                        <td>${new Date(day.date).toLocaleDateString('ru-RU')}</td>
                                        <td class="text-success">${formatNumber(Math.round(day.min_price))} ₽</td>
                                        <td>${formatNumber(Math.round(day.avg_price))} ₽</td>
                                        <td>${day.count}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted">Нет данных о трендах</p>'}
            `;
        } catch (error) {
            console.error('Error loading price history:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки истории цен: ${error.message}</div>`;
        }
    }

    renderRouteDates(route) {
        if (route.is_flexible) {
            const minDays = route.min_days != null ? route.min_days : 'N/A';
            const maxDays = route.max_days != null ? route.max_days : 'N/A';
            return `
                <tr>
                    <td><strong>Диапазон вылета:</strong></td>
                    <td>${route.departure_start || 'N/A'} - ${route.departure_end || 'N/A'}</td>
                </tr>
                <tr>
                    <td><strong>Дни в стране:</strong></td>
                    <td>${minDays} - ${maxDays} дней</td>
                </tr>
            `;
        } else {
            return `
                <tr>
                    <td><strong>Дата вылета:</strong></td>
                    <td>${route.departure_date || 'N/A'}</td>
                </tr>
                ${route.has_return ? `
                    <tr>
                        <td><strong>Дата возврата:</strong></td>
                        <td>${route.return_date || 'N/A'}</td>
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
        const routeDisplay = this.formatRouteTitle(route);
        const confirmed = await showConfirm(
            `Вы уверены, что хотите удалить маршрут ${routeDisplay}?\n\nЭто действие удалит все результаты проверок!`,
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
