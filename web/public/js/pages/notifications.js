// web/public/js/pages/notifications.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, formatDateTime, formatPrice, escapeHtml } from '../utils/helpers.js';

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
        const priorityColors = {
            'CRITICAL': 'danger', 'HIGH': 'warning', 'MEDIUM': 'info', 'LOW': 'secondary'
        };
        const typeLabels = {
            'instant': 'Мгновенное', 'digest': 'Дайджест', 'report': 'Отчёт'
        };

        const modal = new Modal({
            title: `Уведомление #${n.id}`,
            size: 'lg',
            body: `
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
            `,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
            `
        });

        modal.create();
        modal.show();
    }

    destroy() {
        this.table = null;
    }
}

export default NotificationsPage;
