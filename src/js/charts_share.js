/**
 * Rewind — Wrapped-style share deck.
 * A carousel of 10 cards exported as PNGs: seven 1080×1920 portrait story
 * cards (intro, top artists / songs / albums / genres, minutes, vibe) and three
 * 1920×1080 landscape year recaps — the Overview page as a single image, eight
 * metrics around the activity heatmap, one card per recent year.
 * One idea per card and every fact shown exactly once (docs/UI_GUIDELINES.md):
 * the #1 item is the hero of its own list card, so there is no separate hero
 * card, no kicker restating the title, and no recap repeating all of it.
 * Cover art is loaded crossOrigin="anonymous" (Spotify's CDN sends
 * Access-Control-Allow-Origin: *), so drawing it does not taint the canvas and
 * the preview IS exactly the shared image. Covers never gate the deck: the urls
 * that ship inline with the chart rows paint immediately, anything still
 * unresolved arrives through the shared cover cache and repaints the card, and
 * exports wait for that to settle.
 */
(function () {
    "use strict";

    const GREEN = "#1ed760";
    const WHITE = "#ffffff";
    const GRAY = "rgba(255,255,255,0.5)";
    const DARK = "#0e0e0e";
    const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";
    const W = 1080, H = 1920, P = 84;        // portrait story card
    const LW = 1920, LH = 1080, LP = 72;     // landscape recap card
    // Same ramp as .heatmap-cell[data-level] in src/styles/main.css.
    const HEAT = ["#1f1f1f", "rgba(30,215,96,0.22)", "rgba(30,215,96,0.45)", "rgba(30,215,96,0.68)", GREEN];
    const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const RECAP_YEARS = 3;  // most recent years that get their own recap card

    // Synthetic year of activity so the offline mockup still shows a heatmap.
    function sampleDays(year) {
        const out = [];
        const seed = (year % 7) + 3;
        for (let i = 0; i < 365; i += 1) {
            if (i % 7 === 3 || i % 11 === 0) continue;
            out.push({ date: new Date(Date.UTC(year, 0, 1 + i)).toISOString().slice(0, 10), level: (i * seed) % 5 });
        }
        return out;
    }

    function sampleRecap(year, artist, track, album, genre) {
        const days = sampleDays(year);
        return {
            year,
            heat: { year, active_days: days.length, total_streams: 5632, total_minutes: 18840, days },
            artist: { name: artist, streams: 852 },
            track: { name: track, artist },
            album: { name: album, artist },
            genre: { name: genre, streams: 1946 },
            skipped: { name: "Baby Shark", artist: "Pinkfong", skip_pct: 98 },
        };
    }

    // Offline fallback so the deck still previews without a backend.
    const SAMPLE = {
        artists: [{ name: "SZA" }, { name: "J. Cole" }, { name: "Drake" }, { name: "Bryson Tiller" }, { name: "GIVĒON" }],
        tracks: [
            { name: "Nobody Gets Me", artist: "SZA" }, { name: "Snooze", artist: "SZA" },
            { name: "Open Arms", artist: "SZA" }, { name: "Session 32", artist: "Summer Walker" },
            { name: "Lost Me", artist: "Giveon" },
        ],
        albums: [
            { name: "SOS", artist: "SZA" }, { name: "2014 Forest Hills Drive", artist: "J. Cole" },
            { name: "Ctrl", artist: "SZA" }, { name: "T R A P S O U L", artist: "Bryson Tiller" },
            { name: "Take Care", artist: "Drake" },
        ],
        genres: [{ name: "Hip-Hop" }, { name: "R&B" }, { name: "Pop" }, { name: "Afrobeats" }, { name: "Indie" }],
        totalMinutes: 41267,
        audio: { avg: { energy: 0.47, valence: 0.42 } },
        recaps: [
            sampleRecap(2026, "SZA", "Nobody Gets Me", "SOS", "R&B"),
            sampleRecap(2025, "J. Cole", "Session 32", "Ctrl", "Hip-Hop"),
            sampleRecap(2024, "Drake", "Lost Me", "Take Care", "Pop"),
        ],
    };

    document.addEventListener("DOMContentLoaded", () => {
        const modal = document.getElementById("share-modal");
        const canvas = document.getElementById("share-canvas");
        const openBtn = document.getElementById("share-open-btn");
        const closeBtn = document.getElementById("share-close-btn");
        const prevBtn = document.getElementById("share-prev");
        const nextBtn = document.getElementById("share-next");
        const downloadBtn = document.getElementById("share-download-btn");
        const downloadAllBtn = document.getElementById("share-download-all-btn");
        const nativeBtn = document.getElementById("share-native-btn");
        const captionEl = document.getElementById("share-caption");
        const dotsEl = document.getElementById("share-dots");
        if (!modal || !canvas || !openBtn) return;

        const ctx = canvas.getContext("2d");
        let deck = [];
        let index = 0;
        let built = false;
        let building = false;
        let coversPending = null;
        // Size of the card being drawn. Cards are portrait unless they declare
        // otherwise, so every existing renderer keeps using W/H.
        let CW = W, CH = H;

        function setCardSize(w, h) {
            CW = w;
            CH = h;
            if (canvas.width === w && canvas.height === h) return;
            canvas.width = w;      // resizing also clears the canvas
            canvas.height = h;
            fitCanvas();           // the aspect changed, so the preview box must too
        }

        /* ─────────────────────── canvas helpers ─────────────────────── */
        function ls(px) { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }
        function fmtInt(n) { return Math.round(n || 0).toLocaleString("en-US"); }

        function ellipsize(text, maxW) {
            text = String(text == null ? "" : text);
            if (ctx.measureText(text).width <= maxW) return text;
            let t = text;
            while (t.length > 1 && ctx.measureText(t + "\u2026").width > maxW) t = t.slice(0, -1);
            return t + "\u2026";
        }

        function roundRectPath(x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }

        function glow(x, y, r, alpha) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, "rgba(30,215,96," + alpha + ")");
            g.addColorStop(1, "rgba(30,215,96,0)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, CW, CH);
        }

        function background() {
            ctx.fillStyle = DARK;
            ctx.fillRect(0, 0, CW, CH);
            // Radius off the shorter side, so a landscape card doesn't end up
            // washed green edge to edge.
            const r = Math.min(CW, CH);
            glow(CW * 0.92, CH * 0.06, r * 0.8, 0.22);
            glow(CW * 0.06, CH * 0.97, r * 0.85, 0.12);
        }

        function wordmark(y, x) {
            x = x == null ? P : x;
            ctx.fillStyle = GREEN;
            ctx.beginPath();
            ctx.moveTo(x, y - 30);
            ctx.lineTo(x, y - 2);
            ctx.lineTo(x + 26, y - 16);
            ctx.closePath();
            ctx.fill();
            ctx.textAlign = "left";
            ls(0);
            ctx.font = "800 42px " + FONT;
            ctx.fillStyle = WHITE;
            ctx.fillText("Rewind", x + 42, y);
        }

        // object-fit: cover into a rounded/circular box, with a lettered fallback.
        function cover(img, x, y, w, h, radius, fallbackChar) {
            ctx.save();
            roundRectPath(x, y, w, h, radius);
            ctx.clip();
            if (img) {
                const s = Math.max(w / img.width, h / img.height);
                const dw = img.width * s, dh = img.height * s;
                ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
            } else {
                const g = ctx.createLinearGradient(x, y, x + w, y + h);
                g.addColorStop(0, "#1c3b28");
                g.addColorStop(1, "#0f2a1a");
                ctx.fillStyle = g;
                ctx.fillRect(x, y, w, h);
                if (fallbackChar) {
                    ctx.fillStyle = "rgba(30,215,96,0.85)";
                    ctx.font = "800 " + Math.round(h * 0.42) + "px " + FONT;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(fallbackChar, x + w / 2, y + h / 2);
                    ctx.textAlign = "left";
                    ctx.textBaseline = "alphabetic";
                }
            }
            ctx.restore();
        }

        function initial(name) {
            return (String(name || "?").trim().charAt(0) || "?").toUpperCase();
        }

        // Largest font (weight+size) at which `text` fits `maxW`, down to `minPx`.
        function fitFont(text, maxW, startPx, minPx, weight) {
            let px = startPx;
            ctx.font = weight + " " + px + "px " + FONT;
            while (px > minPx && ctx.measureText(text).width > maxW) {
                px -= 4;
                ctx.font = weight + " " + px + "px " + FONT;
            }
            return px;
        }

        /* ─────────────────────── card renderers ─────────────────────── */

        // Each card is wordmark + one title + one idea. No kicker restating the
        // title, no footer strap repeating the wordmark.
        function headline(text, y) {
            ctx.textAlign = "left";
            ctx.fillStyle = WHITE;
            fitFont(text, W - P * 2, 100, 64, "800");
            ctx.fillText(text, P, y);
        }

        function emptyNote(y) {
            ctx.textAlign = "left";
            ctx.fillStyle = GRAY;
            ctx.font = "500 40px " + FONT;
            ctx.fillText("No data yet \u2014 upload your history.", P, y);
        }

        function minutesLabel(it, long) {
            if (!it || it.minutes == null) return "";
            return fmtInt(it.minutes) + (long ? " minutes" : " min");
        }

        function cardIntro(d) {
            background();
            wordmark(P + 46);
            const pics = (d.artists.length ? d.artists : d.albums).slice(0, 4);
            const cell = 380, gap = 28;
            // Collage + title read as one block, centred in the space under the
            // wordmark so the card doesn't sit top-heavy over dead space.
            const gridX = (W - (cell * 2 + gap)) / 2, gridY = 520;
            pics.forEach((it, i) => {
                cover(it.img, gridX + (i % 2) * (cell + gap), gridY + Math.floor(i / 2) * (cell + gap),
                    cell, cell, 28, initial(it.name));
            });
            let y = gridY + cell * 2 + gap + 156;
            ctx.textAlign = "center";
            ctx.font = "800 130px " + FONT;
            ctx.fillStyle = WHITE;
            ctx.fillText("Your Rewind", W / 2, y);
            y += 84;
            ls(6);
            ctx.font = "700 32px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText("ALL-TIME LISTENING", W / 2, y);
            ls(0);
            ctx.textAlign = "left";
        }

        // One card per dimension: #1 is the hero of its own list, 2–5 follow.
        function cardTop(title, items, opts) {
            opts = opts || {};
            background();
            wordmark(P + 46);
            headline(title, P + 216);
            if (!items.length) {
                emptyNote(P + 360);
                return;
            }

            const hero = items[0];
            const size = 420, hy = 380;
            cover(hero.img, (W - size) / 2, hy, size, size, opts.circle ? size / 2 : 40, initial(hero.name));
            ctx.textAlign = "center";
            fitFont(hero.name, W - P * 2, 88, 46, "800");
            ctx.fillStyle = WHITE;
            ctx.fillText(hero.name, W / 2, hy + size + 100);
            const heroSub = opts.showArtist ? hero.artist : minutesLabel(hero, true);
            if (heroSub) {
                ctx.font = "500 40px " + FONT;
                ctx.fillStyle = GREEN;
                ctx.fillText(ellipsize(heroSub, W - P * 2), W / 2, hy + size + 158);
            }
            ctx.textAlign = "left";

            const rows = items.slice(1, 5);
            if (!rows.length) return;
            ctx.strokeStyle = "rgba(255,255,255,0.10)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(P, 1024);
            ctx.lineTo(W - P, 1024);
            ctx.stroke();

            const top = 1090, bottom = H - 150;
            const rowH = (bottom - top) / rows.length;
            const thumb = Math.min(124, rowH - 46);
            const coverX = P + 84;
            const nameX = coverX + thumb + 32;
            const maxW = W - nameX - P;
            rows.forEach((it, i) => {
                const cy = top + i * rowH + rowH / 2;
                ctx.textBaseline = "middle";
                ctx.fillStyle = GREEN;
                ctx.font = "800 48px " + FONT;
                ctx.fillText(String(i + 2), P, cy);
                cover(it.img, coverX, cy - thumb / 2, thumb, thumb, opts.circle ? thumb / 2 : 20, initial(it.name));
                const sub = opts.showArtist ? it.artist : minutesLabel(it, false);
                ctx.fillStyle = WHITE;
                ctx.font = "700 46px " + FONT;
                ctx.fillText(ellipsize(it.name, maxW), nameX, sub ? cy - 20 : cy);
                if (sub) {
                    ctx.fillStyle = GRAY;
                    ctx.font = "500 32px " + FONT;
                    ctx.fillText(ellipsize(sub, maxW), nameX, cy + 26);
                }
                ctx.textBaseline = "alphabetic";
            });
        }

        function cardGenres(d) {
            background();
            wordmark(P + 46);
            headline("Top genres", P + 216);
            const rows = d.genres.slice(0, 5);
            if (!rows.length) {
                emptyNote(P + 360);
                return;
            }
            const top = 500, bottom = H - 180;
            const rowH = (bottom - top) / rows.length;
            const barH = Math.min(150, rowH - 34);
            rows.forEach((it, i) => {
                const y = top + i * rowH + (rowH - barH) / 2;
                roundRectPath(P, y, W - P * 2, barH, barH / 2);
                ctx.fillStyle = "hsl(146,63%," + (60 - i * 8) + "%)";
                ctx.fill();
                ctx.fillStyle = i < 2 ? "#0b1f13" : "rgba(255,255,255,0.92)";
                ctx.font = "800 52px " + FONT;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(String(i + 1), P + 52, y + barH / 2);
                ctx.fillText(ellipsize(it.name, W - P * 2 - 220), P + 160, y + barH / 2);
                ctx.textBaseline = "alphabetic";
            });
        }

        function cardMinutes(d) {
            background();
            wordmark(P + 46);
            ctx.textAlign = "center";
            ls(6);
            ctx.font = "700 34px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText("YOU LISTENED FOR", W / 2, H / 2 - 190);
            ls(0);
            const total = fmtInt(d.totalMinutes);
            fitFont(total, W - P * 2, 250, 110, "800");
            ctx.fillStyle = WHITE;
            ctx.fillText(total, W / 2, H / 2 + 40);
            ls(8);
            ctx.font = "700 34px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText("MINUTES OF MUSIC", W / 2, H / 2 + 150);
            ls(0);
            ctx.textAlign = "left";
        }

        function vibeWord(audio) {
            const a = (audio && audio.avg) || null;
            if (!a) return null;
            const e = a.energy, v = a.valence;
            if (e >= 0.5 && v >= 0.5) return { word: "Upbeat", phrase: "bright, high-energy songs" };
            if (e >= 0.5 && v < 0.5) return { word: "Intense", phrase: "dark, high-energy songs" };
            if (e < 0.5 && v >= 0.5) return { word: "Feel-good", phrase: "warm, easy-going songs" };
            return { word: "Moody", phrase: "slow, emotional songs" };
        }

        function cardVibe(d) {
            const vibe = vibeWord(d.audio) || { word: "Eclectic", phrase: "a bit of everything" };
            const back = (d.tracks[0] && d.tracks[0].img) || (d.artists[0] && d.artists[0].img);
            background();
            if (back) {
                ctx.save();
                ctx.globalAlpha = 0.28;
                const s = Math.max(W / back.width, H / back.height);
                ctx.drawImage(back, (W - back.width * s) / 2, (H - back.height * s) / 2, back.width * s, back.height * s);
                ctx.restore();
                ctx.fillStyle = "rgba(14,14,14,0.62)";
                ctx.fillRect(0, 0, W, H);
            }
            wordmark(P + 46);
            ctx.textAlign = "center";
            ls(6);
            ctx.font = "700 30px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText("YOUR VIBE", W / 2, H / 2 - 120);
            ls(0);
            ctx.font = "800 150px " + FONT;
            ctx.fillStyle = WHITE;
            ctx.fillText(vibe.word, W / 2, H / 2 + 20);
            ctx.font = "500 46px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText("You lean toward " + vibe.phrase + ".", W / 2, H / 2 + 110);
            ctx.textAlign = "left";
        }

        /* ──────────────── landscape year recap ──────────────── */

        function daysInYear(y) {
            return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
        }

        // One Overview-style metric tile: label, value, optional cover + sub-line.
        function tile(x, y, w, h, t) {
            roundRectPath(x, y, w, h, 24);
            ctx.fillStyle = "rgba(255,255,255,0.045)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.textAlign = "left";
            ls(3);
            ctx.font = "700 22px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText(ellipsize(t.label, w - 60), x + 30, y + 52);
            ls(0);

            let tx = x + 30;
            if ("img" in t) {
                const s = 76;
                cover(t.img, x + 30, y + 84, s, s, t.circle ? s / 2 : 14, initial(t.value));
                tx += s + 20;
            }
            const maxW = w - (tx - x) - 30;
            ctx.fillStyle = WHITE;
            fitFont(t.value, maxW, 46, 28, "800");
            ctx.fillText(ellipsize(t.value, maxW), tx, y + 136);
            if (t.sub) {
                ctx.fillStyle = t.accent ? GREEN : GRAY;
                ctx.font = "500 26px " + FONT;
                ctx.fillText(ellipsize(t.sub, maxW), tx, y + 176);
            }
        }

        // GitHub-style year grid: one column per week, Sunday at the top.
        // Returns the height it drew so the caller can place the legend.
        function heatGrid(x, y, w, heat) {
            const year = heat.year;
            const offset = new Date(Date.UTC(year, 0, 1)).getUTCDay();
            const total = offset + daysInYear(year);
            const gutter = 54;  // weekday labels
            const step = (w - gutter) / Math.ceil(total / 7);
            const cell = step - 5;
            const gx = x + gutter;
            const level = {};
            (heat.days || []).forEach((d) => { level[d.date] = d.level; });

            ctx.textAlign = "left";
            ls(2);
            ctx.font = "600 22px " + FONT;
            ctx.fillStyle = GRAY;
            for (let m = 0; m < 12; m += 1) {
                const day = offset + Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86400000);
                ctx.fillText(MONTHS[m], gx + Math.floor(day / 7) * step, y - 16);
            }
            ls(0);

            ctx.textAlign = "right";
            ctx.font = "500 20px " + FONT;
            ["", "Mon", "", "Wed", "", "Fri", ""].forEach((lab, row) => {
                if (lab) ctx.fillText(lab, gx - 16, y + row * step + cell * 0.8);
            });
            ctx.textAlign = "left";

            for (let i = offset; i < total; i += 1) {
                const day = new Date(Date.UTC(year, 0, 1 + i - offset)).toISOString().slice(0, 10);
                roundRectPath(gx + Math.floor(i / 7) * step, y + (i % 7) * step, cell, cell, 4);
                ctx.fillStyle = HEAT[level[day] || 0];
                ctx.fill();
            }
            return 7 * step;
        }

        function heatLegend(right, y) {
            ctx.textAlign = "left";
            ctx.font = "500 20px " + FONT;
            let x = right - 212;
            ctx.fillStyle = GRAY;
            ctx.fillText("Less", x, y);
            x += 46;
            for (let i = 0; i < 5; i += 1) {
                roundRectPath(x, y - 14, 16, 16, 4);
                ctx.fillStyle = HEAT[i];
                ctx.fill();
                x += 22;
            }
            ctx.fillStyle = GRAY;
            ctx.fillText("More", x + 8, y);
        }

        // The Overview page as one landscape image: its eight metrics wrapped
        // around the activity heatmap, for a single year.
        function cardRecap(r) {
            const heat = r.heat || {};
            background();
            wordmark(LP + 46, LP);
            ctx.textAlign = "right";
            ctx.font = "800 62px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText(String(r.year), LW - LP, LP + 50);
            ctx.textAlign = "left";

            const gap = 24;
            const tw = (LW - LP * 2 - gap * 3) / 4;
            const th = 214;
            const streams = (it) => (it && it.streams != null ? fmtInt(it.streams) + " streams" : "");
            const num = (v) => (v == null ? "\u2014" : fmtInt(v));

            [
                { label: "TOP ARTIST", value: r.artist ? r.artist.name : "\u2014", sub: streams(r.artist), img: (r.artist && r.artist.img) || null, circle: true },
                { label: "TOP SONG", value: r.track ? r.track.name : "\u2014", sub: (r.track && r.track.artist) || "", img: (r.track && r.track.img) || null },
                { label: "TOP ALBUM", value: r.album ? r.album.name : "\u2014", sub: (r.album && r.album.artist) || "", img: (r.album && r.album.img) || null },
                { label: "TOP GENRE", value: r.genre ? r.genre.name : "\u2014", sub: streams(r.genre) },
            ].forEach((t, i) => tile(LP + i * (tw + gap), 170, tw, th, t));

            const gridY = 480;
            const gridH = heat.days ? heatGrid(LP, gridY, LW - LP * 2, heat) : 0;
            if (gridH) heatLegend(LW - LP, gridY + gridH + 34);

            const skip = r.skipped;
            [
                { label: "MINUTES", value: num(heat.total_minutes), sub: fmtInt((heat.total_minutes || 0) / 60) + " hours", accent: true },
                { label: "STREAMS", value: num(heat.total_streams), sub: "songs played" },
                { label: "ACTIVE DAYS", value: num(heat.active_days), sub: "of " + daysInYear(r.year) },
                // The rate rides in the label so the sub-line stays the artist,
                // like the other tiles — together they never fit on one line.
                {
                    label: skip && skip.skip_pct != null ? "MOST SKIPPED \u00b7 " + skip.skip_pct + "%" : "MOST SKIPPED",
                    value: skip ? skip.name : "\u2014",
                    sub: (skip && skip.artist) || "",
                    img: (skip && skip.img) || null,
                },
            ].forEach((t, i) => tile(LP + i * (tw + gap), 768, tw, th, t));
        }

        /* ─────────────────────── data + build ─────────────────────── */

        function loadImage(url) {
            return new Promise((resolve) => {
                if (!url) return resolve(null);
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = url;
            });
        }

        async function attachCovers(kind, items, onUpdate) {
            if (!items.length) return;
            // Chart rows ship their own `image_url`, so those paint straight
            // away; seed the shared cache with them too, so the page's other
            // components never re-resolve the same ids.
            if (window.primeCoverUrls) window.primeCoverUrls(kind, items);
            const inline = items.filter((it) => it.image_url);
            await Promise.all(inline.map(async (it) => { it.img = await loadImage(it.image_url); }));
            if (inline.length) onUpdate();

            // Anything the backend hasn't cached yet costs a cold Spotify
            // lookup (seconds per id), so it is resolved after the deck is
            // already on screen — never in front of it.
            const missing = items.filter((it) => !it.img && it.id);
            if (!missing.length || !window.resolveCoverUrls) return;
            const map = await window.resolveCoverUrls(kind, missing.map((it) => it.id));
            await Promise.all(missing.map(async (it) => {
                const url = map[it.id];
                if (!url) return;
                it.image_url = url;
                it.img = await loadImage(url);
            }));
            onUpdate();
        }

        function loadCovers(d, onUpdate) {
            // The recap cards reuse the same objects the cache is keyed on, so
            // their covers cost nothing extra when they duplicate the top lists.
            const recaps = d.recaps || [];
            const from = (key) => recaps.map((r) => r[key]).filter(Boolean);
            return Promise.all([
                attachCovers("artist", d.artists.concat(from("artist")), onUpdate),
                attachCovers("track", d.tracks.concat(from("track"), from("skipped")), onUpdate),
                attachCovers("album", d.albums.concat(from("album")), onUpdate),
            ]);
        }

        // Everything one recap card needs, for one year.
        async function loadRecapYear(f, year, heat) {
            if (!heat) {
                try {
                    const res = await f("/api/metrics/heatmap?year=" + year, {}, 8000);
                    if (res.ok && res.data && Array.isArray(res.data.days) && res.data.days.length) heat = res.data;
                } catch (_e) { /* ignore */ }
            }
            if (!heat) return null;
            const top = async (entity) => {
                try {
                    const res = await f("/api/metrics/chart?entity=" + entity + "&sort=minutes&limit=1&range=" + year);
                    return (res.ok && res.data && res.data.items && res.data.items[0]) || null;
                } catch (_e) { return null; }
            };
            const worst = async () => {
                try {
                    const res = await f("/api/metrics/superlatives?range=" + year + "&limit=1");
                    return (res.ok && res.data && res.data.most_skipped && res.data.most_skipped[0]) || null;
                } catch (_e) { return null; }
            };
            const [artist, track, album, genre, skipped] = await Promise.all([
                top("artist"), top("track"), top("album"), top("genre"), worst(),
            ]);
            return { year, heat, artist, track, album, genre, skipped };
        }

        // One recap per recent year. The heatmap endpoint defaults to the
        // latest year and lists the others, so it decides which years get a
        // card and what the chart/superlatives calls are then ranged to.
        async function loadRecaps(f) {
            let latest = null;
            try {
                const res = await f("/api/metrics/heatmap", {}, 8000);
                if (res.ok && res.data && Array.isArray(res.data.days) && res.data.days.length) latest = res.data;
            } catch (_e) { /* ignore */ }
            if (!latest) return [];

            const years = (latest.years && latest.years.length ? latest.years.slice() : [latest.year])
                .sort((a, b) => b - a)
                .slice(0, RECAP_YEARS);
            const recaps = await Promise.all(
                years.map((y) => loadRecapYear(f, y, y === latest.year ? latest : null)),
            );
            return recaps.filter(Boolean);
        }

        async function loadData() {
            const f = window.fetchWithTimeout;
            if (!f) return window.REWIND_ALLOW_SAMPLE ? SAMPLE : null;
            const chart = async (entity) => {
                try {
                    const res = await f("/api/metrics/chart?entity=" + entity + "&sort=minutes&limit=5&range=all");
                    return (res.ok && res.data && Array.isArray(res.data.items)) ? res.data.items : [];
                } catch (_e) { return []; }
            };
            const [artists, tracks, albums, genres] = await Promise.all([
                chart("artist"), chart("track"), chart("album"), chart("genre"),
            ]);
            if (!artists.length && !tracks.length) return window.REWIND_ALLOW_SAMPLE ? SAMPLE : null;  // backend offline/empty

            let totalMinutes = 0, audio = {};
            // Kicked off first so the year recaps resolve alongside these two
            // rather than after them.
            const recapsPending = loadRecaps(f);
            try {
                const tt = await f("/api/metrics/total-time");
                if (tt.ok && tt.data) totalMinutes = tt.data.total_minutes || 0;
            } catch (_e) { /* ignore */ }
            try {
                const au = await f("/api/metrics/audio");
                if (au.ok && au.data) audio = au.data;
            } catch (_e) { /* ignore */ }

            return { artists, tracks, albums, genres, totalMinutes, audio, recaps: await recapsPending };
        }

        function cardNoData() {
            background();
            wordmark(200);
            ctx.textAlign = "center";
            ctx.fillStyle = WHITE;
            ctx.font = "800 68px " + FONT;
            ctx.fillText("Nothing to share yet", W / 2, H / 2 - 20);
            ctx.fillStyle = GRAY;
            ctx.font = "500 42px " + FONT;
            ctx.fillText("Upload your Spotify history first.", W / 2, H / 2 + 54);
            ctx.textAlign = "left";
        }

        function buildDeck(d) {
            if (!d) {
                deck = [{ title: "Rewind", render: cardNoData }];
                return;
            }
            deck = [
                { title: "Intro", render: () => cardIntro(d) },
                { title: "Top artists", render: () => cardTop("Top artists", d.artists, { circle: true }) },
                { title: "Top songs", render: () => cardTop("Top songs", d.tracks, { showArtist: true }) },
                { title: "Top albums", render: () => cardTop("Top albums", d.albums, { showArtist: true }) },
                { title: "Top genres", render: () => cardGenres(d) },
                { title: "Minutes", render: () => cardMinutes(d) },
                { title: "Your vibe", render: () => cardVibe(d) },
            ];
            // Landscape, newest year first, and only for years that have data.
            (d.recaps || []).forEach((r) => {
                deck.push({ title: String(r.year), w: LW, h: LH, render: () => cardRecap(r) });
            });
        }

        /* ─────────────────────── carousel ─────────────────────── */

        function drawLoading() {
            background();
            ctx.textAlign = "center";
            ctx.fillStyle = WHITE;
            ctx.font = "700 52px " + FONT;
            ctx.fillText("Building your cards\u2026", W / 2, H / 2);
            ctx.textAlign = "left";
        }

        function buildDots() {
            if (downloadAllBtn) {
                const label = downloadAllBtn.querySelector("[data-count]");
                if (label) label.textContent = "Save all " + deck.length;
            }
            if (!dotsEl) return;
            dotsEl.innerHTML = deck
                .map((_c, i) => '<button data-dot="' + i + '" class="share-dot w-2 h-2 rounded-full transition-all"></button>')
                .join("");
            dotsEl.querySelectorAll("[data-dot]").forEach((b) => {
                b.addEventListener("click", () => { index = Number(b.getAttribute("data-dot")); renderCurrent(); });
            });
        }

        function renderCurrent() {
            if (!deck.length) return;
            index = (index % deck.length + deck.length) % deck.length;
            const card = deck[index];
            setCardSize(card.w || W, card.h || H);
            card.render();
            // The card already carries its own headline, so the counter is the
            // only thing worth repeating outside it (docs/UI_GUIDELINES.md §1).
            if (captionEl) captionEl.textContent = (index + 1) + " / " + deck.length;
            if (dotsEl) {
                dotsEl.querySelectorAll(".share-dot").forEach((dot, i) => {
                    dot.classList.toggle("bg-primary", i === index);
                    dot.classList.toggle("w-5", i === index);
                    dot.classList.toggle("bg-white/30", i !== index);
                });
            }
        }

        function go(delta) { index += delta; renderCurrent(); }

        /**
         * Size the preview to the space the modal actually has.
         *
         * Cards are 9:16 except the landscape recap, and the controls under
         * them wrap on narrow screens, so a fixed "viewport minus N" guess
         * either crops the card or pushes the buttons off-screen. Measuring the
         * chrome and honouring the current card's aspect keeps the whole card
         * visible at any size. Only the CSS box changes — the canvas bitmap is
         * the exported one, so exports are unaffected.
         */
        function fitCanvas() {
            const frame = canvas.parentElement;
            const stack = frame && frame.parentElement;
            if (!frame || !stack || modal.classList.contains("hidden")) return;
            // scrollHeight, not offsetHeight: the stack scrolls, so once it
            // overflows its own height stops growing and would under-report the
            // chrome — leaving the buttons cut off at the bottom.
            const chrome = stack.scrollHeight - frame.offsetHeight;  // caption + dots + actions + gaps
            const avail = modal.clientHeight - 32 - chrome - 8;      // modal p-4 + a little slack
            const aspect = canvas.width / canvas.height;
            let height = Math.max(240, Math.min(720, avail));
            let width = height * aspect;
            const maxW = modal.clientWidth - 32;
            if (width > maxW) {                                      // landscape on a narrow screen
                width = maxW;
                height = width / aspect;
            }
            canvas.style.aspectRatio = canvas.width + " / " + canvas.height;
            canvas.style.height = Math.round(height) + "px";
            canvas.style.width = Math.round(width) + "px";
        }

        async function ensureBuilt() {
            if (built || building) return;
            building = true;
            drawLoading();
            if (document.fonts && document.fonts.ready) {
                try { await document.fonts.ready; } catch (_e) { /* ignore */ }
            }
            const data = await loadData();
            buildDeck(data);
            buildDots();
            built = true;
            building = false;
            // Deliberately not awaited: the deck is usable immediately and each
            // batch of covers repaints the card on screen as it arrives.
            if (data) coversPending = loadCovers(data, () => { if (built) renderCurrent(); });
        }

        // Exports wait for the covers (bounded), so a saved PNG never loses art
        // the preview was about to show.
        function coversSettled() {
            if (!coversPending) return Promise.resolve();
            return Promise.race([
                coversPending,
                new Promise((r) => setTimeout(r, 12000)),
            ]);
        }

        /* ─────────────────────── open / close / export ─────────────────────── */

        async function openModal() {
            modal.classList.remove("hidden");
            if (nativeBtn && navigator.canShare) {
                nativeBtn.classList.remove("hidden");
                nativeBtn.classList.add("flex");
            }
            fitCanvas();
            await ensureBuilt();
            renderCurrent();
            fitCanvas();  // the dots row only exists once the deck is built
        }
        function closeModal() { modal.classList.add("hidden"); }

        function toBlob() {
            return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        }
        function slugTitle() {
            return (deck[index] ? deck[index].title : "card").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        }
        function downloadBlob(blob, name) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
        }

        openBtn.addEventListener("click", openModal);
        if (closeBtn) closeBtn.addEventListener("click", closeModal);
        if (prevBtn) prevBtn.addEventListener("click", () => go(-1));
        if (nextBtn) nextBtn.addEventListener("click", () => go(1));
        modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
        window.addEventListener("resize", fitCanvas);
        document.addEventListener("keydown", (e) => {
            if (modal.classList.contains("hidden")) return;
            if (e.key === "Escape") closeModal();
            else if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "ArrowRight") go(1);
        });

        if (downloadBtn) {
            downloadBtn.addEventListener("click", async () => {
                await coversSettled();
                renderCurrent();
                const blob = await toBlob();
                if (blob) downloadBlob(blob, "rewind-" + slugTitle() + ".png");
            });
        }

        if (downloadAllBtn) {
            downloadAllBtn.addEventListener("click", async () => {
                await coversSettled();
                const start = index;
                for (let i = 0; i < deck.length; i++) {
                    index = i;
                    renderCurrent();
                    const blob = await toBlob();
                    if (blob) downloadBlob(blob, "rewind-" + String(i + 1).padStart(2, "0") + "-" + slugTitle() + ".png");
                    await new Promise((r) => setTimeout(r, 250));  // let each download register
                }
                index = start;
                renderCurrent();
            });
        }

        if (nativeBtn) {
            nativeBtn.addEventListener("click", async () => {
                await coversSettled();
                renderCurrent();
                const blob = await toBlob();
                if (!blob) return;
                const file = new File([blob], "rewind-" + slugTitle() + ".png", { type: "image/png" });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try { await navigator.share({ files: [file], title: "My Rewind" }); }
                    catch (_e) { /* dismissed */ }
                }
            });
        }
    });
})();
