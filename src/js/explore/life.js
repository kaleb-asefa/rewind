// Chapter 07 — Your Listening Life: biggest day/week/month peaks, session pace,
// and play-count milestones on a timeline (with hover).
(function (E) {
    'use strict';
    const { fmtMins, esc, setText, showTip, moveTip, hideTip } = E;

    const lifeState = { milestones: [] };

    const SAMPLE_LISTENING_LIFE = {
        peaks: [
            { label: 'Day', minutes: 429, period: 'February 11, 2024' },
            { label: 'Week', minutes: 2114, period: 'February 5-11, 2024' },
            { label: 'Month', minutes: 7080, period: 'February 2024' },
        ],
        typical_session_minutes: 41,
        session_mix: [
            { label: 'Under 15m', share: 0.27 },
            { label: '15-30m', share: 0.31 },
            { label: '30-60m', share: 0.26 },
            { label: 'Over 1h', share: 0.16 },
        ],
        milestones: [
            { target: 1000, date: 'May 2023', track: 'Snooze', artist: 'SZA' },
            { target: 5000, date: 'October 2023', track: 'Good Days', artist: 'SZA' },
            { target: 10000, date: 'June 2024', track: 'Lost Me', artist: 'Giveon' },
        ],
    };

    function milestoneLabel(n) {
        return n >= 1000 ? Math.round(n / 1000) + 'K' : n.toLocaleString();
    }
    function renderLifePeaks(peaks) {
        const el = document.getElementById('life-peaks');
        if (!el) return;
        el.innerHTML = peaks.slice(0, 3).map((item, index) =>
            '<div class="life-peak ' + (index ? 'sm:border-l sm:border-white/10 sm:pl-6' : '') + '">' +
            '<div class="font-label-bold text-label-bold uppercase tracking-wider text-on-surface-variant opacity-70">Biggest ' + esc(item.label) + '</div>' +
            '<div class="font-display-lg text-display-lg-mobile text-primary leading-tight mt-2">' + fmtMins(item.minutes || 0) + '</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface-variant opacity-75 mt-1 truncate">' + esc(item.period || '') + '</div></div>'
        ).join('');
    }
    function renderSessionPace(minutes, mix) {
        setText('life-session-value', fmtMins(minutes || 0));
        const el = document.getElementById('life-session-mix');
        if (!el) return;
        const max = Math.max.apply(null, mix.map((item) => item.share).concat(0.01));
        el.innerHTML = mix.slice(0, 4).map((item) => {
            const width = Math.max(6, Math.round((item.share / max) * 100));
            return '<div><div class="flex items-center justify-between gap-3 mb-1">' +
                '<span class="font-body-sm text-[11px] text-on-surface-variant">' + esc(item.label) + '</span>' +
                '<span class="font-mono text-[10px] text-on-surface-variant">' + Math.round(item.share * 100) + '%</span></div>' +
                '<div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden"><div class="h-full rounded-full bg-primary/60" style="width:' + width + '%"></div></div></div>';
        }).join('');
    }
    function renderMilestones(milestones) {
        const el = document.getElementById('life-milestones');
        if (!el) return;
        lifeState.milestones = milestones;
        if (!milestones.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">Milestones appear as you listen.</p>';
            return;
        }
        el.innerHTML = '<div class="relative grid grid-cols-' + milestones.length + ' gap-4 w-full">' +
            (milestones.length > 1 ? '<div class="life-milestone-line absolute left-[16.667%] right-[16.667%] top-[9px]"></div>' : '') +
            milestones.map((item, index) =>
                '<div class="life-milestone relative cursor-pointer min-w-0" data-milestone="' + index + '">' +
                '<div class="life-milestone-dot w-5 h-5 rounded-full bg-primary border-4 border-surface-container-high shadow mx-auto sm:mx-0"></div>' +
                '<div class="font-display-lg text-display-lg-mobile text-on-surface leading-tight mt-5 text-center sm:text-left">' + milestoneLabel(item.target || 0) + '</div>' +
                '<div class="font-label-bold text-label-bold uppercase tracking-wider text-primary mt-1 text-center sm:text-left">plays</div>' +
                '<div class="font-body-sm text-body-sm text-on-surface-variant opacity-75 mt-2 text-center sm:text-left truncate">' + esc(item.date || '') + '</div></div>'
            ).join('') + '</div>';
    }
    function renderListeningLife(data) {
        renderLifePeaks(data.peaks || []);
        renderSessionPace(data.typical_session_minutes, data.session_mix || []);
        renderMilestones(data.milestones || []);
    }
    async function fetchListeningLife() {
        if (!document.getElementById('life-peaks')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/listening-life');
                if (res && res.ok && res.data && Array.isArray(res.data.peaks) && res.data.peaks.length) {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('listening-life', false); renderListeningLife(SAMPLE_LISTENING_LIFE); return; }
            E.chapterEmpty('listening-life', true);
            return;
        }
        E.chapterEmpty('listening-life', false);
        renderListeningLife(data);
    }

    /* ---- Hover (milestones) ---- */
    function setupHover() {
        const milestones = document.getElementById('life-milestones');
        if (!milestones) return;
        const markerOf = (target) => (target && target.closest ? target.closest('[data-milestone]') : null);
        milestones.addEventListener('mouseover', (e) => {
            const marker = markerOf(e.target);
            if (!marker) return;
            const item = lifeState.milestones[+marker.getAttribute('data-milestone')];
            if (!item) return;
            showTip(item.track || ((item.target || 0).toLocaleString() + ' plays'), item.artist ? item.artist + ' · ' + item.date : item.date, e.clientX, e.clientY);
        });
        milestones.addEventListener('mousemove', (e) => { if (markerOf(e.target)) moveTip(e.clientX, e.clientY); });
        milestones.addEventListener('mouseout', (e) => {
            const marker = markerOf(e.target);
            if (marker && marker.contains(e.relatedTarget)) return;
            hideTip();
        });
    }

    E.chapters.push({ fetch: fetchListeningLife, hover: setupHover });
})(window.RewindExplore);
