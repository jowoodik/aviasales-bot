// web/public/js/app.js

import CONFIG from './config.js';
import api from './api.js';
import router from './router.js';
import sidebar from './components/sidebar.js';
import header from './components/header.js';

// Import pages
import DashboardPage from './pages/dashboard.js';
import UsersPage from './pages/users.js';
import RoutesPage from './pages/routes.js';
import SubscriptionsPage from './pages/subscriptions.js';
import CheckStatsPage from './pages/checkStats.js';
import AnalyticsPage from './pages/analytics.js';
import FailedChecksPage from './pages/failedChecks.js';
import DatabasePage from './pages/database.js';

class App {
    constructor() {
        this.pages = {};
        this.init();
    }

    async init() {
        console.log('🚀 Initializing Aviasales Bot Admin Panel...');

        try {
            // Initialize sidebar
            sidebar.render();

            // Initialize pages
            this.initializePages();

            // Register routes
            this.registerRoutes();

            // Start router
            router.handleRouteChange();

            console.log('✅ Application initialized successfully');
        } catch (error) {
            console.error('❌ Application initialization failed:', error);
            this.showInitError(error);
        }
    }

    initializePages() {
        this.pages = {
            dashboard: new DashboardPage(),
            users: new UsersPage(),
            routes: new RoutesPage(),
            subscriptions: new SubscriptionsPage(),
            checkStats: new CheckStatsPage(),
            analytics: new AnalyticsPage(),
            failedChecks: new FailedChecksPage(),
            database: new DatabasePage()
        };
    }

    registerRoutes() {
        // Register all routes
        Object.keys(this.pages).forEach(route => {
            router.register(route, (params) => {
                this.pages[route].render(params);
            });
        });

        // Register additional routes if needed
        router.register('failed-checks', (params) => {
            this.pages.failedChecks.render(params);
        });

        router.register('check-stats', (params) => {
            this.pages.checkStats.render(params);
        });
    }

    showInitError(error) {
        const contentEl = document.getElementById('main-content');
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="container mt-5">
                    <div class="alert alert-danger">
                        <h4><i class="bi bi-exclamation-triangle"></i> Ошибка инициализации</h4>
                        <p>${error.message}</p>
                        <button class="btn btn-primary" onclick="location.reload()">
                            Попробовать снова
                        </button>
                    </div>
                </div>
            `;
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new App();
    });
} else {
    new App();
}

export default App;
