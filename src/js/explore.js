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

    /* ---- Chart data + labels shared with hover handlers ---- */
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const FULL_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const state = { hourly: [], weekday: [], monthly: [], seasonPts: null, clockPeak: null };

    function plays(n) {
        return n.toLocaleString() + (n === 1 ? ' play' : ' plays');
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

    /* ---- Radial listening clock ---- */
    function renderClock(hours) {
        state.hourly = hours;
        const svg = document.getElementById('clock-svg');
        if (!svg) return;
        const cx = 150, cy = 150, inner = 62, maxLen = 62, minLen = 8;
        const max = Math.max.apply(null, hours) || 1;
        const hasData = hours.some((v) => v > 0);
        let peak = 0;
        hours.forEach((v, i) => {
            if (v > hours[peak]) peak = i;
        });
        state.clockPeak = hasData ? peak : null;
        let bars = '';
        let hits = '';
        for (let i = 0; i < 24; i++) {
            const v = hours[i] / max;
            const ang = ((i * 15 - 90) * Math.PI) / 180;
            const cos = Math.cos(ang), sin = Math.sin(ang);
            const len = minLen + v * maxLen;
            const x1 = cx + cos * inner;
            const y1 = cy + sin * inner;
            const x2 = cx + cos * (inner + len);
            const y2 = cy + sin * (inner + len);
            const isPeak = hasData && i === peak;
            const stroke = isPeak ? '#ffffff' : 'rgb(30,215,96)';
            const op = isPeak ? 1 : (0.25 + v * 0.7).toFixed(2);
            const w = isPeak ? 8 : 6;
            bars += '<line class="clock-bar" data-h="' + i + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
                '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
                '" stroke="' + stroke + '" stroke-opacity="' + op + '" stroke-width="' + w + '" />';
            const hitLen = Math.max(len, 30);
            const hx2 = cx + cos * (inner + hitLen);
            const hy2 = cy + sin * (inner + hitLen);
            hits += '<line class="clock-hit" data-h="' + i + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
                '" x2="' + hx2.toFixed(1) + '" y2="' + hy2.toFixed(1) +
                '" stroke="transparent" stroke-width="15" />';
        }
        svg.innerHTML = bars + hits; // hit lines on top capture hover
        const label = document.getElementById('clock-peak');
        if (label) label.textContent = hasData ? fmtHour(peak) : '—';
        resetCenter();
    }

    function highlightSpoke(i, on) {
        const bar = document.querySelector('#clock-svg .clock-bar[data-h="' + i + '"]');
        if (bar) bar.classList.toggle('is-hover', on);
    }
    function setCenter(i) {
        const label = document.getElementById('clock-peak');
        const cap = document.getElementById('clock-caption');
        if (label) label.textContent = fmtHour(i);
        if (cap) cap.textContent = plays(state.hourly[i] || 0);
    }
    function resetCenter() {
        const label = document.getElementById('clock-peak');
        const cap = document.getElementById('clock-caption');
        if (cap) cap.textContent = 'Peak hour';
        if (label) label.textContent = state.clockPeak != null ? fmtHour(state.clockPeak) : '—';
    }

    /* ---- Seasonal curve ---- */
    function renderSeason(months) {
        state.monthly = months;
        const svg = document.getElementById('season-svg');
        if (!svg) return;
        const W = 320, H = 110, pad = 8;
        const max = Math.max.apply(null, months) || 1;
        const step = (W - pad * 2) / (months.length - 1);
        const pts = months.map((v, i) => {
            const x = pad + i * step;
            const y = H - pad - (v / max) * (H - pad * 2);
            return [x, y];
        });
        state.seasonPts = pts;
        const line = pts
            .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
            .join(' ');
        const last = pts[pts.length - 1];
        const first = pts[0];
        const area = line + ' L' + last[0].toFixed(1) + ' ' + (H - pad) +
            ' L' + first[0].toFixed(1) + ' ' + (H - pad) + ' Z';
        let hits = '';
        for (let i = 0; i < months.length; i++) {
            const x = pad + i * step - step / 2;
            hits += '<rect class="season-hit" data-m="' + i + '" x="' + x.toFixed(1) +
                '" y="0" width="' + step.toFixed(1) + '" height="' + H + '" fill="transparent" />';
        }
        svg.innerHTML =
            '<defs><linearGradient id="season-fill" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="rgb(30,215,96)" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="rgb(30,215,96)" stop-opacity="0"/>' +
            '</linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#season-fill)"/>' +
            '<path d="' + line + '" fill="none" stroke="rgb(30,215,96)" stroke-width="2.5" ' +
            'stroke-linecap="round" stroke-linejoin="round"/>' +
            '<line id="season-vline" x1="0" y1="0" x2="0" y2="' + H + '" stroke="rgb(30,215,96)" ' +
            'stroke-opacity="0.3" stroke-width="1" style="opacity:0" />' +
            '<circle id="season-dot" r="4.5" fill="#fff" stroke="rgb(30,215,96)" stroke-width="2.5" style="opacity:0" />' +
            hits;
    }

    function showSeasonPoint(i) {
        const pts = state.seasonPts;
        if (!pts || !pts[i]) return;
        const dot = document.getElementById('season-dot');
        const vline = document.getElementById('season-vline');
        const x = pts[i][0].toFixed(1);
        if (dot) {
            dot.setAttribute('cx', x);
            dot.setAttribute('cy', pts[i][1].toFixed(1));
            dot.style.opacity = '1';
        }
        if (vline) {
            vline.setAttribute('x1', x);
            vline.setAttribute('x2', x);
            vline.style.opacity = '1';
        }
    }
    function hideSeasonPoint() {
        const dot = document.getElementById('season-dot');
        const vline = document.getElementById('season-vline');
        if (dot) dot.style.opacity = '0';
        if (vline) vline.style.opacity = '0';
    }

    /* ---- Weekday bars ---- */
    function renderWeekday(weekday) {
        state.weekday = weekday;
        const el = document.getElementById('weekday-bars');
        if (!el) return;
        const max = Math.max.apply(null, weekday) || 1;
        let busiest = 0;
        weekday.forEach((v, i) => {
            if (v > weekday[busiest]) busiest = i;
        });
        el.innerHTML = weekday
            .map((v, i) => {
                const h = Math.max(4, Math.round((v / max) * 100));
                const top = i === busiest && v > 0;
                const barCls = top ? 'bg-primary' : 'bg-primary/30';
                const lblCls = top ? 'text-primary font-bold' : 'text-on-surface-variant';
                return '<div class="weekday-col flex-1 flex flex-col items-center gap-2 h-full justify-end cursor-pointer" data-d="' + i + '">' +
                    '<div class="weekday-bar w-full rounded-t-md ' + barCls + ' transition-colors" style="height:' + h + '%"></div>' +
                    '<span class="font-mono text-[10px] ' + lblCls + '">' + WEEKDAYS[i] + '</span>' +
                    '</div>';
            })
            .join('');
    }

    /* ---- Wire hover on all three charts (delegated, survives re-render) ---- */
    function attr(el, name) {
        return el && el.getAttribute ? el.getAttribute(name) : null;
    }
    function setupHover() {
        const clock = document.getElementById('clock-svg');
        if (clock) {
            clock.addEventListener('mouseover', (e) => {
                const a = attr(e.target, 'data-h');
                if (a == null) return;
                const i = +a;
                highlightSpoke(i, true);
                setCenter(i);
                showTip(fmtHour(i), plays(state.hourly[i] || 0), e.clientX, e.clientY);
            });
            clock.addEventListener('mousemove', (e) => {
                if (attr(e.target, 'data-h') != null) moveTip(e.clientX, e.clientY);
            });
            clock.addEventListener('mouseout', (e) => {
                const a = attr(e.target, 'data-h');
                if (a == null) return;
                highlightSpoke(+a, false);
                if (attr(e.relatedTarget, 'data-h') == null) {
                    hideTip();
                    resetCenter();
                }
            });
        }

        const season = document.getElementById('season-svg');
        if (season) {
            season.addEventListener('mouseover', (e) => {
                const a = attr(e.target, 'data-m');
                if (a == null) return;
                const i = +a;
                showSeasonPoint(i);
                showTip(FULL_MONTHS[i], plays(state.monthly[i] || 0), e.clientX, e.clientY);
            });
            season.addEventListener('mousemove', (e) => {
                if (attr(e.target, 'data-m') != null) moveTip(e.clientX, e.clientY);
            });
            season.addEventListener('mouseout', (e) => {
                if (attr(e.target, 'data-m') == null) return;
                if (attr(e.relatedTarget, 'data-m') == null) {
                    hideSeasonPoint();
                    hideTip();
                }
            });
        }

        const wk = document.getElementById('weekday-bars');
        if (wk) {
            const colOf = (t) => (t && t.closest ? t.closest('[data-d]') : null);
            wk.addEventListener('mouseover', (e) => {
                const col = colOf(e.target);
                if (!col) return;
                const i = +col.getAttribute('data-d');
                showTip(FULL_WEEKDAYS[i], plays(state.weekday[i] || 0), e.clientX, e.clientY);
            });
            wk.addEventListener('mousemove', (e) => {
                if (colOf(e.target)) moveTip(e.clientX, e.clientY);
            });
            wk.addEventListener('mouseout', (e) => {
                const col = colOf(e.target);
                if (col && col.contains(e.relatedTarget)) return;
                hideTip();
            });
        }
    }

    /* ---- Side stats ---- */
    function setChronotype(chrono) {
        const label = document.getElementById('chrono-label');
        const marker = document.getElementById('chrono-marker');
        const icon = document.getElementById('chrono-icon');
        const pos = chrono && typeof chrono.position === 'number' ? chrono.position : 0;
        if (label) label.textContent = (chrono && chrono.label) || '—';
        if (marker) marker.style.left = Math.round(pos * 100) + '%';
        if (icon) {
            const map = { 'Early bird': 'wb_twilight', Balanced: 'schedule', 'Night owl': 'bedtime' };
            icon.textContent = (chrono && map[chrono.label]) || 'schedule';
        }
    }
    function setBusiest(name) {
        const el = document.getElementById('busiest-weekday');
        if (el) el.textContent = name || '—';
    }
    function setStreak(streak) {
        const l = document.getElementById('streak-longest');
        const c = document.getElementById('streak-current');
        const a = document.getElementById('streak-active');
        if (l) l.textContent = streak ? streak.longest : '—';
        if (c) c.textContent = streak ? streak.current + (streak.current === 1 ? ' day' : ' days') : '—';
        if (a) a.textContent = streak ? streak.active_days.toLocaleString() : '—';
    }

    /* ---- Fetch + render the rhythm chapter ---- */
    // Sample keeps the visuals alive when the API is offline (e.g. the bento preview).
    const SAMPLE = {
        hourly: [3, 2, 1, 1, 1, 2, 5, 12, 18, 14, 10, 12, 15, 17, 20, 22, 26, 30, 36, 42, 46, 50, 34, 16],
        weekday: [2634, 2442, 2428, 2786, 2599, 1924, 2835],
        monthly: [42, 38, 30, 26, 22, 20, 28, 34, 30, 44, 52, 60],
        busiest_weekday: 'Sunday',
        chronotype: { label: 'Balanced', position: 0.36 },
        streak: { longest: 34, current: 2, active_days: 432 },
    };

    async function fetchRhythm() {
        let d = SAMPLE;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/rhythm');
                if (res && res.ok && res.data && res.data.total_streams > 0) {
                    d = res.data;
                }
            } catch (_e) {
                /* keep sample fallback */
            }
        }
        renderClock(d.hourly);
        renderWeekday(d.weekday);
        renderSeason(d.monthly);
        setChronotype(d.chronotype);
        setBusiest(d.busiest_weekday);
        setStreak(d.streak);
    }

    function init() {
        initReveal();
        initScrollSpy();
        setupHover();
        fetchRhythm();
        window.addEventListener('rewind:data-updated', fetchRhythm);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
