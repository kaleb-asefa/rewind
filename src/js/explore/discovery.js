// Chapter 06 — Discovery & Loyalty: discovery-vs-familiar mix, new artists per
// month, one-hit wonders, returning favorites, rising artists. No hover.
(function (E) {
    'use strict';
    const { esc, setText, coverCell, loadCovers } = E;

    const SAMPLE_DISCOVERY = {
        new_artist_share: 0.34,
        new_artists_monthly: 11,
        one_off_share: 0.42,
        rediscoveries: [
            { name: 'Japanese Denim', artist: 'Daniel Caesar', plays: 38 },
            { name: 'Get You', artist: 'Daniel Caesar', plays: 31 },
            { name: 'Love Galore', artist: 'SZA', plays: 27 },
        ],
        rising: [
            { name: 'Tems', share: 86 },
            { name: 'Amaarae', share: 64 },
            { name: 'Steve Lacy', share: 43 },
        ],
    };

    function discoveryWord(share) {
        return share >= 0.45 ? 'Explorer' : share >= 0.25 ? 'Open to new music' : 'Loyalist';
    }
    function renderDiscoveryMix(share) {
        const discovery = Math.round(Math.max(0, Math.min(1, share)) * 100);
        const familiar = 100 - discovery;
        setText('discovery-word', discoveryWord(share));
        setText('discovery-pct', discovery);
        setText('familiar-pct', familiar);
        const bar = document.getElementById('discovery-bar');
        if (bar) {
            bar.innerHTML =
                '<div style="width:' + discovery + '%;background:rgb(30,215,96)"></div>' +
                '<div style="width:' + familiar + '%;background:rgba(30,215,96,0.28)"></div>';
        }
    }
    function renderRediscoveries(items) {
        const el = document.getElementById('rediscovery-list');
        if (!el) return;
        if (!items.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">No returning favorites yet.</p>';
            return;
        }
        el.innerHTML = items.map((item) =>
            '<div class="gem-row flex items-center gap-3 p-2 rounded-lg">' +
            coverCell(item.id) +
            '<div class="min-w-0 flex-1"><div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(item.name) +
            '</div><div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(item.artist) +
            '</div></div><span class="font-mono text-[11px] text-primary shrink-0">' + item.plays + ' plays</span></div>'
        ).join('');
        loadCovers(el);
    }
    function renderRising(items) {
        const el = document.getElementById('rising-list');
        if (!el) return;
        const max = Math.max.apply(null, items.map((item) => item.share).concat(1));
        el.innerHTML = items.map((item) => {
            const width = Math.max(6, Math.round((item.share / max) * 100));
            return '<div class="gem-row flex items-center gap-3 p-2 rounded-lg">' +
                coverCell(item.id, 'artist') +
                '<div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-3 mb-1">' +
                '<span class="font-body-sm text-body-sm text-on-surface truncate">' + esc(item.name) + '</span>' +
                '<span class="font-mono text-[11px] text-primary shrink-0">+' + item.share + '%</span></div>' +
                '<div class="h-2.5 rounded-full bg-surface-container-high overflow-hidden">' +
                '<div class="h-full rounded-full bg-primary" style="width:' + width + '%"></div></div></div></div>';
        }).join('');
        loadCovers(el);
    }
    function renderDiscovery(d) {
        renderDiscoveryMix(typeof d.new_artist_share === 'number' ? d.new_artist_share : 0);
        setText('new-artists-value', Math.round(d.new_artists_monthly || 0));
        setText('one-off-value', Math.round((d.one_off_share || 0) * 100) + '%');
        renderRediscoveries(d.rediscoveries || []);
        renderRising(d.rising || []);
    }
    async function fetchDiscovery() {
        if (!document.getElementById('discovery-bar')) return;
        let d = SAMPLE_DISCOVERY;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout('/api/metrics/discovery');
                if (res && res.ok && res.data && typeof res.data.new_artist_share === 'number') {
                    d = res.data;
                }
            } catch (_e) {
                /* keep sample fallback until the endpoint is available */
            }
        }
        renderDiscovery(d);
    }

    E.chapters.push({ fetch: fetchDiscovery });
})(window.RewindExplore);
