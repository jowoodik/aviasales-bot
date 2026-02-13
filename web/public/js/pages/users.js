// web/public/js/pages/users.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatPrice, formatNumber, formatDateTime } from '../utils/helpers.js';
import airportService from '../services/airportService.js';

class UsersPage {
    constructor() {
        this.table = null;
        this.users = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>👥 Управление пользователями</h2>
                        <p class="text-muted">Просмотр и редактирование пользователей системы</p>
                    </div>
                </div>

                <div id="users-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadUsers();
    }

    async loadUsers() {
        const container = document.getElementById('users-table');
        showLoading(container);

        try {
            this.users = await api.getUsers();
            this.renderTable();
        } catch (error) {
            console.error('Error loading users:', error);
            showError(container, error);
        }
    }

    renderTable() {
        this.table = new Table({
            containerId: 'users-table',
            title: 'Список пользователей',
            columns: CONFIG.TABLES.USERS.columns,
            data: this.users,
            actions: CONFIG.TABLES.USERS.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadUsers()
        });

        this.table.render();
    }

    async handleAction(action, chatId) {
        const user = this.users.find(u => u.chat_id == chatId);
        if (!user) return;

        switch (action) {
            case 'view':
                await this.viewUser(user);
                break;
            case 'edit':
                await this.editUser(user);
                break;
            case 'delete':
                await this.deleteUser(user);
                break;
        }
    }

    async viewUser(user) {
        const modal = new Modal({
            title: `Пользователь: ${user.chat_id}`,
            size: 'xl',
            body: this.renderTabbedContent(user),
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-primary" id="edit-user-btn">
                    <i class="bi bi-pencil"></i> Редактировать
                </button>
            `
        });

        modal.create();
        modal.show();

        // Load info tab immediately
        this.loadInfoTab(user, modal.getBody());

        // Setup lazy loading for other tabs
        this.setupTabHandlers(user, modal.getBody());

        const editBtn = modal.getElement().querySelector('#edit-user-btn');
        editBtn.addEventListener('click', () => {
            modal.hide();
            this.editUser(user);
        });
    }

    renderTabbedContent(user) {
        return `
            <ul class="nav nav-tabs" id="userTabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active text-dark" id="info-tab" data-bs-toggle="tab" data-bs-target="#info-pane" type="button" role="tab">
                        <i class="bi bi-info-circle"></i> Информация
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link text-dark" id="routes-tab" data-bs-toggle="tab" data-bs-target="#routes-pane" type="button" role="tab">
                        <i class="bi bi-signpost-2"></i> Маршруты
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
            <div class="tab-content pt-3" id="userTabContent">
                <div class="tab-pane fade show active" id="info-pane" role="tabpanel">
                    <div class="text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка...</span>
                    </div>
                </div>
                <div class="tab-pane fade" id="routes-pane" role="tabpanel" data-loaded="false">
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

    setupTabHandlers(user, container) {
        const tabs = container.querySelectorAll('[data-bs-toggle="tab"]');
        tabs.forEach(tab => {
            tab.addEventListener('shown.bs.tab', async (e) => {
                const targetId = e.target.getAttribute('data-bs-target');
                const pane = container.querySelector(targetId);

                if (pane && pane.dataset.loaded === 'false') {
                    pane.dataset.loaded = 'true';

                    switch (targetId) {
                        case '#routes-pane':
                            await this.loadRoutesTab(user, pane);
                            break;
                        case '#checks-pane':
                            await this.loadChecksTab(user, pane);
                            break;
                        case '#notifications-pane':
                            await this.loadNotificationsTab(user, pane);
                            break;
                        case '#prices-pane':
                            await this.loadPricesTab(user, pane);
                            break;
                    }
                }
            });
        });
    }

    async loadInfoTab(user, container) {
        const infoPane = container.querySelector('#info-pane');

        try {
            const stats = await api.getUserStats(user.chat_id);

            infoPane.innerHTML = `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6>Основная информация</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${user.chat_id}</code></td>
                            </tr>
                            <tr>
                                <td><strong>Подписка:</strong></td>
                                <td><span class="badge bg-${stats.subscription_type === 'free' ? 'secondary' : 'success'}">${stats.subscription_type || 'free'}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Таймзона:</strong></td>
                                <td>${stats.timezone || 'Europe/Moscow'}</td>
                            </tr>
                            <tr>
                                <td><strong>Уведомления:</strong></td>
                                <td>${stats.notifications_enabled !== false ? '<span class="badge bg-success">Вкл</span>' : '<span class="badge bg-secondary">Выкл</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Ночной режим:</strong></td>
                                <td>${stats.night_mode ? '<span class="badge bg-success">Вкл</span>' : '<span class="badge bg-secondary">Выкл</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Создан:</strong></td>
                                <td>${stats.created_at ? new Date(stats.created_at).toLocaleString('ru-RU') : new Date(user.created_at).toLocaleString('ru-RU')}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Статистика</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Всего маршрутов:</strong></td>
                                <td><span class="badge bg-primary">${stats.total_routes || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Активных:</strong></td>
                                <td><span class="badge bg-success">${stats.active_routes || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Гибких:</strong></td>
                                <td><span class="badge bg-info">${stats.flexible_routes || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Получено уведомлений:</strong></td>
                                <td><span class="badge bg-warning">${stats.notifications_received || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Последняя активность:</strong></td>
                                <td>${user.lastactivity ? new Date(user.lastactivity).toLocaleString('ru-RU') : 'Нет'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading user info:', error);
            infoPane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки: ${error.message}</div>`;
        }
    }

    async loadRoutesTab(user, pane) {
        try {
            const routes = await api.getUserRoutes(user.chat_id);

            if (routes.length === 0) {
                pane.innerHTML = '<p class="text-muted">У пользователя нет маршрутов</p>';
                return;
            }

            pane.innerHTML = `
                <div class="table-responsive">
                    <table class="table table-sm table-hover">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Маршрут</th>
                                <th>Даты</th>
                                <th>Статус</th>
                                <th>Порог цены</th>
                                <th>Проверок</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${routes.map(r => {
                                const routeLabel = r.origin_city && r.destination_city
                                    ? `${r.origin_city} (${r.origin}) → ${r.destination_city} (${r.destination})`
                                    : airportService.formatRoute(r.origin, r.destination);
                                const dates = r.is_flexible
                                    ? `${r.departure_start || '?'} — ${r.departure_end || '?'}`
                                    : `${r.departure_date || '?'}${r.return_date ? ' — ' + r.return_date : ''}`;
                                return `
                                    <tr>
                                        <td>${r.id}</td>
                                        <td><strong>${routeLabel}</strong></td>
                                        <td><small>${dates}</small></td>
                                        <td>${r.is_paused ? '<span class="badge bg-secondary">Пауза</span>' : '<span class="badge bg-success">Активен</span>'}</td>
                                        <td>${formatPrice(r.threshold_price, r.currency)}</td>
                                        <td>${r.check_count || 0}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <small class="text-muted">Всего маршрутов: ${routes.length}</small>
            `;
        } catch (error) {
            console.error('Error loading user routes:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки маршрутов: ${error.message}</div>`;
        }
    }

    async loadChecksTab(user, pane) {
        try {
            const routes = await api.getUserRoutes(user.chat_id);

            if (routes.length === 0) {
                pane.innerHTML = '<p class="text-muted">Нет маршрутов для проверки</p>';
                return;
            }

            let totalChecks = 0;
            let totalSuccess = 0;
            let totalFailed = 0;
            const routeStats = [];

            for (const route of routes) {
                try {
                    const data = await api.getRouteCheckStats(route.id);
                    const s = data.summary || {};
                    totalChecks += s.total_checks || 0;
                    totalSuccess += s.total_success || 0;
                    totalFailed += s.total_failed || 0;
                    routeStats.push({
                        route,
                        summary: s
                    });
                } catch (e) {
                    // skip failed routes
                }
            }

            const successRate = totalChecks > 0 ? ((totalSuccess / totalChecks) * 100).toFixed(1) : '0';

            pane.innerHTML = `
                <div class="row g-3 mb-4">
                    <div class="col-md-3">
                        <div class="card border-primary">
                            <div class="card-body text-center">
                                <h3 class="text-primary">${totalChecks}</h3>
                                <small class="text-muted">Всего проверок</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-success">
                            <div class="card-body text-center">
                                <h3 class="text-success">${totalSuccess}</h3>
                                <small class="text-muted">Успешных</small>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="card border-danger">
                            <div class="card-body text-center">
                                <h3 class="text-danger">${totalFailed}</h3>
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

                <h6>По маршрутам</h6>
                ${routeStats.length > 0 ? `
                    <div class="table-responsive">
                        <table class="table table-sm table-hover">
                            <thead>
                                <tr>
                                    <th>Маршрут</th>
                                    <th>Проверок</th>
                                    <th>Успешных</th>
                                    <th>Неудачных</th>
                                    <th>Последняя</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${routeStats.map(({ route, summary }) => {
                                    const label = route.origin_city
                                        ? `${route.origin_city} → ${route.destination_city}`
                                        : `${route.origin} → ${route.destination}`;
                                    return `
                                        <tr>
                                            <td><strong>${label}</strong></td>
                                            <td>${summary.total_checks || 0}</td>
                                            <td><span class="text-success">${summary.total_success || 0}</span></td>
                                            <td><span class="text-danger">${summary.total_failed || 0}</span></td>
                                            <td>${summary.last_check_time ? new Date(summary.last_check_time).toLocaleString('ru-RU') : '—'}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted">Нет данных о проверках</p>'}
            `;
        } catch (error) {
            console.error('Error loading checks:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки проверок: ${error.message}</div>`;
        }
    }

    async loadNotificationsTab(user, pane) {
        try {
            const notifications = await api.getUserNotifications(user.chat_id);

            if (notifications.length === 0) {
                pane.innerHTML = '<p class="text-muted">Уведомления пользователю не отправлялись</p>';
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
                                <th>Маршрут</th>
                                <th>Тип</th>
                                <th>Приоритет</th>
                                <th>Цена</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${notifications.map(n => `
                                <tr>
                                    <td>${n.sent_at ? new Date(n.sent_at).toLocaleString('ru-RU') : '—'}</td>
                                    <td>${n.routename || '—'}</td>
                                    <td><span class="badge bg-primary">${typeLabels[n.message_type] || n.message_type || '—'}</span></td>
                                    <td><span class="badge bg-${priorityColors[n.priority] || 'secondary'}">${n.priority || '—'}</span></td>
                                    <td>${n.price ? formatPrice(n.price) : '—'}</td>
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

    async loadPricesTab(user, pane) {
        try {
            const routes = await api.getUserRoutes(user.chat_id);

            if (routes.length === 0) {
                pane.innerHTML = '<p class="text-muted">Нет маршрутов</p>';
                return;
            }

            const priceData = [];
            for (const route of routes) {
                try {
                    const data = await api.getRoutePriceHistory(route.id);
                    if (data.summary && data.summary.data_points > 0) {
                        priceData.push({
                            route,
                            summary: data.summary
                        });
                    }
                } catch (e) {
                    // skip
                }
            }

            if (priceData.length === 0) {
                pane.innerHTML = '<p class="text-muted">Нет данных о ценах</p>';
                return;
            }

            pane.innerHTML = `
                <div class="table-responsive">
                    <table class="table table-sm table-hover">
                        <thead>
                            <tr>
                                <th>Маршрут</th>
                                <th>Мин. цена</th>
                                <th>Средняя</th>
                                <th>Макс. цена</th>
                                <th>Точек данных</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${priceData.map(({ route, summary }) => {
                                const label = route.origin_city
                                    ? `${route.origin_city} → ${route.destination_city}`
                                    : `${route.origin} → ${route.destination}`;
                                return `
                                    <tr>
                                        <td><strong>${label}</strong></td>
                                        <td class="text-success">${formatNumber(Math.round(summary.min_price))} ₽</td>
                                        <td>${formatNumber(Math.round(summary.avg_price))} ₽</td>
                                        <td class="text-danger">${formatNumber(Math.round(summary.max_price))} ₽</td>
                                        <td>${summary.data_points}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (error) {
            console.error('Error loading prices:', error);
            pane.innerHTML = `<div class="alert alert-danger">Ошибка загрузки цен: ${error.message}</div>`;
        }
    }

    async editUser(user) {
        const formData = await Modal.form({
            title: `Редактировать пользователя: ${user.chat_id}`,
            size: 'md',
            fields: [
                {
                    name: 'timezone',
                    label: 'Таймзона',
                    type: 'select',
                    value: user.timezone || 'Asia/Yekaterinburg',
                    options: CONFIG.TIMEZONES.map(tz => ({ value: tz, label: tz })),
                    required: true
                },
                {
                    name: 'notifications_enabled',
                    label: 'Уведомления',
                    type: 'checkbox',
                    value: user.notifications_enabled ? true : false
                },
                {
                    name: 'night_mode',
                    label: 'Ночной режим (23:00-08:00)',
                    type: 'checkbox',
                    value: user.night_mode ? true : false
                }
            ]
        });

        if (!formData) return;

        try {
            const updateData = {
                timezone: formData.timezone,
                notifications_enabled: formData.notifications_enabled ? 1 : 0,
                night_mode: formData.night_mode ? 1 : 0
            };

            await api.updateUser(user.chat_id, updateData);
            showToast('Пользователь успешно обновлен', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('Error updating user:', error);
            showToast('Ошибка обновления пользователя: ' + error.message, 'danger');
        }
    }

    async deleteUser(user) {
        const confirmed = await showConfirm(
            `Вы уверены, что хотите удалить пользователя ${user.chat_id}?\n\nЭто действие удалит все его маршруты и результаты!`,
            null,
            'Удаление пользователя'
        );

        if (!confirmed) return;

        try {
            await api.deleteUser(user.chat_id);
            showToast('Пользователь успешно удален', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('Error deleting user:', error);
            showToast('Ошибка удаления пользователя: ' + error.message, 'danger');
        }
    }

    destroy() {
        this.table = null;
    }
}

export default UsersPage;
