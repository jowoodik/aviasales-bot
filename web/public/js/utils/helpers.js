// web/public/js/utils/helpers.js

/**
 * Format date to localized string
 */
export function formatDate(dateString, includeTime = false) {
    if (!dateString) return '<span class="text-muted">Нет данных</span>';

    try {
        const date = new Date(dateString);
        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        };

        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }

        return date.toLocaleString('ru-RU', options);
    } catch (e) {
        return dateString;
    }
}

/**
 * Format datetime
 */
export function formatDateTime(dateString) {
    return formatDate(dateString, true);
}

/**
 * Format relative time (e.g., "5 минут назад")
 */
export function formatRelativeTime(dateString) {
    if (!dateString) return 'Никогда';

    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Только что';
        if (diffMins < 60) return `${diffMins} мин. назад`;
        if (diffHours < 24) return `${diffHours} ч. назад`;
        if (diffDays < 7) return `${diffDays} дн. назад`;

        return formatDate(dateString);
    } catch (e) {
        return dateString;
    }
}

/**
 * Format price
 */
export function formatPrice(price, currency = 'RUB') {
    if (price === null || price === undefined) return 'N/A';

    const symbols = {
        'RUB': '₽',
        'USD': '$',
        'EUR': '€',
        'KZT': '₸'
    };

    return `${Math.round(price)} ${symbols[currency] || currency}`;
}

/**
 * Format number with spaces (e.g., 1000000 -> 1 000 000)
 */
export function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
    if (!text) return '';

    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };

    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

/**
 * Debounce function
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Show toast notification
 */
export function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container') || createToastContainer();

    const toastId = `toast-${Date.now()}`;
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `toast align-items-center text-white bg-${type} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${escapeHtml(message)}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;

    toastContainer.appendChild(toast);

    const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
    bsToast.show();

    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
}

/**
 * Create toast container if not exists
 */
function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
    return container;
}

/**
 * Show confirmation modal
 */
export function showConfirm(message, onConfirm, title = 'Подтверждение') {
    return new Promise((resolve) => {
        const modalId = 'confirm-modal';
        let modal = document.getElementById(modalId);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'modal fade';
            modal.innerHTML = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${escapeHtml(title)}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p id="confirm-message"></p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
                            <button type="button" class="btn btn-danger" id="confirm-btn">Подтвердить</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        document.getElementById('confirm-message').textContent = message;

        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();

        const confirmBtn = document.getElementById('confirm-btn');
        const handleConfirm = () => {
            bsModal.hide();
            if (onConfirm) onConfirm();
            resolve(true);
            confirmBtn.removeEventListener('click', handleConfirm);
        };

        confirmBtn.addEventListener('click', handleConfirm);

        modal.addEventListener('hidden.bs.modal', () => {
            resolve(false);
        });
    });
}

/**
 * Show loading spinner
 */
export function showLoading(element) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }

    if (!element) return;

    element.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
                <span class="visually-hidden">Загрузка...</span>
            </div>
            <p class="mt-3 text-muted">Загрузка данных...</p>
        </div>
    `;
}

/**
 * Show error message
 */
export function showError(element, error) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }

    if (!element) return;

    element.innerHTML = `
        <div class="alert alert-danger">
            <i class="bi bi-exclamation-triangle"></i>
            <strong>Ошибка:</strong> ${escapeHtml(error.message || error)}
        </div>
    `;
}

/**
 * Copy to clipboard
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Скопировано в буфер обмена', 'success');
    } catch (err) {
        showToast('Ошибка копирования', 'danger');
    }
}

/**
 * Generate random ID
 */
export function generateId() {
    return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sort array of objects by key
 */
export function sortBy(array, key, order = 'asc') {
    return [...array].sort((a, b) => {
        const valA = a[key];
        const valB = b[key];

        if (valA === valB) return 0;

        const comparison = valA > valB ? 1 : -1;
        return order === 'asc' ? comparison : -comparison;
    });
}

/**
 * Filter array by search term
 */
export function filterBySearch(array, searchTerm, keys) {
    if (!searchTerm) return array;

    const term = searchTerm.toLowerCase();

    return array.filter(item => {
        return keys.some(key => {
            const value = item[key];
            if (value === null || value === undefined) return false;
            return value.toString().toLowerCase().includes(term);
        });
    });
}

/**
 * Paginate array
 */
export function paginate(array, page = 1, pageSize = 20) {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
        data: array.slice(start, end),
        total: array.length,
        page: page,
        pageSize: pageSize,
        totalPages: Math.ceil(array.length / pageSize)
    };
}

export default {
    formatDate,
    formatDateTime,
    formatRelativeTime,
    formatPrice,
    formatNumber,
    escapeHtml,
    debounce,
    showToast,
    showConfirm,
    showLoading,
    showError,
    copyToClipboard,
    generateId,
    sortBy,
    filterBySearch,
    paginate
};
