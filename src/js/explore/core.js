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
    // When a chapter has no real data — nothing uploaded yet, the API is
    // unreachable, or the selected year simply has no plays — hide its content
    // and show one small "no data" card instead of inventing sample numbers the
    // user might mistake for their own.
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
                section.appendChild(msg);
            }
            msg.innerHTML = emptyMarkup();
            msg.classList.remove('hidden');
        } else {
            if (msg) msg.classList.add('hidden');
            children.forEach((c, i) => {
                if (i === 0 || c === msg) return;
                c.classList.remove('hidden');
            });
        }
    }

    // A filtered year with nothing in it isn't an error and isn't an empty
    // account — say so, and offer the way back to all time.
    function emptyMarkup() {
        if (E.year) {
            return '<span class="material-symbols-outlined text-3xl text-on-surface-variant opacity-40">calendar_month</span>' +
                '<p class="font-body-lg text-body-lg text-on-surface-variant mt-2">No listening in ' + esc(E.year) + ' — ' +
                '<button type="button" class="text-primary hover:underline" data-year-reset>see all time</button>.</p>';
        }
        return '<span class="material-symbols-outlined text-3xl text-on-surface-variant opacity-40">bar_chart</span>' +
            '<p class="font-body-lg text-body-lg text-on-surface-variant mt-2">Nothing to show yet — ' +
            '<a href="upload.html" class="text-primary hover:underline">upload your Spotify history</a>.</p>';
    }

    /* ---- Chapter busy state (while a year switch is in flight) ---- */
    // Dims a chapter's body instead of leaving last year's numbers on screen
    // looking like this year's. The header stays readable so the page keeps its
    // shape while the new data lands. Owner-keyed because a chapter can have
    // more than one loader (chapter 01 runs the velocity chart and the bar race
    // independently) — the dim lifts only once every owner is done.
    const busyOwners = new Map();
    function chapterBusy(sectionId, isBusy, owner) {
        const section = document.getElementById(sectionId);
        if (!section) return;
        let owners = busyOwners.get(sectionId);
        if (!owners) { owners = new Set(); busyOwners.set(sectionId, owners); }
        if (isBusy) owners.add(owner || 'chapter');
        else owners.delete(owner || 'chapter');
        const on = owners.size > 0;
        Array.from(section.children).forEach((c, i) => {
            if (i === 0) return; // keep the chapter header crisp
            c.classList.toggle('chapter-busy', on);
        });
    }

    /* ---- Year filter (one selection drives every chapter) ---- */
    // `E.year` is the single source of truth: null = all time, otherwise an int.
    // Every chapter builds its URL with withYear() and stamps its request with
    // token(), so a response from a year the user has already moved off is
    // dropped instead of painting the wrong numbers.
    const YEAR_KEY = 'rewind_explore_year';
    let yearSeq = 0;
    let yearOptions = [];

    function readStoredYear() {
        try {
            const raw = localStorage.getItem(YEAR_KEY);
            return raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
        } catch (_e) {
            return null;
        }
    }
    function storeYear(y) {
        try {
            if (y == null) localStorage.removeItem(YEAR_KEY);
            else localStorage.setItem(YEAR_KEY, String(y));
        } catch (_e) {
            /* private mode — the filter just won't persist */
        }
    }
    function withYear(path) {
        const y = E.year;
        if (!y) return path; // all time → the URL you had before the filter existed
        return path + (path.includes('?') ? '&' : '?') + 'year=' + encodeURIComponent(y);
    }
    function yearLabel() {
        return E.year ? String(E.year) : 'All time';
    }
    function token() {
        return yearSeq;
    }
    function stale(t) {
        return t !== yearSeq;
    }

    function setYear(y) {
        const next = y == null ? null : Number(y);
        if (next === E.year) return;
        E.year = next;
        storeYear(next);
        yearSeq++;  // anything still in flight for the old year is now stale
        renderYearControl();
        // Chapters listen on this already (it's the post-upload refresh hook), so
        // one dispatch refetches the whole page — no per-chapter plumbing.
        window.dispatchEvent(new Event('rewind:data-updated'));
    }

    function renderYearControl() {
        const label = document.getElementById('year-filter-label');
        if (label) label.textContent = yearLabel();
        const btn = document.getElementById('year-filter-btn');
        if (btn) btn.classList.toggle('year-pill--active', !!E.year);
        const menu = document.getElementById('year-filter-menu');
        if (!menu) return;
        const opt = (value, text, sub) =>
            '<button type="button" role="option" class="year-option' +
            (String(value) === String(E.year == null ? 'all' : E.year) ? ' year-option--active' : '') +
            '" data-year="' + esc(value) + '" aria-selected="' +
            (String(value) === String(E.year == null ? 'all' : E.year)) + '">' +
            '<span class="year-option-label">' + esc(text) + '</span>' +
            (sub ? '<span class="year-option-sub">' + esc(sub) + '</span>' : '') +
            '</button>';
        menu.innerHTML =
            opt('all', 'All time', '') +
            yearOptions
                .map((y) => opt(y.year, y.year, y.streams ? y.streams.toLocaleString() + ' plays' : ''))
                .join('');
    }

    function closeYearMenu() {
        const wrap = document.getElementById('year-filter');
        const btn = document.getElementById('year-filter-btn');
        if (wrap) wrap.classList.remove('is-open');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function initYearControl() {
        const wrap = document.getElementById('year-filter');
        const btn = document.getElementById('year-filter-btn');
        if (!wrap || !btn) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = wrap.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) closeYearMenu();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeYearMenu();
        });
        // Delegated so it survives the menu being re-rendered, and so the
        // "see all time" link inside an empty chapter card works too.
        document.addEventListener('click', (e) => {
            const reset = e.target.closest && e.target.closest('[data-year-reset]');
            if (reset) {
                setYear(null);
                return;
            }
            const optBtn = e.target.closest && e.target.closest('.year-option');
            if (!optBtn) return;
            const v = optBtn.getAttribute('data-year');
            setYear(v === 'all' ? null : v);
            closeYearMenu();
        });

        renderYearControl();
        loadYearOptions();
    }

    async function loadYearOptions() {
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            return { ok: res.ok, data: await res.json() };
        });
        let years = [];
        try {
            const res = await fetcher('/api/metrics/years', {}, 5000);
            if (res && res.ok && res.data && Array.isArray(res.data.years)) years = res.data.years;
        } catch (_e) {
            /* offline → the control stays hidden and every chapter shows its empty card */
        }
        yearOptions = years;
        const wrap = document.getElementById('year-filter');
        if (wrap) wrap.classList.toggle('hidden', !years.length);
        // A stored year that no longer exists (new upload, cleared history)
        // must not strand the page on an empty view.
        if (E.year != null && !years.some((y) => Number(y.year) === E.year)) {
            setYear(null);
            return;
        }
        renderYearControl();
    }

    /* ---- Inline "?" help popovers ---- */
    // Each help button has a sibling `.help-content`; on click we mirror that
    // markup into a body-level popover so card `overflow-hidden` never clips it.
    function initHelp() {
        const buttons = Array.from(document.querySelectorAll('.help-btn'));
        if (!buttons.length) return;
        let pop = null;
        let openBtn = null;

        const close = () => {
            if (pop) { pop.remove(); pop = null; }
            if (openBtn) { openBtn.classList.remove('is-open'); openBtn.setAttribute('aria-expanded', 'false'); }
            openBtn = null;
        };
        const place = (btn) => {
            if (!pop) return;
            const r = btn.getBoundingClientRect();
            const w = pop.offsetWidth;
            const h = pop.offsetHeight;
            const m = 8;
            let left = r.left + r.width / 2 - w / 2;
            let top = r.bottom + 8;
            left = Math.max(m, Math.min(left, window.innerWidth - w - m));
            if (top + h > window.innerHeight - m) top = r.top - h - 8;
            pop.style.left = left + 'px';
            pop.style.top = Math.max(m, top) + 'px';
        };
        const open = (btn) => {
            const content = btn.parentElement && btn.parentElement.querySelector('.help-content');
            if (!content) return;
            close();
            pop = document.createElement('div');
            pop.className = 'help-pop';
            pop.setAttribute('role', 'tooltip');
            pop.innerHTML = content.innerHTML;
            document.body.appendChild(pop);
            openBtn = btn;
            btn.classList.add('is-open');
            btn.setAttribute('aria-expanded', 'true');
            place(btn);
        };

        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('.help-btn');
            if (btn) {
                e.preventDefault();
                if (openBtn === btn) close();
                else open(btn);
                return;
            }
            if (pop && !(e.target.closest && e.target.closest('.help-pop'))) close();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
        window.addEventListener('scroll', () => { if (openBtn) place(openBtn); }, true);
        window.addEventListener('resize', close);
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
        chapterBusy,
        year: readStoredYear(),
        withYear,
        setYear,
        token,
        stale,
        chapters: [],
    };
    window.RewindExplore = E;

    // Fetch a chapter with its loading state managed. A run that started before
    // the current year selection never clears the busy state — otherwise a slow
    // previous-year response would un-dim the chapter while the real data is
    // still on the wire.
    function runChapter(c) {
        if (!c.fetch) return;
        const t = yearSeq;
        if (c.section) chapterBusy(c.section, true);
        Promise.resolve()
            .then(() => c.fetch())
            .catch(() => {})
            .then(() => {
                if (t === yearSeq && c.section) chapterBusy(c.section, false);
            });
    }

    function init() {
        initReveal();
        // The filter first: chapters must never be left unfilterable because a
        // rail/scroll-spy hiccup threw on the way in.
        initYearControl();
        initScrollSpy();
        initHelp();
        E.chapters.forEach((c) => { if (c.hover) c.hover(); });
        E.chapters.forEach((c) => runChapter(c));
        window.addEventListener('rewind:data-updated', () => {
            E.chapters.forEach((c) => runChapter(c));
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
