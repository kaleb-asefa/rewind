/**
 * Rewind Theme & Header Interaction Module
 */
(function () {
    const storageKey = 'rewind-theme';
    const root = document.documentElement;

    function getPreferredTheme() {
        const saved = localStorage.getItem(storageKey);
        if (saved === 'dark' || saved === 'light') return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        root.classList.toggle('dark', isDark);
        root.classList.toggle('light', !isDark);

        const toggle = document.getElementById('theme-toggle');
        const icon = document.getElementById('theme-icon');

        if (icon) {
            icon.textContent = isDark ? 'light_mode' : 'dark_mode';
        }
        if (toggle) {
            toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
            toggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        }
    }

    // Apply initial theme immediately to avoid flash of wrong theme
    applyTheme(getPreferredTheme());

    function setupListeners() {
        applyTheme(getPreferredTheme());

        // Delegate click handler for theme toggle button
        document.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('#theme-toggle');
            if (!toggleBtn) return;

            const current = root.classList.contains('dark') ? 'dark' : 'light';
            const next = current === 'dark' ? 'light' : 'dark';

            applyTheme(next);
            localStorage.setItem(storageKey, next);
        });

        // Header scroll effect
        window.addEventListener('scroll', () => {
            const header = document.querySelector('header');
            if (!header) return;
            if (window.scrollY > 20) {
                header.classList.add('shadow-spotify-card');
                header.classList.remove('bg-surface/90');
                header.classList.add('bg-surface');
            } else {
                header.classList.remove('shadow-spotify-card');
                header.classList.add('bg-surface/90');
                header.classList.remove('bg-surface');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupListeners);
    } else {
        setupListeners();
    }
})();
