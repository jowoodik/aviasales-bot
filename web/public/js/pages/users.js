// web/public/js/pages/users.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm } from '../utils/helpers.js';

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
            size: 'lg',
            body: '<div id="user-details-content">Загрузка...</div>',
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-primary" id="edit-user-btn">
                    <i class="bi bi-pencil"></i> Редактировать
                </button>
            `
        });

        modal.create();
        modal.show();

        // Load detailed stats
        try {
            const stats = await this.getUserStats(user.chat_id);
            const detailsContent = modal.getBody();

            detailsContent.innerHTML = `
                <div class="row g-3">
                    <div class="col-md-6">
                        <h6>Основная информация</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${user.chat_id}</code></td>
                            </tr>
                            <tr>
                                <td><strong>Таймзона:</strong></td>
                                <td>${user.timezone || 'Asia/Yekaterinburg'}</td>
                            </tr>
                            <tr>
                                <td><strong>Тихие часы:</strong></td>
                                <td>${this.formatQuietHours(user)}</td>
                            </tr>
                            <tr>
                                <td><strong>Создан:</strong></td>
                                <td>${new Date(user.created_at).toLocaleString('ru-RU')}</td>
                            </tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6>Статистика</h6>
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Всего маршрутов:</strong></td>
                                <td><span class="badge bg-primary">${stats.totalRoutes || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Активных:</strong></td>
                                <td><span class="badge bg-success">${stats.activeRoutes || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Результатов:</strong></td>
                                <td><span class="badge bg-info">${stats.totalResults || 0}</span></td>
                            </tr>
                            <tr>
                                <td><strong>Последняя активность:</strong></td>
                                <td>${user.lastactivity ? new Date(user.lastactivity).toLocaleString('ru-RU') : 'Нет'}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;

            // Edit button handler
            const editBtn = modal.getElement().querySelector('#edit-user-btn');
            editBtn.addEventListener('click', () => {
                modal.hide();
                this.editUser(user);
            });
        } catch (error) {
            showToast('Ошибка загрузки статистики', 'danger');
        }
    }

    async getUserStats(chatId) {
        // This endpoint needs to be added to server.js
        // For now, return basic stats from user object
        const user = this.users.find(u => u.chat_id == chatId);
        return {
            totalRoutes: user.totalroutes || 0,
            activeRoutes: 0,
            totalResults: 0
        };
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
                    name: 'quiet_hours_start',
                    label: 'Начало тихих часов',
                    type: 'number',
                    value: user.quiet_hours_start !== null ? user.quiet_hours_start : '',
                    min: 0,
                    max: 23,
                    placeholder: '0-23 (пусто = не установлено)'
                },
                {
                    name: 'quiet_hours_end',
                    label: 'Конец тихих часов',
                    type: 'number',
                    value: user.quiet_hours_end !== null ? user.quiet_hours_end : '',
                    min: 0,
                    max: 23,
                    placeholder: '0-23 (пусто = не установлено)'
                }
            ]
        });

        if (!formData) return;

        try {
            // Convert empty strings to null
            const updateData = {
                timezone: formData.timezone,
                quiet_hours_start: formData.quiet_hours_start === '' ? null : parseInt(formData.quiet_hours_start),
                quiet_hours_end: formData.quiet_hours_end === '' ? null : parseInt(formData.quiet_hours_end)
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

    formatQuietHours(user) {
        if (user.quiet_hours_start !== null && user.quiet_hours_end !== null) {
            return `${String(user.quiet_hours_start).padStart(2, '0')}:00 - ${String(user.quiet_hours_end).padStart(2, '0')}:00`;
        }
        return 'Не установлено';
    }

    destroy() {
        this.table = null;
    }
}

export default UsersPage;
