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
    function rankClass(rank) {
        if (rank === 1) return "text-primary";
        if (rank === 2) return "text-primary/80";
        if (rank === 3) return "text-primary/60";
        return "text-on-surface-variant";
    }
    function trackCover(id) {
        const img = id
            ? '<img class="cover-img hidden absolute inset-0 w-full h-full object-cover rounded-md" data-cover-id="' + esc(id) + '" alt="">'
            : "";
        return '<div class="w-10 h-10 rounded-md bg-surface-container-high relative overflow-hidden shrink-0">' +
            '<span class="absolute inset-0 flex items-center justify-center text-on-surface-variant opacity-40">' +
            '<span class="material-symbols-outlined text-lg">music_note</span></span>' + img + "</div>";
    }
    function loadCovers(container) {
        if (!window.loadCover) return;
        container.querySelectorAll("img.cover-img[data-cover-id]").forEach((img) => {
            window.loadCover(img, "track", img.getAttribute("data-cover-id"));
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
                if (Array.isArray(res.data.obsession) && res.data.obsession.length) data = res.data.obsession;
            }
        }
        if (!data) data = SAMPLE_OBSESSION.map((o, i) => Object.assign({ rank: i + 1 }, o));
        cache[range] = data;
        return data;
    }

    function renderObsession(rows) {
        const el = document.getElementById("obsession-list");
        if (!el) return;
        el.innerHTML = rows
            .map((it, i) => {
                const rank = it.rank || i + 1;
                const sub = esc(it.artist || "") + (it.date ? ' · <span class="opacity-70">' + fmtDate(it.date) + "</span>" : "");
                return '<div class="chart-row flex items-center gap-3 px-2 py-2 rounded-lg">' +
                    '<div class="w-6 text-right font-mono font-bold shrink-0 ' + rankClass(rank) + '">' + rank + "</div>" +
                    trackCover(it.id) +
                    '<div class="min-w-0 flex-1">' +
                        '<div class="font-semibold text-on-surface truncate">' + esc(it.name) + "</div>" +
                        '<div class="text-[11px] text-on-surface-variant truncate">' + sub + "</div>" +
                    "</div>" +
                    '<div class="text-right shrink-0">' +
                        '<div class="text-primary font-bold tabular-nums leading-none">×' + it.count + "</div>" +
                        '<div class="text-[10px] text-on-surface-variant opacity-60 mt-0.5">in a day</div>' +
                    "</div>" +
                "</div>";
            })
            .join("");
        loadCovers(el);
    }

    async function render() {
        const rows = await fetchData(state.range);
        syncYears();
        renderObsession(rows);
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
