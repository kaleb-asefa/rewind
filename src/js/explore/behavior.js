// Chapter 05 — How You Listen: shuffle vs picked, skip word, longest binge,
// attention buckets, on-repeat loops. No hover (all values shown via labels).
(function (E) {
    'use strict';
    const { fmtMins, setText, esc, coverCell, loadCovers } = E;

    const SAMPLE_BEHAVIOR = {
        shuffle: 0.63,
        skip_rate: 0.29,
        longest_binge_min: 252,
        attention: { under30: 0.25, partial: 0.18, finished: 0.57 },
        loops: [
            { name: 'Snooze', artist: 'SZA', count: 7 },
            { name: 'Calm Down', artist: 'Rema', count: 5 },
            { name: 'Kill Bill', artist: 'SZA', count: 4 },
        ],
    };

    function shuffleWord(s) {
        return s >= 0.6 ? 'Shuffler' : s >= 0.35 ? 'A bit of both' : 'Curator';
    }
    function skipWord(s) {
        return s >= 0.4 ? 'Restless' : s >= 0.2 ? 'Selective' : 'Locked in';
    }

    function renderShuffle(s) {
        const sh = Math.round(Math.max(0, Math.min(1, s)) * 100);
        const pk = 100 - sh;
        setText('shuffle-word', shuffleWord(s));
        setText('shuffle-pct', sh);
        setText('picked-pct', pk);
        const bar = document.getElementById('shuffle-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + sh + '%;background:rgb(30,215,96)"></div>' +
                '<div style="width:' + pk + '%;background:rgba(30,215,96,0.28)"></div>';
        }
    }
    function renderSkip(s) {
        setText('skip-word', skipWord(s));
        setText('skip-sub', 'You skip ' + Math.round(s * 100) + '% of tracks.');
    }
    function renderBinge(min) {
        setText('binge-value', fmtMins(min));
    }

    const ATTENTION_SHADES = ['rgba(30,215,96,0.3)', 'rgba(30,215,96,0.6)', 'rgb(30,215,96)'];
    function renderAttention(a) {
        const segs = [
            { label: 'Under 30s', pct: Math.round((a.under30 || 0) * 100) },
            { label: 'Partial', pct: Math.round((a.partial || 0) * 100) },
            { label: 'Finished', pct: Math.round((a.finished || 0) * 100) },
        ];
        const bar = document.getElementById('attention-bar');
        if (bar) {
            bar.innerHTML = segs
                .map((seg, i) => '<div style="width:' + seg.pct + '%;background:' + ATTENTION_SHADES[i] + '"></div>')
                .join('');
        }
        const legend = document.getElementById('attention-legend');
        if (legend) {
            legend.innerHTML = segs
                .map((seg, i) => '<span class="inline-flex items-center gap-1.5"><span style="width:8px;height:8px;border-radius:9999px;background:' + ATTENTION_SHADES[i] + '"></span>' + seg.label + ' ' + seg.pct + '%</span>')
                .join('');
        }
    }

    function renderLoops(loops) {
        const el = document.getElementById('loop-list');
        if (!el) return;
        if (!loops.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">No back-to-back repeats yet.</p>';
            return;
        }
        el.innerHTML = loops
            .map((l) => '<div class="gem-row flex items-center gap-3 p-2 rounded-lg">' +
                coverCell(l.id) +
                '<div class="min-w-0 flex-1">' +
                '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(l.name) + '</div>' +
                '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(l.artist) + '</div>' +
                '</div>' +
                '<span class="font-mono text-[11px] text-primary shrink-0">×' + l.count + '</span>' +
                '</div>')
            .join('');
        loadCovers(el);
    }

    function renderBehavior(b) {
        renderShuffle(typeof b.shuffle === 'number' ? b.shuffle : 0.5);
        renderSkip(typeof b.skip_rate === 'number' ? b.skip_rate : 0);
        renderBinge(b.longest_binge_min || 0);
        renderAttention(b.attention || {});
        renderLoops(b.loops || []);
    }

    async function fetchBehavior() {
        if (!document.getElementById('shuffle-bar')) return;
        let b = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/behavior');
                if (res && res.ok && res.data && typeof res.data.shuffle === 'number') {
                    b = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!b) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('habits', false); renderBehavior(SAMPLE_BEHAVIOR); return; }
            E.chapterEmpty('habits', true);
            return;
        }
        E.chapterEmpty('habits', false);
        renderBehavior(b);
    }

    E.chapters.push({ fetch: fetchBehavior });
})(window.RewindExplore);
