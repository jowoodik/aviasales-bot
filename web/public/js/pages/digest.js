// web/public/js/pages/digest.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatDateTime, formatPrice, escapeHtml } from '../utils/helpers.js';

class DigestQueuePage {
    constructor() {
        this.table = null;
        this.queue = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>Очередь дайджеста</h2>
                        <p class="text-muted">Уведомления, ожидающие отправки в дайджесте</p>
                    </div>
                </div>

                <div id="digest-queue-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadQueue();
    }

    async loadQueue() {
        const container = document.getElementById('digest-queue-table');
        showLoading(container);

        try {
            this.queue = await api.getDigestQueue();
            this.renderTable();
        } catch (error) {
            console.error('Error loading digest queue:', error);
            showError(container, error);
        }
    }

    renderTable() {
        this.table = new Table({
            containerId: 'digest-queue-table',
            title: 'Очередь дайджеста',
            columns: CONFIG.TABLES.DIGEST_QUEUE.columns,
            data: this.queue,
            actions: CONFIG.TABLES.DIGEST_QUEUE.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadQueue(),
            emptyMessage: 'Очередь дайджеста пуста'
        });

        this.table.render();
    }

    async handleAction(action, id) {
        const item = this.queue.find(q => q.id == id);
        if (!item) return;

        switch (action) {
            case 'view':
                this.viewItem(item);
                break;
            case 'delete':
                await this.deleteItem(item);
                break;
        }
    }

    viewItem(item) {
        const priorityColors = {
            'CRITICAL': 'danger', 'HIGH': 'warning', 'MEDIUM': 'info', 'LOW': 'secondary'
        };

        const modal = new Modal({
            title: `Элемент очереди #${item.id}`,
            size: 'lg',
            body: `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6>Информация</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>ID:</strong></td>
                                <td>${item.id}</td>
                            </tr>
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${item.chat_id}</code></td>
                            </tr>
                            <tr>
                                <td><strong>Маршрут:</strong></td>
                                <td>${escapeHtml(item.routename || '—')}</td>
                            </tr>
                            <tr>
                                <td><strong>Route ID:</strong></td>
                                <td>${item.route_id || '—'}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Детали</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Приоритет:</strong></td>
                                <td><span class="badge bg-${priorityColors[item.priority] || 'secondary'}">${item.priority || '—'}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Цена:</strong></td>
                                <td>${item.price ? formatPrice(item.price) : '—'}</td>
                            </tr>
                            <tr>
                                <td><strong>Средняя цена:</strong></td>
                                <td>${item.avg_price ? formatPrice(item.avg_price) : '—'}</td>
                            </tr>
                            <tr>
                                <td><strong>Исторический минимум:</strong></td>
                                <td>${item.historical_min ? formatPrice(item.historical_min) : '—'}</td>
                            </tr>
                            <tr>
                                <td><strong>Обработано:</strong></td>
                                <td>${item.processed ? '<span class="badge bg-success">Да</span>' : '<span class="badge bg-secondary">Нет</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Создано:</strong></td>
                                <td>${item.created_at ? formatDateTime(item.created_at) : '—'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-danger" id="delete-digest-item-btn">
                    <i class="bi bi-trash"></i> Удалить
                </button>
            `
        });

        modal.create();
        modal.show();

        const deleteBtn = modal.getElement().querySelector('#delete-digest-item-btn');
        deleteBtn.addEventListener('click', () => {
            modal.hide();
            this.deleteItem(item);
        });
    }

    async deleteItem(item) {
        const confirmed = await showConfirm(
            `Удалить элемент #${item.id} из очереди дайджеста?`,
            null,
            'Удаление из очереди'
        );

        if (!confirmed) return;

        try {
            await api.deleteDigestItem(item.id);
            showToast('Элемент успешно удалён из очереди', 'success');
            await this.loadQueue();
        } catch (error) {
            console.error('Error deleting digest item:', error);
            showToast('Ошибка удаления: ' + error.message, 'danger');
        }
    }

    destroy() {
        this.table = null;
    }
}

export default DigestQueuePage;
