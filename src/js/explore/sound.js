// Chapter 03 — Your Sound: mood map (valence × energy), vibe sliders, pace gauge.
// computeVibe / renderMoodMix / renderPlainWords are retained but unused (their
// DOM was removed in the declutter pass); kept for when mood-mix may be rewired.
(function (E) {
    'use strict';
    const { pct, setText, showTip, moveTip, hideTip, attr } = E;

    const soundState = { tracks: [], mix: [] };

    const SAMPLE_SOUND = {
        avg: { energy: 0.5, valence: 0.55, danceability: 0.68, acousticness: 0.3, vocal: 0.9 },
        tempo_avg: 118,
        mode: { major: 0.57 },
        tracks: [
            { name: 'Snooze', valence: 0.42, energy: 0.45, plays: 120 },
            { name: 'Kill Bill', valence: 0.55, energy: 0.52, plays: 150 },
            { name: 'No Role Modelz', valence: 0.5, energy: 0.62, plays: 110 },
            { name: 'Nobody Gets Me', valence: 0.22, energy: 0.28, plays: 95 },
            { name: 'Redbone', valence: 0.63, energy: 0.4, plays: 80 },
            { name: 'Marvins Room', valence: 0.2, energy: 0.35, plays: 70 },
            { name: 'Runaway', valence: 0.3, energy: 0.55, plays: 88 },
            { name: 'Best Part', valence: 0.58, energy: 0.3, plays: 76 },
            { name: 'HUMBLE.', valence: 0.52, energy: 0.82, plays: 130 },
            { name: 'Good Days', valence: 0.6, energy: 0.48, plays: 140 },
            { name: 'Pursuit of Happiness', valence: 0.35, energy: 0.7, plays: 60 },
            { name: 'Sunflower', valence: 0.78, energy: 0.6, plays: 105 },
            { name: 'Location', valence: 0.48, energy: 0.42, plays: 98 },
            { name: 'Passionfruit', valence: 0.66, energy: 0.5, plays: 112 },
        ],
    };

    // Neutral split at 0.5 — the backend already de-inflates R&B/soul 'energy'
    // (genre-specific), so raising the threshold here isn't needed.
    const EN_MID = 0.5;
    const VAL_MID = 0.5;
    // Friendly one-word mood for a (positivity, energy) pair.
    function moodZone(v, e) {
        if (e >= EN_MID) return v >= VAL_MID ? 'Pumped' : 'Intense';
        return v >= VAL_MID ? 'Chill' : 'Moody';
    }
    function computeVibe(tracks) {
        let sv = 0, se = 0, sp = 0;
        const counts = { Pumped: 0, Intense: 0, Chill: 0, Moody: 0 };
        tracks.forEach((t) => {
            sv += t.valence * t.plays; se += t.energy * t.plays; sp += t.plays;
            counts[moodZone(t.valence, t.energy)] += t.plays;
        });
        sp = sp || 1;
        const zone = moodZone(sv / sp, se / sp);
        const mix = [
            { key: 'Chill', label: 'Feel-good', pct: Math.round((counts.Chill / sp) * 100) },
            { key: 'Pumped', label: 'Upbeat', pct: Math.round((counts.Pumped / sp) * 100) },
            { key: 'Moody', label: 'Moody', pct: Math.round((counts.Moody / sp) * 100) },
            { key: 'Intense', label: 'Intense', pct: Math.round((counts.Intense / sp) * 100) },
        ];
        return { zone, mix };
    }

    /* Mood map: positivity (x) × energy (y), dot size by plays, ring = your average. */
    function renderMood(tracks, sweet, center) {
        soundState.tracks = tracks;
        const svg = document.getElementById('mood-svg');
        if (!svg) return;
        const S = 320, pad = 40, plot = S - pad * 2, mid = S / 2;
        const px = (v) => pad + v * plot;
        const py = (e) => pad + (1 - e) * plot;
        const maxPlays = Math.max.apply(null, tracks.map((t) => t.plays).concat(1));
        let g = '';
        g += '<rect x="' + pad + '" y="' + pad + '" width="' + plot + '" height="' + plot + '" rx="14" fill="none" stroke="var(--grid-line)"/>';
        g += '<line x1="' + pad + '" y1="' + py(EN_MID).toFixed(1) + '" x2="' + (S - pad) + '" y2="' + py(EN_MID).toFixed(1) + '" stroke="var(--grid-line-strong)"/>';
        g += '<line x1="' + px(VAL_MID).toFixed(1) + '" y1="' + pad + '" x2="' + px(VAL_MID).toFixed(1) + '" y2="' + (S - pad) + '" stroke="var(--grid-line-strong)"/>';
        const zl = (x, y, anchor, txt) => '<text x="' + x + '" y="' + y + '" fill="var(--axis-label)" font-size="10" font-weight="700" text-anchor="' + anchor + '" letter-spacing="0.05em">' + txt + '</text>';
        g += zl(pad + 8, pad + 16, 'start', 'INTENSE');
        g += zl(S - pad - 8, pad + 16, 'end', 'PUMPED');
        g += zl(pad + 8, S - pad - 9, 'start', 'IN MY FEELS');
        g += zl(S - pad - 8, S - pad - 9, 'end', 'CHILL');
        g += '<text x="' + mid + '" y="' + (S - 12) + '" fill="var(--axis-label)" font-size="9" font-weight="600" text-anchor="middle">SAD  →  HAPPY</text>';
        g += '<text x="14" y="' + mid + '" fill="var(--axis-label)" font-size="9" font-weight="600" text-anchor="middle" transform="rotate(-90 14 ' + mid + ')">CALM  →  ENERGETIC</text>';
        let dots = '';
        tracks.forEach((t, i) => {
            const r = 4 + (t.plays / maxPlays) * 7;
            dots += '<circle class="mood-dot" data-t="' + i + '" cx="' + px(t.valence).toFixed(1) + '" cy="' + py(t.energy).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="rgb(var(--accent-rgb))" fill-opacity="0.75"/>';
        });
        let sv = 0, se = 0, sp = 0;
        tracks.forEach((t) => { sv += t.valence * t.plays; se += t.energy * t.plays; sp += t.plays; });
        sp = sp || 1;
        const ringV = center && typeof center.v === 'number' ? center.v : sv / sp;
        const ringE = center && typeof center.e === 'number' ? center.e : se / sp;
        const cx = px(ringV), cy = py(ringE);
        const you = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="10" fill="none" stroke="var(--emphasis)" stroke-width="2.5"/>' +
            '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.5" fill="var(--emphasis)"/>';
        svg.innerHTML = g + dots + you;
        setText('mood-sweetspot', sweet);
    }

    const MIX_SHADES = ['rgb(var(--accent-rgb))', 'rgba(var(--accent-rgb), 0.72)', 'rgba(var(--accent-rgb), 0.48)', 'rgba(var(--accent-rgb), 0.3)'];
    function renderMoodMix(mix) {
        const bar = document.getElementById('mood-mix');
        if (!bar) return;
        const sorted = mix.slice().sort((a, b) => b.pct - a.pct).filter((m) => m.pct > 0);
        soundState.mix = sorted;
        bar.innerHTML = sorted
            .map((m, i) => '<div class="mood-seg" data-mix="' + i + '" style="width:' + m.pct + '%;background:' + MIX_SHADES[i] + '"></div>')
            .join('');
        const legend = document.getElementById('mood-mix-legend');
        if (legend) {
            legend.innerHTML = sorted
                .map((m, i) => '<span class="inline-flex items-center gap-1.5"><span style="width:8px;height:8px;border-radius:9999px;background:' + MIX_SHADES[i] + '"></span>' + m.label + ' ' + m.pct + '%</span>')
                .join('');
        }
    }

    // Human spectrum sliders — where taste lands between two everyday words.
    function renderVibe(avg) {
        const el = document.getElementById('vibe-sliders');
        if (!el) return;
        const rows = [
            { l: 'Acoustic', r: 'Produced', v: 1 - avg.acousticness },
            { l: 'Easy listening', r: 'Dancefloor', v: avg.danceability },
            { l: 'Instrumental', r: 'Vocal', v: avg.vocal },
        ];
        el.innerHTML = rows
            .map((row) => {
                const p = Math.round(Math.max(0, Math.min(1, row.v)) * 100);
                return '<div>' +
                    '<div class="flex justify-between text-[11px] text-on-surface-variant mb-1.5"><span>' + row.l + '</span><span>' + row.r + '</span></div>' +
                    '<div class="relative h-1.5 rounded-full bg-surface-container-high">' +
                    '<div class="absolute inset-y-0 left-0 rounded-full bg-primary/30" style="width:' + p + '%"></div>' +
                    '<div class="absolute top-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-primary shadow" style="left:' + p + '%;transform:translate(-50%,-50%)"></div>' +
                    '</div></div>';
            })
            .join('');
    }

    function paceWord(b) {
        return b < 85 ? 'Laid-back' : b < 105 ? 'Easy-going' : b < 125 ? 'Upbeat' : b < 145 ? 'Lively' : 'High-energy';
    }
    function renderPace(bpm) {
        const svg = document.getElementById('pace-svg');
        if (!svg) return;
        const cx = 120, cy = 125, R = 92, lo = 60, hi = 190;
        const p = Math.max(0, Math.min(1, (bpm - lo) / (hi - lo)));
        const at = (pp, rad) => { const th = Math.PI * (1 - pp); return [cx + rad * Math.cos(th), cy - rad * Math.sin(th)]; };
        const bg = 'M ' + (cx - R) + ' ' + cy + ' A ' + R + ' ' + R + ' 0 0 1 ' + (cx + R) + ' ' + cy;
        const end = at(p, R);
        const val = 'M ' + (cx - R) + ' ' + cy + ' A ' + R + ' ' + R + ' 0 0 1 ' + end[0].toFixed(1) + ' ' + end[1].toFixed(1);
        const np = at(p, R - 16);
        svg.innerHTML =
            '<path d="' + bg + '" fill="none" stroke="var(--grid-line-strong)" stroke-width="12" stroke-linecap="round"/>' +
            '<path d="' + val + '" fill="none" stroke="rgb(var(--accent-rgb))" stroke-width="12" stroke-linecap="round"/>' +
            '<line x1="' + cx + '" y1="' + cy + '" x2="' + np[0].toFixed(1) + '" y2="' + np[1].toFixed(1) + '" stroke="var(--emphasis)" stroke-width="3" stroke-linecap="round"/>' +
            '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="var(--emphasis)"/>' +
            '<text x="' + (cx - R) + '" y="' + (cy + 18) + '" fill="var(--axis-label)" font-size="9" text-anchor="middle">Slow</text>' +
            '<text x="' + (cx + R) + '" y="' + (cy + 18) + '" fill="var(--axis-label)" font-size="9" text-anchor="middle">Fast</text>';
    }

    function renderPlainWords(avg, mode) {
        const el = document.getElementById('plain-words');
        if (!el) return;
        const hi = (t) => '<b class="text-primary">' + t + '</b>';
        const items = [
            { icon: 'bolt', text: avg.energy < 0.5 ? 'You keep it more ' + hi('chilled-out') + ' than hyped.' : 'You lean more ' + hi('energetic') + ' than laid-back.' },
            { icon: mode.major >= 0.5 ? 'wb_sunny' : 'cloud', text: mode.major >= 0.5 ? 'Your music leans ' + hi('bright and uplifting') + '.' : 'Your music leans ' + hi('moody and emotional') + '.' },
            { icon: 'mic', text: avg.vocal >= 0.6 ? "It's " + hi('lyrics-first') + ' — vocals over instrumentals.' : 'You lean ' + hi('instrumental') + ' over vocals.' },
            { icon: 'graphic_eq', text: 'About ' + hi(pct(avg.acousticness) + '% acoustic') + ', the rest produced.' },
        ];
        el.innerHTML = items
            .map((it) => '<li class="flex items-start gap-2.5">' +
                '<span class="material-symbols-outlined text-primary text-lg shrink-0">' + it.icon + '</span>' +
                '<span class="font-body-sm text-body-sm text-on-surface">' + it.text + '</span></li>')
            .join('');
    }

    const VIBE_SWEET = { Chill: 'Chill & feel-good', Pumped: 'Upbeat & energetic', Moody: 'Mellow & moody', Intense: 'Dark & intense' };
    const VIBE_WORD = { Chill: 'Feel-good', Pumped: 'Upbeat', Moody: 'Moody', Intense: 'Intense' };
    const VIBE_PHRASE = {
        Chill: 'easy, positive songs you sink into',
        Pumped: 'bright, high-energy anthems',
        Moody: 'slow, emotional songs',
        Intense: 'dark, high-energy tracks',
    };
    async function fetchSound() {
        if (!document.getElementById('mood-svg')) return;
        let s = null;
        let coverage = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/audio');
                if (res && res.ok && res.data && res.data.avg && res.data.tracks && res.data.tracks.length) {
                    s = res.data;
                    coverage = typeof res.data.coverage === 'number' ? res.data.coverage : null;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!s) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('sound', false); renderSound(SAMPLE_SOUND); setCoverageNote(null); return; }
            E.chapterEmpty('sound', true);
            return;
        }
        E.chapterEmpty('sound', false);
        renderSound(s);
        setCoverageNote(coverage);
    }
    // Only surface a caveat when coverage is low; high-coverage users see nothing.
    function setCoverageNote(cov) {
        const el = document.getElementById('sound-coverage');
        if (!el) return;
        if (cov != null && cov < 0.75) {
            el.textContent = 'Based on the ' + Math.round(cov * 100) + '% of your songs we could match to audio data.';
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }
    function renderSound(s) {
        // Vibe word/zone come from the average so they agree with the sliders.
        const zone = moodZone(s.avg.valence, s.avg.energy);
        renderMood(s.tracks, VIBE_SWEET[zone], { v: s.avg.valence, e: s.avg.energy });
        renderVibe(s.avg);
        renderPace(s.tempo_avg);
        setText('vibe-word', VIBE_WORD[zone]);
        setText('vibe-phrase', 'Most of your music is ' + VIBE_PHRASE[zone] + '.');
        setText('pace-word', paceWord(s.tempo_avg));
        const maj = pct(s.mode.major), min = 100 - maj;
        setText('mode-major', maj);
        setText('mode-minor', min);
        const mb = document.getElementById('mode-major-bar'); if (mb) mb.style.width = maj + '%';
        const nb = document.getElementById('mode-minor-bar'); if (nb) nb.style.width = min + '%';
    }

    /* ---- Hover (mood map + mood mix) ---- */
    function setupHover() {
        const mood = document.getElementById('mood-svg');
        if (mood) {
            mood.addEventListener('mouseover', (e) => {
                const a = attr(e.target, 'data-t');
                if (a == null) return;
                const t = soundState.tracks[+a];
                e.target.classList.add('is-hover');
                showTip(t.name, moodZone(t.valence, t.energy), e.clientX, e.clientY);
            });
            mood.addEventListener('mousemove', (e) => {
                if (attr(e.target, 'data-t') != null) moveTip(e.clientX, e.clientY);
            });
            mood.addEventListener('mouseout', (e) => {
                const a = attr(e.target, 'data-t');
                if (a == null) return;
                e.target.classList.remove('is-hover');
                if (attr(e.relatedTarget, 'data-t') == null) hideTip();
            });
        }

        const mix = document.getElementById('mood-mix');
        if (mix) {
            mix.addEventListener('mouseover', (e) => {
                const a = attr(e.target, 'data-mix');
                if (a == null) return;
                const m = soundState.mix[+a];
                showTip(m.label, m.pct + '% of your plays', e.clientX, e.clientY);
            });
            mix.addEventListener('mousemove', (e) => {
                if (attr(e.target, 'data-mix') != null) moveTip(e.clientX, e.clientY);
            });
            mix.addEventListener('mouseout', (e) => {
                if (attr(e.target, 'data-mix') != null && attr(e.relatedTarget, 'data-mix') == null) hideTip();
            });
        }
    }

    E.chapters.push({ fetch: fetchSound, hover: setupHover });
})(window.RewindExplore);
