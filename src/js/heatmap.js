/**
 * Rewind Listening Activity Heatmap Module
 * Renders GitHub-style activity heatmaps with yearly breakdown & hover tooltips.
 */
(function initHeatmap() {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const grid = document.getElementById('heatmap-grid');
    const monthsEl = document.getElementById('heatmap-months');
    const tooltip = document.getElementById('heatmap-tooltip');
    const summaryEl = document.getElementById('heatmap-summary');
    const totalEl = document.getElementById('heatmap-total');
    const yearBtns = document.querySelectorAll('.heatmap-year-btn');
    let activeYear = 2024;

    if (!grid || !monthsEl) return;

    function seededRandom(seed) {
        let s = seed % 2147483647;
        if (s <= 0) s += 2147483646;
        return () => (s = (s * 16807) % 2147483647) / 2147483647;
    }

    function countToLevel(count) {
        if (count === 0) return 0;
        if (count <= 8) return 1;
        if (count <= 20) return 2;
        if (count <= 40) return 3;
        return 4;
    }

    function formatDate(date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    function generateYearData(year) {
        const rand = seededRandom(year * 9973);
        const start = new Date(year, 0, 1);
        const end = year === new Date().getFullYear()
            ? new Date()
            : new Date(year, 11, 31);

        start.setDate(start.getDate() - start.getDay());

        const days = [];
        const cursor = new Date(start);

        while (cursor <= end || days.length % 7 !== 0) {
            const inRange = cursor >= new Date(year, 0, 1) && cursor <= end;
            let count = 0;

            if (inRange) {
                const dow = cursor.getDay();
                const month = cursor.getMonth();
                const isWeekend = dow === 0 || dow === 6;
                const base = isWeekend ? 0.35 : 0.72;
                const seasonal = 0.85 + Math.sin((month / 11) * Math.PI) * 0.25;

                if (rand() < base * seasonal) {
                    count = Math.floor(rand() * rand() * 55) + 1;
                    if (rand() > 0.92) count += Math.floor(rand() * 30);
                }
            }

            days.push({
                date: new Date(cursor),
                count,
                inRange,
                padding: !inRange || cursor > end
            });
            cursor.setDate(cursor.getDate() + 1);
        }

        return days;
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

        let activeDays = 0;
        let totalStreams = 0;

        days.forEach((day) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'heatmap-cell';
            cell.dataset.level = String(countToLevel(day.count));

            if (day.padding) {
                cell.dataset.future = 'true';
                cell.tabIndex = -1;
                cell.setAttribute('aria-hidden', 'true');
            } else {
                if (day.count > 0) {
                    activeDays += 1;
                    totalStreams += day.count;
                }
                cell.setAttribute('aria-label', `${formatDate(day.date)}: ${day.count} streams`);
                cell.addEventListener('mouseenter', (e) => showTooltip(e, day));
                cell.addEventListener('focus', (e) => showTooltip(e, day));
                cell.addEventListener('mouseleave', hideTooltip);
                cell.addEventListener('blur', hideTooltip);
            }

            grid.appendChild(cell);
        });

        if (summaryEl) summaryEl.textContent = activeDays.toLocaleString();
        if (totalEl) totalEl.textContent = totalStreams.toLocaleString();
    }

    function showTooltip(e, day) {
        if (!tooltip) return;
        const rect = e.target.getBoundingClientRect();
        const mins = Math.round(day.count * 3.2);
        tooltip.innerHTML = day.count === 0
            ? `<strong>${formatDate(day.date)}</strong><br>No streams`
            : `<strong>${formatDate(day.date)}</strong><br><span class="count">${day.count}</span> streams · ~${mins} min`;
        tooltip.classList.add('visible');
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top}px`;
    }

    function hideTooltip() {
        if (tooltip) tooltip.classList.remove('visible');
    }

    function render(year) {
        activeYear = year;
        const days = generateYearData(year);
        renderMonths(days);
        renderGrid(days);

        yearBtns.forEach((btn) => {
            const selected = Number(btn.dataset.year) === year;
            btn.classList.toggle('bg-primary', selected);
            btn.classList.toggle('text-on-primary', selected);
            btn.classList.toggle('text-on-surface-variant', !selected);
        });

        grid.setAttribute('aria-label', `Listening activity heatmap for ${year}`);
    }

    yearBtns.forEach((btn) => {
        btn.addEventListener('click', () => render(Number(btn.dataset.year)));
    });

    render(activeYear);
})();
