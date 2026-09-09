/**
 * Rewind — Charts page.
 * Numbered Top-N leaderboards (artists / tracks / albums / genres) with a
 * time selector (all-time + per year), sort + depth controls, and a
 * "find your rank" search. Falls back to SAMPLE data until the backend
 * /api/metrics/chart endpoint is wired.
 */
(function () {
    "use strict";

    const ENTITIES = {
        artist: { label: "Artists", one: "artist", cover: "artist", round: true, hasArtist: false },
        track:  { label: "Tracks",  one: "track",  cover: "track",  round: false, hasArtist: true },
        album:  { label: "Albums",  one: "album",  cover: "album",  round: false, hasArtist: true },
        genre:  { label: "Genres",  one: "genre",  cover: null,     round: false, hasArtist: false },
    };
    const AVAILABLE_YEARS = ["2025", "2024", "2023", "2022"];
    const DEPTHS = [5, 10, 20, 50, 100];

    // ── sample data (owner-flavoured; replaced by backend later) ────────────
    const SAMPLE = {
        artist: [
            { name: "SZA", id: "7tYKF4w9nC0nq9CsPZTHyP", minutes: 4182, streams: 1668 },
            { name: "J. Cole", minutes: 2740, streams: 1190 },
            { name: "Drake", minutes: 2210, streams: 1035 },
            { name: "Summer Walker", minutes: 1980, streams: 902 },
            { name: "Giveon", minutes: 1655, streams: 720 },
            { name: "Brent Faiyaz", minutes: 1420, streams: 640 },
            { name: "Frank Ocean", minutes: 1290, streams: 545 },
            { name: "The Weeknd", minutes: 1180, streams: 560 },
            { name: "Kendrick Lamar", minutes: 1075, streams: 498 },
            { name: "Tyla", minutes: 940, streams: 470 },
            { name: "Burna Boy", minutes: 880, streams: 402 },
            { name: "Rema", minutes: 815, streams: 388 },
            { name: "Travis Scott", minutes: 760, streams: 330 },
            { name: "Doja Cat", minutes: 690, streams: 344 },
            { name: "Cardi B", minutes: 640, streams: 288 },
            { name: "Kali Uchis", minutes: 590, streams: 261 },
            { name: "Daniel Caesar", minutes: 540, streams: 240 },
            { name: "PARTYNEXTDOOR", minutes: 495, streams: 214 },
            { name: "21 Savage", minutes: 452, streams: 205 },
            { name: "Doechii", minutes: 410, streams: 190 },
            { name: "Tems", minutes: 372, streams: 168 },
            { name: "Wizkid", minutes: 331, streams: 150 },
            { name: "Ariana Grande", minutes: 288, streams: 140 },
            { name: "Lil Baby", minutes: 244, streams: 118 },
            { name: "Metro Boomin", minutes: 198, streams: 96 },
        ],
        track: [
            { name: "Nobody Gets Me", artist: "SZA", id: "5Y35SjAfXjjG0sFQ3KOxmm", minutes: 620, streams: 199 },
            { name: "Snooze", artist: "SZA", minutes: 540, streams: 176 },
            { name: "Kill Bill", artist: "SZA", minutes: 470, streams: 158 },
            { name: "Good Days", artist: "SZA", minutes: 430, streams: 138 },
            { name: "Session 32", artist: "Summer Walker", minutes: 388, streams: 145 },
            { name: "WITHOUT YOU", artist: "The Kid LAROI", minutes: 352, streams: 132 },
            { name: "Lost Me", artist: "Giveon", minutes: 330, streams: 121 },
            { name: "Open Arms", artist: "SZA", minutes: 305, streams: 110 },
            { name: "Water", artist: "Tyla", minutes: 288, streams: 118 },
            { name: "Calm Down", artist: "Rema", minutes: 266, streams: 108 },
            { name: "No Role Modelz", artist: "J. Cole", minutes: 248, streams: 101 },
            { name: "Die For You", artist: "The Weeknd", minutes: 232, streams: 94 },
            { name: "Best Part", artist: "Daniel Caesar", minutes: 214, streams: 88 },
            { name: "Seek & Destroy", artist: "SZA", minutes: 198, streams: 79 },
            { name: "All The Stars", artist: "Kendrick Lamar", minutes: 182, streams: 76 },
            { name: "Rich Baby Daddy", artist: "Drake", minutes: 168, streams: 70 },
            { name: "Location", artist: "Karol G", minutes: 152, streams: 64 },
            { name: "Feel No Ways", artist: "Drake", minutes: 138, streams: 58 },
            { name: "Pretty Little Birds", artist: "SZA", minutes: 124, streams: 52 },
            { name: "Come Through and Chill", artist: "Miguel", minutes: 110, streams: 46 },
            { name: "Godzilla", artist: "Eminem", minutes: 96, streams: 41 },
            { name: "Cinderella", artist: "Remble", minutes: 84, streams: 36 },
            { name: "Attention", artist: "Doja Cat", minutes: 72, streams: 31 },
            { name: "Peru", artist: "Fireboy DML", minutes: 60, streams: 27 },
            { name: "Sativa", artist: "Jhené Aiko", minutes: 48, streams: 22 },
        ],
        album: [
            { name: "SOS", artist: "SZA", id: "07w0rG5TETcyihsEIZR3qG", minutes: 2370, streams: 812 },
            { name: "Ctrl", artist: "SZA", minutes: 1610, streams: 560 },
            { name: "2014 Forest Hills Drive", artist: "J. Cole", minutes: 1180, streams: 402 },
            { name: "Still Over It", artist: "Summer Walker", minutes: 1020, streams: 366 },
            { name: "Give or Take", artist: "Giveon", minutes: 890, streams: 318 },
            { name: "Blonde", artist: "Frank Ocean", minutes: 760, streams: 254 },
            { name: "Wasteland", artist: "Brent Faiyaz", minutes: 680, streams: 240 },
            { name: "Starboy", artist: "The Weeknd", minutes: 590, streams: 224 },
            { name: "good kid, m.A.A.d city", artist: "Kendrick Lamar", minutes: 520, streams: 190 },
            { name: "TYLA", artist: "Tyla", minutes: 470, streams: 205 },
            { name: "Love, Damini", artist: "Burna Boy", minutes: 418, streams: 162 },
            { name: "Rave & Roses", artist: "Rema", minutes: 372, streams: 148 },
            { name: "UTOPIA", artist: "Travis Scott", minutes: 330, streams: 128 },
            { name: "Scarlet", artist: "Doja Cat", minutes: 288, streams: 132 },
            { name: "Red (Taylor's Version)", artist: "Taylor Swift", minutes: 244, streams: 96 },
            { name: "Freudian", artist: "Daniel Caesar", minutes: 210, streams: 84 },
            { name: "PARTYMOBILE", artist: "PARTYNEXTDOOR", minutes: 178, streams: 72 },
            { name: "Her Loss", artist: "Drake", minutes: 152, streams: 66 },
            { name: "Alligator Bites Never Heal", artist: "Doechii", minutes: 128, streams: 55 },
            { name: "Made in Lagos", artist: "Wizkid", minutes: 104, streams: 44 },
        ],
        genre: [
            { name: "Hip-Hop", minutes: 8420, streams: 6897 },
            { name: "R&B", minutes: 6180, streams: 4189 },
            { name: "Pop", minutes: 4560, streams: 3782 },
            { name: "Afrobeats", minutes: 980, streams: 282 },
            { name: "Soul", minutes: 640, streams: 210 },
            { name: "Indie", minutes: 520, streams: 153 },
            { name: "Singer-Songwriter", minutes: 410, streams: 121 },
            { name: "Latin", minutes: 336, streams: 98 },
            { name: "Reggae", minutes: 248, streams: 72 },
            { name: "Rock", minutes: 190, streams: 58 },
        ],
    };

    // ── state ───────────────────────────────────────────────────────────────
    const state = { entity: "artist", sort: "minutes", depth: 10, range: "all", search: "" };
    let lastFull = [];   // most recent full ranking, for the share card
    const cache = {};
    let apiYears = null;   // real years from the backend, once known
    let yearsSynced = false;

    // ── helpers ──────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function fmtNum(n) { return Number(n || 0).toLocaleString(); }
    function fmtMinutes(m) {
        m = Math.round(m || 0);
        if (m < 60) return m + "m";
        const h = Math.floor(m / 60);
        const rem = m % 60;
        return rem ? h + "h " + rem + "m" : h + "h";
    }
    function statText(item) {
        return state.sort === "minutes" ? fmtMinutes(item.minutes) : fmtNum(item.streams) + " streams";
    }
    function subStatText(item) {
        return state.sort === "minutes" ? fmtNum(item.streams) + " streams" : fmtMinutes(item.minutes);
    }

    function derivePeriods(base) {
        const periods = {
            all: base.map((x) => ({ name: x.name, artist: x.artist, id: x.id, minutes: x.minutes, streams: x.streams })),
        };
        AVAILABLE_YEARS.forEach((y, yi) => {
            const decay = 1 - yi * 0.18;
            const arr = base
                .map((it, i) => {
                    const seed = ((i + 1) * (yi * 17 + 7)) % 13;
                    const wob = 0.45 + (seed / 12) * 1.5;
                    return {
                        name: it.name, artist: it.artist, id: it.id,
                        minutes: Math.round(it.minutes * wob * decay * 0.5),
                        streams: Math.round(it.streams * wob * decay * 0.5),
                    };
                })
                .filter((x) => x.minutes > 0);
            arr.sort((a, b) => b.minutes - a.minutes);
            periods[y] = arr;
        });
        return periods;
    }
    function samplePeriods(entity) {
        const k = "sample:" + entity;
        if (!cache[k]) cache[k] = derivePeriods(SAMPLE[entity]);
        return cache[k];
    }

    // Returns a ranked list for entity+sort+range. Tries the backend, else sample.
    async function getList(entity, sort, range) {
        const key = entity + ":" + sort + ":" + range;
        if (cache[key]) return cache[key];
        let items = null;
        if (window.fetchWithTimeout) {
            const q = "/api/metrics/chart?entity=" + entity + "&sort=" + sort + "&limit=100&range=" + range;
            const res = await window.fetchWithTimeout(q).catch(() => null);
            if (res && res.ok && res.data) {
                if (Array.isArray(res.data.items) && res.data.items.length) items = res.data.items;
                if (Array.isArray(res.data.years) && res.data.years.length) apiYears = res.data.years.map(String);
            }
        }
        if (!items) {
            // No real data (nothing uploaded yet, or the API is unreachable).
            // Only the labeled sample mockup shows placeholder data; real pages
            // get an empty list so render() shows the honest "upload" state.
            if (window.REWIND_ALLOW_SAMPLE) {
                const periods = samplePeriods(entity);
                items = (periods[range] || periods.all).slice().sort((a, b) => b[sort] - a[sort]);
            } else {
                items = [];
            }
        }
        cache[key] = items;
        return items;
    }

    // Warm the sibling entity tabs AND the other years (data + covers) during
    // idle time, so switching year or entity is instant instead of "click, wait".
    // Idempotent: getList + preloadCovers dedupe against their caches, and covers
    // overlap heavily across years, so the incremental cost shrinks fast.
    let prefetchScheduled = false;
    function schedulePrefetch() {
        if (prefetchScheduled) return;
        prefetchScheduled = true;
        const idle = window.requestIdleCallback || ((f) => setTimeout(f, 500));
        idle(() => { prefetchScheduled = false; prefetchNeighbors(); });
    }
    async function warmView(entity, sort, range) {
        const cfg = ENTITIES[entity];
        try {
            const items = await getList(entity, sort, range);
            if (cfg.cover && window.preloadCovers && items.length) {
                const n = Math.min(items.length, Math.max(state.depth, 20), 50);
                await window.preloadCovers(cfg.cover, items.slice(0, n).map((it) => it.id).filter(Boolean));
            }
        } catch (_) { /* prefetch is best-effort */ }
    }
    async function prefetchNeighbors() {
        const { entity, sort, range } = state;
        const years = (apiYears && apiYears.length ? apiYears : AVAILABLE_YEARS).map(String);
        // Current entity across every year → instant year switching.
        for (const r of ["all", ...years]) {
            if (r !== range) await warmView(entity, sort, r);
        }
        // Sibling entities for the current year → instant entity switching.
        for (const e of Object.keys(ENTITIES)) {
            if (e !== entity) await warmView(e, sort, range);
        }
    }

    // ── rendering ─────────────────────────────────────────────────────────────
    function coverCell(item, big) {
        const cfg = ENTITIES[state.entity];
        const size = big ? "w-16 h-16 sm:w-20 sm:h-20" : "w-11 h-11";
        const shape = cfg.round ? "rounded-full" : "rounded-md";
        if (!cfg.cover) {
            return '<div class="' + size + " " + shape + ' bg-primary/15 flex items-center justify-center shrink-0">' +
                '<span class="material-symbols-outlined text-primary">category</span></div>';
        }
        const icon = state.entity === "artist" ? "artist" : "music_note";
        const img = item.id
            ? '<img class="cover-img hidden absolute inset-0 w-full h-full object-cover ' + shape + '" data-cover-id="' + esc(item.id) + '" alt="">'
            : "";
        return '<div class="' + size + " " + shape + ' bg-surface-container-high relative overflow-hidden shrink-0">' +
            '<span class="absolute inset-0 flex items-center justify-center text-on-surface-variant opacity-40">' +
            '<span class="material-symbols-outlined">' + icon + "</span></span>" + img + "</div>";
    }

    function movementBadge(move) {
        if (move === "new") return '<span class="text-[10px] font-bold tracking-wide text-primary">NEW</span>';
        if (move == null || move === 0) return "";
        const up = move > 0;
        return '<span class="text-[10px] font-bold tabular-nums ' + (up ? "text-primary" : "text-error") + '">' +
            (up ? "▲" : "▼") + Math.abs(move) + "</span>";
    }

    function rankClass(rank) {
        if (rank === 1) return "text-primary";
        if (rank === 2) return "text-primary/80";
        if (rank === 3) return "text-primary/60";
        return "text-on-surface-variant";
    }

    function rowHTML(item, rank, maxVal, move, isMatch) {
        const cfg = ENTITIES[state.entity];
        const share = maxVal > 0 ? Math.max(3, Math.round((item[state.sort] / maxVal) * 100)) : 0;
        const artistLine = cfg.hasArtist && item.artist
            ? '<div class="text-[12px] text-on-surface-variant opacity-70 truncate">' + esc(item.artist) + "</div>"
            : "";
        return '<div class="chart-row flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-2.5' +
            (isMatch ? " chart-row--match" : "") + '" data-rank="' + rank + '">' +
            '<div class="w-7 sm:w-9 text-right font-mono text-body-lg font-bold shrink-0 ' + rankClass(rank) + '">' + rank + "</div>" +
            coverCell(item, false) +
            '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-2">' +
                    '<span class="font-semibold text-on-surface truncate">' + esc(item.name) + "</span>" +
                    movementBadge(move) +
                "</div>" + artistLine +
                '<div class="mt-1.5 h-1 rounded-full bg-surface-container-high overflow-hidden">' +
                    '<div class="h-full bg-primary/70 rounded-full" style="width:' + share + '%"></div>' +
                "</div>" +
            "</div>" +
            '<div class="text-right shrink-0">' +
                '<div class="font-semibold text-on-surface tabular-nums">' + statText(item) + "</div>" +
                '<div class="text-[11px] text-on-surface-variant opacity-70 tabular-nums">' + subStatText(item) + "</div>" +
            "</div>" +
        "</div>";
    }

    function podiumCardHTML(item, rank, move) {
        const cfg = ENTITIES[state.entity];
        const lift = rank === 1 ? " sm:-mt-6 ring-1 ring-primary/40" : "";
        const artistLine = cfg.hasArtist && item.artist
            ? '<div class="text-[11px] text-on-surface-variant opacity-70 truncate w-full">' + esc(item.artist) + "</div>"
            : "";
        return '<div class="glass-card rounded-2xl p-4 flex flex-col items-center text-center' + lift + '">' +
            '<div class="font-mono text-headline-md font-bold ' + rankClass(rank) + '">' + rank + "</div>" +
            '<div class="my-3">' + coverCell(item, true) + "</div>" +
            '<div class="font-semibold text-on-surface truncate w-full">' + esc(item.name) + "</div>" +
            artistLine +
            '<div class="text-primary font-bold mt-1 tabular-nums">' + statText(item) + "</div>" +
        "</div>";
    }

    function loadRowCovers(container) {
        if (window.loadCoversBatch) {
            window.loadCoversBatch(container, ENTITIES[state.entity].cover);
            return;
        }
        if (!window.loadCover) return;
        container.querySelectorAll("img.cover-img[data-cover-id]").forEach((img) => {
            window.loadCover(img, ENTITIES[state.entity].cover, img.getAttribute("data-cover-id"));
        });
    }

    function prevPeriodKey(range) {
        if (range === "all") return null;
        const prev = String(Number(range) - 1);
        return AVAILABLE_YEARS.indexOf(prev) !== -1 ? prev : null;
    }

    async function render() {
        const listEl = document.getElementById("chart-list");
        const podiumEl = document.getElementById("chart-podium");
        const emptyEl = document.getElementById("chart-empty");
        if (!listEl) return;

        const { entity, sort, range, search } = state;
        const full = await getList(entity, sort, range);
        lastFull = full;
        syncYears();

        updateHeading();

        if (!full.length) {
            listEl.innerHTML = "";
            podiumEl.innerHTML = "";
            emptyEl.classList.remove("hidden");
            return;
        }
        emptyEl.classList.add("hidden");

        // Movement vs the previous year. Real backend rows carry prev_rank
        // (keyed by a merge-safe artist key); sample rows are matched by name.
        const isYear = /^\d{4}$/.test(range);
        const backendPrev = full.length > 0 && Object.prototype.hasOwnProperty.call(full[0], "prev_rank");
        let prevMap = null;
        if (!backendPrev) {
            const pk = prevPeriodKey(range);
            if (pk) {
                const prevList = await getList(entity, sort, pk);
                prevMap = {};
                prevList.forEach((it, i) => { prevMap[it.name + "|" + (it.artist || "")] = i + 1; });
            }
        }
        const moveOf = (item, rank) => {
            if (backendPrev) {
                if (!isYear) return null;
                return item.prev_rank == null ? "new" : item.prev_rank - rank;
            }
            if (!prevMap) return null;
            const p = prevMap[item.name + "|" + (item.artist || "")];
            return p ? p - rank : "new";
        };

        // search: locate matches across the FULL list
        const q = search.trim().toLowerCase();
        let matchRanks = null;
        let firstMatchRank = null;
        if (q) {
            matchRanks = new Set();
            full.forEach((it, i) => {
                const hay = (it.name + " " + (it.artist || "")).toLowerCase();
                if (hay.indexOf(q) !== -1) {
                    matchRanks.add(i + 1);
                    if (firstMatchRank == null) firstMatchRank = i + 1;
                }
            });
        }

        // how deep to render: honour depth, but extend to reveal a search hit
        let visible = state.depth;
        if (firstMatchRank) visible = Math.max(visible, firstMatchRank);
        visible = Math.min(visible, full.length);
        const shown = full.slice(0, visible);
        const maxVal = full[0][sort];

        podiumEl.innerHTML = shown.length >= 3
            ? [1, 0, 2].map((idx) => podiumCardHTML(shown[idx], idx + 1, null)).join("")
            : "";
        loadRowCovers(podiumEl);

        listEl.innerHTML = shown
            .map((it, i) => rowHTML(it, i + 1, maxVal, moveOf(it, i + 1), matchRanks ? matchRanks.has(i + 1) : false))
            .join("");
        loadRowCovers(listEl);

        updateSearchBanner(q, matchRanks, firstMatchRank, full);

        if (firstMatchRank) {
            const target = listEl.querySelector('.chart-row[data-rank="' + firstMatchRank + '"]');
            if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        schedulePrefetch();
    }

    function updateHeading() {
        const title = document.getElementById("chart-title");
        const sub = document.getElementById("chart-subtitle");
        if (title) title.textContent = "Top " + ENTITIES[state.entity].label;
        if (sub) {
            const rangeLabel = state.range === "all" ? "All-time" : state.range;
            sub.textContent = rangeLabel + " · by " + state.sort;
        }
    }

    function updateSearchBanner(q, matchRanks, firstMatchRank, full) {
        const banner = document.getElementById("chart-search-result");
        if (!banner) return;
        if (!q) { banner.classList.add("hidden"); banner.innerHTML = ""; return; }
        banner.classList.remove("hidden");
        const noun = ENTITIES[state.entity].label.toLowerCase();
        if (firstMatchRank) {
            const hit = full[firstMatchRank - 1];
            const who = esc(hit.name) + (hit.artist ? " · " + esc(hit.artist) : "");
            banner.innerHTML =
                '<span class="material-symbols-outlined text-primary">leaderboard</span>' +
                "<span><b>" + who + "</b> — <span class=\"text-primary font-bold\">#" + firstMatchRank + "</span> of your top " + noun +
                (matchRanks.size > 1 ? ' <span class="opacity-60">(' + matchRanks.size + " matches)</span>" : "") + "</span>";
        } else {
            banner.innerHTML =
                '<span class="material-symbols-outlined text-on-surface-variant">search_off</span>' +
                "<span>No match for “" + esc(q) + "” in your top " + noun + ".</span>";
        }
    }

    // ── controls ──────────────────────────────────────────────────────────────
    function setActive(container, attr, value) {
        if (!container) return;
        container.querySelectorAll("[" + attr + "]").forEach((btn) => {
            btn.classList.toggle("is-active", btn.getAttribute(attr) === String(value));
        });
    }

    function buildRangeTabs(years) {
        const el = document.getElementById("range-tabs");
        if (!el) return;
        const list = (years && years.length ? years : AVAILABLE_YEARS).map(String);
        const tabs = [{ v: "all", label: "All-time" }].concat(list.map((y) => ({ v: y, label: y })));
        el.innerHTML = tabs
            .map((t) => '<button data-range="' + t.v + '" class="range-tab px-3.5 py-1.5 rounded-full text-label-bold font-label-bold whitespace-nowrap transition-all">' + t.label + "</button>")
            .join("");
        el.querySelectorAll("[data-range]").forEach((btn) => {
            btn.addEventListener("click", () => { state.range = btn.getAttribute("data-range"); setActive(el, "data-range", state.range); render(); });
        });
        setActive(el, "data-range", state.range);
    }

    // Rebuild the range pills from the real backend years, once we have them.
    function syncYears() {
        if (yearsSynced || !apiYears || !apiYears.length) return;
        yearsSynced = true;
        if (state.range !== "all" && apiYears.indexOf(state.range) === -1) state.range = "all";
        buildRangeTabs(apiYears);
    }

    function buildDepthTabs() {
        const el = document.getElementById("depth-tabs");
        if (!el) return;
        el.innerHTML = DEPTHS
            .map((d) => '<button data-depth="' + d + '" class="depth-btn px-3 py-1.5 rounded-full text-label-bold font-label-bold transition-all">' + d + "</button>")
            .join("");
        el.querySelectorAll("[data-depth]").forEach((btn) => {
            btn.addEventListener("click", () => { state.depth = Number(btn.getAttribute("data-depth")); setActive(el, "data-depth", state.depth); render(); });
        });
        setActive(el, "data-depth", state.depth);
    }

    function wireTabs() {
        const entityTabs = document.getElementById("chart-entity-tabs");
        if (entityTabs) {
            entityTabs.querySelectorAll("[data-entity]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.entity = btn.getAttribute("data-entity");
                    setActive(entityTabs, "data-entity", state.entity);
                    render();
                });
            });
            setActive(entityTabs, "data-entity", state.entity);
        }
        const sortTabs = document.getElementById("sort-tabs");
        if (sortTabs) {
            sortTabs.querySelectorAll("[data-sort]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    state.sort = btn.getAttribute("data-sort");
                    setActive(sortTabs, "data-sort", state.sort);
                    render();
                });
            });
            setActive(sortTabs, "data-sort", state.sort);
        }
    }

    function wireSearch() {
        const input = document.getElementById("chart-search");
        const clear = document.getElementById("chart-search-clear");
        if (!input) return;
        let t = null;
        input.addEventListener("input", () => {
            if (t) clearTimeout(t);
            const v = input.value;
            if (clear) clear.classList.toggle("hidden", !v);
            t = setTimeout(() => { state.search = v; render(); }, 140);
        });
        if (clear) {
            clear.addEventListener("click", () => {
                input.value = ""; state.search = ""; clear.classList.add("hidden"); input.focus(); render();
            });
        }
    }

    // Current top-10 snapshot for the shareable card.
    function snapshot() {
        const cfg = ENTITIES[state.entity];
        return {
            entity: state.entity,
            label: cfg.label,
            hasArtist: cfg.hasArtist,
            rangeLabel: state.range === "all" ? "All-time" : state.range,
            sort: state.sort,
            items: lastFull.slice(0, 10),
        };
    }
    window.RewindCharts = { snapshot: snapshot };

    function init() {
        wireTabs();
        buildRangeTabs();
        buildDepthTabs();
        wireSearch();
        render();
        window.addEventListener("rewind:data-updated", () => {
            for (const k in cache) { if (k.indexOf("sample:") !== 0) delete cache[k]; }
            apiYears = null;
            yearsSynced = false;
            render();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
