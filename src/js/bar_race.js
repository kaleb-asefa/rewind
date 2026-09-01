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
    const LANE = 44;             // px per row lane
    const BAR_H = 26;            // bar thickness
    const AVATAR = 34;          // cover circle riding the bar tip
    const GAP = 8;
    const LEFT_PAD = 30;         // left gutter for the rank number
    const RIGHT_PAD = 130;       // reserved right space so bars never reach the edge
    const AXIS_TOP = 18;         // top strip for the value-axis labels
    const AXIS_FILL = 0.82;      // leader targets this fraction of the axis (leaves headroom)
    const SECONDS_PER_MONTH = 0.9;
    const EASE_TAU = 0.30;       // vertical glide time constant (s) — smaller = snappier
    const AXIS_EASE_TAU = 0.5;   // axis-rescale glide time constant (s)

    // Fixed green shade per category (stable for the whole race, so a bar keeps its
    // colour as it moves — never recoloured between frames).
    const GREENS = [
        "#6ef58e", "#53e076", "#3fce68", "#1db954",
        "#2bbf63", "#57cf7e", "#149c46", "#39d06e",
    ];
    function greenFor(index) {
        return GREENS[index % GREENS.length];
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
    let curAxisMax = 1;          // eased axis maximum (minutes)
    let gridEls = [];            // pooled axis gridline elements

    function monthLabel(idx) {
        if (!months.length) return "----";
        const i = Math.min(Math.max(0, Math.floor(idx)), months.length - 1);
        const yyyymm = months[i];
        const y = yyyymm.slice(0, 4);
        const m = parseInt(yyyymm.slice(5, 7), 10) - 1;
        return `${MONTH_NAMES[m]} ${y}`.toUpperCase();
    }

    function fmtValue(min) {
        // Always minutes, so the number keeps ticking as the bar grows.
        return `${Math.round(min).toLocaleString()} min`;
    }

    // Round up to a "nice" number (1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10 × 10^k).
    function niceCeil(x) {
        if (!(x > 0)) return 1;
        const base = Math.pow(10, Math.floor(Math.log10(x)));
        const f = x / base;
        const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
        return (steps.find((s) => f <= s) || 10) * base;
    }

    function ensureGrid() {
        const vp = document.getElementById("race-viewport");
        if (!vp || document.getElementById("race-grid")) return;
        const grid = document.createElement("div");
        grid.id = "race-grid";
        grid.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5;";
        vp.insertBefore(grid, vp.firstChild);
        gridEls = [];
        for (let i = 0; i < 5; i++) {
            const line = document.createElement("div");
            line.style.cssText = "position:absolute;width:1px;background:rgba(255,255,255,.06);";
            const label = document.createElement("div");
            label.style.cssText = "position:absolute;top:0;transform:translateX(-50%);font-family:'Space Mono',monospace;font-size:10px;color:#7f8d7f;white-space:nowrap;";
            grid.appendChild(line);
            grid.appendChild(label);
            gridEls.push({ line, label });
        }
    }

    // Redraw the value-axis ticks/labels for the current (eased) axis maximum.
    function updateGrid(usableWidth, xOffset) {
        ensureGrid();
        const rowsH = VISIBLE_N * LANE;
        const nTicks = 4;
        gridEls.forEach((g, i) => {
            const tick = i + 1;
            if (tick > nTicks) {
                g.line.style.display = "none";
                g.label.style.display = "none";
                return;
            }
            const frac = tick / nTicks;
            const x = xOffset + frac * usableWidth;
            const val = Math.round(frac * curAxisMax);
            g.line.style.display = "block";
            g.line.style.left = `${x.toFixed(1)}px`;
            g.line.style.top = `${AXIS_TOP}px`;
            g.line.style.height = `${rowsH}px`;
            g.label.style.display = "block";
            g.label.style.left = `${x.toFixed(1)}px`;
            g.label.textContent = tick === nTicks
                ? `${val.toLocaleString()} min`
                : val.toLocaleString();
        });
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
        container.style.height = `${VISIBLE_N * LANE + AXIS_TOP}px`;

        items.forEach((item, idx) => {
            const row = document.createElement("div");
            row.className = "race-row";
            row.style.cssText =
                `position:absolute;left:0;right:0;top:0;height:${LANE}px;opacity:0;` +
                "transform:translateY(0px);will-change:transform,opacity;";
            const sub = item.artist_name
                ? ` <span style="opacity:.7;font-weight:400;">· ${item.artist_name}</span>`
                : "";
            const initial = (item.name || "?").trim().charAt(0).toUpperCase() || "?";
            row.innerHTML = `
                <div class="race-rank" style="position:absolute;left:0;top:0;width:${LEFT_PAD - 6}px;height:${LANE}px;display:flex;align-items:center;justify-content:flex-end;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:#7f8d7f;"></div>
                <div class="race-bar" style="position:absolute;left:${LEFT_PAD}px;top:${(LANE - BAR_H) / 2}px;height:${BAR_H}px;width:0;border-radius:9999px;background:${greenFor(idx)};box-shadow:0 2px 5px rgba(0,0,0,.35);"></div>
                <div class="race-name" style="position:absolute;left:${LEFT_PAD}px;top:0;height:${LANE}px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-shadow:0 1px 3px rgba(0,0,0,.7);">${item.name}${sub}</div>
                <div class="race-avatar" style="position:absolute;top:${(LANE - AVATAR) / 2}px;width:${AVATAR}px;height:${AVATAR}px;border-radius:9999px;overflow:hidden;border:2px solid rgba(255,255,255,.18);background:linear-gradient(135deg,#2f6b43,#1db954);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);">
                    <span style="font-size:15px;font-weight:800;color:#eafff0;">${initial}</span>
                    <img class="race-cover hidden" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" alt=""/>
                </div>
                <div class="race-value" style="position:absolute;top:0;height:${LANE}px;display:flex;align-items:center;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:#e5e2e1;white-space:nowrap;"></div>`;
            container.appendChild(row);
            rowEls.push(row);
            curY.push(VISIBLE_N * LANE + AXIS_TOP);
            curOp.push(0);
        });

        // Lazy-load cover art (best-effort, cached server-side).
        if (window.loadCover) {
            items.forEach((item, i) => {
                if (!item.id) return;
                const img = rowEls[i].querySelector(".race-cover");
                window.loadCover(img, entity, item.id);
            });
        }
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

        const trackW = container.clientWidth || 600;
        const values = items.map((it) => valueAt(it.cumulative, progress));
        const order = values
            .map((v, i) => i)
            .sort((a, b) => values[b] - values[a]);
        const leader = values[order[0]] || 1;

        const slotOf = new Array(items.length).fill(-1);
        order.forEach((itemIdx, pos) => { slotOf[itemIdx] = pos; });

        // Frame-rate independent easing. dt === null snaps (used for scrubbing).
        const k = dt == null ? 1 : 1 - Math.exp(-dt / EASE_TAU);
        const kAxis = dt == null ? 1 : 1 - Math.exp(-dt / AXIS_EASE_TAU);

        // The axis rescales continuously to a "nice" value above the leader, so the
        // #1 bar keeps space to grow and the scale labels visibly climb over time.
        const targetAxis = niceCeil(leader / AXIS_FILL);
        curAxisMax += (targetAxis - curAxisMax) * kAxis;
        if (curAxisMax < 1) curAxisMax = 1;
        const usableWidth = Math.max(50, trackW - RIGHT_PAD - LEFT_PAD);
        updateGrid(usableWidth, LEFT_PAD);

        items.forEach((item, i) => {
            const row = rowEls[i];
            if (!row) return;
            const pos = slotOf[i];
            const onChart = pos < VISIBLE_N;
            const targetY = AXIS_TOP + (onChart ? pos : VISIBLE_N) * LANE;

            curY[i] += (targetY - curY[i]) * k;
            curOp[i] += ((onChart ? 1 : 0) - curOp[i]) * k;
            row.style.transform = `translateY(${curY[i].toFixed(2)}px)`;
            row.style.opacity = curOp[i].toFixed(3);
            if (curOp[i] < 0.01) return;  // invisible row — skip layout math

            const barW = Math.max(2, (values[i] / curAxisMax) * usableWidth);
            const avatarLeft = Math.min(Math.max(LEFT_PAD + barW - AVATAR / 2, LEFT_PAD), trackW - AVATAR);

            const bar = row.querySelector(".race-bar");
            const nameEl = row.querySelector(".race-name");
            const avatarEl = row.querySelector(".race-avatar");
            const valEl = row.querySelector(".race-value");
            const rankEl = row.querySelector(".race-rank");

            if (bar) bar.style.width = `${barW}px`;
            if (avatarEl) avatarEl.style.left = `${avatarLeft}px`;
            if (nameEl) nameEl.style.width = `${Math.max(0, avatarLeft - GAP - LEFT_PAD)}px`;
            if (valEl) {
                valEl.style.left = `${avatarLeft + AVATAR + GAP}px`;
                valEl.textContent = fmtValue(values[i]);
            }
            if (rankEl) rankEl.textContent = `${pos + 1}`;
        });

        const monthDisp = document.getElementById("race-month-display");
        if (monthDisp) monthDisp.textContent = monthLabel(Math.round(progress));
        const watermark = document.getElementById("race-date-watermark");
        if (watermark && months.length) {
            const idx = Math.min(Math.max(0, Math.round(progress)), months.length - 1);
            watermark.textContent = months[idx].slice(0, 4);
        }
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
            id: d.id || null,
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
        const id = `race-speed-${spd === 0.25 ? "025" : spd === 0.5 ? "05" : "10"}`;
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
