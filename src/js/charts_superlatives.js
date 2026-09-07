/**
 * Rewind — Charts superlatives section.
 * "Your records" as Top-N lists, viewable per year or all-time. Its own range
 * selector (independent of the main leaderboard). Currently: Obsession of the
 * Day (the track you played most in a single day). Falls back to SAMPLE data.
 */
(function () {
    "use strict";

    const AVAILABLE_YEARS = ["2025", "2024", "2023", "2022"];

    const SAMPLE_OBSESSION = [
        { name: "Snooze", artist: "SZA", id: "4iZ4pt7kvcaH6Yo8UoZ4s2", count: 14, date: "2023-06-18" },
        { name: "Kill Bill", artist: "SZA", id: null, count: 12, date: "2023-01-22" },
        { name: "WITHOUT YOU", artist: "The Kid LAROI", id: null, count: 11, date: "2022-11-05" },
        { name: "Lost Me", artist: "Giveon", id: null, count: 9, date: "2024-02-14" },
        { name: "Water", artist: "Tyla", id: null, count: 8, date: "2024-08-09" },
        { name: "Calm Down", artist: "Rema", id: null, count: 7, date: "2023-03-30" },
        { name: "Nobody Gets Me", artist: "SZA", id: "5Y35SjAfXjjG0sFQ3KOxmm", count: 7, date: "2023-01-08" },
    ];

    const SAMPLE_ON_REPEAT = [
        { name: "Snooze", artist: "SZA", id: "4iZ4pt7kvcaH6Yo8UoZ4s2", count: 6 },
        { name: "Good Days", artist: "SZA", id: null, count: 5 },
        { name: "Calm Down", artist: "Rema", id: null, count: 4 },
        { name: "Water", artist: "Tyla", id: null, count: 4 },
        { name: "Kill Bill", artist: "SZA", id: null, count: 3 },
        { name: "Lost Me", artist: "Giveon", id: null, count: 3 },
        { name: "Peru", artist: "Fireboy DML", id: null, count: 2 },
    ];

    const SAMPLE_BINGES = [
        { name: "SZA", id: "7tYKF4w9nC0nq9CsPZTHyP", minutes: 341, date: "2023-06-18", plays: 47 },
        { name: "J. Cole", id: null, minutes: 268, date: "2023-01-22", plays: 39 },
        { name: "Drake", id: null, minutes: 214, date: "2024-02-14", plays: 33 },
        { name: "Summer Walker", id: null, minutes: 182, date: "2024-08-09", plays: 28 },
        { name: "Giveon", id: null, minutes: 151, date: "2023-03-30", plays: 24 },
        { name: "Brent Faiyaz", id: null, minutes: 128, date: "2023-11-02", plays: 20 },
    ];

    const SAMPLE_MOST_SKIPPED = [
        { name: "Grey", artist: "Yung Filly", id: null, plays: 115, skip_pct: 93 },
        { name: "Until I Found You", artist: "Stephen Sanchez", id: null, plays: 22, skip_pct: 86 },
        { name: "You Are The Reason", artist: "Calum Scott", id: null, plays: 18, skip_pct: 83 },
        { name: "Rockabye", artist: "Clean Bandit", id: null, plays: 14, skip_pct: 79 },
        { name: "7 Years", artist: "Lukas Graham", id: null, plays: 12, skip_pct: 75 },
        { name: "As It Was", artist: "Harry Styles", id: null, plays: 10, skip_pct: 70 },
    ];

    const SAMPLE_NEVER_SKIPPED = [
        { name: "Snooze", artist: "SZA", id: "4iZ4pt7kvcaH6Yo8UoZ4s2", plays: 176 },
        { name: "Nobody Gets Me", artist: "SZA", id: "5Y35SjAfXjjG0sFQ3KOxmm", plays: 158 },
        { name: "Lost Me", artist: "Giveon", id: null, plays: 121 },
        { name: "Session 32", artist: "Summer Walker", id: null, plays: 98 },
        { name: "Best Part", artist: "Daniel Caesar", id: null, plays: 76 },
        { name: "Open Arms", artist: "SZA", id: null, plays: 64 },
    ];

    const state = { range: "all" };
    const cache = {};
    let apiYears = null;
    let yearsSynced = false;

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function fmtDate(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
        if (!m) return "";
        return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
    }
    function fmtMins(m) {
        m = Math.round(m || 0);
        if (m < 60) return m + "m";
        const h = Math.floor(m / 60);
        const rem = m % 60;
        return rem ? h + "h " + rem + "m" : h + "h";
    }
    function fmtNum(n) {
        return Number(n || 0).toLocaleString();
    }
    function rankClass(rank) {
        if (rank === 1) return "text-primary";
        if (rank === 2) return "text-primary/80";
        if (rank === 3) return "text-primary/60";
        return "text-on-surface-variant";
    }
    function trackCover(id) {
        const img = id
            ? '<img class="cover-img hidden absolute inset-0 w-full h-full object-cover rounded-md" data-cover-kind="track" data-cover-id="' + esc(id) + '" alt="">'
            : "";
        return '<div class="w-10 h-10 rounded-md bg-surface-container-high relative overflow-hidden shrink-0">' +
            '<span class="absolute inset-0 flex items-center justify-center text-on-surface-variant opacity-40">' +
            '<span class="material-symbols-outlined text-lg">music_note</span></span>' + img + "</div>";
    }
    // Binges are an ARTIST's session, so show the artist's photo (round), not a
    // random track cover from that session.
    function artistCover(id) {
        const img = id
            ? '<img class="cover-img hidden absolute inset-0 w-full h-full object-cover rounded-full" data-cover-kind="artist" data-cover-id="' + esc(id) + '" alt="">'
            : "";
        return '<div class="w-10 h-10 rounded-full bg-surface-container-high relative overflow-hidden shrink-0">' +
            '<span class="absolute inset-0 flex items-center justify-center text-on-surface-variant opacity-40">' +
            '<span class="material-symbols-outlined text-lg">artist</span></span>' + img + "</div>";
    }
    function loadCovers(container) {
        if (window.loadCoversBatch) {
            window.loadCoversBatch(container, "track");
            return;
        }
        if (!window.loadCover) return;
        container.querySelectorAll("img.cover-img[data-cover-id]").forEach((img) => {
            window.loadCover(img, img.getAttribute("data-cover-kind") || "track", img.getAttribute("data-cover-id"));
        });
    }

    async function fetchData(range) {
        if (cache[range]) return cache[range];
        let data = null;
        if (window.fetchWithTimeout) {
            const res = await window.fetchWithTimeout(
                "/api/metrics/superlatives?range=" + range + "&limit=10"
            ).catch(() => null);
            if (res && res.ok && res.data) {
                if (Array.isArray(res.data.years) && res.data.years.length) apiYears = res.data.years.map(String);
                const obs = Array.isArray(res.data.obsession) ? res.data.obsession : [];
                const rep = Array.isArray(res.data.on_repeat) ? res.data.on_repeat : [];
                const bng = Array.isArray(res.data.binges) ? res.data.binges : [];
                const msk = Array.isArray(res.data.most_skipped) ? res.data.most_skipped : [];
                const nsk = Array.isArray(res.data.never_skipped) ? res.data.never_skipped : [];
                if (obs.length || rep.length || bng.length || msk.length || nsk.length) {
                    data = { obsession: obs, on_repeat: rep, binges: bng, most_skipped: msk, never_skipped: nsk };
                }
            }
        }
        if (!data) {
            data = {
                obsession: SAMPLE_OBSESSION.map((o, i) => Object.assign({ rank: i + 1 }, o)),
                on_repeat: SAMPLE_ON_REPEAT.map((o, i) => Object.assign({ rank: i + 1 }, o)),
                binges: SAMPLE_BINGES.map((o, i) => Object.assign({ rank: i + 1 }, o)),
                most_skipped: SAMPLE_MOST_SKIPPED.map((o, i) => Object.assign({ rank: i + 1 }, o)),
                never_skipped: SAMPLE_NEVER_SKIPPED.map((o, i) => Object.assign({ rank: i + 1 }, o)),
            };
        }
        cache[range] = data;
        return data;
    }

    // opts = { value(item), badge(item)|string, sub(item), cover(item)? }.
    function renderList(elId, rows, opts) {
        const el = document.getElementById(elId);
        if (!el) return;
        const badgeOf = typeof opts.badge === "function" ? opts.badge : () => opts.badge;
        const coverOf = opts.cover || ((it) => trackCover(it.id));
        el.innerHTML = rows
            .map((it, i) => {
                const rank = it.rank || i + 1;
                return '<div class="chart-row flex items-center gap-3 px-2 py-2 rounded-lg">' +
                    '<div class="w-6 text-right font-mono font-bold shrink-0 ' + rankClass(rank) + '">' + rank + "</div>" +
                    coverOf(it) +
                    '<div class="min-w-0 flex-1">' +
                        '<div class="font-semibold text-on-surface truncate">' + esc(it.name) + "</div>" +
                        '<div class="text-[11px] text-on-surface-variant truncate">' + opts.sub(it) + "</div>" +
                    "</div>" +
                    '<div class="text-right shrink-0">' +
                        '<div class="text-primary font-bold tabular-nums leading-none">' + opts.value(it) + "</div>" +
                        '<div class="text-[10px] text-on-surface-variant opacity-60 mt-0.5">' + badgeOf(it) + "</div>" +
                    "</div>" +
                "</div>";
            })
            .join("");
        loadCovers(el);
    }

    const times = (it) => "\u00d7" + it.count;
    const withDate = (it) => esc(it.artist || "") + (it.date ? ' · <span class="opacity-70">' + fmtDate(it.date) + "</span>" : "");
    const artistOnly = (it) => esc(it.artist || "");
    const bingeSub = (it) => (it.plays ? it.plays + " tracks · " : "") + '<span class="opacity-70">' + fmtDate(it.date) + "</span>";
    const skipVal = (it) => it.skip_pct + "%";
    const skipSub = (it) => esc(it.artist || "") + (it.plays ? ' · <span class="opacity-70">' + it.plays + " plays</span>" : "");
    const playsVal = (it) => fmtNum(it.plays);

    async function render() {
        const data = await fetchData(state.range);
        syncYears();
        renderList("obsession-list", data.obsession, { value: times, badge: "in a day", sub: withDate });
        renderList("on-repeat-list", data.on_repeat, { value: times, badge: "in a row", sub: artistOnly });
        renderList("binge-list", data.binges, { value: (it) => fmtMins(it.minutes), badge: "in one sitting", sub: bingeSub, cover: (it) => artistCover(it.id) });
        renderList("most-skipped-list", data.most_skipped, { value: skipVal, badge: "skipped", sub: skipSub });
        renderList("never-skipped-list", data.never_skipped, { value: playsVal, badge: "never skipped", sub: artistOnly });
    }

    function setActive(el, value) {
        el.querySelectorAll("[data-range]").forEach((b) => {
            b.classList.toggle("is-active", b.getAttribute("data-range") === String(value));
        });
    }
    function buildRangeTabs(years) {
        const el = document.getElementById("super-range-tabs");
        if (!el) return;
        const list = (years && years.length ? years : AVAILABLE_YEARS).map(String);
        const tabs = [{ v: "all", label: "All-time" }].concat(list.map((y) => ({ v: y, label: y })));
        el.innerHTML = tabs
            .map((t) => '<button data-range="' + t.v + '" class="range-tab px-3.5 py-1.5 rounded-full text-label-bold font-label-bold whitespace-nowrap transition-all">' + t.label + "</button>")
            .join("");
        el.querySelectorAll("[data-range]").forEach((b) => {
            b.addEventListener("click", () => { state.range = b.getAttribute("data-range"); setActive(el, state.range); render(); });
        });
        setActive(el, state.range);
    }
    function syncYears() {
        if (yearsSynced || !apiYears || !apiYears.length) return;
        yearsSynced = true;
        if (state.range !== "all" && apiYears.indexOf(state.range) === -1) state.range = "all";
        buildRangeTabs(apiYears);
    }

    function init() {
        buildRangeTabs();
        render();
        window.addEventListener("rewind:data-updated", () => {
            for (const k in cache) delete cache[k];
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
