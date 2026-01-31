// web/public/js/components/modal.js

import { escapeHtml, generateId } from '../utils/helpers.js';

class Modal {
    constructor(config) {
        this.config = {
            id: config.id || generateId(),
            title: config.title || 'Модальное окно',
            size: config.size || 'md', // sm, md, lg, xl
            body: config.body || '',
            footer: config.footer || null,
            onShow: config.onShow || null,
            onHide: config.onHide || null,
            backdrop: config.backdrop !== false,
            keyboard: config.keyboard !== false
        };

        this.modal = null;
        this.bsModal = null;
    }

    create() {
        // Remove existing modal with same ID
        const existing = document.getElementById(this.config.id);
        if (existing) {
            existing.remove();
        }

        // Create modal element
        this.modal = document.createElement('div');
        this.modal.id = this.config.id;
        this.modal.className = 'modal fade';
        this.modal.setAttribute('tabindex', '-1');

        if (!this.config.backdrop) {
            this.modal.setAttribute('data-bs-backdrop', 'static');
        }
        if (!this.config.keyboard) {
            this.modal.setAttribute('data-bs-keyboard', 'false');
        }

        this.modal.innerHTML = `
            <div class="modal-dialog modal-${this.config.size}">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${escapeHtml(this.config.title)}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${this.config.body}
                    </div>
                    ${this.config.footer ? `
                        <div class="modal-footer">
                            ${this.config.footer}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        // Initialize Bootstrap modal
        this.bsModal = new bootstrap.Modal(this.modal);

        // Attach event listeners
        this.attachEventListeners();

        return this;
    }

    attachEventListeners() {
        if (this.config.onShow) {
            this.modal.addEventListener('shown.bs.modal', () => {
                this.config.onShow(this);
            });
        }

        if (this.config.onHide) {
            this.modal.addEventListener('hidden.bs.modal', () => {
                this.config.onHide(this);
            });
        }

        // Auto-destroy on hide
        this.modal.addEventListener('hidden.bs.modal', () => {
            this.destroy();
        });
    }

    show() {
        if (!this.modal) {
            this.create();
        }
        this.bsModal.show();
        return this;
    }

    hide() {
        if (this.bsModal) {
            this.bsModal.hide();
        }
        return this;
    }

    destroy() {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
            this.bsModal = null;
        }
    }

    setTitle(title) {
        const titleEl = this.modal.querySelector('.modal-title');
        if (titleEl) {
            titleEl.textContent = title;
        }
        return this;
    }

    setBody(body) {
        const bodyEl = this.modal.querySelector('.modal-body');
        if (bodyEl) {
            bodyEl.innerHTML = body;
        }
        return this;
    }

    setFooter(footer) {
        let footerEl = this.modal.querySelector('.modal-footer');
        if (!footerEl && footer) {
            footerEl = document.createElement('div');
            footerEl.className = 'modal-footer';
            this.modal.querySelector('.modal-content').appendChild(footerEl);
        }
        if (footerEl) {
            footerEl.innerHTML = footer;
        }
        return this;
    }

    getElement() {
        return this.modal;
    }

    getBody() {
        return this.modal ? this.modal.querySelector('.modal-body') : null;
    }

    // Static helper methods
    static confirm(options) {
        const modal = new Modal({
            title: options.title || 'Подтверждение',
            body: options.message || 'Вы уверены?',
            size: 'sm',
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
                <button type="button" class="btn btn-danger" id="confirm-btn">Подтвердить</button>
            `
        });

        modal.create();

        return new Promise((resolve) => {
            const confirmBtn = modal.modal.querySelector('#confirm-btn');
            confirmBtn.addEventListener('click', () => {
                modal.hide();
                resolve(true);
            });

            modal.modal.addEventListener('hidden.bs.modal', () => {
                resolve(false);
            });

            modal.show();
        });
    }

    static alert(options) {
        const modal = new Modal({
            title: options.title || 'Уведомление',
            body: options.message || '',
            size: 'sm',
            footer: `
                <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
            `
        });

        modal.create().show();

        return new Promise((resolve) => {
            modal.modal.addEventListener('hidden.bs.modal', () => {
                resolve(true);
            });
        });
    }

    static form(options) {
        const formFields = options.fields.map(field => {
            return `
                <div class="mb-3">
                    <label class="form-label">${escapeHtml(field.label)}</label>
                    ${Modal.renderFormField(field)}
                    ${field.help ? `<div class="form-text">${escapeHtml(field.help)}</div>` : ''}
                </div>
            `;
        }).join('');

        const modal = new Modal({
            title: options.title || 'Форма',
            size: options.size || 'md',
            body: `<form id="modal-form">${formFields}</form>`,
            footer: `
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
                <button type="submit" form="modal-form" class="btn btn-primary">Сохранить</button>
            `
        });

        modal.create();

        return new Promise((resolve) => {
            const form = modal.modal.querySelector('#modal-form');

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                const data = Object.fromEntries(formData.entries());
                modal.hide();
                resolve(data);
            });

            modal.modal.addEventListener('hidden.bs.modal', () => {
                resolve(null);
            });

            modal.show();
        });
    }

    static renderFormField(field) {
        const value = field.value || '';
        const required = field.required ? 'required' : '';

        switch (field.type) {
            case 'select':
                return `
                    <select name="${field.name}" class="form-select" ${required}>
                        ${field.options.map(opt =>
                    `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`
                ).join('')}
                    </select>
                `;
            case 'textarea':
                return `
                    <textarea name="${field.name}" class="form-control" rows="${field.rows || 3}" ${required}>${escapeHtml(value)}</textarea>
                `;
            case 'checkbox':
                return `
                    <div class="form-check">
                        <input type="checkbox" name="${field.name}" class="form-check-input" id="${field.name}" ${value ? 'checked' : ''}>
                        <label class="form-check-label" for="${field.name}">${field.checkboxLabel || ''}</label>
                    </div>
                `;
            default:
                return `
                    <input 
                        type="${field.type || 'text'}" 
                        name="${field.name}" 
                        class="form-control" 
                        value="${escapeHtml(value)}"
                        ${field.min !== undefined ? `min="${field.min}"` : ''}
                        ${field.max !== undefined ? `max="${field.max}"` : ''}
                        ${field.step !== undefined ? `step="${field.step}"` : ''}
                        ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ''}
                        ${required}
                    >
                `;
        }
    }
}

export default Modal;
