/**
 * Rewind — Wrapped-style share deck.
 * A carousel of 7 story cards (intro, top artists / songs / albums / genres,
 * minutes, vibe) drawn onto a 1080×1920 canvas and exported as PNGs.
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
    const W = 1080, H = 1920, P = 84;

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
            ctx.fillRect(0, 0, W, H);
        }

        function background() {
            ctx.fillStyle = DARK;
            ctx.fillRect(0, 0, W, H);
            glow(W * 0.92, H * 0.06, W * 0.8, 0.22);
            glow(W * 0.06, H * 0.97, W * 0.85, 0.12);
        }

        function wordmark(y) {
            ctx.fillStyle = GREEN;
            ctx.beginPath();
            ctx.moveTo(P, y - 30);
            ctx.lineTo(P, y - 2);
            ctx.lineTo(P + 26, y - 16);
            ctx.closePath();
            ctx.fill();
            ctx.textAlign = "left";
            ls(0);
            ctx.font = "800 42px " + FONT;
            ctx.fillStyle = WHITE;
            ctx.fillText("Rewind", P + 42, y);
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
            return Promise.all([
                attachCovers("artist", d.artists, onUpdate),
                attachCovers("track", d.tracks, onUpdate),
                attachCovers("album", d.albums, onUpdate),
            ]);
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
            try {
                const tt = await f("/api/metrics/total-time");
                if (tt.ok && tt.data) totalMinutes = tt.data.total_minutes || 0;
            } catch (_e) { /* ignore */ }
            try {
                const au = await f("/api/metrics/audio");
                if (au.ok && au.data) audio = au.data;
            } catch (_e) { /* ignore */ }

            return { artists, tracks, albums, genres, totalMinutes, audio };
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
            deck[index].render();
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
         * The card is 9:16, and the controls under it wrap on narrow screens,
         * so a fixed "viewport minus N" guess either crops the card or pushes
         * the buttons off-screen. Measuring the chrome keeps the whole card
         * visible at any size. Only the CSS box changes — the canvas bitmap
         * stays 1080×1920, so exports are unaffected.
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
            const height = Math.max(240, Math.min(720, avail));
            canvas.style.height = height + "px";
            canvas.style.width = Math.round(height * W / H) + "px";
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
