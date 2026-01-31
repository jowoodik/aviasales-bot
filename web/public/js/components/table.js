// web/public/js/components/table.js

import { formatDate, formatDateTime, formatPrice, escapeHtml, sortBy, filterBySearch, paginate } from '../utils/helpers.js';
import CONFIG from '../config.js';

class Table {
    constructor(config) {
        this.config = {
            containerId: config.containerId,
            columns: config.columns || [],
            data: config.data || [],
            actions: config.actions || [],
            searchable: config.searchable !== false,
            sortable: config.sortable !== false,
            pagination: config.pagination !== false,
            pageSize: config.pageSize || CONFIG.PAGINATION.DEFAULT_PAGE_SIZE,
            onAction: config.onAction || null,
            emptyMessage: config.emptyMessage || 'Нет данных для отображения'
        };

        this.state = {
            currentData: [...this.config.data],
            filteredData: [...this.config.data],
            sortColumn: null,
            sortOrder: 'asc',
            searchTerm: '',
            currentPage: 1
        };
    }

    render() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return;

        const html = `
            <div class="table-container">
                ${this.renderHeader()}
                ${this.renderTable()}
                ${this.config.pagination ? this.renderPagination() : ''}
            </div>
        `;

        container.innerHTML = html;
        this.attachEventListeners();
    }

    renderHeader() {
        return `
            <div class="table-header">
                <h5 class="table-title mb-0">${this.config.title || ''}</h5>
                <div class="table-actions">
                    ${this.config.searchable ? this.renderSearch() : ''}
                    ${this.config.onRefresh ? '<button class="btn btn-sm btn-outline-primary" id="table-refresh"><i class="bi bi-arrow-clockwise"></i></button>' : ''}
                    ${this.config.onCreate ? '<button class="btn btn-sm btn-primary" id="table-create"><i class="bi bi-plus-lg"></i> Создать</button>' : ''}
                </div>
            </div>
        `;
    }

    renderSearch() {
        return `
            <div class="search-bar">
                <i class="bi bi-search"></i>
                <input 
                    type="text" 
                    class="form-control form-control-sm" 
                    id="table-search" 
                    placeholder="Поиск..."
                    value="${this.state.searchTerm}"
                >
            </div>
        `;
    }

    renderTable() {
        const paginatedData = this.getPaginatedData();

        if (paginatedData.data.length === 0) {
            return `
                <div class="p-5 text-center text-muted">
                    <i class="bi bi-inbox fs-1"></i>
                    <p class="mt-3">${this.config.emptyMessage}</p>
                </div>
            `;
        }

        return `
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            ${this.renderTableHeaders()}
                            ${this.config.actions.length > 0 ? '<th>Действия</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${this.renderTableRows(paginatedData.data)}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderTableHeaders() {
        return this.config.columns.map(col => {
            const sortable = this.config.sortable && col.sortable !== false;
            const isSorted = this.state.sortColumn === col.key;
            const sortIcon = isSorted
                ? (this.state.sortOrder === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down')
                : 'bi-arrow-down-up';

            return `
                <th class="${sortable ? 'sortable' : ''} ${isSorted ? this.state.sortOrder : ''}" 
                    data-column="${col.key}">
                    ${col.label}
                    ${sortable ? `<i class="bi ${sortIcon}"></i>` : ''}
                </th>
            `;
        }).join('');
    }

    renderTableRows(data) {
        return data.map(row => {
            return `
                <tr data-id="${row.id || row.chat_id}">
                    ${this.renderTableCells(row)}
                    ${this.config.actions.length > 0 ? this.renderActionButtons(row) : ''}
                </tr>
            `;
        }).join('');
    }

    renderTableCells(row) {
        return this.config.columns.map(col => {
            const value = row[col.key];
            const formattedValue = this.formatCellValue(value, col.type, row);
            return `<td>${formattedValue}</td>`;
        }).join('');
    }

    formatCellValue(value, type, row) {
        if (value === null || value === undefined) {
            return '<span class="text-muted">—</span>';
        }
        console.log(value, type, row)

        switch (type) {
            case 'date':
                return formatDate(value);
            case 'datetime':
                return formatDateTime(value);
            case 'price':
                return formatPrice(value, row.currency);
            case 'badge':
                return `<span class="badge bg-primary">${value}</span>`;
            case 'badge-success':
                return `<span class="badge bg-success">${value}</span>`;
            case 'badge-danger':
                return `<span class="badge bg-danger">${value}</span>`;
            case 'code':
                return `<code>${escapeHtml(value)}</code>`;
            case 'status':
                return this.formatStatus(value);
            case 'route':
                return `<strong>${row.origin} → ${row.destination}</strong>`;
            case 'route-type':
                return value ? '<span class="badge bg-info">Гибкий</span>' : '<span class="badge bg-secondary">Фиксированный</span>';
            case 'dates':
                return this.formatDates(row);
            case 'quiet-hours':
                return this.formatQuietHours(row);
            case 'error-status':
                return value === 'error'
                    ? '<span class="badge bg-danger">Error</span>'
                    : '<span class="badge bg-warning text-dark">Not Found</span>';
            default:
                return escapeHtml(value);
        }
    }

    formatStatus(isPaused) {
        return isPaused
            ? '<span class="badge bg-secondary">Пауза</span>'
            : '<span class="badge bg-success">Активен</span>';
    }

    formatDates(row) {
        if (row.is_flexible) {
            return `<small>${row.departure_start || ''}<br>${row.departure_end || ''}</small>`;
        } else {
            return `<small>${row.departure_date || ''}${row.return_date ? '<br>' + row.return_date : ''}</small>`;
        }
    }

    formatQuietHours(row) {
        if (row.quiet_hours_start !== null && row.quiet_hours_end !== null) {
            return `<small>${String(row.quiet_hours_start).padStart(2, '0')}:00 - ${String(row.quiet_hours_end).padStart(2, '0')}:00</small>`;
        }
        return '<span class="text-muted">Не установлено</span>';
    }

    renderActionButtons(row) {
        const buttons = this.config.actions.map(action => {
            const icons = {
                view: 'bi-eye',
                edit: 'bi-pencil',
                delete: 'bi-trash',
                pause: row.is_paused ? 'bi-play-fill' : 'bi-pause-fill'
            };

            const variants = {
                view: 'outline-primary',
                edit: 'outline-secondary',
                delete: 'outline-danger',
                pause: row.is_paused ? 'outline-success' : 'outline-warning'
            };

            const titles = {
                view: 'Просмотр',
                edit: 'Редактировать',
                delete: 'Удалить',
                pause: row.is_paused ? 'Возобновить' : 'Приостановить'
            };

            return `
                <button 
                    class="btn btn-sm btn-${variants[action]} btn-icon" 
                    data-action="${action}"
                    data-id="${row.id || row.chat_id}"
                    title="${titles[action]}"
                >
                    <i class="bi ${icons[action]}"></i>
                </button>
            `;
        }).join('');

        return `<td><div class="btn-group btn-group-sm">${buttons}</div></td>`;
    }

    renderPagination() {
        const paginatedData = this.getPaginatedData();
        if (paginatedData.totalPages <= 1) return '';

        const start = (paginatedData.page - 1) * paginatedData.pageSize + 1;
        const end = Math.min(start + paginatedData.pageSize - 1, paginatedData.total);

        return `
            <div class="pagination-container">
                <div class="pagination-info">
                    Показано ${start}-${end} из ${paginatedData.total}
                </div>
                <nav>
                    <ul class="pagination mb-0">
                        <li class="page-item ${paginatedData.page === 1 ? 'disabled' : ''}">
                            <a class="page-link" href="#" data-page="prev">Назад</a>
                        </li>
                        ${this.renderPageNumbers(paginatedData)}
                        <li class="page-item ${paginatedData.page === paginatedData.totalPages ? 'disabled' : ''}">
                            <a class="page-link" href="#" data-page="next">Вперед</a>
                        </li>
                    </ul>
                </nav>
            </div>
        `;
    }

    renderPageNumbers(paginatedData) {
        const pages = [];
        const maxPages = 5;
        let startPage = Math.max(1, paginatedData.page - Math.floor(maxPages / 2));
        let endPage = Math.min(paginatedData.totalPages, startPage + maxPages - 1);

        if (endPage - startPage < maxPages - 1) {
            startPage = Math.max(1, endPage - maxPages + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(`
                <li class="page-item ${i === paginatedData.page ? 'active' : ''}">
                    <a class="page-link" href="#" data-page="${i}">${i}</a>
                </li>
            `);
        }

        return pages.join('');
    }

    attachEventListeners() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return;

        // Search
        const searchInput = container.querySelector('#table-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Sort
        const sortHeaders = container.querySelectorAll('th.sortable');
        sortHeaders.forEach(header => {
            header.addEventListener('click', () => {
                this.handleSort(header.dataset.column);
            });
        });

        // Actions
        const actionButtons = container.querySelectorAll('[data-action]');
        actionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const action = button.dataset.action;
                const id = button.dataset.id;
                this.handleAction(action, id);
            });
        });

        // Pagination
        const pageLinks = container.querySelectorAll('.page-link');
        pageLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.handlePageChange(link.dataset.page);
            });
        });

        // Refresh
        const refreshBtn = container.querySelector('#table-refresh');
        if (refreshBtn && this.config.onRefresh) {
            refreshBtn.addEventListener('click', () => {
                this.config.onRefresh();
            });
        }

        // Create
        const createBtn = container.querySelector('#table-create');
        if (createBtn && this.config.onCreate) {
            createBtn.addEventListener('click', () => {
                this.config.onCreate();
            });
        }
    }

    handleSearch(searchTerm) {
        this.state.searchTerm = searchTerm;
        this.state.currentPage = 1;
        this.applyFilters();
        this.render();
    }

    handleSort(column) {
        if (this.state.sortColumn === column) {
            this.state.sortOrder = this.state.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortColumn = column;
            this.state.sortOrder = 'asc';
        }
        this.applyFilters();
        this.render();
    }

    handlePageChange(page) {
        const paginatedData = this.getPaginatedData();

        if (page === 'prev') {
            this.state.currentPage = Math.max(1, this.state.currentPage - 1);
        } else if (page === 'next') {
            this.state.currentPage = Math.min(paginatedData.totalPages, this.state.currentPage + 1);
        } else {
            this.state.currentPage = parseInt(page);
        }

        this.render();
    }

    handleAction(action, id) {
        if (this.config.onAction) {
            this.config.onAction(action, id);
        }
    }

    applyFilters() {
        let data = [...this.config.data];

        // Apply search
        if (this.state.searchTerm) {
            const searchKeys = this.config.columns.map(col => col.key);
            data = filterBySearch(data, this.state.searchTerm, searchKeys);
        }

        // Apply sort
        if (this.state.sortColumn) {
            data = sortBy(data, this.state.sortColumn, this.state.sortOrder);
        }

        this.state.filteredData = data;
    }

    getPaginatedData() {
        if (!this.config.pagination) {
            return {
                data: this.state.filteredData,
                total: this.state.filteredData.length,
                page: 1,
                pageSize: this.state.filteredData.length,
                totalPages: 1
            };
        }

        return paginate(this.state.filteredData, this.state.currentPage, this.config.pageSize);
    }

    updateData(newData) {
        this.config.data = newData;
        this.state.currentData = [...newData];
        this.state.currentPage = 1;
        this.applyFilters();
        this.render();
    }

    refresh() {
        this.render();
    }
}

export default Table;
