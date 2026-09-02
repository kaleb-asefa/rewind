/**
 * Rewind Listening Activity Heatmap Module
 * Renders a GitHub-style activity calendar from real backend data, with a
 * dynamic year switcher and hover tooltips showing that day's top track.
 */
(function initHeatmap() {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const grid = document.getElementById('heatmap-grid');
    const monthsEl = document.getElementById('heatmap-months');
    const tooltip = document.getElementById('heatmap-tooltip');
    const summaryEl = document.getElementById('heatmap-summary');
    const totalEl = document.getElementById('heatmap-total');
    const yearsContainer = document.getElementById('heatmap-years');

    if (!grid || !monthsEl) return;

    // Move the tooltip to <body> so no card/stacking context can clip or cover it.
    if (tooltip && tooltip.parentElement !== document.body) {
        document.body.appendChild(tooltip);
    }

    const cache = new Map(); // year -> payload
    let years = [];
    let activeYear = null;
    let isFetching = false;

    const fetcher = window.fetchWithTimeout || (async (ep) => {
        const res = await fetch(`http://127.0.0.1:8000${ep}`);
        const data = await res.json();
        return { ok: res.ok, data };
    });

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function isoLocal(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatDate(date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    function formatMinutes(mins) {
        if (mins >= 60) {
            const h = Math.floor(mins / 60);
            const m = Math.round(mins % 60);
            return m ? `${h}h ${m}m` : `${h}h`;
        }
        return `${Math.round(mins)} min`;
    }

    function buildCalendar(year, dayMap) {
        const today = new Date();
        const isCurrentYear = year === today.getFullYear();
        const yearStart = new Date(year, 0, 1);
        const end = isCurrentYear ? today : new Date(year, 11, 31);

        const start = new Date(yearStart);
        start.setDate(start.getDate() - start.getDay());

        const days = [];
        const cursor = new Date(start);

        while (cursor <= end || days.length % 7 !== 0) {
            const inRange = cursor >= yearStart && cursor <= end;
            const iso = isoLocal(cursor);
            const info = inRange ? dayMap.get(iso) : null;

            days.push({
                date: new Date(cursor),
                streams: info ? info.streams : 0,
                minutes: info ? info.minutes : 0,
                level: info ? info.level : 0,
                topTrack: info ? info.top_track : null,
                topArtist: info ? info.top_artist : null,
                inRange,
                padding: !inRange || cursor > end
            });
            cursor.setDate(cursor.getDate() + 1);
        }

        return days;
    }

    function renderYears() {
        if (!yearsContainer || !years.length) return;
        yearsContainer.innerHTML = '';
        years.slice().reverse().forEach((y) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.year = String(y);
            const selected = y === activeYear;
            btn.className =
                'heatmap-year-btn px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ' +
                (selected ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface');
            btn.textContent = String(y);
            btn.addEventListener('click', () => loadYear(y));
            yearsContainer.appendChild(btn);
        });
    }

    function renderMonths(days) {
        monthsEl.innerHTML = '';
        const weeks = Math.ceil(days.length / 7);
        monthsEl.style.setProperty('--weeks-count', weeks);
        monthsEl.style.gridTemplateColumns = `repeat(${weeks}, minmax(0, 1fr))`;

        let lastMonth = -1;
        for (let w = 0; w < weeks; w++) {
            const dayIdx = w * 7;
            const month = days[dayIdx]?.date.getMonth();
            const span = document.createElement('span');
            span.className = 'heatmap-month';
            span.style.gridColumn = `${w + 1}`;

            if (month !== lastMonth && days[dayIdx]?.inRange) {
                span.textContent = MONTHS[month];
                lastMonth = month;
            }
            monthsEl.appendChild(span);
        }
    }

    function renderGrid(days) {
        grid.innerHTML = '';
        const weeks = Math.ceil(days.length / 7);
        grid.style.setProperty('--weeks-count', weeks);
        grid.style.gridTemplateColumns = `repeat(${weeks}, minmax(0, 1fr))`;

        days.forEach((day) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'heatmap-cell';
            cell.dataset.level = String(day.level);

            if (day.padding) {
                cell.dataset.future = 'true';
                cell.tabIndex = -1;
                cell.setAttribute('aria-hidden', 'true');
            } else {
                cell.setAttribute('aria-label', `${formatDate(day.date)}: ${day.streams} streams`);
                cell.addEventListener('mouseenter', (e) => showTooltip(e, day));
                cell.addEventListener('focus', (e) => showTooltip(e, day));
                cell.addEventListener('mouseleave', hideTooltip);
                cell.addEventListener('blur', hideTooltip);
            }

            grid.appendChild(cell);
        });
    }

    function showTooltip(e, day) {
        if (!tooltip) return;
        const target = e.currentTarget || e.target;
        const rect = target.getBoundingClientRect();

        if (day.streams === 0) {
            tooltip.innerHTML = `<strong>${formatDate(day.date)}</strong><br>No listening`;
        } else {
            let html = `<strong>${formatDate(day.date)}</strong><br>` +
                `<span class="count">${day.streams.toLocaleString()}</span> streams · ${formatMinutes(day.minutes)}`;
            if (day.topTrack) {
                const artist = day.topArtist ? ` — ${escapeHtml(day.topArtist)}` : '';
                html += `<br><span class="top">♪ ${escapeHtml(day.topTrack)}${artist}</span>`;
            }
            tooltip.innerHTML = html;
        }

        tooltip.classList.add('visible');
        positionTooltip(rect);
    }

    function positionTooltip(rect) {
        const margin = 8;   // viewport edge padding
        const gap = 6;      // distance between the cell and the tooltip
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;

        // Horizontally centered on the cell, clamped inside the viewport.
        let left = rect.left + rect.width / 2 - tw / 2;
        left = Math.max(margin, Math.min(left, vw - tw - margin));

        // Prefer just above the cell; flip below when there is no room above.
        let top = rect.top - th - gap;
        if (top < margin) top = rect.bottom + gap;
        top = Math.min(top, vh - th - margin);
        top = Math.max(margin, top);

        tooltip.style.left = `${Math.round(left)}px`;
        tooltip.style.top = `${Math.round(top)}px`;
    }

    function hideTooltip() {
        if (tooltip) tooltip.classList.remove('visible');
    }

    function applyPayload(payload) {
        activeYear = payload.year;
        const dayMap = new Map();
        (payload.days || []).forEach((d) => dayMap.set(d.date, d));

        const days = buildCalendar(payload.year, dayMap);
        renderYears();
        renderMonths(days);
        renderGrid(days);

        if (summaryEl) summaryEl.textContent = (payload.active_days || 0).toLocaleString();
        if (totalEl) totalEl.textContent = (payload.total_streams || 0).toLocaleString();
        grid.setAttribute('aria-label', `Listening activity heatmap for ${payload.year}`);
    }

    function renderEmpty() {
        const year = activeYear || new Date().getFullYear();
        const days = buildCalendar(year, new Map());
        renderMonths(days);
        renderGrid(days);
        if (summaryEl) summaryEl.textContent = '0';
        if (totalEl) totalEl.textContent = '0';
    }

    async function loadYear(year, force) {
        if (isFetching) return;
        if (year && cache.has(year) && !force) {
            applyPayload(cache.get(year));
            return;
        }

        isFetching = true;
        grid.style.opacity = '0.5';
        try {
            const qs = year ? `?year=${encodeURIComponent(year)}` : '';
            const res = await fetcher(`/api/metrics/heatmap${qs}`, {}, 6000);

            if (res.ok && res.data && res.data.status === 'ok' && res.data.year != null) {
                years = res.data.years || years;
                cache.set(res.data.year, res.data);
                applyPayload(res.data);
            } else {
                renderEmpty();
            }
        } finally {
            grid.style.opacity = '1';
            isFetching = false;
        }
    }

    function reload() {
        cache.clear();
        loadYear(activeYear, true);
    }

    const overviewView = document.getElementById('view-overview');
    if (!overviewView || !overviewView.classList.contains('hidden')) {
        loadYear();
    }

    window.addEventListener('rewind:data-updated', reload);
})();
