// Chapter 04 — Your Taste: top genres, mainstream gauge, decades, hidden gems.
(function (E) {
    'use strict';
    const { plays, esc, setText, coverCell, loadCovers, showTip, moveTip, hideTip, attr } = E;

    const tasteState = { genres: [], eras: [], gems: [] };

    // Sample keeps the visuals alive until /api/metrics/taste is wired.
    const SAMPLE_TASTE = {
        genres: [
            { name: 'R&B', plays: 4200 },
            { name: 'Hip hop', plays: 3600 },
            { name: 'Pop', plays: 2500 },
            { name: 'Soul', plays: 1400 },
            { name: 'Afrobeats', plays: 1100 },
            { name: 'Amapiano', plays: 700 },
        ],
        mainstream: 0.62,
        distinct_genres: 8,
        eras: [
            { decade: 1990, plays: 900 },
            { decade: 2000, plays: 1800 },
            { decade: 2010, plays: 5200 },
            { decade: 2020, plays: 7600 },
        ],
        avg_year: 2019,
        gems: [
            { name: 'Session 32', artist: 'Summer Walker', plays: 151 },
            { name: "Marvin's Room", artist: 'Drake', plays: 96 },
            { name: 'Eski Leyew', artist: 'Rophnan', plays: 88 },
        ],
    };

    function renderGenres(genres) {
        tasteState.genres = genres;
        const el = document.getElementById('genre-bars');
        if (!el) return;
        const max = Math.max.apply(null, genres.map((g) => g.plays).concat(1));
        el.innerHTML = genres
            .map((g, i) => {
                const w = Math.max(6, Math.round((g.plays / max) * 100));
                return '<div class="genre-row cursor-pointer" data-g="' + i + '">' +
                    '<div class="genre-name font-body-sm text-body-sm text-on-surface mb-1">' + esc(g.name) + '</div>' +
                    '<div class="h-2.5 rounded-full bg-surface-container-high overflow-hidden">' +
                    '<div class="genre-bar-fill h-full rounded-full bg-primary" style="width:' + w + '%"></div>' +
                    '</div></div>';
            })
            .join('');
    }

    function mainstreamWord(m) {
        return m < 0.4 ? 'Underground' : m < 0.65 ? 'In the mix' : 'Mainstream';
    }
    function renderMainstream(m) {
        setText('taste-mainstream-word', mainstreamWord(m));
        const bar = document.getElementById('taste-mainstream-bar');
        if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, m)) * 100) + '%';
    }

    function rangeWord(n) {
        return n >= 7 ? 'Explorer' : n >= 4 ? 'Adventurous' : 'Loyalist';
    }
    function renderTasteRange(n) {
        setText('taste-range-word', rangeWord(n));
        setText('taste-range-sub', n + (n === 1 ? ' genre' : ' genres') + ' in your mix');
    }

    function eraWord(avgYear) {
        const age = new Date().getFullYear() - avgYear;
        return age <= 5 ? 'Mostly recent' : age <= 15 ? 'A mix of eras' : 'Throwback';
    }
    function renderEras(eras, avgYear) {
        tasteState.eras = eras;
        setText('era-word', eraWord(avgYear));
        const el = document.getElementById('era-bars');
        if (!el) return;
        const max = Math.max.apply(null, eras.map((e) => e.plays).concat(1));
        let top = 0;
        eras.forEach((e, i) => { if (e.plays > (eras[top] ? eras[top].plays : 0)) top = i; });
        el.innerHTML = eras
            .map((e, i) => {
                const h = Math.max(4, Math.round((e.plays / max) * 100));
                const isTop = i === top && e.plays > 0;
                const barCls = isTop ? 'bg-primary' : 'bg-primary/30';
                const lblCls = isTop ? 'text-primary font-bold' : 'text-on-surface-variant';
                return '<div class="era-col flex-1 flex flex-col items-center gap-2 h-full justify-end cursor-pointer" data-era="' + i + '">' +
                    '<div class="era-bar w-full rounded-t-md ' + barCls + ' transition-colors" style="height:' + h + '%"></div>' +
                    '<span class="font-mono text-[10px] ' + lblCls + '">' + e.decade + 's</span>' +
                    '</div>';
            })
            .join('');
    }

    function renderGems(gems) {
        tasteState.gems = gems;
        const el = document.getElementById('gem-list');
        if (!el) return;
        if (!gems.length) {
            el.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant opacity-70">Your taste leans mainstream — no deep cuts here.</p>';
            return;
        }
        el.innerHTML = gems
            .map((g, i) => '<div class="gem-row flex items-center gap-3 p-2 rounded-lg cursor-pointer" data-gem="' + i + '">' +
                coverCell(g.id) +
                '<div class="min-w-0">' +
                '<div class="font-body-sm text-body-sm text-on-surface truncate">' + esc(g.name) + '</div>' +
                '<div class="font-body-sm text-[11px] text-on-surface-variant opacity-70 truncate">' + esc(g.artist) + '</div>' +
                '</div></div>')
            .join('');
        loadCovers(el);
    }

    function renderTaste(t) {
        renderGenres(t.genres || []);
        renderMainstream(typeof t.mainstream === 'number' ? t.mainstream : 0.5);
        renderTasteRange(t.distinct_genres || (t.genres ? t.genres.length : 0));
        renderEras(t.eras || [], t.avg_year || new Date().getFullYear());
        renderGems(t.gems || []);
    }

    async function fetchTaste() {
        const tok = E.token();  // year at request time
        if (!document.getElementById('genre-bars')) return;
        let t = null;
        if (window.fetchWithTimeout) {
            try {
                const res = await window.fetchWithTimeout(E.withYear('/api/metrics/taste'));
                if (res && res.ok && res.data && Array.isArray(res.data.genres) && res.data.genres.length) {
                    t = res.data;
                }
            } catch (_e) {
                /* no data */
            }
        }
        if (E.stale(tok)) return;  // a newer year is already in flight
        if (!t) {
            if (window.REWIND_ALLOW_SAMPLE) { E.chapterEmpty('taste', false); renderTaste(SAMPLE_TASTE); return; }
            E.chapterEmpty('taste', true);
            return;
        }
        E.chapterEmpty('taste', false);
        renderTaste(t);
    }

    /* ---- Hover (genres, eras, gems) ---- */
    function setupHover() {
        const genres = document.getElementById('genre-bars');
        if (genres) {
            const rowOf = (t) => (t && t.closest ? t.closest('[data-g]') : null);
            genres.addEventListener('mouseover', (e) => {
                const row = rowOf(e.target);
                if (!row) return;
                const g = tasteState.genres[+row.getAttribute('data-g')];
                if (g) showTip(g.name, plays(g.plays), e.clientX, e.clientY);
            });
            genres.addEventListener('mousemove', (e) => { if (rowOf(e.target)) moveTip(e.clientX, e.clientY); });
            genres.addEventListener('mouseout', (e) => {
                const row = rowOf(e.target);
                if (row && row.contains(e.relatedTarget)) return;
                hideTip();
            });
        }

        const eras = document.getElementById('era-bars');
        if (eras) {
            const colOf = (t) => (t && t.closest ? t.closest('[data-era]') : null);
            eras.addEventListener('mouseover', (e) => {
                const col = colOf(e.target);
                if (!col) return;
                const er = tasteState.eras[+col.getAttribute('data-era')];
                if (er) showTip(er.decade + 's', plays(er.plays), e.clientX, e.clientY);
            });
            eras.addEventListener('mousemove', (e) => { if (colOf(e.target)) moveTip(e.clientX, e.clientY); });
            eras.addEventListener('mouseout', (e) => {
                const col = colOf(e.target);
                if (col && col.contains(e.relatedTarget)) return;
                hideTip();
            });
        }

        const gems = document.getElementById('gem-list');
        if (gems) {
            const rowOf = (t) => (t && t.closest ? t.closest('[data-gem]') : null);
            gems.addEventListener('mouseover', (e) => {
                const row = rowOf(e.target);
                if (!row) return;
                const g = tasteState.gems[+row.getAttribute('data-gem')];
                if (g) showTip(g.name, plays(g.plays), e.clientX, e.clientY);
            });
            gems.addEventListener('mousemove', (e) => { if (rowOf(e.target)) moveTip(e.clientX, e.clientY); });
            gems.addEventListener('mouseout', (e) => {
                const row = rowOf(e.target);
                if (row && row.contains(e.relatedTarget)) return;
                hideTip();
            });
        }
    }

    E.chapters.push({ section: 'taste', fetch: fetchTaste, hover: setupHover });
})(window.RewindExplore);
