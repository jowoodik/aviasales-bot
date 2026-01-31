// web/public/js/pages/failedChecks.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatDateTime } from '../utils/helpers.js';

class FailedChecksPage {
    constructor() {
        this.table = null;
        this.failedChecks = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>❌ Неудачные проверки</h2>
                        <p class="text-muted">Просмотр и анализ ошибок при проверке маршрутов</p>
                    </div>
                </div>

                <!-- Summary -->
                <div class="row g-3 mb-4">
                    <div class="col-md-4">
                        <div class="card border-danger">
                            <div class="card-body text-center">
                                <h6 class="text-danger">Всего ошибок</h6>
                                <h3 class="mb-0 text-danger" id="total-errors">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card border-warning">
                            <div class="card-body text-center">
                                <h6 class="text-warning">Не найдено</h6>
                                <h3 class="mb-0 text-warning" id="not-found-count">-</h3>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="card border-secondary">
                            <div class="card-body text-center">
                                <h6 class="text-muted">Технические ошибки</h6>
                                <h3 class="mb-0" id="error-count">-</h3>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Actions -->
                <div class="row mb-3">
                    <div class="col">
                        <button class="btn btn-outline-danger" id="clear-old-errors">
                            <i class="bi bi-trash"></i> Очистить старые ошибки
                        </button>
                    </div>
                </div>

                <!-- Table -->
                <div id="failed-checks-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadFailedChecks();
        this.attachEventListeners();
    }

    async loadFailedChecks() {
        const container = document.getElementById('failed-checks-table');
        showLoading(container);

        try {
            this.failedChecks = await api.getFailedChecks();
            this.updateSummary();
            this.renderTable();
        } catch (error) {
            console.error('Error loading failed checks:', error);
            showError(container, error);
        }
    }

    updateSummary() {
        const total = this.failedChecks.length;
        const notFound = this.failedChecks.filter(c => c.status === 'not_found').length;
        const errors = this.failedChecks.filter(c => c.status === 'error').length;

        document.getElementById('total-errors').textContent = total;
        document.getElementById('not-found-count').textContent = notFound;
        document.getElementById('error-count').textContent = errors;
    }

    renderTable() {
        this.table = new Table({
            containerId: 'failed-checks-table',
            title: 'Список неудачных проверок',
            columns: CONFIG.TABLES.FAILED_CHECKS.columns,
            data: this.failedChecks,
            actions: ['view', 'delete'],
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadFailedChecks(),
            emptyMessage: '🎉 Нет неудачных проверок! Все работает отлично.'
        });

        this.table.render();
    }

    async handleAction(action, id) {
        const check = this.failedChecks.find(c => c.id == id);
        if (!check) return;

        switch (action) {
            case 'view':
                await this.viewFailedCheck(check);
                break;
            case 'delete':
                await this.deleteFailedCheck(check);
                break;
        }
    }

    async viewFailedCheck(check) {
        const modal = new Modal({
            title: 'Детали неудачной проверки',
            size: 'lg',
            body: `
                <div class="row g-3">
                    <div class="col-12">
                        <div class="alert alert-${check.status === 'error' ? 'danger' : 'warning'}">
                            <h5>${check.status === 'error' ? '❌ Ошибка' : '⚠️ Не найдено'}</h5>
                            <p class="mb-0">${check.error_message || 'Нет сообщения об ошибке'}</p>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <h6>Информация о маршруте</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Маршрут:</strong></td>
                                <td>${check.routename}</td>
                            </tr>
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${check.chatid}</code></td>
                            </tr>
                            <tr>
                                <td><strong>Дата вылета:</strong></td>
                                <td>${check.departure_date || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td><strong>Дата возврата:</strong></td>
                                <td>${check.return_date || 'N/A'}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Детали проверки</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Статус:</strong></td>
                                <td>${check.status === 'error' ? '<span class="badge bg-danger">Error</span>' : '<span class="badge bg-warning">Not Found</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Время проверки:</strong></td>
                                <td>${formatDateTime(check.check_timestamp)}</td>
                            </tr>
                            <tr>
                                <td><strong>Скриншот:</strong></td>
                                <td>${check.screenshot_path ? '<a href="' + check.screenshot_path + '" target="_blank">Открыть</a>' : 'Нет'}</td>
                            </tr>
                        </table>
                    </div>
                    ${check.search_link ? `
                        <div class="col-12">
                            <a href="${check.search_link}" target="_blank" class="btn btn-primary">
                                <i class="bi bi-box-arrow-up-right"></i> Открыть на Aviasales
                            </a>
                        </div>
                    ` : ''}
                </div>
            `,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-danger" id="delete-check-btn">
                    <i class="bi bi-trash"></i> Удалить
                </button>
            `
        });

        modal.create();
        modal.show();

        const deleteBtn = modal.getElement().querySelector('#delete-check-btn');
        deleteBtn.addEventListener('click', () => {
            modal.hide();
            this.deleteFailedCheck(check);
        });
    }

    async deleteFailedCheck(check) {
        const confirmed = await showConfirm(
            'Вы уверены, что хотите удалить эту запись об ошибке?',
            null,
            'Удаление записи'
        );

        if (!confirmed) return;

        try {
            // This endpoint needs to be added to server.js
            await api.delete(`/failed-checks/${check.id}`);
            showToast('Запись успешно удалена', 'success');
            await this.loadFailedChecks();
        } catch (error) {
            console.error('Error deleting failed check:', error);
            showToast('Ошибка удаления: ' + error.message, 'danger');
        }
    }

    attachEventListeners() {
        const clearBtn = document.getElementById('clear-old-errors');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearOldErrors());
        }
    }

    async clearOldErrors() {
        const confirmed = await showConfirm(
            'Удалить все ошибки старше 7 дней?',
            null,
            'Очистка старых ошибок'
        );

        if (!confirmed) return;

        try {
            const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const toDelete = this.failedChecks.filter(c => new Date(c.check_timestamp) < cutoffDate);

            for (const check of toDelete) {
                await api.delete(`/failed-checks/${check.id}`);
            }

            showToast(`Удалено ${toDelete.length} записей`, 'success');
            await this.loadFailedChecks();
        } catch (error) {
            console.error('Error clearing old errors:', error);
            showToast('Ошибка очистки: ' + error.message, 'danger');
        }
    }

    destroy() {
        this.table = null;
    }
}

export default FailedChecksPage;
