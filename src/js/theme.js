/**
 * Rewind Theme & Header Interaction Module
 */
(function () {
    const storageKey = 'rewind-theme';
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-icon');

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        root.classList.toggle('dark', isDark);
        root.classList.toggle('light', !isDark);
        if (icon) {
            icon.textContent = isDark ? 'light_mode' : 'dark_mode';
        }
        if (toggle) {
            toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
            toggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        }
    }

    const saved = localStorage.getItem(storageKey);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));

    if (toggle) {
        toggle.addEventListener('click', () => {
            const next = root.classList.contains('dark') ? 'light' : 'dark';
            applyTheme(next);
            localStorage.setItem(storageKey, next);
        });
    }

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
})();
