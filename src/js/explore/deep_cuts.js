// Chapter 11 — Your Deep Cuts: loyalty concentration (top-10 artist share),
// album commitment (full albums vs cherry-picked singles), the track you binged
// most in a single day, and the favourite you almost never skip. History-only;
// frontend-only until GET /api/metrics/deep-cuts exists.
(function (E) {
    'use strict';
    const { esc, setText, coverCell, loadCovers } = E;

    const SAMPLE_DEEP_CUTS = {
        concentration: { top10_share: 0.58 },
        album_commitment: { deep_share: 0.34 },
        top_day_track: { name: 'Snooze', artist: 'SZA', count: 14, date: 'February 11, 2024' },
        no_skip: { name: 'Nobody Gets Me', artist: 'SZA', plays: 199, skip_rate: 0.02 },
    };

    /* ---- Loyalty concentration (top 10 artists' share) ---- */
    function concentrationWord(share) {
        return share >= 0.6 ? 'Devoted' : share >= 0.4 ? 'Balanced' : 'Far-reaching';
    }
    function renderConcentration(share) {
        const top = Math.round(Math.max(0, Math.min(1, share)) * 100);
        setText('concentration-word', concentrationWord(share));
        setText('concentration-pct', top);
        const bar = document.getElementById('concentration-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + top + '%;background:rgb(var(--accent-rgb))"></div>' +
                '<div style="width:' + (100 - top) + '%;background:rgba(var(--accent-rgb), 0.28)"></div>';
        }
    }

    /* ---- Album commitment (full albums vs singles) ---- */
    function albumWord(share) {
        return share >= 0.5 ? 'Album lover' : share >= 0.25 ? 'A mix' : 'Single picker';
    }
    function renderAlbum(share) {
        const deep = Math.round(Math.max(0, Math.min(1, share)) * 100);
        setText('album-word', albumWord(share));
        setText('album-deep-pct', deep);
        setText('album-single-pct', 100 - deep);
        const bar = document.getElementById('album-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + deep + '%;background:rgb(var(--accent-rgb))"></div>' +
                '<div style="width:' + (100 - deep) + '%;background:rgba(var(--accent-rgb), 0.28)"></div>';
        }
    }

    /* ---- Feature track (big stat + track row) ---- */
    function trackRow(item) {
        return '<div class="flex items-center gap-3">' +
            coverCell(item.id, 'track') +
            '<div class="min-w-0">' +
            '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(item.name || '—') + '</div>' +
            '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(item.artist || '') + '</div>' +
            '</div></div>';
    }
    function renderTopDayTrack(item) {
        const el = document.getElementById('day-track');
        if (!el) return;
        if (!item || !item.name) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">No single-day binges yet.</p>';
            return;
        }
        el.innerHTML =
            '<div class="font-display-lg text-display-lg-mobile text-primary leading-tight">×' + (item.count || 0) + '</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface-variant opacity-75 mb-4">in one day · ' + esc(item.date || '') + '</div>' +
            trackRow(item);
        loadCovers(el);
    }
    function renderNoSkip(item) {
        const el = document.getElementById('noskip');
        if (!el) return;
        if (!item || !item.name) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">Not enough plays yet.</p>';
            return;
        }
        el.innerHTML =
            '<div class="font-display-lg text-display-lg-mobile text-primary leading-tight">' + Math.round((item.skip_rate || 0) * 100) + '%</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface-variant opacity-75 mb-4">skip rate · ' + (item.plays || 0) + ' plays</div>' +
            trackRow(item);
        loadCovers(el);
    }

    function renderDeepCuts(data) {
        const c = data.concentration || {};
        renderConcentration(typeof c.top10_share === 'number' ? c.top10_share : 0);
        const a = data.album_commitment || {};
        renderAlbum(typeof a.deep_share === 'number' ? a.deep_share : 0);
        renderTopDayTrack(data.top_day_track || {});
        renderNoSkip(data.no_skip || {});
    }
    async function fetchDeepCuts() {
        const tok = E.token();  // year at request time
        if (!document.getElementById('concentration-bar')) return;
        let data = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout(E.withYear('/api/metrics/deep-cuts'));
                if (res && res.ok && res.data && res.data.concentration &&
                    typeof res.data.concentration.top10_share === 'number') {
                    data = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (E.stale(tok)) return;  // a newer year is already in flight
        if (!data) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('deep-cuts', false); renderDeepCuts(SAMPLE_DEEP_CUTS); return; }
            E.chapterEmpty('deep-cuts', true);
            return;
        }
        E.chapterEmpty('deep-cuts', false);
        renderDeepCuts(data);
    }

    E.chapters.push({ section: 'deep-cuts', fetch: fetchDeepCuts });
})(window.RewindExplore);
