// web/public/js/router.js

class Router {
    constructor() {
        this.routes = {};
        this.currentRoute = null;
        this.currentParams = {};

        // Listen to hash changes
        window.addEventListener('hashchange', () => this.handleRouteChange());
        window.addEventListener('load', () => this.handleRouteChange());
    }

    /**
     * Register a route
     */
    register(path, handler) {
        this.routes[path] = handler;
    }

    /**
     * Navigate to a route
     */
    navigate(path, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const hash = queryString ? `#${path}?${queryString}` : `#${path}`;
        window.location.hash = hash;
    }

    /**
     * Get current route
     */
    getCurrentRoute() {
        return this.currentRoute;
    }

    /**
     * Get route parameters
     */
    getParams() {
        return this.currentParams;
    }

    /**
     * Parse hash and extract path and params
     */
    parseHash() {
        const hash = window.location.hash.slice(1) || 'dashboard';
        const [path, queryString] = hash.split('?');

        const params = {};
        if (queryString) {
            const urlParams = new URLSearchParams(queryString);
            for (const [key, value] of urlParams) {
                params[key] = value;
            }
        }

        return { path, params };
    }

    /**
     * Handle route change
     */
    handleRouteChange() {
        const { path, params } = this.parseHash();

        this.currentRoute = path;
        this.currentParams = params;

        // Find matching route
        const handler = this.routes[path];

        if (handler) {
            try {
                handler(params);
                this.updateBreadcrumbs(path);
                this.updateActiveNavItem(path);
            } catch (error) {
                console.error('Route handler error:', error);
                this.handleError(error);
            }
        } else {
            console.warn(`No handler for route: ${path}`);
            this.navigate('dashboard');
        }
    }

    /**
     * Update breadcrumbs
     */
    updateBreadcrumbs(path) {
        const breadcrumbsEl = document.getElementById('breadcrumbs');
        if (!breadcrumbsEl) return;

        const breadcrumbMap = {
            'dashboard': ['Главная'],
            'users': ['Главная', 'Пользователи'],
            'routes': ['Главная', 'Маршруты'],
            'subscriptions': ['Главная', 'Подписки'],
            'check-stats': ['Главная', 'Статистика проверок'],
            'analytics': ['Главная', 'Аналитика'],
            'database': ['Главная', 'База данных']
        };

        const breadcrumbs = breadcrumbMap[path] || ['Главная'];

        let html = '<nav aria-label="breadcrumb"><ol class="breadcrumb mb-0">';
        breadcrumbs.forEach((crumb, index) => {
            if (index === breadcrumbs.length - 1) {
                html += `<li class="breadcrumb-item active">${crumb}</li>`;
            } else {
                html += `<li class="breadcrumb-item"><a href="#${index === 0 ? 'dashboard' : path}">${crumb}</a></li>`;
            }
        });
        html += '</ol></nav>';

        breadcrumbsEl.innerHTML = html;
    }

    /**
     * Update active nav item
     */
    updateActiveNavItem(path) {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('data-route') === path) {
                link.classList.add('active');
            }
        });
    }

    /**
     * Handle errors
     */
    handleError(error) {
        const contentEl = document.getElementById('main-content');
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="alert alert-danger">
                    <h4>Ошибка</h4>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="location.hash='#dashboard'">На главную</button>
                </div>
            `;
        }
    }

    /**
     * Go back
     */
    back() {
        window.history.back();
    }
}

// Create singleton instance
const router = new Router();

export default router;
