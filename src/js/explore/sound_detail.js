// Chapter 10 — The Detail In Your Sound: tempo spread (how fast you listen),
// bright-vs-moody (major/minor), most danceable tracks, and a workout-vs-
// wind-down energy split. Frontend-only until GET /api/metrics/sound-detail.
(function (E) {
    'use strict';
    const { esc, setText, plays, coverCell, loadCovers, showTip, moveTip, hideTip } = E;

    const state = { tempo: [] };

    const SAMPLE_SOUND_DETAIL = {
        tempo: {
            buckets: [
                { label: 'Slow', plays: 180 },
                { label: 'Relaxed', plays: 520 },
                { label: 'Steady', plays: 1240 },
                { label: 'Upbeat', plays: 860 },
                { label: 'Fast', plays: 210 },
            ],
        },
        key: { major_share: 0.54 },
        danceable: [
            { name: 'Snooze', artist: 'SZA', danceability: 0.86 },
            { name: 'Calm Down', artist: 'Rema', danceability: 0.83 },
            { name: 'First Class', artist: 'Jack Harlow', danceability: 0.80 },
            { name: 'Kill Bill', artist: 'SZA', danceability: 0.78 },
        ],
        energy_split: { workout: 0.44, wind_down: 0.56 },
    };

    /* ---- Tempo spread (slow → fast histogram) ---- */
    function renderTempo(buckets) {
        state.tempo = buckets;
        const el = document.getElementById('tempo-bars');
        if (!el) return;
        if (!buckets.length) {
            el.innerHTML = '';
            setText('tempo-caption', '—');
            return;
        }
        const max = Math.max.apply(null, buckets.map((b) => b.plays).concat(1));
        let big = 0;
        buckets.forEach((b, i) => { if (b.plays > buckets[big].plays) big = i; });
        el.innerHTML = buckets
            .map((b, i) => {
                const h = Math.max(4, Math.round((b.plays / max) * 100));
                const top = i === big && b.plays > 0;
                return '<div class="tempo-col flex-1 flex flex-col items-center gap-2 h-full justify-end cursor-pointer" data-b="' + i + '">' +
                    '<div class="tempo-bar w-full rounded-t-md ' + (top ? 'bg-primary' : 'bg-primary/30') + '" style="height:' + h + '%"></div>' +
                    '<span class="font-mono text-[10px] ' + (top ? 'text-primary font-bold' : 'text-on-surface-variant') + '">' + esc(b.label) + '</span>' +
                    '</div>';
            })
            .join('');
        setText('tempo-caption', 'Mostly ' + String(buckets[big].label).toLowerCase());
    }

    /* ---- Bright or moody (major vs minor) ---- */
    function keyWord(share) {
        return share >= 0.55 ? 'Bright' : share >= 0.45 ? 'Balanced' : 'Moody';
    }
    function renderKey(share) {
        const major = Math.round(Math.max(0, Math.min(1, share)) * 100);
        setText('key-word', keyWord(share));
        setText('key-major-pct', major);
        setText('key-minor-pct', 100 - major);
        const bar = document.getElementById('key-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + major + '%;background:rgb(var(--accent-rgb))"></div>' +
                '<div style="width:' + (100 - major) + '%;background:rgba(var(--accent-rgb), 0.28)"></div>';
        }
    }

    /* ---- Most danceable tracks ---- */
    function renderDanceable(list) {
        const el = document.getElementById('dance-list');
        if (!el) return;
        if (!list.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">No danceable tracks yet.</p>';
            return;
        }
        el.innerHTML = list.slice(0, 4)
            .map((item) => '<div class="gem-row flex items-center gap-3 p-2 rounded-lg">' +
                coverCell(item.id, 'track') +
                '<div class="min-w-0 flex-1">' +
                '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(item.name) + '</div>' +
                '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(item.artist) + '</div>' +
                '</div>' +
                '<span class="font-mono text-[11px] text-primary shrink-0">' + Math.round((item.danceability || 0) * 100) + '%</span>' +
                '</div>')
            .join('');
        loadCovers(el);
    }

    /* ---- Workout vs wind-down (high vs low energy) ---- */
    function renderEnergySplit(split) {
        const workout = Math.round(Math.max(0, Math.min(1, split.workout || 0)) * 100);
        const word = workout >= 55 ? 'Mostly workout' : workout <= 45 ? 'Mostly wind-down' : 'Balanced';
        setText('energy-split-word', word);
        setText('workout-pct', workout);
        setText('winddown-pct', 100 - workout);
        const bar = document.getElementById('energy-split-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + workout + '%;background:rgb(var(--accent-rgb))"></div>' +
                '<div style="width:' + (100 - workout) + '%;background:rgba(var(--accent-rgb), 0.28)"></div>';
        }
    }

    function renderSoundDetail(data) {
        renderTempo((data.tempo && data.tempo.buckets) || []);
        renderKey(data.key && typeof data.key.major_share === 'number' ? data.key.major_share : 0.5);
        renderDanceable(data.danceable || []);
        renderEnergySplit(data.energy_split || {});
    }
    async function fetchSoundDetail() {
        if (!document.getElementById('tempo-bars')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/sound-detail');
                if (res && res.ok && res.data && res.data.tempo &&
                    Array.isArray(res.data.tempo.buckets) && res.data.tempo.buckets.length) {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('sound-detail', false); renderSoundDetail(SAMPLE_SOUND_DETAIL); return; }
            E.chapterEmpty('sound-detail', true);
            return;
        }
        E.chapterEmpty('sound-detail', false);
        renderSoundDetail(data);
    }

    /* ---- Hover (tempo bars) ---- */
    function setupHover() {
        const el = document.getElementById('tempo-bars');
        if (!el) return;
        const colOf = (t) => (t && t.closest ? t.closest('[data-b]') : null);
        el.addEventListener('mouseover', (e) => {
            const col = colOf(e.target);
            if (!col) return;
            const b = state.tempo[+col.getAttribute('data-b')];
            if (b) showTip(b.label, plays(b.plays || 0), e.clientX, e.clientY);
        });
        el.addEventListener('mousemove', (e) => { if (colOf(e.target)) moveTip(e.clientX, e.clientY); });
        el.addEventListener('mouseout', (e) => {
            const col = colOf(e.target);
            if (col && col.contains(e.relatedTarget)) return;
            hideTip();
        });
    }

    E.chapters.push({ fetch: fetchSoundDetail, hover: setupHover });
})(window.RewindExplore);
