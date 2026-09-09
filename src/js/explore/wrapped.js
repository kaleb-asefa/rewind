// Finale — Your Rewind, Wrapped: a listening-personality synthesis (five
// spectrum traits pulled from the other chapters' signals) plus longest/shortest
// song superlatives. Frontend-only until GET /api/metrics/wrapped exists.
(function (E) {
    'use strict';
    const { esc, coverCell, loadCovers } = E;

    const SAMPLE_WRAPPED = {
        personality: [
            { label: 'Explorer', left: 'Loyalist', right: 'Explorer', position: 0.68, icon: 'explore' },
            { label: 'Mainstream', left: 'Underground', right: 'Mainstream', position: 0.62, icon: 'trending_up' },
            { label: 'Night owl', left: 'Early bird', right: 'Night owl', position: 0.66, icon: 'bedtime' },
            { label: 'Focused', left: 'Restless', right: 'Focused', position: 0.75, icon: 'center_focus_strong' },
            { label: 'A bit of both', left: 'Curator', right: 'Shuffler', position: 0.52, icon: 'shuffle' },
        ],
        longest_track: { name: 'SICKO MODE', artist: 'Travis Scott', seconds: 312 },
        shortest_track: { name: 'Now', artist: 'SZA', seconds: 69 },
    };

    function fmtDur(seconds) {
        const s = Math.max(0, Math.round(seconds || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function renderPersonality(list) {
        const el = document.getElementById('personality-badges');
        if (!el) return;
        if (!list.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">Your personality appears as you listen.</p>';
            return;
        }
        el.innerHTML = list
            .map((item) => {
                const pos = Math.round(Math.max(0, Math.min(1, item.position || 0)) * 100);
                return '<div class="rounded-xl bg-surface-container-high/40 border border-white/5 p-4">' +
                    '<div class="flex items-center gap-2">' +
                    '<span class="material-symbols-outlined text-primary text-xl">' + esc(item.icon || 'star') + '</span>' +
                    '<span class="font-headline-md text-headline-md text-on-surface truncate">' + esc(item.label) + '</span>' +
                    '</div>' +
                    '<div class="relative h-1.5 rounded-full bg-surface-container-high mt-4">' +
                    '<div class="absolute top-1/2 w-3 h-3 rounded-full bg-primary border-2 border-surface shadow" style="left:' + pos + '%;transform:translate(-50%,-50%)"></div>' +
                    '</div>' +
                    '<div class="flex justify-between mt-1.5 text-[10px] text-on-surface-variant opacity-70">' +
                    '<span>' + esc(item.left) + '</span><span>' + esc(item.right) + '</span></div>' +
                    '</div>';
            })
            .join('');
    }

    function renderExtreme(id, item, heading) {
        const el = document.getElementById(id);
        if (!el) return;
        if (!item || !item.name) {
            el.innerHTML = '<div class="font-label-bold text-label-bold uppercase tracking-wider text-on-surface-variant opacity-70">' + esc(heading) + '</div>' +
                '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70 mt-2">—</p>';
            return;
        }
        el.innerHTML =
            '<div class="font-label-bold text-label-bold uppercase tracking-wider text-on-surface-variant opacity-70">' + esc(heading) + '</div>' +
            '<div class="flex items-center gap-3 mt-2">' +
            coverCell(item.id, 'track') +
            '<div class="min-w-0 flex-1">' +
            '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(item.name) + '</div>' +
            '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(item.artist || '') + '</div>' +
            '</div>' +
            '<span class="font-mono text-[11px] text-primary shrink-0">' + fmtDur(item.seconds) + '</span>' +
            '</div>';
        loadCovers(el);
    }

    function renderWrapped(data) {
        renderPersonality(data.personality || []);
        renderExtreme('longest-track', data.longest_track, 'Longest song');
        renderExtreme('shortest-track', data.shortest_track, 'Shortest song');
    }
    async function fetchWrapped() {
        if (!document.getElementById('personality-badges')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/wrapped');
                if (res && res.ok && res.data && Array.isArray(res.data.personality) && res.data.personality.length) {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('wrapped', false); renderWrapped(SAMPLE_WRAPPED); return; }
            E.chapterEmpty('wrapped', true);
            return;
        }
        E.chapterEmpty('wrapped', false);
        renderWrapped(data);
    }

    E.chapters.push({ fetch: fetchWrapped });
})(window.RewindExplore);
