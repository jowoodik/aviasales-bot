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
        id: 'subscriptions',
        label: 'Подписки',
        icon: 'bi-star',
        route: '#subscriptions'
    },
    {
        id: 'routes',
        label: 'Маршруты',
        icon: 'bi-airplane',
        route: '#routes'
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
        id: 'notifications',
        label: 'Лог уведомлений',
        icon: 'bi-bell',
        route: '#notifications'
    },
    {
        id: 'digest-queue',
        label: 'Очередь дайджеста',
        icon: 'bi-inbox',
        route: '#digest-queue'
    },
    {
        id: 'broadcasts',
        label: 'Планировщик рассылок',
        icon: 'bi-chat',
        route: '#broadcasts'
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

        if (!toggle || !sidebar) return;

        // Открытие/закрытие по кнопке toggle
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('show');

            // Добавляем/убираем backdrop
            this.toggleBackdrop(sidebar.classList.contains('show'));
        });

        // Закрытие при клике на пункт меню (на мобилке)
        sidebar.addEventListener('click', (e) => {
            const link = e.target.closest('.sidebar-link');
            if (link && window.innerWidth < 768) {
                sidebar.classList.remove('show');
                this.toggleBackdrop(false);
            }
        });

        // Закрытие при клике вне сайдбара (на backdrop)
        document.addEventListener('click', (e) => {
            if (
                sidebar.classList.contains('show') &&
                !sidebar.contains(e.target) &&
                !toggle.contains(e.target)
            ) {
                sidebar.classList.remove('show');
                this.toggleBackdrop(false);
            }
        });

        // Закрытие по ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('show')) {
                sidebar.classList.remove('show');
                this.toggleBackdrop(false);
            }
        });
    }

    toggleBackdrop(show) {
        let backdrop = document.getElementById('sidebar-backdrop');

        if (show) {
            // Создаем backdrop если его нет
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'sidebar-backdrop';
                backdrop.className = 'sidebar-backdrop';
                document.body.appendChild(backdrop);

                // Закрытие по клику на backdrop
                backdrop.addEventListener('click', () => {
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar) {
                        sidebar.classList.remove('show');
                        this.toggleBackdrop(false);
                    }
                });
            }
            backdrop.classList.add('show');
            document.body.style.overflow = 'hidden'; // Блокируем скролл
        } else {
            // Убираем backdrop
            if (backdrop) {
                backdrop.classList.remove('show');
                setTimeout(() => backdrop.remove(), 300); // Удаляем после анимации
            }
            document.body.style.overflow = ''; // Возвращаем скролл
        }
    }
}

const sidebar = new Sidebar();
export default sidebar;
