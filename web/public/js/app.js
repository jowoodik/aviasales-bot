import router from './router.js';
import sidebar from './components/sidebar.js';
import airportService from './services/airportService.js';

// Import pages
import DashboardPage from './pages/dashboard.js';
import UsersPage from './pages/users.js';
import RoutesPage from './pages/routes.js';
import SubscriptionsPage from './pages/subscriptions.js';
import CheckStatsPage from './pages/checkStats.js';
import AnalyticsPage from './pages/analytics.js';
import NotificationsPage from './pages/notifications.js';
import DigestQueuePage from './pages/digest.js';
import BroadcastsPage from './pages/broadcasts.js';
import DatabasePage from './pages/database.js';

class App {
    constructor() {
        this.pages = {};
        this.init();
    }

    async init() {
        console.log('🚀 Initializing Aviasales Bot Admin Panel...');

        try {
            // Load airport codes cache
            await airportService.load();

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
            notifications: new NotificationsPage(),
            digestQueue: new DigestQueuePage(),
            broadcasts: new BroadcastsPage(),
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

        router.register('check-stats', (params) => {
            this.pages.checkStats.render(params);
        });

        router.register('digest-queue', (params) => {
            this.pages.digestQueue.render(params);
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
