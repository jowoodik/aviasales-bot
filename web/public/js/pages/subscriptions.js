// web/public/js/pages/subscriptions.js

import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import CONFIG from '../config.js';
import { showLoading, showError, showToast, showConfirm, formatDate, formatDateTime } from '../utils/helpers.js';

class SubscriptionsPage {
    constructor() {
        this.table = null;
        this.subscriptions = [];
        this.subscriptionTypes = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>⭐ Управление подписками</h2>
                        <p class="text-muted">Просмотр и управление подписками пользователей</p>
                    </div>
                </div>

                <!-- Subscription Types Overview -->
                <div id="subscription-types-cards" class="row g-3 mb-4">
                    <div class="col-12 text-center py-3">
                        <div class="spinner-border spinner-border-sm" role="status"></div>
                        <span class="ms-2">Загрузка типов подписок...</span>
                    </div>
                </div>

                <div id="subscriptions-table"></div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadSubscriptionTypes();
        await this.loadSubscriptions();
    }

    async loadSubscriptionTypes() {
        try {
            this.subscriptionTypes = await api.getSubscriptionTypes();
            this.renderSubscriptionTypeCards();
        } catch (error) {
            console.error('Error loading subscription types:', error);
            const container = document.getElementById('subscription-types-cards');
            container.innerHTML = `<div class="col-12"><div class="alert alert-danger">Ошибка загрузки типов подписок: ${error.message}</div></div>`;
        }
    }

    renderSubscriptionTypeCards() {
        const container = document.getElementById('subscription-types-cards');
        const typeIcons = {
            'free': '🆓',
            'plus': '💎',
            'admin': '⚡'
        };
        const typeColors = {
            'free': { border: '', text: 'text-muted' },
            'plus': { border: 'border-success', text: 'text-success' },
            'admin': { border: 'border-primary', text: 'text-primary' }
        };

        container.innerHTML = this.subscriptionTypes.map(type => {
            const icon = typeIcons[type.name] || '📋';
            const colors = typeColors[type.name] || { border: '', text: '' };
            const priceDisplay = type.price_per_month > 0 ? `${type.price_per_month} ₽/мес` : (type.name === 'admin' ? 'Безлимит' : 'Бесплатно');
            const combinationsDisplay = type.max_combinations >= 999 ? 'Безлимит' : type.max_combinations;
            const fixedDisplay = type.max_fixed_routes >= 999 ? 'Безлимит' : type.max_fixed_routes;
            const flexibleDisplay = type.max_flexible_routes >= 999 ? 'Безлимит' : type.max_flexible_routes;

            return `
                <div class="col-md-4">
                    <div class="card ${colors.border}">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <h6 class="${colors.text}">${icon} ${type.display_name}</h6>
                                    <h3 class="mb-0">${priceDisplay}</h3>
                                </div>
                                <button class="btn btn-sm btn-outline-secondary" onclick="window.subscriptionsPage.editSubscriptionType(${type.id})" title="Редактировать">
                                    <i class="bi bi-pencil"></i>
                                </button>
                            </div>
                            <ul class="small mt-2 mb-0">
                                <li>${fixedDisplay} фиксированных маршрутов</li>
                                <li>${flexibleDisplay} гибких маршрутов</li>
                                <li>${combinationsDisplay} комбинаций</li>
                                <li>Проверка каждые ${type.check_interval_hours} ч.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Сохраняем ссылку на страницу для доступа из onclick
        window.subscriptionsPage = this;
    }

    async editSubscriptionType(typeId) {
        const type = this.subscriptionTypes.find(t => t.id === typeId);
        if (!type) return;

        const formData = await Modal.form({
            title: `Редактировать тип подписки: ${type.display_name}`,
            size: 'md',
            fields: [
                {
                    name: 'max_fixed_routes',
                    label: 'Макс. фиксированных маршрутов',
                    type: 'number',
                    value: type.max_fixed_routes,
                    min: 0,
                    max: 999,
                    required: true
                },
                {
                    name: 'max_flexible_routes',
                    label: 'Макс. гибких маршрутов',
                    type: 'number',
                    value: type.max_flexible_routes,
                    min: 0,
                    max: 999,
                    required: true
                },
                {
                    name: 'max_combinations',
                    label: 'Макс. комбинаций',
                    type: 'number',
                    value: type.max_combinations,
                    min: 1,
                    max: 999,
                    required: true,
                    help: 'Количество комбинаций дат для гибких маршрутов'
                },
                {
                    name: 'check_interval_hours',
                    label: 'Интервал проверки (часы)',
                    type: 'number',
                    value: type.check_interval_hours,
                    min: 1,
                    max: 24,
                    required: true
                },
                {
                    name: 'price_per_month',
                    label: 'Цена в месяц (₽)',
                    type: 'number',
                    value: type.price_per_month,
                    min: 0,
                    step: 1
                }
            ]
        });

        if (!formData) return;

        try {
            const updateData = {
                max_fixed_routes: parseInt(formData.max_fixed_routes),
                max_flexible_routes: parseInt(formData.max_flexible_routes),
                max_combinations: parseInt(formData.max_combinations),
                check_interval_hours: parseInt(formData.check_interval_hours),
                price_per_month: parseFloat(formData.price_per_month) || 0
            };

            await api.updateSubscriptionType(typeId, updateData);
            showToast('Тип подписки успешно обновлен', 'success');
            await this.loadSubscriptionTypes();
        } catch (error) {
            console.error('Error updating subscription type:', error);
            showToast('Ошибка обновления типа подписки: ' + error.message, 'danger');
        }
    }

    async loadSubscriptions() {
        const container = document.getElementById('subscriptions-table');
        showLoading(container);

        try {
            this.subscriptions = await api.getSubscriptions();
            this.renderTable();
        } catch (error) {
            console.error('Error loading subscriptions:', error);
            showError(container, error);
        }
    }

    renderTable() {
        const columns = [
            { key: 'id', label: 'ID', sortable: true },
            { key: 'chat_id', label: 'Chat ID', sortable: true, type: 'code' },
            { key: 'subscription_type', label: 'Тип', sortable: true, type: 'subscription-type' },
            { key: 'valid_from', label: 'Начало', sortable: true, type: 'datetime' },
            { key: 'valid_to', label: 'Окончание', sortable: true, type: 'datetime' },
            { key: 'is_active', label: 'Статус', sortable: true, type: 'subscription-status' },
            { key: 'created_at', label: 'Создана', sortable: true, type: 'date' }
        ];

        // Override formatCellValue for subscription-specific types
        const originalFormatCellValue = Table.prototype.formatCellValue;
        Table.prototype.formatCellValue = function(value, type, row) {
            if (type === 'subscription-type') {
                const badges = {
                    'free': '<span class="badge bg-secondary">Free</span>',
                    'plus': '<span class="badge bg-success">Plus</span>',
                    'admin': '<span class="badge bg-primary">Admin</span>'
                };
                return badges[value] || value;
            }
            if (type === 'subscription-status') {
                return value
                    ? '<span class="badge bg-success">Активна</span>'
                    : '<span class="badge bg-secondary">Неактивна</span>';
            }
            return originalFormatCellValue.call(this, value, type, row);
        };

        this.table = new Table({
            containerId: 'subscriptions-table',
            title: 'Список подписок',
            columns: columns,
            data: this.subscriptions,
            actions: ['view', 'edit', 'delete'],
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadSubscriptions(),
            onCreate: () => this.createSubscription()
        });

        this.table.render();
    }

    async handleAction(action, id) {
        const subscription = this.subscriptions.find(s => s.id == id);
        if (!subscription) return;

        switch (action) {
            case 'view':
                await this.viewSubscription(subscription);
                break;
            case 'edit':
                await this.editSubscription(subscription);
                break;
            case 'delete':
                await this.deleteSubscription(subscription);
                break;
        }
    }

    async viewSubscription(subscription) {
        const isExpired = subscription.valid_to && new Date(subscription.valid_to) < new Date();
        const daysLeft = subscription.valid_to
            ? Math.ceil((new Date(subscription.valid_to) - new Date()) / (1000 * 60 * 60 * 24))
            : null;

        const modal = new Modal({
            title: `Подписка #${subscription.id}`,
            size: 'md',
            body: `
                <div class="row g-3">
                    <div class="col-12">
                        <table class="table table-sm">
                            <tr>
                                <td><strong>Chat ID:</strong></td>
                                <td><code>${subscription.chat_id}</code></td>
                            </tr>
                            <tr>
                                <td><strong>Тип:</strong></td>
                                <td>${this.getSubscriptionTypeBadge(subscription.subscription_type)}</td>
                            </tr>
                            <tr>
                                <td><strong>Статус:</strong></td>
                                <td>${subscription.is_active ? '<span class="badge bg-success">Активна</span>' : '<span class="badge bg-secondary">Неактивна</span>'}</td>
                            </tr>
                            <tr>
                                <td><strong>Начало:</strong></td>
                                <td>${formatDateTime(subscription.valid_from)}</td>
                            </tr>
                            <tr>
                                <td><strong>Окончание:</strong></td>
                                <td>${subscription.valid_to ? formatDateTime(subscription.valid_to) : '<span class="text-muted">Бессрочная</span>'}</td>
                            </tr>
                            ${daysLeft !== null ? `
                                <tr>
                                    <td><strong>Осталось дней:</strong></td>
                                    <td>
                                        ${isExpired
                ? '<span class="badge bg-danger">Истекла</span>'
                : `<span class="badge bg-${daysLeft < 7 ? 'warning' : 'success'}">${daysLeft} дней</span>`
            }
                                    </td>
                                </tr>
                            ` : ''}
                            <tr>
                                <td><strong>Создана:</strong></td>
                                <td>${formatDateTime(subscription.created_at)}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-primary" id="edit-subscription-btn">
                    <i class="bi bi-pencil"></i> Редактировать
                </button>
            `
        });

        modal.create();
        modal.show();

        const editBtn = modal.getElement().querySelector('#edit-subscription-btn');
        editBtn.addEventListener('click', () => {
            modal.hide();
            this.editSubscription(subscription);
        });
    }

    async createSubscription() {
        const formData = await Modal.form({
            title: 'Создать подписку',
            size: 'md',
            fields: [
                {
                    name: 'chat_id',
                    label: 'Chat ID пользователя',
                    type: 'number',
                    required: true,
                    placeholder: 'Введите Telegram Chat ID'
                },
                {
                    name: 'subscription_type',
                    label: 'Тип подписки',
                    type: 'select',
                    required: true,
                    options: [
                        { value: 'free', label: 'Free (Бесплатная)' },
                        { value: 'plus', label: 'Plus (199₽/мес)' },
                        { value: 'admin', label: 'Admin (Безлимит)' }
                    ]
                },
                {
                    name: 'duration_months',
                    label: 'Длительность (месяцев)',
                    type: 'number',
                    value: 1,
                    min: 1,
                    max: 12,
                    help: 'Для Free и Admin - бессрочно'
                }
            ]
        });

        if (!formData) return;

        try {
            const subscriptionData = {
                chat_id: parseInt(formData.chat_id),
                subscription_type: formData.subscription_type,
                duration_months: parseInt(formData.duration_months)
            };

            await api.createSubscription(subscriptionData);
            showToast('Подписка успешно создана', 'success');
            await this.loadSubscriptions();
        } catch (error) {
            console.error('Error creating subscription:', error);
            showToast('Ошибка создания подписки: ' + error.message, 'danger');
        }
    }

    async editSubscription(subscription) {
        const formData = await Modal.form({
            title: `Редактировать подписку #${subscription.id}`,
            size: 'md',
            fields: [
                {
                    name: 'subscription_type',
                    label: 'Тип подписки',
                    type: 'select',
                    value: subscription.subscription_type,
                    options: [
                        { value: 'free', label: 'Free (Бесплатная)' },
                        { value: 'plus', label: 'Plus (199₽/мес)' },
                        { value: 'admin', label: 'Admin (Безлимит)' }
                    ]
                },
                {
                    name: 'is_active',
                    label: 'Статус',
                    type: 'select',
                    value: subscription.is_active.toString(),
                    options: [
                        { value: '1', label: 'Активна' },
                        { value: '0', label: 'Неактивна' }
                    ]
                },
                {
                    name: 'extend_months',
                    label: 'Продлить на (месяцев)',
                    type: 'number',
                    value: 0,
                    min: 0,
                    max: 12,
                    help: 'Оставьте 0, чтобы не продлевать'
                }
            ]
        });

        if (!formData) return;

        try {
            const updateData = {
                subscription_type: formData.subscription_type,
                is_active: parseInt(formData.is_active),
                extend_months: parseInt(formData.extend_months)
            };

            await api.updateSubscription(subscription.id, updateData);
            showToast('Подписка успешно обновлена', 'success');
            await this.loadSubscriptions();
        } catch (error) {
            console.error('Error updating subscription:', error);
            showToast('Ошибка обновления подписки: ' + error.message, 'danger');
        }
    }

    async deleteSubscription(subscription) {
        const confirmed = await showConfirm(
            `Вы уверены, что хотите удалить подписку для пользователя ${subscription.chat_id}?\n\nПользователь получит подписку Free по умолчанию.`,
            null,
            'Удаление подписки'
        );

        if (!confirmed) return;

        try {
            await api.deleteSubscription(subscription.id);
            showToast('Подписка успешно удалена', 'success');
            await this.loadSubscriptions();
        } catch (error) {
            console.error('Error deleting subscription:', error);
            showToast('Ошибка удаления подписки: ' + error.message, 'danger');
        }
    }

    getSubscriptionTypeBadge(type) {
        const badges = {
            'free': '<span class="badge bg-secondary">🆓 Free</span>',
            'plus': '<span class="badge bg-success">💎 Plus</span>',
            'admin': '<span class="badge bg-primary">⚡ Admin</span>'
        };
        return badges[type] || type;
    }

    destroy() {
        this.table = null;
    }
}

export default SubscriptionsPage;
