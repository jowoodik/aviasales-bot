import api from '../api.js';
import Table from '../components/table.js';
import Modal from '../components/modal.js';
import { showLoading, showError, showToast, showConfirm, formatDate, formatDateTime } from '../utils/helpers.js';
import CONFIG from "../config.js";

class BroadcastsPage {
    constructor() {
        this.table = null;
        this.broadcasts = [];
        this.users = [];
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
      <div class="broadcasts-page">
        <div class="page-header">
          <div>
            <h1>📢 Массовая рассылка</h1>
            <p class="subtitle">Создание и управление рассылками для пользователей</p>
          </div>
          <button class="btn btn-primary" id="create-broadcast-btn">
            <i class="fas fa-plus"></i> Создать рассылку
          </button>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Сообщения для рассылки</h3>
          </div>
          <div class="card-body">
            <div id="broadcasts-table"></div>
          </div>
        </div>
      </div>
    `;

        content.innerHTML = html;

        // Event listeners
        document.getElementById('create-broadcast-btn').addEventListener('click', () => {
            this.showCreateModal();
        });

        await this.loadBroadcasts();
        this.renderTable();
    }

    async loadBroadcasts() {
        try {
            showLoading('Загрузка рассылок...');
            this.broadcasts = await api.getBroadcasts();
        } catch (error) {
            showError('Ошибка загрузки рассылок: ' + error.message);
        }
    }

    async loadUsers() {
        try {
            this.users = await api.getBroadcastUsers();
        } catch (error) {
            showError('Ошибка загрузки пользователей: ' + error.message);
        }
    }

    renderTable() {
        this.table = new Table({
            containerId: 'broadcasts-table',
            title: 'Список рассылок',
            columns: CONFIG.TABLES.BROADCASTS.columns,
            data: this.broadcasts,
            actions: CONFIG.TABLES.BROADCASTS.actions,
            searchable: true,
            sortable: true,
            pagination: true,
            pageSize: 20,
            onAction: (action, id) => this.handleAction(action, id),
            onRefresh: () => this.loadBroadcasts(),
            onCreate: () => this.createBroadcast()
        });

        this.table.render();
    }

    async handleAction(action, id) {
        const broadcast = this.broadcasts.find(b => b.id == id);
        if (!broadcast) return;

        switch (action) {
            case 'view':
                await this.viewBroadcast(broadcast);
                break;
            case 'edit':
                await this.editBroadcast(broadcast.id);
                break;
            case 'delete':
                await this.deleteBroadcast(broadcast.id);
                break;
        }
    }

    async showCreateModal() {
        await this.loadUsers();

        const modalBody = `
      <form id="broadcast-form">
        <div class="mb-3">
          <label for="message_text" class="form-label">Текст сообщения *</label>
          <textarea 
            id="message_text" 
            class="form-control" 
            rows="6" 
            required
            placeholder="Введите текст сообщения для рассылки..."
          ></textarea>
          <small class="form-text text-muted">Поддерживается Markdown форматирование</small>
        </div>

        <div class="mb-3">
          <label for="scheduled_time" class="form-label">Время отправки (локальное время пользователя) *</label>
          <input 
            type="time" 
            id="scheduled_time" 
            class="form-control" 
            required
            value="10:00"
          />
          <small class="form-text text-muted">Сообщение будет отправлено когда у пользователя наступит это время</small>
        </div>

        <div class="mb-3">
          <label class="form-label">Получатели *</label>
          <div class="form-check">
            <input 
              class="form-check-input" 
              type="radio" 
              name="target_type" 
              id="target_all" 
              value="all" 
              checked
            />
            <label class="form-check-label" for="target_all">
              Все пользователи (${this.users.length})
            </label>
          </div>
          <div class="form-check">
            <input 
              class="form-check-input" 
              type="radio" 
              name="target_type" 
              id="target_selected" 
              value="selected"
            />
            <label class="form-check-label" for="target_selected">
              Выбранные пользователи
            </label>
          </div>
        </div>

        <div class="mb-3" id="users-select-group" style="display: none;">
          <label class="form-label">Выберите пользователей</label>
          <div class="users-checkbox-list" style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px; background: #f8f9fa;">
            ${this.users.map(user => `
              <div class="form-check">
                <input 
                  class="form-check-input user-checkbox" 
                  type="checkbox" 
                  value="${user.chat_id}" 
                  id="user_${user.chat_id}"
                />
                <label class="form-check-label" for="user_${user.chat_id}">
                  ${user.chat_id} (${user.timezone || 'без timezone'}, маршрутов: ${user.routes_count || 0})
                </label>
              </div>
            `).join('')}
          </div>
          <div class="mt-2">
            <button type="button" class="btn btn-sm btn-outline-primary" id="select-all-users">Выбрать всех</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="deselect-all-users">Снять выбор</button>
          </div>
        </div>

        <div class="alert alert-info">
          <i class="fas fa-info-circle"></i>
          <strong>Важно:</strong> Telegram ограничивает скорость отправки до 30 сообщений в секунду. 
          Рассылка будет идти со скоростью 25 сообщений в секунду для безопасности.
        </div>
      </form>
    `;

        const modalFooter = `
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
      <button type="button" class="btn btn-primary" id="create-broadcast-submit">Создать</button>
    `;

        const modal = new Modal({
            title: '📢 Создать рассылку',
            size: 'lg',
            body: modalBody,
            footer: modalFooter,
            onShow: () => {
                // Event listeners для формы
                document.querySelectorAll('input[name="target_type"]').forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        const usersGroup = document.getElementById('users-select-group');
                        usersGroup.style.display = e.target.value === 'selected' ? 'block' : 'none';
                    });
                });

                document.getElementById('select-all-users')?.addEventListener('click', () => {
                    document.querySelectorAll('.user-checkbox').forEach(cb => cb.checked = true);
                });

                document.getElementById('deselect-all-users')?.addEventListener('click', () => {
                    document.querySelectorAll('.user-checkbox').forEach(cb => cb.checked = false);
                });

                document.getElementById('create-broadcast-submit')?.addEventListener('click', async () => {
                    await this.handleCreateBroadcast(modal);
                });
            }
        });

        modal.show();
    }

    async handleCreateBroadcast(modal) {
        const form = document.getElementById('broadcast-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const messageText = document.getElementById('message_text').value.trim();
        const scheduledTime = document.getElementById('scheduled_time').value;
        const targetType = document.querySelector('input[name="target_type"]:checked').value;

        let targetUsers = 'all';
        if (targetType === 'selected') {
            const selectedUsers = Array.from(document.querySelectorAll('.user-checkbox:checked'))
                .map(cb => parseInt(cb.value));

            if (selectedUsers.length === 0) {
                showError('Выберите хотя бы одного пользователя');
                return;
            }
            targetUsers = JSON.stringify(selectedUsers);
        }

        try {
            showLoading('Создание рассылки...');

            await api.createBroadcast({
                message_text: messageText,
                target_users: targetUsers,
                scheduled_time: scheduledTime
            });

            showToast('Рассылка успешно создана', 'success');
            modal.hide();
            await this.loadBroadcasts();
            this.renderTable();
        } catch (error) {
            showError('Ошибка создания рассылки: ' + error.message);
        }
    }

    async viewBroadcast(broadcast) {
        const modal = new Modal({
            title: `📢 Рассылка #${broadcast.id}`,
            size: 'lg',
            body: '<div id="broadcast-details-content">Загрузка...</div>',
            footer: `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
        ${broadcast.is_sent === 0 ? `
          <button type="button" class="btn btn-primary" id="edit-broadcast-btn">
            <i class="bi bi-pencil"></i> Редактировать
          </button>
        ` : ''}
      `
        });

        modal.create();
        modal.show();

        const detailsContent = modal.getBody();

        try {
            const fullBroadcast = await api.getBroadcastById(broadcast.id);

            const detailsHtml = `
        <div class="broadcast-details">
          <div class="detail-row">
            <strong>ID:</strong> ${fullBroadcast.id}
          </div>
          <div class="detail-row">
            <strong>Статус:</strong> 
            ${fullBroadcast.is_sent ? '<span class="badge badge-success">Отправлено</span>' : '<span class="badge badge-warning">В очереди</span>'}
          </div>
          <div class="detail-row">
            <strong>Время отправки:</strong> ${fullBroadcast.scheduled_time} (локальное время)
          </div>
          <div class="detail-row">
            <strong>Создано:</strong> ${formatDateTime(fullBroadcast.created_at)}
          </div>
          ${fullBroadcast.sent_at ? `
            <div class="detail-row">
              <strong>Завершено:</strong> ${formatDateTime(fullBroadcast.sent_at)}
            </div>
          ` : ''}
          <div class="detail-row">
            <strong>Текст сообщения:</strong>
            <div style="margin-top: 10px; padding: 15px; background: #f5f5f5; border-radius: 4px; white-space: pre-wrap;">
${fullBroadcast.message_text}
            </div>
          </div>
          <div class="detail-row">
            <strong>Получатели:</strong>
            ${fullBroadcast.target_users === 'all' ?
                'Все пользователи' :
                `${JSON.parse(fullBroadcast.target_users).length} выбранных пользователей`
            }
          </div>
          ${fullBroadcast.sent_users && fullBroadcast.sent_users.length > 0 ? `
            <div class="detail-row">
              <strong>Отправлено (${fullBroadcast.sent_users.length}):</strong>
              <div style="max-height: 300px; overflow-y: auto; margin-top: 10px;">
                <table class="table table-sm table-striped">
                  <thead>
                    <tr>
                      <th>Chat ID</th>
                      <th>Timezone</th>
                      <th>Время отправки</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${fullBroadcast.sent_users.map(u => `
                      <tr>
                        <td>${u.chat_id}</td>
                        <td>${u.timezone || 'N/A'}</td>
                        <td>${formatDateTime(u.sent_at)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
        </div>
      `;

            detailsContent.innerHTML = detailsHtml;
        } catch (error) {
            console.error('Error loading broadcast details:', error);
            detailsContent.innerHTML =
                `<div class="alert alert-danger">Ошибка загрузки данных: ${error.message}</div>`;
        }

        // Event handlers
        if (broadcast.is_sent === 0) {
            const editBtn = modal.getElement().querySelector('#edit-broadcast-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    modal.hide();
                    this.editBroadcast(broadcast.id);
                });
            }
        }
    }

    async editBroadcast(id) {
        try {
            showLoading('Загрузка данных...');
            const broadcast = await api.getBroadcastById(id);
            await this.loadUsers();

            let selectedUsers = [];
            if (broadcast.target_users !== 'all') {
                try {
                    selectedUsers = JSON.parse(broadcast.target_users);
                } catch (e) {
                    selectedUsers = [];
                }
            }

            const modalBody = `
        <form id="broadcast-edit-form">
          <div class="mb-3">
            <label for="edit_message_text" class="form-label">Текст сообщения *</label>
            <textarea 
              id="edit_message_text" 
              class="form-control" 
              rows="6" 
              required
            >${broadcast.message_text}</textarea>
          </div>

          <div class="mb-3">
            <label for="edit_scheduled_time" class="form-label">Время отправки *</label>
            <input 
              type="time" 
              id="edit_scheduled_time" 
              class="form-control" 
              required
              value="${broadcast.scheduled_time}"
            />
          </div>

          <div class="mb-3">
            <label class="form-label">Получатели *</label>
            <div class="form-check">
              <input 
                class="form-check-input" 
                type="radio" 
                name="edit_target_type" 
                id="edit_target_all" 
                value="all" 
                ${broadcast.target_users === 'all' ? 'checked' : ''}
              />
              <label class="form-check-label" for="edit_target_all">
                Все пользователи
              </label>
            </div>
            <div class="form-check">
              <input 
                class="form-check-input" 
                type="radio" 
                name="edit_target_type" 
                id="edit_target_selected" 
                value="selected"
                ${broadcast.target_users !== 'all' ? 'checked' : ''}
              />
              <label class="form-check-label" for="edit_target_selected">
                Выбранные пользователи
              </label>
            </div>
          </div>

          <div class="mb-3" id="edit-users-select-group" style="display: ${broadcast.target_users !== 'all' ? 'block' : 'none'};">
            <label class="form-label">Выберите пользователей</label>
            <div class="users-checkbox-list" style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px; background: #f8f9fa;">
              ${this.users.map(user => `
                <div class="form-check">
                  <input 
                    class="form-check-input edit-user-checkbox" 
                    type="checkbox" 
                    value="${user.chat_id}" 
                    id="edit_user_${user.chat_id}"
                    ${selectedUsers.includes(user.chat_id) ? 'checked' : ''}
                  />
                  <label class="form-check-label" for="edit_user_${user.chat_id}">
                    ${user.chat_id} (${user.timezone || 'без timezone'})
                  </label>
                </div>
              `).join('')}
            </div>
          </div>
        </form>
      `;

            const modalFooter = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
        <button type="button" class="btn btn-primary" id="edit-broadcast-submit">Сохранить</button>
      `;

            const modal = new Modal({
                title: `✏️ Редактировать рассылку #${id}`,
                size: 'lg',
                body: modalBody,
                footer: modalFooter,
                onShow: () => {
                    // Event listeners
                    document.querySelectorAll('input[name="edit_target_type"]').forEach(radio => {
                        radio.addEventListener('change', (e) => {
                            const usersGroup = document.getElementById('edit-users-select-group');
                            usersGroup.style.display = e.target.value === 'selected' ? 'block' : 'none';
                        });
                    });

                    document.getElementById('edit-broadcast-submit')?.addEventListener('click', async () => {
                        await this.handleEditBroadcast(id, modal);
                    });
                }
            });

            modal.show();
        } catch (error) {
            showError('Ошибка загрузки данных: ' + error.message);
        }
    }

    async handleEditBroadcast(id, modal) {
        const form = document.getElementById('broadcast-edit-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const messageText = document.getElementById('edit_message_text').value.trim();
        const scheduledTime = document.getElementById('edit_scheduled_time').value;
        const targetType = document.querySelector('input[name="edit_target_type"]:checked').value;

        let targetUsers = 'all';
        if (targetType === 'selected') {
            const selectedUsers = Array.from(document.querySelectorAll('.edit-user-checkbox:checked'))
                .map(cb => parseInt(cb.value));

            if (selectedUsers.length === 0) {
                showError('Выберите хотя бы одного пользователя');
                return;
            }
            targetUsers = JSON.stringify(selectedUsers);
        }

        try {
            showLoading('Сохранение...');

            await api.updateBroadcast(id, {
                message_text: messageText,
                target_users: targetUsers,
                scheduled_time: scheduledTime
            });

            showToast('Рассылка успешно обновлена', 'success');
            modal.hide();
            await this.loadBroadcasts();
            this.renderTable();
        } catch (error) {
            showError('Ошибка обновления: ' + error.message);
        }
    }

    async deleteBroadcast(id) {
        const confirmed = await showConfirm(
            'Это действие нельзя отменить. Все связанные логи отправки также будут удалены.',
            null,
            'Удалить рассылку?'
        );

        if (!confirmed) return;

        try {
            showLoading('Удаление...');
            await api.deleteBroadcast(id);
            showToast('Рассылка удалена', 'success');
            await this.loadBroadcasts();
            this.renderTable();
        } catch (error) {
            showError('Ошибка удаления: ' + error.message);
        }
    }
}

// Экспортируем класс
export default BroadcastsPage;
