/**
 * Rewind - All-Time Bar Race (src/js/bar_race.js)
 *
 * Horizontal bar-chart race of cumulative listening time. The value is a running
 * SUM(ms_played) per entity, so bars only ever grow — the animation is smooth by
 * construction and the final frame equals the all-time leaderboard.
 * Data comes from GET /api/metrics/bar-race?entity=artist|track|album.
 */

(function () {
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    const VISIBLE_N = 10;
    const ROW_GAP = 44;          // px between row tops
    const SECONDS_PER_MONTH = 0.9;
    const EASE_TAU = 0.22;       // vertical glide time constant (s) — smaller = snappier

    // Monochrome green ramp (theme): brighter at the top, deeper toward the bottom.
    function greenShade(pos) {
        const t = VISIBLE_N > 1 ? Math.min(pos, VISIBLE_N - 1) / (VISIBLE_N - 1) : 0;
        return `hsl(145, 63%, ${58 - t * 30}%)`;
    }

    // Module state
    let entity = "artist";
    let months = [];
    let items = [];              // [{ name, artist_name?, cumulative: number[] }]
    let rowEls = [];             // DOM row per item, index-aligned with `items`
    let curY = [];               // eased vertical position per row
    let curOp = [];              // eased opacity per row
    let progress = 0;            // 0 .. months.length-1
    let isPlaying = true;
    let speed = 1.0;
    let rafId = null;
    let lastTs = null;

    function monthLabel(idx) {
        if (!months.length) return "----";
        const i = Math.min(Math.max(0, Math.floor(idx)), months.length - 1);
        const yyyymm = months[i];
        const y = yyyymm.slice(0, 4);
        const m = parseInt(yyyymm.slice(5, 7), 10) - 1;
        return `${MONTH_NAMES[m]} ${y}`.toUpperCase();
    }

    function fmtValue(min) {
        const h = min / 60;
        if (h >= 1) return `${h.toLocaleString(undefined, { maximumFractionDigits: 0 })}h`;
        return `${Math.round(min)}m`;
    }

    function valueAt(cum, p) {
        if (!cum.length) return 0;
        const i = Math.floor(p);
        if (i >= cum.length - 1) return cum[cum.length - 1];
        const frac = p - i;
        return cum[i] + (cum[i + 1] - cum[i]) * frac;
    }

    function buildRows() {
        const container = document.getElementById("race-rows");
        if (!container) return;
        container.innerHTML = "";
        rowEls = [];
        curY = [];
        curOp = [];
        container.style.height = `${VISIBLE_N * ROW_GAP}px`;

        items.forEach((item) => {
            const row = document.createElement("div");
            row.className = "race-row";
            row.style.cssText =
                "position:absolute;left:0;right:0;top:0;opacity:0;" +
                "transform:translateY(0px);will-change:transform,opacity;";
            const sub = item.artist_name
                ? `<span class="text-on-surface-variant font-normal opacity-70"> · ${item.artist_name}</span>`
                : "";
            row.innerHTML = `
                <div class="flex items-center gap-2 h-10">
                    <div class="race-rank w-6 text-right font-mono text-label-bold text-on-surface-variant"></div>
                    <div class="race-name w-28 md:w-44 truncate text-body-sm font-bold text-on-surface" title="${item.name}">${item.name}${sub}</div>
                    <div class="flex-1 h-6 rounded-full bg-surface-container-high/40 overflow-hidden">
                        <div class="race-bar h-full rounded-full" style="width:0%;"></div>
                    </div>
                    <div class="race-value w-16 text-right font-mono text-label-bold text-on-surface"></div>
                </div>`;
            container.appendChild(row);
            rowEls.push(row);
            curY.push(VISIBLE_N * ROW_GAP);
            curOp.push(0);
        });
    }

    function render(dt) {
        const empty = document.getElementById("race-empty");
        const container = document.getElementById("race-rows");
        if (!container) return;

        if (!items.length || !months.length) {
            if (empty) empty.classList.remove("hidden");
            container.classList.add("hidden");
            return;
        }
        if (empty) empty.classList.add("hidden");
        container.classList.remove("hidden");

        const values = items.map((it) => valueAt(it.cumulative, progress));
        const order = values
            .map((v, i) => i)
            .sort((a, b) => values[b] - values[a]);
        const maxVal = values[order[0]] || 1;

        const slotOf = new Array(items.length).fill(-1);
        order.forEach((itemIdx, pos) => { slotOf[itemIdx] = pos; });

        // Frame-rate independent easing. dt === null snaps (used for scrubbing).
        const k = dt == null ? 1 : 1 - Math.exp(-dt / EASE_TAU);

        items.forEach((item, i) => {
            const row = rowEls[i];
            if (!row) return;
            const pos = slotOf[i];
            const onChart = pos < VISIBLE_N;
            const targetY = (onChart ? pos : VISIBLE_N) * ROW_GAP;

            curY[i] += (targetY - curY[i]) * k;
            curOp[i] += ((onChart ? 1 : 0) - curOp[i]) * k;
            row.style.transform = `translateY(${curY[i].toFixed(2)}px)`;
            row.style.opacity = curOp[i].toFixed(3);

            const bar = row.querySelector(".race-bar");
            const rankEl = row.querySelector(".race-rank");
            const valEl = row.querySelector(".race-value");
            if (bar) {
                bar.style.width = `${Math.max(0, (values[i] / maxVal) * 100)}%`;
                if (onChart) bar.style.background = greenShade(pos);
            }
            if (rankEl) rankEl.textContent = `${pos + 1}`;
            if (valEl) valEl.textContent = fmtValue(values[i]);
        });

        const monthDisp = document.getElementById("race-month-display");
        if (monthDisp) monthDisp.textContent = monthLabel(progress);
        const scrubber = document.getElementById("race-scrubber");
        if (scrubber && document.activeElement !== scrubber) {
            scrubber.max = Math.max(0, months.length - 1);
            scrubber.value = progress;
        }
    }

    function setPlayIcon() {
        const icon = document.getElementById("race-play-icon");
        if (icon) icon.textContent = isPlaying ? "pause" : "play_arrow";
    }

    function loop(ts) {
        if (lastTs == null) lastTs = ts;
        const dt = (ts - lastTs) / 1000;
        lastTs = ts;

        if (isPlaying && months.length > 1) {
            const maxP = months.length - 1;
            progress += (dt / SECONDS_PER_MONTH) * speed;
            if (progress >= maxP) {
                progress = maxP;      // hold on the final all-time standings
                isPlaying = false;
                setPlayIcon();
            }
        }
        // Always render so the eased motion keeps settling even while paused.
        render(Math.min(dt, 0.05));
        rafId = requestAnimationFrame(loop);
    }

    async function fetchRace() {
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            return { ok: res.ok, data: await res.json() };
        });

        const res = await fetcher(`/api/metrics/bar-race?entity=${entity}&limit=12`, {}, 6000);
        if (!(res.ok && res.data && res.data.status === "ok")) {
            items = [];
            months = [];
            render();
            return;
        }

        months = Array.isArray(res.data.months) ? res.data.months : [];
        items = (res.data.data || []).map((d) => ({
            name: d.name || "Unknown",
            artist_name: d.artist_name || null,
            cumulative: Array.isArray(d.cumulative_minutes) ? d.cumulative_minutes : [],
        }));

        progress = 0;
        isPlaying = months.length > 1;
        setPlayIcon();

        const startEl = document.getElementById("race-start-year");
        const endEl = document.getElementById("race-end-year");
        if (startEl && months.length) startEl.textContent = months[0].slice(0, 4);
        if (endEl && months.length) endEl.textContent = months[months.length - 1].slice(0, 4);

        buildRows();
        render(null);
    }

    // ---- Exposed controls (wired from time.html) ----
    window.switchRaceEntity = function (next) {
        if (next === entity) return;
        entity = next;
        ["artist", "track", "album"].forEach((e) => {
            const btn = document.getElementById(`race-tab-${e}s`);
            if (!btn) return;
            btn.className = e === entity
                ? "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-label-bold font-label-bold transition-all bg-primary text-on-primary shadow-sm"
                : "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-label-bold font-label-bold transition-all text-on-surface-variant hover:text-on-surface";
        });
        fetchRace();
    };

    window.toggleRacePlay = function () {
        if (months.length <= 1) return;
        if (!isPlaying && progress >= months.length - 1) progress = 0;  // replay from start
        isPlaying = !isPlaying;
        setPlayIcon();
    };

    window.resetRace = function () {
        progress = 0;
        isPlaying = true;
        setPlayIcon();
        render(null);
    };

    window.onRaceScrub = function (val) {
        progress = parseFloat(val);
        render(null);
    };

    window.setRaceSpeed = function (spd) {
        speed = spd;
        document.querySelectorAll('[id^="race-speed-"]').forEach((btn) => {
            btn.className = "px-2 py-0.5 rounded-full text-on-surface-variant hover:text-on-surface transition-colors";
        });
        const id = `race-speed-${spd === 0.5 ? "05" : spd === 1 ? "10" : "20"}`;
        const active = document.getElementById(id);
        if (active) active.className = "px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold";
    };

    document.addEventListener("DOMContentLoaded", () => {
        render(null);
        rafId = requestAnimationFrame(loop);
        fetchRace();
    });

    window.addEventListener("rewind:data-updated", () => {
        fetchRace();
    });
})();
