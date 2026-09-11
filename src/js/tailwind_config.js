/**
 * Rewind — shared Tailwind CDN config.
 *
 * Every colour resolves to a CSS custom property defined in src/styles/main.css
 * (`:root` = light, `.dark` = dark), so utilities like `bg-surface` follow the
 * active theme instead of being frozen to one palette. Load this AFTER the
 * Tailwind CDN script and WITHOUT `defer` so the config is set before Tailwind
 * generates its stylesheet.
 */
(function () {
    const COLOR_TOKENS = [
        'primary', 'on-primary', 'primary-container', 'on-primary-container',
        'primary-fixed', 'on-primary-fixed', 'primary-fixed-dim', 'on-primary-fixed-variant',
        'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
        'secondary-fixed', 'on-secondary-fixed', 'secondary-fixed-dim', 'on-secondary-fixed-variant',
        'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
        'tertiary-fixed', 'on-tertiary-fixed', 'tertiary-fixed-dim', 'on-tertiary-fixed-variant',
        'error', 'on-error', 'error-container', 'on-error-container',
        'background', 'on-background',
        'surface', 'on-surface', 'surface-variant', 'on-surface-variant',
        'surface-dim', 'surface-bright', 'surface-tint',
        'surface-container-lowest', 'surface-container-low', 'surface-container',
        'surface-container-high', 'surface-container-highest',
        'inverse-surface', 'inverse-on-surface', 'inverse-primary',
        'outline', 'outline-variant',
    ];

    const colors = {};
    for (const token of COLOR_TOKENS) {
        colors[token] = `rgb(var(--color-${token}) / <alpha-value>)`;
    }

    const JAKARTA = ['Plus Jakarta Sans', 'sans-serif'];

    try {
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors,
                    borderRadius: {
                        DEFAULT: '1rem',
                        lg: '2rem',
                        xl: '3rem',
                        full: '9999px',
                    },
                    spacing: {
                        'container-padding-desktop': '32px',
                        'container-padding-mobile': '16px',
                        'section-gap': '48px',
                        gutter: '24px',
                        base: '8px',
                    },
                    fontFamily: {
                        sans: JAKARTA,
                        'body-lg': JAKARTA,
                        'body-sm': JAKARTA,
                        'label-bold': JAKARTA,
                        'headline-md': JAKARTA,
                        'display-lg': JAKARTA,
                        'display-lg-mobile': JAKARTA,
                        mono: ['Space Mono', 'monospace'],
                    },
                    fontSize: {
                        'body-lg': ['16px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '500' }],
                        'body-sm': ['14px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
                        'label-bold': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '700' }],
                        'headline-md': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '700' }],
                        'display-lg': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '800' }],
                        'display-lg-mobile': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '800' }],
                    },
                    boxShadow: {
                        'spotify-card': 'var(--card-shadow)',
                        'spotify-dialog': 'var(--card-shadow-strong)',
                        'spotify-green': '0 8px 24px rgba(var(--accent-rgb), 0.25)',
                    },
                },
            },
        };
    } catch (_e) {}
})();
