// Chapter 09 — How Your Taste Changes: genre mix over time (stacked columns),
// mood drift and mainstream-pull trend lines, and a day-vs-night sound compare.
// All hoverable; frontend-only until GET /api/metrics/evolution exists.
(function (E) {
    'use strict';
    const { esc, setText, showTip, moveTip, hideTip, attr } = E;

    const state = {
        genreEvo: { periods: [], genres: [] },
        mood: { points: [], pts: [] },
        main: { points: [], pts: [] },
    };

    const GENRE_SHADES = [
        'var(--genre-1)',
        'var(--genre-2)',
        'var(--genre-3)',
        'var(--genre-4)',
        'var(--genre-5)',
        'var(--genre-6)',
    ];

    const SAMPLE_EVOLUTION = {
        genre_evolution: {
            periods: ['2022', '2023', '2024', '2025'],
            genres: [
                { name: 'Hip-Hop', shares: [0.42, 0.38, 0.34, 0.30] },
                { name: 'R&B', shares: [0.20, 0.26, 0.31, 0.34] },
                { name: 'Pop', shares: [0.24, 0.20, 0.18, 0.16] },
                { name: 'Afrobeats', shares: [0.06, 0.08, 0.10, 0.13] },
                { name: 'Other', shares: [0.08, 0.08, 0.07, 0.07] },
            ],
        },
        mood_trend: [
            { period: '2022', valence: 0.52 },
            { period: '2023', valence: 0.48 },
            { period: '2024', valence: 0.44 },
            { period: '2025', valence: 0.46 },
        ],
        day_night: { morning: { energy: 0.42 }, night: { energy: 0.63 } },
        mainstream_trend: [
            { period: '2022', popularity: 0.72 },
            { period: '2023', popularity: 0.68 },
            { period: '2024', popularity: 0.64 },
            { period: '2025', popularity: 0.60 },
        ],
    };

    /* ---- Genre mix over time (100% stacked columns) ---- */
    function renderGenreEvolution(evo) {
        const periods = evo.periods || [];
        const genres = evo.genres || [];
        state.genreEvo = { periods, genres };
        const svg = document.getElementById('genre-evo-svg');
        const legend = document.getElementById('genre-evo-legend');
        if (!svg) return;
        if (!periods.length || !genres.length) {
            svg.innerHTML = '';
            if (legend) legend.innerHTML = '';
            return;
        }
        const W = 320, H = 176, padX = 6, padTop = 8, padBottom = 24;
        const plotH = H - padTop - padBottom;
        const colW = (W - padX * 2) / periods.length;
        const barW = Math.min(46, colW * 0.62);
        let rects = '';
        let labels = '';
        periods.forEach((period, j) => {
            const x = padX + j * colW + (colW - barW) / 2;
            const total = genres.reduce((s, g) => s + (g.shares[j] || 0), 0) || 1;
            let y = padTop + plotH;
            genres.forEach((g, i) => {
                const segH = ((g.shares[j] || 0) / total) * plotH;
                y -= segH;
                rects += '<rect class="genre-evo-seg" data-g="' + i + '" data-p="' + j + '" x="' + x.toFixed(1) +
                    '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, segH).toFixed(1) +
                    '" fill="' + GENRE_SHADES[i % GENRE_SHADES.length] + '" />';
            });
            labels += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) +
                '" fill="var(--axis-label)" font-size="10" text-anchor="middle">' + esc(period) + '</text>';
        });
        svg.innerHTML = rects + labels;
        if (legend) {
            legend.innerHTML = genres
                .map((g, i) => '<span class="inline-flex items-center gap-1.5"><span style="width:9px;height:9px;border-radius:3px;background:' +
                    GENRE_SHADES[i % GENRE_SHADES.length] + '"></span>' + esc(g.name) + '</span>')
                .join('');
        }
    }

    /* ---- Shared sparkline (line + area + hidden dot + hit rects) ---- */
    function lineChart(points, accessor, W, H) {
        const pad = 8;
        const vals = points.map(accessor);
        const min = Math.min.apply(null, vals);
        const max = Math.max.apply(null, vals);
        const span = (max - min) || 1;
        const step = (W - pad * 2) / ((points.length - 1) || 1);
        const pts = points.map((p, i) => {
            const x = pad + i * step;
            const y = pad + (1 - (accessor(p) - min) / span) * (H - pad * 2);
            return [x, y];
        });
        const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        const area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - pad) +
            ' L' + pts[0][0].toFixed(1) + ' ' + (H - pad) + ' Z';
        let hits = '';
        for (let i = 0; i < points.length; i++) {
            const x = pad + i * step - step / 2;
            hits += '<rect class="evo-hit" data-i="' + i + '" x="' + x.toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + H + '" fill="transparent" />';
        }
        const html =
            '<path d="' + area + '" fill="rgba(var(--accent-rgb), 0.14)"/>' +
            '<path d="' + line + '" fill="none" stroke="rgb(var(--accent-rgb))" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<circle class="evo-dot" r="4" fill="var(--emphasis)" stroke="rgb(var(--accent-rgb))" stroke-width="2.5" style="opacity:0"/>' +
            hits;
        return { pts, html };
    }

    function renderTrend(cfg) {
        setText(cfg.wordId, cfg.points.length ? cfg.word(cfg.points) : '—');
        const svg = document.getElementById(cfg.svgId);
        if (!svg) return;
        if (cfg.points.length < 2) {
            svg.innerHTML = '';
            cfg.store.pts = [];
            return;
        }
        const c = lineChart(cfg.points, cfg.accessor, 200, 72);
        cfg.store.points = cfg.points;
        cfg.store.pts = c.pts;
        svg.innerHTML = c.html;
    }

    function moodWord(points) {
        const drift = points[points.length - 1].valence - points[0].valence;
        return drift >= 0.05 ? 'Happier' : drift <= -0.05 ? 'Moodier' : 'Steady';
    }
    function mainstreamWord(points) {
        const drift = points[points.length - 1].popularity - points[0].popularity;
        return drift >= 0.05 ? 'Going mainstream' : drift <= -0.05 ? 'Going niche' : 'Steady';
    }

    /* ---- Day vs night sound ---- */
    function energyWord(e) {
        return e >= 0.6 ? 'Energetic' : e >= 0.4 ? 'Easy' : 'Calm';
    }
    function renderDayNight(dn) {
        const el = document.getElementById('day-night');
        if (!el) return;
        const parts = [
            { icon: 'wb_sunny', label: 'Mornings', energy: (dn.morning && dn.morning.energy) || 0 },
            { icon: 'bedtime', label: 'Late nights', energy: (dn.night && dn.night.energy) || 0 },
        ];
        el.innerHTML = parts
            .map((p) => {
                const width = Math.round(Math.max(0, Math.min(1, p.energy)) * 100);
                return '<div class="flex-1 min-w-0">' +
                    '<div class="flex items-center gap-2 mb-3"><span class="material-symbols-outlined text-primary text-lg">' + p.icon + '</span>' +
                    '<span class="font-body-sm text-body-sm text-on-surface">' + p.label + '</span></div>' +
                    '<div class="font-display-lg text-display-lg-mobile text-primary leading-tight">' + energyWord(p.energy) + '</div>' +
                    '<div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden mt-3"><div class="h-full rounded-full bg-primary" style="width:' + width + '%"></div></div>' +
                    '</div>';
            })
            .join('');
    }

    function renderEvolution(data) {
        renderGenreEvolution(data.genre_evolution || { periods: [], genres: [] });
        renderTrend({ points: data.mood_trend || [], accessor: (p) => p.valence, wordId: 'mood-drift-word', svgId: 'mood-drift-svg', word: moodWord, store: state.mood });
        renderDayNight(data.day_night || {});
        renderTrend({ points: data.mainstream_trend || [], accessor: (p) => p.popularity, wordId: 'mainstream-word', svgId: 'mainstream-svg', word: mainstreamWord, store: state.main });
    }
    async function fetchEvolution() {
        if (!document.getElementById('genre-evo-svg')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/evolution');
                if (res && res.ok && res.data && res.data.genre_evolution &&
                    Array.isArray(res.data.genre_evolution.genres) && res.data.genre_evolution.genres.length) {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('evolution', false); renderEvolution(SAMPLE_EVOLUTION); return; }
            E.chapterEmpty('evolution', true);
            return;
        }
        E.chapterEmpty('evolution', false);
        renderEvolution(data);
    }

    /* ---- Hover ---- */
    function wireSparkline(svgId, getStore, fmt) {
        const svg = document.getElementById(svgId);
        if (!svg) return;
        svg.addEventListener('mouseover', (e) => {
            const a = attr(e.target, 'data-i');
            if (a == null) return;
            const store = getStore();
            const point = store.points[+a];
            const pt = store.pts[+a];
            if (!point) return;
            const dot = svg.querySelector('.evo-dot');
            if (dot && pt) {
                dot.setAttribute('cx', pt[0].toFixed(1));
                dot.setAttribute('cy', pt[1].toFixed(1));
                dot.style.opacity = '1';
            }
            showTip(point.period, fmt(point), e.clientX, e.clientY);
        });
        svg.addEventListener('mousemove', (e) => {
            if (attr(e.target, 'data-i') != null) moveTip(e.clientX, e.clientY);
        });
        svg.addEventListener('mouseout', (e) => {
            if (attr(e.target, 'data-i') == null) return;
            if (attr(e.relatedTarget, 'data-i') == null) {
                const dot = svg.querySelector('.evo-dot');
                if (dot) dot.style.opacity = '0';
                hideTip();
            }
        });
    }
    function setupHover() {
        const evo = document.getElementById('genre-evo-svg');
        if (evo) {
            const segOf = (t) => (t && t.closest ? t.closest('[data-g]') : null);
            evo.addEventListener('mouseover', (e) => {
                const seg = segOf(e.target);
                if (!seg) return;
                const gi = +seg.getAttribute('data-g');
                const pi = +seg.getAttribute('data-p');
                const g = state.genreEvo.genres[gi];
                const period = state.genreEvo.periods[pi];
                if (!g || period == null) return;
                const total = state.genreEvo.genres.reduce((s, x) => s + (x.shares[pi] || 0), 0) || 1;
                showTip(g.name, period + ' · ' + Math.round(((g.shares[pi] || 0) / total) * 100) + '%', e.clientX, e.clientY);
            });
            evo.addEventListener('mousemove', (e) => { if (segOf(e.target)) moveTip(e.clientX, e.clientY); });
            evo.addEventListener('mouseout', (e) => {
                const seg = segOf(e.target);
                if (seg && seg.contains(e.relatedTarget)) return;
                hideTip();
            });
        }
        wireSparkline('mood-drift-svg', () => state.mood, (p) => Math.round(p.valence * 100) + '% positive');
        wireSparkline('mainstream-svg', () => state.main, (p) => Math.round(p.popularity * 100) + '% popular');
    }

    E.chapters.push({ fetch: fetchEvolution, hover: setupHover });
})(window.RewindExplore);
