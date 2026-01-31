// web/public/js/components/sidebar.js

const MENU_ITEMS = [
    {
        id: 'dashboard',
        label: 'Панель управления',
        icon: 'bi-speedometer2',
        route: '#dashboard'
    },
    {
        id: 'users',
        label: 'Пользователи',
        icon: 'bi-people',
        route: '#users'
    },
    {
        id: 'routes',
        label: 'Маршруты',
        icon: 'bi-airplane',
        route: '#routes'
    },
    {
        id: 'subscriptions',
        label: 'Подписки',
        icon: 'bi-star',
        route: '#subscriptions'
    },
    {
        id: 'check-stats',
        label: 'Статистика проверок',
        icon: 'bi-graph-up',
        route: '#check-stats'
    },
    {
        id: 'analytics',
        label: 'Аналитика',
        icon: 'bi-pie-chart',
        route: '#analytics'
    },
    {
        id: 'failed-checks',
        label: 'Неудачные проверки',
        icon: 'bi-exclamation-triangle',
        route: '#failed-checks'
    },
    {
        id: 'database',
        label: 'База данных',
        icon: 'bi-database',
        route: '#database'
    }
];

class Sidebar {
    render() {
        const nav = document.getElementById('sidebar-nav');
        if (!nav) return;

        const html = MENU_ITEMS.map(item => `
            <a href="${item.route}" class="sidebar-link" data-route="${item.id}">
                <i class="bi ${item.icon}"></i>
                ${item.label}
            </a>
        `).join('');

        nav.innerHTML = html;

        // Highlight active route
        this.updateActiveLink();
        window.addEventListener('hashchange', () => this.updateActiveLink());

        // Mobile toggle
        this.initMobileToggle();
    }

    updateActiveLink() {
        const currentRoute = window.location.hash.slice(1).split('?')[0] || 'dashboard';
        const links = document.querySelectorAll('.sidebar-link');

        links.forEach(link => {
            if (link.dataset.route === currentRoute) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    initMobileToggle() {
        const toggle = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('sidebar');

        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('show');
            });
        }
    }
}

const sidebar = new Sidebar();
export default sidebar;