// Finale — Your Rewind, Wrapped: a listening-personality synthesis, five
// spectrum traits pulled from the other chapters' signals.
// Frontend-only until GET /api/metrics/wrapped exists.
(function (E) {
    'use strict';
    const { esc } = E;

    const SAMPLE_WRAPPED = {
        personality: [
            { label: 'Explorer', left: 'Loyalist', right: 'Explorer', position: 0.68, icon: 'explore' },
            { label: 'Mainstream', left: 'Underground', right: 'Mainstream', position: 0.62, icon: 'trending_up' },
            { label: 'Night owl', left: 'Early bird', right: 'Night owl', position: 0.66, icon: 'bedtime' },
            { label: 'Focused', left: 'Restless', right: 'Focused', position: 0.75, icon: 'center_focus_strong' },
            { label: 'A bit of both', left: 'Curator', right: 'Shuffler', position: 0.52, icon: 'shuffle' },
        ],
    };

    function renderPersonality(list) {
        const el = document.getElementById('personality-badges');
        if (!el) return;
        if (!list.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant">Your personality appears as you listen.</p>';
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
                    '<div class="flex justify-between mt-1.5 text-[10px] text-on-surface-variant">' +
                    '<span>' + esc(item.left) + '</span><span>' + esc(item.right) + '</span></div>' +
                    '</div>';
            })
            .join('');
    }

    function renderWrapped(data) {
        renderPersonality(data.personality || []);
    }
    async function fetchWrapped() {
        const tok = E.token();  // year at request time
        if (!document.getElementById('personality-badges')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout(E.withYear('/api/metrics/wrapped'));
                if (res && res.ok && res.data && Array.isArray(res.data.personality) && res.data.personality.length) {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (E.stale(tok)) return;  // a newer year is already in flight
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('wrapped', false); renderWrapped(SAMPLE_WRAPPED); return; }
            E.chapterEmpty('wrapped', true);
            return;
        }
        E.chapterEmpty('wrapped', false);
        renderWrapped(data);
    }

    E.chapters.push({ section: 'wrapped', fetch: fetchWrapped });
})(window.RewindExplore);
