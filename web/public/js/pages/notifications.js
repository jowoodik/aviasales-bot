// web/public/js/pages/notifications.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, formatDateTime, formatPrice, formatNumber, escapeHtml } from '../utils/helpers.js';
import airportService from '../services/airportService.js';

class NotificationsPage {
    constructor() {
        this.table = null;
        this.notifications = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>Лог уведомлений</h2>
                        <p class="text-muted">История отправленных уведомлений пользователям</p>
                    </div>
                </div>

                <div id="notifications-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadNotifications();
    }

    async loadNotifications() {
        const container = document.getElementById('notifications-table');
        showLoading(container);

        try {
            this.notifications = await api.getNotifications();
            this.renderTable();
        } catch (error) {
            console.error('Error loading notifications:', error);
            showError(container, error);
        }
    }

    renderTable() {
        this.table = new Table({
            containerId: 'notifications-table',
            title: 'Список уведомлений',
            columns: CONFIG.TABLES.NOTIFICATIONS.columns,
            data: this.notifications,
            actions: CONFIG.TABLES.NOTIFICATIONS.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadNotifications(),
            emptyMessage: 'Нет отправленных уведомлений'
        });

        this.table.render();
    }

    async handleAction(action, id) {
        const notification = this.notifications.find(n => n.id == id);
        if (!notification) return;

        if (action === 'view') {
            this.viewNotification(notification);
        }
    }

    viewNotification(n) {
        const modal = new Modal({
            title: `Уведомление #${n.id}`,
            size: 'xl',
            body: this.renderTabbedContent(n),
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
            `
        });

        modal.create();
        modal.show();

        // Load info tab immediately
        this.loadInfoTab(n, modal.getBody());

        // Setup lazy loading for other tabs
        this.setupTabHandlers(n, modal.getBody());
    }

    renderTabbedContent(n) {
        return `
            <ul class="nav nav-tabs" id="notifTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active text-dark" id="info-tab" data-bs-toggle="tab" data-bs-target="#info-pane" type="button" role="tab">
                        <i class="bi bi-info-circle"></i> Информация
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="route-tab" data-bs-toggle="tab" data-bs-target="#route-pane" type="button" role="tab" ${!n.route_id ? 'disabled' : ''}>
                        <i class="bi bi-signpost-2"></i> Маршрут
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="user-tab" data-bs-toggle="tab" data-bs-target="#user-pane" type="button" role="tab">
                        <i class="bi bi-person"></i> Пользователь
                    </button>
                </li>
            </ul>
            <div class="tab-content pt-3" id="notifTabContent">
                <div class="tab-pane fade show active" id="info-pane" role="tabpanel">
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
                <div class="tab-pane fade" id="user-pane" role="tabpanel" data-loaded="false">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
            </div>
        `;
    }

    setupTabHandlers(n, container) {
        const tabs = container.querySelectorAll('[data-bs-toggle="tab"]');
        tabs.forEach(tab => {
            tab.addEventListener('shown.bs.tab', async (e) => {
                const targetId = e.target.getAttribute('data-bs-target');
                const pane = container.querySelector(targetId);

                if (pane && pane.dataset.loaded === 'false') {
                    pane.dataset.loaded = 'true';

                    switch (targetId) {
                        case '#route-pane':
                            await this.loadRouteTab(n, pane);
                            break;
                        case '#user-pane':
                            await this.loadUserTab(n, pane);
                            break;
                    }
                }
            });
        });
    }

    loadInfoTab(n, container) {
        const infoPane = container.querySelector('#info-pane');

        const priorityColors = {
            'CRITICAL': 'danger', 'HIGH': 'warning', 'MEDIUM': 'info', 'LOW': 'secondary'
        };
        const typeLabels = {
            'instant': 'Мгновенное', 'digest': 'Дайджест', 'report': 'Отчёт'
        };

        infoPane.innerHTML = `
            <div class="row g-3">
                <div class="col-md-6">
                    <h6>Информация</h6>
                    <table class="table table-sm">
                        <tr>
                            <td><strong>ID:</strong></td>
                            <td>${n.id}</td>
                        </tr>
                        <tr>
                            <td><strong>Chat ID:</strong></td>
                            <td><code>${n.chat_id}</code></td>
                        </tr>
                        <tr>
                            <td><strong>Маршрут:</strong></td>
                            <td>${escapeHtml(n.routename || '—')}</td>
                        </tr>
                        <tr>
                            <td><strong>Route ID:</strong></td>
                            <td>${n.route_id || '—'}</td>
                        </tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>Детали</h6>
                    <table class="table table-sm">
                        <tr>
                            <td><strong>Приоритет:</strong></td>
                            <td><span class="badge bg-${priorityColors[n.priority] || 'secondary'}">${n.priority || '—'}</span></td>
                        </tr>
                        <tr>
                            <td><strong>Цена:</strong></td>
                            <td>${n.price ? formatPrice(n.price) : '—'}</td>
                        </tr>
                        <tr>
                            <td><strong>Тип:</strong></td>
                            <td>${typeLabels[n.message_type] || n.message_type || '—'}</td>
                        </tr>
                        <tr>
                            <td><strong>Тихое уведомление:</strong></td>
                            <td>${n.disable_notification ? '<span class="badge bg-success">Да</span>' : '<span class="badge bg-secondary">Нет</span>'}</td>
                        </tr>
                        <tr>
                            <td><strong>Отправлено:</strong></td>
                            <td>${n.sent_at ? formatDateTime(n.sent_at) : '—'}</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
    }

    async loadRouteTab(n, pane) {
        if (!n.route_id) {
            pane.innerHTML = '<p class="text-muted">Маршрут не привязан к уведомлению</p>';
            return;
        }

        try {
            const route = await api.getRouteById(n.route_id);

            const routeLabel = route.origin_city && route.destination_city
                ? `${route.origin_city} (${route.origin}) → ${route.destination_city} (${route.destination})`
                : airportService.formatRoute(route.origin, route.destination);

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

    async loadUserTab(n, pane) {
        try {
            const userStats = await api.getUserStats(n.chat_id);

            pane.innerHTML = `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6>Информация о пользователе</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${n.chat_id}</code></td>
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
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Статистика</h6>
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

    destroy() {
        this.table = null;
    }
}

export default NotificationsPage;
