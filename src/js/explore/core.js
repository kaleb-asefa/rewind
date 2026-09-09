// Explore page core: shared helpers, tooltip, reveal/scroll-spy, and the
// chapter registry. Each chapter file (rhythm/sound/taste/behavior/discovery/
// life) attaches to `window.RewindExplore` and registers a `{ fetch, hover }`
// pair; `init` (on DOMContentLoaded, after all deferred chapter scripts have
// run) wires hover, runs the initial fetch, and refetches on rewind:data-updated.
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

        const track = document.getElementById('chapter-rail-track');
        const scrollBehavior = reduceMotion ? 'auto' : 'smooth';

        // Fade the rail edges only while it actually overflows its container.
        const updateOverflow = () => {
            if (!track) return;
            track.classList.toggle('is-scrollable', track.scrollWidth > track.clientWidth + 2);
        };

        // Keep the active pill centred in the rail so the list follows your
        // reading position automatically instead of needing a manual drag.
        const scrollToPill = (pill) => {
            if (!track || !pill) return;
            const target = pill.offsetLeft - (track.clientWidth - pill.offsetWidth) / 2;
            const max = track.scrollWidth - track.clientWidth;
            track.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: scrollBehavior });
        };

        const setActive = (id) => {
            let active = null;
            pills.forEach((p) => {
                const on = p.getAttribute('href') === '#' + id;
                p.classList.toggle('chapter-pill--active', on);
                if (on) active = p;
            });
            scrollToPill(active);
        };

        updateOverflow();
        window.addEventListener('resize', updateOverflow);
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

    /* ---- Shared formatting helpers ---- */
    function plays(n) {
        return n.toLocaleString() + (n === 1 ? ' play' : ' plays');
    }
    function fmtMins(min) {
        const m = Math.max(0, Math.round(min));
        const h = Math.floor(m / 60);
        return h > 0 ? h + 'h ' + (m % 60) + 'm' : m + 'm';
    }
    function pct(v) {
        return Math.round(v * 100);
    }
    function setText(id, v) {
        const e = document.getElementById(id);
        if (e) e.textContent = v;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function attr(el, name) {
        return el && el.getAttribute ? el.getAttribute(name) : null;
    }

    /* ---- Shared cursor tooltip (clamped to the viewport) ---- */
    let tipEl = null;
    function showTip(title, value, x, y) {
        if (!tipEl) {
            tipEl = document.createElement('div');
            tipEl.className = 'rhythm-tooltip';
            document.body.appendChild(tipEl);
        }
        tipEl.innerHTML = '<span class="rt-title"></span><span class="rt-val"></span>';
        tipEl.firstChild.textContent = title;
        tipEl.lastChild.textContent = value;
        tipEl.classList.add('visible');
        moveTip(x, y);
    }
    function moveTip(x, y) {
        if (!tipEl) return;
        const m = 8;
        const w = tipEl.offsetWidth;
        const h = tipEl.offsetHeight;
        let left = x - w / 2;
        let top = y - h - 14;
        left = Math.max(m, Math.min(left, window.innerWidth - w - m));
        if (top < m) top = y + 18;
        top = Math.max(m, Math.min(top, window.innerHeight - h - m));
        tipEl.style.left = left + 'px';
        tipEl.style.top = top + 'px';
    }
    function hideTip() {
        if (tipEl) tipEl.classList.remove('visible');
    }

    /* ---- Album/artist cover cell (music-note fallback; <img> reveals on load) ---- */
    function coverCell(id, kind) {
        const imageKind = kind || 'track';
        return '<div class="relative shrink-0 w-10 h-10 rounded-md overflow-hidden bg-surface-container-high">' +
            '<span class="material-symbols-outlined text-on-surface-variant text-lg opacity-40 absolute inset-0 flex items-center justify-center">music_note</span>' +
            (id ? '<img class="cover-img hidden absolute inset-0 w-full h-full object-cover" data-cover-kind="' + esc(imageKind) + '" data-cover-id="' + esc(id) + '" alt="">' : '') +
            '</div>';
    }
    function loadCovers(container) {
        if (!container) return;
        if (window.loadCoversBatch) {
            window.loadCoversBatch(container, 'track');
            return;
        }
        if (!window.loadCover) return;
        container.querySelectorAll('img.cover-img[data-cover-id]').forEach((img) => {
            window.loadCover(img, img.getAttribute('data-cover-kind') || 'track', img.getAttribute('data-cover-id'));
        });
    }

    /* ---- Per-chapter empty state (same honesty as the overview cards) ---- */
    // When a chapter has no real data — nothing uploaded yet, or the API is
    // unreachable — hide its content and show one small "no data" card instead
    // of inventing sample numbers the user might mistake for their own.
    function chapterEmpty(sectionId, isEmpty) {
        const section = document.getElementById(sectionId);
        if (!section) return;
        const children = Array.from(section.children);
        let msg = children.find((c) => c.classList.contains('chapter-empty')) || null;
        if (isEmpty) {
            children.forEach((c, i) => {
                if (i === 0 || c === msg) return; // keep the chapter header
                c.classList.add('hidden');
            });
            if (!msg) {
                msg = document.createElement('div');
                msg.className = 'chapter-empty glass-card rounded-2xl p-8 text-center';
                msg.innerHTML =
                    '<span class="material-symbols-outlined text-3xl text-on-surface-variant opacity-40">bar_chart</span>' +
                    '<p class="font-body-lg text-body-lg text-on-surface-variant mt-2">Nothing to show yet — ' +
                    '<a href="upload.html" class="text-primary hover:underline">upload your Spotify history</a>.</p>';
                section.appendChild(msg);
            }
            msg.classList.remove('hidden');
        } else {
            if (msg) msg.classList.add('hidden');
            children.forEach((c, i) => {
                if (i === 0 || c === msg) return;
                c.classList.remove('hidden');
            });
        }
    }

    const E = {
        reduceMotion,
        plays,
        fmtMins,
        pct,
        setText,
        esc,
        attr,
        showTip,
        moveTip,
        hideTip,
        coverCell,
        loadCovers,
        chapterEmpty,
        chapters: [],
    };
    window.RewindExplore = E;

    function init() {
        initReveal();
        initScrollSpy();
        E.chapters.forEach((c) => { if (c.hover) c.hover(); });
        E.chapters.forEach((c) => { if (c.fetch) c.fetch(); });
        E.chapters.forEach((c) => {
            if (c.fetch) window.addEventListener('rewind:data-updated', c.fetch);
        });
    }

    // Deferred chapter scripts run before DOMContentLoaded, so by the time this
    // fires every chapter has registered. (readyState is 'interactive' during
    // deferred execution — still register the listener; only run immediately if
    // the document is already fully loaded.)
    if (document.readyState === 'complete') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
