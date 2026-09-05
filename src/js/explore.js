// Explore page — scrollytelling glue: sticky chapter-rail scroll-spy,
// reveal-on-scroll, and the "When You Listen" placeholder visuals.
// The radial clock and season curve render from SAMPLE_* data until the
// chapter is wired to real /api endpoints.
(function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---- Reveal on scroll ---- */
    function initReveal() {
        const els = document.querySelectorAll('.reveal');
        if (!els.length) return;
        // No observer / reduced motion → leave everything visible.
        if (!('IntersectionObserver' in window) || reduceMotion) return;
        els.forEach((el) => el.classList.add('reveal-init'));
        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (!e.isIntersecting) return;
                    e.target.classList.remove('reveal-init');
                    e.target.classList.add('reveal-in');
                    io.unobserve(e.target);
                });
            },
            { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
        );
        els.forEach((el) => io.observe(el));
    }

    /* ---- Chapter rail scroll-spy ---- */
    function initScrollSpy() {
        const pills = Array.from(document.querySelectorAll('#chapter-rail [data-chapter]'));
        if (!pills.length) return;
        const sections = pills
            .map((p) => document.querySelector(p.getAttribute('href')))
            .filter(Boolean);
        if (!sections.length) return;

        const setActive = (id) => {
            pills.forEach((p) =>
                p.classList.toggle('chapter-pill--active', p.getAttribute('href') === '#' + id)
            );
        };
        setActive(sections[0].id);

        if (!('IntersectionObserver' in window)) return;
        const spy = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) setActive(e.target.id);
                });
            },
            { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
        );
        sections.forEach((s) => spy.observe(s));
    }

    /* ---- Helpers ---- */
    function fmtHour(h) {
        const ampm = h < 12 ? 'AM' : 'PM';
        let hr = h % 12;
        if (hr === 0) hr = 12;
        return hr + ' ' + ampm;
    }

    /* ---- Radial listening clock (sample data placeholder) ---- */
    const SAMPLE_HOURS = [3, 2, 1, 1, 1, 2, 5, 12, 18, 14, 10, 12, 15, 17, 20, 22, 26, 30, 36, 42, 46, 50, 34, 16];
    function renderClock() {
        const svg = document.getElementById('clock-svg');
        if (!svg) return;
        const cx = 150, cy = 150, inner = 62, maxLen = 62, minLen = 8;
        const max = Math.max.apply(null, SAMPLE_HOURS) || 1;
        let peak = 0;
        SAMPLE_HOURS.forEach((v, i) => {
            if (v > SAMPLE_HOURS[peak]) peak = i;
        });
        let markup = '';
        for (let i = 0; i < 24; i++) {
            const v = SAMPLE_HOURS[i] / max;
            const ang = ((i * 15 - 90) * Math.PI) / 180;
            const len = minLen + v * maxLen;
            const x1 = cx + Math.cos(ang) * inner;
            const y1 = cy + Math.sin(ang) * inner;
            const x2 = cx + Math.cos(ang) * (inner + len);
            const y2 = cy + Math.sin(ang) * (inner + len);
            const isPeak = i === peak;
            const stroke = isPeak ? '#ffffff' : 'rgb(30,215,96)';
            const op = isPeak ? 1 : (0.25 + v * 0.7).toFixed(2);
            const w = isPeak ? 8 : 6;
            markup += '<line class="clock-bar" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
                '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
                '" stroke="' + stroke + '" stroke-opacity="' + op + '" stroke-width="' + w + '" />';
        }
        svg.innerHTML = markup;
        const label = document.getElementById('clock-peak');
        if (label) label.textContent = fmtHour(peak);
    }

    /* ---- Seasonal curve (sample data placeholder) ---- */
    const SAMPLE_MONTHS = [42, 38, 30, 26, 22, 20, 28, 34, 30, 44, 52, 60];
    function renderSeason() {
        const svg = document.getElementById('season-svg');
        if (!svg) return;
        const W = 320, H = 110, pad = 8;
        const max = Math.max.apply(null, SAMPLE_MONTHS) || 1;
        const step = (W - pad * 2) / (SAMPLE_MONTHS.length - 1);
        const pts = SAMPLE_MONTHS.map((v, i) => {
            const x = pad + i * step;
            const y = H - pad - (v / max) * (H - pad * 2);
            return [x, y];
        });
        const line = pts
            .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
            .join(' ');
        const last = pts[pts.length - 1];
        const first = pts[0];
        const area = line + ' L' + last[0].toFixed(1) + ' ' + (H - pad) +
            ' L' + first[0].toFixed(1) + ' ' + (H - pad) + ' Z';
        svg.innerHTML =
            '<defs><linearGradient id="season-fill" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="rgb(30,215,96)" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="rgb(30,215,96)" stop-opacity="0"/>' +
            '</linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#season-fill)"/>' +
            '<path d="' + line + '" fill="none" stroke="rgb(30,215,96)" stroke-width="2.5" ' +
            'stroke-linecap="round" stroke-linejoin="round"/>';
    }

    function init() {
        initReveal();
        initScrollSpy();
        renderClock();
        renderSeason();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
