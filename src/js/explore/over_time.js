// Chapter 08 — Your Music, Over Time: per-year highlights (interactive year
// selector), music age (new vs catalog), oldest/newest tracks, and a nostalgia
// trend of average release year over the listening timeline (with hover).
(function (E) {
    'use strict';
    const { esc, setText, coverCell, loadCovers, showTip, moveTip, hideTip, attr } = E;

    const state = { years: [], activeYear: null, nostalgia: [], nostalgiaPts: null };

    const SAMPLE_OVER_TIME = {
        years: [
            { year: 2022, top_artist: { name: 'Drake' }, top_track: { name: 'Jimmy Cooks', artist: 'Drake' }, summer_track: { name: 'First Class', artist: 'Jack Harlow' } },
            { year: 2023, top_artist: { name: 'SZA' }, top_track: { name: 'Kill Bill', artist: 'SZA' }, summer_track: { name: 'Snooze', artist: 'SZA' } },
            { year: 2024, top_artist: { name: 'SZA' }, top_track: { name: 'Nobody Gets Me', artist: 'SZA' }, summer_track: { name: 'Good Days', artist: 'SZA' } },
            { year: 2025, top_artist: { name: 'J. Cole' }, top_track: { name: 'a m a r i', artist: 'J. Cole' }, summer_track: { name: 'Calm Down', artist: 'Rema' } },
        ],
        music_age: { fresh_share: 0.58, avg_year: 2019 },
        time_machine: {
            oldest: { name: "Ain't No Sunshine", artist: 'Bill Withers', year: 1971 },
            newest: { name: 'a m a r i', artist: 'J. Cole', year: 2025 },
        },
        nostalgia: [
            { period: '2022', avg_year: 2018 },
            { period: '2023', avg_year: 2019 },
            { period: '2024', avg_year: 2020 },
            { period: '2025', avg_year: 2021 },
        ],
    };

    /* ---- Year selector ---- */
    function renderYearTabs() {
        const el = document.getElementById('year-tabs');
        if (!el) return;
        el.innerHTML = state.years
            .map((y) => '<button type="button" class="year-tab px-3 py-1 rounded-full text-label-bold font-label-bold whitespace-nowrap' +
                (y.year === state.activeYear ? ' year-tab--active' : '') +
                '" data-year="' + y.year + '" aria-pressed="' + (y.year === state.activeYear) + '">' + y.year + '</button>')
            .join('');
    }

    function highlightRow(label, name, sub, id, kind) {
        return '<div class="gem-row flex items-center gap-3 p-2 rounded-lg">' +
            coverCell(id, kind) +
            '<div class="min-w-0 flex-1">' +
            '<div class="font-label-bold text-[10px] uppercase tracking-wider text-on-surface-variant opacity-60">' + esc(label) + '</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(name) + '</div>' +
            (sub ? '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(sub) + '</div>' : '') +
            '</div></div>';
    }
    function renderYearHighlights() {
        const el = document.getElementById('year-highlights');
        if (!el) return;
        const y = state.years.find((item) => item.year === state.activeYear);
        if (!y) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">No plays this year.</p>';
            return;
        }
        const artist = y.top_artist || {};
        const track = y.top_track || {};
        const summer = y.summer_track || {};
        el.innerHTML =
            highlightRow('Top artist', artist.name || '—', '', artist.id, 'artist') +
            highlightRow('Top track', track.name || '—', track.artist || '', track.id, 'track') +
            highlightRow('Song of summer', summer.name || '—', summer.artist || '', summer.id, 'track');
        loadCovers(el);
    }

    /* ---- Music age ---- */
    function ageWord(share) {
        return share >= 0.6 ? 'Fresh' : share >= 0.35 ? 'A mix' : 'Throwback';
    }
    function renderMusicAge(age) {
        const fresh = Math.round(Math.max(0, Math.min(1, Number(age.fresh_share) || 0)) * 100);
        setText('age-word', ageWord((Number(age.fresh_share) || 0)));
        setText('age-fresh-pct', fresh);
        setText('age-catalog-pct', 100 - fresh);
        setText('age-avg-year', age.avg_year || '—');
        const bar = document.getElementById('age-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + fresh + '%;background:rgb(30,215,96)"></div>' +
                '<div style="width:' + (100 - fresh) + '%;background:rgba(30,215,96,0.28)"></div>';
        }
    }

    /* ---- Time machine ---- */
    function machineRow(label, item) {
        return '<div class="gem-row flex items-center gap-3 p-2 rounded-lg">' +
            coverCell(item.id, 'track') +
            '<div class="min-w-0 flex-1">' +
            '<div class="font-label-bold text-[10px] uppercase tracking-wider text-on-surface-variant opacity-60">' + esc(label) + '</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(item.name || '—') + '</div>' +
            '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(item.artist || '') + '</div>' +
            '</div><span class="font-mono text-[11px] text-primary shrink-0">' + (item.year || '—') + '</span></div>';
    }
    function renderTimeMachine(machine) {
        const el = document.getElementById('time-machine-list');
        if (!el) return;
        const oldest = machine.oldest;
        const newest = machine.newest;
        if (!oldest && !newest) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">No release years yet.</p>';
            return;
        }
        el.innerHTML = (oldest ? machineRow('Oldest', oldest) : '') + (newest ? machineRow('Newest', newest) : '');
        loadCovers(el);
    }

    /* ---- Nostalgia trend ---- */
    function nostalgiaWord(points) {
        if (points.length < 2) return 'Steady';
        const drift = points[points.length - 1].avg_year - points[0].avg_year;
        return drift >= 2 ? 'Going newer' : drift <= -2 ? 'Going older' : 'Steady';
    }
    function renderNostalgia(points) {
        state.nostalgia = points;
        const svg = document.getElementById('nostalgia-svg');
        if (!svg) return;
        setText('nostalgia-word', points.length ? nostalgiaWord(points) : '—');
        if (points.length < 2) {
            svg.innerHTML = '';
            state.nostalgiaPts = null;
            return;
        }
        const W = 320, H = 110, pad = 10;
        const years = points.map((p) => p.avg_year);
        const min = Math.min.apply(null, years);
        const max = Math.max.apply(null, years);
        const span = (max - min) || 1;
        const step = (W - pad * 2) / (points.length - 1);
        const pts = points.map((p, i) => {
            const x = pad + i * step;
            const y = pad + (1 - (p.avg_year - min) / span) * (H - pad * 2);
            return [x, y];
        });
        state.nostalgiaPts = pts;
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        const last = pts[pts.length - 1];
        const first = pts[0];
        const area = line + ' L' + last[0].toFixed(1) + ' ' + (H - pad) + ' L' + first[0].toFixed(1) + ' ' + (H - pad) + ' Z';
        let hits = '';
        for (let i = 0; i < points.length; i++) {
            const x = pad + i * step - step / 2;
            hits += '<rect class="nostalgia-hit" data-n="' + i + '" x="' + x.toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + H + '" fill="transparent" />';
        }
        svg.innerHTML =
            '<defs><linearGradient id="nostalgia-fill" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="rgb(30,215,96)" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="rgb(30,215,96)" stop-opacity="0"/>' +
            '</linearGradient></defs>' +
            '<path d="' + area + '" fill="url(#nostalgia-fill)"/>' +
            '<path d="' + line + '" fill="none" stroke="rgb(30,215,96)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<line id="nostalgia-vline" x1="0" y1="0" x2="0" y2="' + H + '" stroke="rgb(30,215,96)" stroke-opacity="0.3" stroke-width="1" style="opacity:0" />' +
            '<circle id="nostalgia-dot" r="4.5" fill="#fff" stroke="rgb(30,215,96)" stroke-width="2.5" style="opacity:0" />' +
            hits;
    }
    function showNostalgiaPoint(i) {
        const pts = state.nostalgiaPts;
        if (!pts || !pts[i]) return;
        const dot = document.getElementById('nostalgia-dot');
        const vline = document.getElementById('nostalgia-vline');
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
    function hideNostalgiaPoint() {
        const dot = document.getElementById('nostalgia-dot');
        const vline = document.getElementById('nostalgia-vline');
        if (dot) dot.style.opacity = '0';
        if (vline) vline.style.opacity = '0';
    }

    function renderOverTime(data) {
        state.years = Array.isArray(data.years) ? data.years : [];
        state.activeYear = state.years.length ? state.years[state.years.length - 1].year : null;
        renderYearTabs();
        renderYearHighlights();
        renderMusicAge(data.music_age || {});
        renderTimeMachine(data.time_machine || {});
        renderNostalgia(data.nostalgia || []);
    }
    async function fetchOverTime() {
        if (!document.getElementById('year-tabs')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/over-time');
                if (res && res.ok && res.data && Array.isArray(res.data.years) && res.data.years.length) {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('over-time', false); renderOverTime(SAMPLE_OVER_TIME); return; }
            E.chapterEmpty('over-time', true);
            return;
        }
        E.chapterEmpty('over-time', false);
        renderOverTime(data);
    }

    /* ---- Interactivity (year selector + nostalgia hover) ---- */
    function setupHover() {
        const tabs = document.getElementById('year-tabs');
        if (tabs) {
            tabs.addEventListener('click', (e) => {
                const btn = e.target.closest ? e.target.closest('[data-year]') : null;
                if (!btn) return;
                state.activeYear = +btn.getAttribute('data-year');
                renderYearTabs();
                renderYearHighlights();
            });
        }

        const svg = document.getElementById('nostalgia-svg');
        if (svg) {
            svg.addEventListener('mouseover', (e) => {
                const a = attr(e.target, 'data-n');
                if (a == null) return;
                const i = +a;
                const point = state.nostalgia[i];
                if (!point) return;
                showNostalgiaPoint(i);
                showTip(point.period, 'Avg release ' + point.avg_year, e.clientX, e.clientY);
            });
            svg.addEventListener('mousemove', (e) => {
                if (attr(e.target, 'data-n') != null) moveTip(e.clientX, e.clientY);
            });
            svg.addEventListener('mouseout', (e) => {
                if (attr(e.target, 'data-n') == null) return;
                if (attr(e.relatedTarget, 'data-n') == null) {
                    hideNostalgiaPoint();
                    hideTip();
                }
            });
        }
    }

    E.chapters.push({ fetch: fetchOverTime, hover: setupHover });
})(window.RewindExplore);
