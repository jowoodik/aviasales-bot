// web/public/js/pages/database.js

import api from '../api.js';
import Modal from '../components/modal.js';
import { showLoading, showError, showToast, showConfirm, formatNumber } from '../utils/helpers.js';

class DatabasePage {
    constructor() {
        this.dbInfo = null;
    }

    async render() {
        const content = document.getElementById('main-content');

        const html = `
            <div class="container-fluid">
                <div class="row mb-4">
                    <div class="col">
                        <h2>💾 Управление базой данных</h2>
                        <p class="text-muted">Информация о БД и операции обслуживания</p>
                    </div>
                </div>

                <div id="database-content">
                    <div class="text-center py-5">
                        <div class="spinner-border text-primary" role="status"></div>
                        <p class="mt-3 text-muted">Загрузка информации...</p>
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = html;

        await this.loadDatabaseInfo();
    }

    async loadDatabaseInfo() {
        try {
            this.dbInfo = await api.getDatabaseInfo();
            this.renderDatabaseInfo();
        } catch (error) {
            console.error('Error loading database info:', error);
            showError('database-content', error);
        }
    }

    renderDatabaseInfo() {
        const container = document.getElementById('database-content');

        const totalRecords = this.dbInfo.totalRecords || 0;
        const tables = this.dbInfo.tables || [];

        const html = `
            <div class="row g-4">
                <!-- Database Overview -->
                <div class="col-lg-4">
                    <div class="card">
                        <div class="card-header">
                            <h5 class="mb-0">📊 Обзор базы данных</h5>
                        </div>
                        <div class="card-body">
                            <div class="mb-3">
                                <h6 class="text-muted">Всего записей</h6>
                                <h3>${formatNumber(totalRecords)}</h3>
                            </div>
                            <div class="mb-3">
                                <h6 class="text-muted">Всего таблиц</h6>
                                <h3>${tables.length}</h3>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Database Operations -->
                <div class="col-lg-8">
                    <div class="card">
                        <div class="card-header">
                            <h5 class="mb-0">🔧 Операции с базой данных</h5>
                        </div>
                        <div class="card-body">
                            <div class="row g-3">
                                <div class="col-md-6">
                                    <button class="btn btn-primary w-100" id="backup-btn">
                                        <i class="bi bi-save"></i> Создать резервную копию
                                    </button>
                                </div>
                                <div class="col-md-6">
                                    <button class="btn btn-warning w-100" id="vacuum-btn">
                                        <i class="bi bi-gear"></i> Оптимизация (VACUUM)
                                    </button>
                                </div>
                                <div class="col-md-6">
                                    <button class="btn btn-info w-100" id="export-btn">
                                        <i class="bi bi-download"></i> Экспорт данных
                                    </button>
                                </div>
                                <div class="col-md-6">
                                    <button class="btn btn-secondary w-100" id="sql-editor-btn">
                                        <i class="bi bi-code-slash"></i> SQL редактор
                                    </button>
                                </div>
                            </div>
                            <div id="operation-result" class="mt-3"></div>
                        </div>
                    </div>
                </div>

                <!-- Tables Info -->
                <div class="col-12">
                    <div class="card">
                        <div class="card-header">
                            <h5 class="mb-0">📋 Информация о таблицах</h5>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-hover">
                                    <thead>
                                        <tr>
                                            <th>Таблица</th>
                                            <th>Записей</th>
                                            <th>Действия</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tables.map(table => `
                                            <tr>
                                                <td><code>${table.name}</code></td>
                                                <td><span class="badge bg-primary">${formatNumber(table.count)}</span></td>
                                                <td>
                                                    <button class="btn btn-sm btn-outline-primary view-table-btn" data-table="${table.name}">
                                                        <i class="bi bi-eye"></i> Просмотр
                                                    </button>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        this.attachEventListeners();
    }

    attachEventListeners() {
        // Backup
        document.getElementById('backup-btn')?.addEventListener('click', () => this.createBackup());

        // Vacuum
        document.getElementById('vacuum-btn')?.addEventListener('click', () => this.vacuumDatabase());

        // Export
        document.getElementById('export-btn')?.addEventListener('click', () => this.showExportOptions());

        // SQL Editor
        document.getElementById('sql-editor-btn')?.addEventListener('click', () => this.openSQLEditor());

        // View table buttons
        document.querySelectorAll('.view-table-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tableName = btn.dataset.table;
                this.viewTableData(tableName);
            });
        });
    }

    async createBackup() {
        const resultEl = document.getElementById('operation-result');

        try {
            resultEl.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split"></i> Создание резервной копии...</div>';

            const result = await api.createBackup();

            resultEl.innerHTML = `
                <div class="alert alert-success">
                    <i class="bi bi-check-circle"></i> 
                    Резервная копия создана: <code>${result.filename}</code>
                </div>
            `;

            showToast('Резервная копия успешно создана', 'success');
        } catch (error) {
            resultEl.innerHTML = `<div class="alert alert-danger">Ошибка: ${error.message}</div>`;
            showToast('Ошибка создания резервной копии', 'danger');
        }
    }

    async vacuumDatabase() {
        const confirmed = await showConfirm(
            'Выполнить оптимизацию базы данных? Это может занять некоторое время.',
            null,
            'Оптимизация БД'
        );

        if (!confirmed) return;

        const resultEl = document.getElementById('operation-result');

        try {
            resultEl.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split"></i> Оптимизация БД...</div>';

            const result = await api.vacuumDatabase();

            resultEl.innerHTML = `
                <div class="alert alert-success">
                    <i class="bi bi-check-circle"></i> ${result.message}
                </div>
            `;

            showToast('Оптимизация успешно выполнена', 'success');

            // Reload DB info
            setTimeout(() => this.loadDatabaseInfo(), 2000);
        } catch (error) {
            resultEl.innerHTML = `<div class="alert alert-danger">Ошибка: ${error.message}</div>`;
            showToast('Ошибка оптимизации', 'danger');
        }
    }

    showExportOptions() {
        const modal = new Modal({
            title: 'Экспорт данных',
            size: 'md',
            body: `
                <p>Выберите данные для экспорта в формате CSV:</p>
                <div class="list-group">
                    <a href="#" class="list-group-item list-group-item-action export-link" data-type="users">
                        <i class="bi bi-people"></i> Пользователи
                    </a>
                    <a href="#" class="list-group-item list-group-item-action export-link" data-type="routes">
                        <i class="bi bi-airplane"></i> Маршруты
                    </a>
                    <a href="#" class="list-group-item list-group-item-action export-link" data-type="results">
                        <i class="bi bi-ticket"></i> Результаты
                    </a>
                </div>
            `,
            footer: `<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>`
        });

        modal.create();
        modal.show();

        modal.getElement().querySelectorAll('.export-link').forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const type = link.dataset.type;
                await this.exportData(type);
                modal.hide();
            });
        });
    }

    async exportData(type) {
        try {
            showToast('Подготовка экспорта...', 'info');

            const blob = await api.exportData(type);
            const filename = `${type}_export_${new Date().toISOString().split('T')[0]}.csv`;

            api.downloadExport(blob, filename);

            showToast('Экспорт успешно выполнен', 'success');
        } catch (error) {
            console.error('Export error:', error);
            showToast('Ошибка экспорта: ' + error.message, 'danger');
        }
    }

    async openSQLEditor() {
        const modal = new Modal({
            title: 'SQL редактор (только SELECT)',
            size: 'lg',
            body: `
                <div class="mb-3">
                    <label class="form-label">SQL запрос</label>
                    <textarea 
                        id="sql-query" 
                        class="form-control font-monospace" 
                        rows="5" 
                        placeholder="SELECT * FROM unified_routes LIMIT 10"
                    ></textarea>
                    <small class="form-text text-muted">
                        ⚠️ Разрешены только SELECT запросы
                    </small>
                </div>
                <div id="sql-results"></div>
            `,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>
                <button type="button" class="btn btn-primary" id="execute-sql-btn">
                    <i class="bi bi-play-fill"></i> Выполнить
                </button>
            `
        });

        modal.create();
        modal.show();

        const executeBtn = modal.getElement().querySelector('#execute-sql-btn');
        executeBtn.addEventListener('click', async () => {
            const query = modal.getElement().querySelector('#sql-query').value;
            await this.executeSQLQuery(query, modal.getElement().querySelector('#sql-results'));
        });
    }

    async executeSQLQuery(query, resultsContainer) {
        if (!query.trim()) {
            resultsContainer.innerHTML = '<div class="alert alert-warning">Введите SQL запрос</div>';
            return;
        }

        resultsContainer.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm"></div></div>';

        try {
            const result = await api.executeSQLQuery(query);

            if (result.results && result.results.length > 0) {
                const keys = Object.keys(result.results[0]);

                let html = `
                    <div class="alert alert-success">
                        Найдено записей: ${result.count}
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-bordered">
                            <thead>
                                <tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr>
                            </thead>
                            <tbody>
                                ${result.results.slice(0, 100).map(row => `
                                    <tr>${keys.map(k => `<td>${row[k] !== null ? row[k] : '<em>null</em>'}</td>`).join('')}</tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;

                if (result.count > 100) {
                    html += '<div class="alert alert-info">Показаны первые 100 записей из ' + result.count + '</div>';
                }

                resultsContainer.innerHTML = html;
            } else {
                resultsContainer.innerHTML = '<div class="alert alert-info">Запрос выполнен успешно, но не вернул результатов</div>';
            }
        } catch (error) {
            resultsContainer.innerHTML = `<div class="alert alert-danger">Ошибка: ${error.message}</div>`;
        }
    }

    async viewTableData(tableName) {
        const modal = new Modal({
            title: `Таблица: ${tableName}`,
            size: 'xl',
            body: '<div id="table-data-content">Загрузка...</div>',
            footer: '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Закрыть</button>'
        });

        modal.create();
        modal.show();

        try {
            const data = await api.getTableData(tableName, 50);
            const content = modal.getBody();

            if (data.rows && data.rows.length > 0) {
                const keys = Object.keys(data.rows[0]);

                content.innerHTML = `
                    <p class="text-muted">Показано ${data.showing} из ${data.total} записей</p>
                    <div class="table-responsive">
                        <table class="table table-sm table-hover">
                            <thead>
                                <tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr>
                            </thead>
                            <tbody>
                                ${data.rows.map(row => `
                                    <tr>${keys.map(k => `<td>${row[k] !== null ? row[k] : '<em>null</em>'}</td>`).join('')}</tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            } else {
                content.innerHTML = '<p class="text-muted">Таблица пуста</p>';
            }
        } catch (error) {
            modal.getBody().innerHTML = `<div class="alert alert-danger">Ошибка: ${error.message}</div>`;
        }
    }

    destroy() {
        // Cleanup if needed
    }
}

export default DatabasePage;
