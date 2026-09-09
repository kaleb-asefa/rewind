/**
 * Rewind — Wrapped-style share deck.
 * A carousel of 10 Spotify-Wrapped-style story cards (Top 5 artists, tracks,
 * albums, genres, hero cards, minutes, vibe, recap) drawn onto a 1080×1920
 * canvas and exported as PNGs. Cover art is loaded crossOrigin="anonymous"
 * (Spotify's CDN sends Access-Control-Allow-Origin: *), so drawing it does not
 * taint the canvas and the preview IS exactly the shared image.
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

        function footer() {
            const y = H - P + 6;
            ls(5);
            ctx.font = "700 24px " + FONT;
            ctx.textAlign = "left";
            ctx.fillStyle = GRAY;
            ctx.fillText("MY REWIND", P, y);
            ctx.textAlign = "right";
            ctx.fillStyle = GREEN;
            ctx.fillText("REWIND.APP", W - P, y);
            ctx.textAlign = "left";
            ls(0);
        }

        function kicker(text, x, y) {
            ls(6);
            ctx.font = "700 28px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.textAlign = "left";
            ctx.fillText(String(text).toUpperCase(), x, y);
            ls(0);
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

        function cardIntro(d) {
            background();
            wordmark(P + 46);
            const pics = (d.artists.length ? d.artists : d.albums).slice(0, 4);
            const cellW = 300, cellH = 300, gap = 24;
            const gridW = cellW * 2 + gap, gridX = (W - gridW) / 2, gridY = 300;
            pics.forEach((it, i) => {
                const cx = gridX + (i % 2) * (cellW + gap);
                const cy = gridY + Math.floor(i / 2) * (cellH + gap);
                cover(it.img, cx, cy, cellW, cellH, 28, initial(it.name));
            });
            let y = gridY + cellH * 2 + gap + 150;
            ctx.textAlign = "center";
            ls(6);
            ctx.font = "700 30px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText("MY MUSIC, WRAPPED", W / 2, y);
            ls(0);
            y += 130;
            ctx.font = "800 130px " + FONT;
            ctx.fillStyle = WHITE;
            ctx.fillText("Your Rewind", W / 2, y);
            y += 90;
            ctx.font = "500 40px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText(fmtInt(d.totalMinutes) + " minutes of music", W / 2, y);
            ctx.textAlign = "left";
            footer();
        }

        function cardHero(kickerText, item, subtitle, circle) {
            background();
            wordmark(P + 46);
            kicker(kickerText, P, P + 150);
            const size = 620, x = (W - size) / 2, y = 460;
            cover(item.img, x, y, size, size, circle ? size / 2 : 40, initial(item.name));
            let ty = y + size + 130;
            ctx.textAlign = "center";
            fitFont(item.name, W - P * 2, 96, 48, "800");
            ctx.fillStyle = WHITE;
            ctx.fillText(item.name, W / 2, ty);
            if (subtitle) {
                ty += 66;
                ctx.font = "500 42px " + FONT;
                ctx.fillStyle = GREEN;
                ctx.fillText(ellipsize(subtitle, W - P * 2), W / 2, ty);
            }
            ctx.textAlign = "left";
            footer();
        }

        function cardList(kickerText, title, items, opts) {
            opts = opts || {};
            background();
            wordmark(P + 46);
            kicker(kickerText, P, P + 150);
            ctx.textAlign = "left";
            ctx.fillStyle = WHITE;
            ctx.font = "800 108px " + FONT;
            ctx.fillText(ellipsize(title, W - P * 2), P, P + 250);

            const rows = items.slice(0, 5);
            const top = 560, bottom = H - 180;
            const rowH = rows.length ? (bottom - top) / rows.length : 0;
            const thumb = Math.min(150, rowH - 40);
            const rankW = 66, gap = 26;
            const coverX = P + rankW + gap;
            const nameX = coverX + thumb + 34;
            const maxW = W - nameX - P;

            if (!rows.length) {
                ctx.fillStyle = GRAY;
                ctx.font = "500 36px " + FONT;
                ctx.fillText("No data yet \u2014 upload your history.", P, top + 60);
            }

            rows.forEach((it, i) => {
                const cy = top + i * rowH + rowH / 2;
                ctx.fillStyle = GREEN;
                ctx.font = "800 60px " + FONT;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(String(i + 1), P, cy);
                ctx.textBaseline = "alphabetic";
                cover(it.img, coverX, cy - thumb / 2, thumb, thumb, opts.circle ? thumb / 2 : 20, initial(it.name));
                const sub = opts.showArtist ? it.artist : (it.minutes != null ? fmtInt(it.minutes) + " min" : "");
                ctx.textBaseline = "middle";
                ctx.fillStyle = WHITE;
                ctx.font = "700 50px " + FONT;
                ctx.fillText(ellipsize(it.name, maxW), nameX, sub ? cy - 22 : cy);
                if (sub) {
                    ctx.fillStyle = GRAY;
                    ctx.font = "500 36px " + FONT;
                    ctx.fillText(ellipsize(sub, maxW), nameX, cy + 30);
                }
                ctx.textBaseline = "alphabetic";
            });
            ctx.textAlign = "left";
            footer();
        }

        function cardGenres(d) {
            background();
            wordmark(P + 46);
            kicker("MY TOP GENRES", P, P + 150);
            ctx.fillStyle = WHITE;
            ctx.font = "800 108px " + FONT;
            ctx.fillText("Top genres", P, P + 250);

            const rows = d.genres.slice(0, 5);
            const top = 560, bottom = H - 180;
            const rowH = rows.length ? (bottom - top) / rows.length : 0;
            const barH = Math.min(150, rowH - 34);
            rows.forEach((it, i) => {
                const y = top + i * rowH + (rowH - barH) / 2;
                const shade = 60 - i * 8;
                roundRectPath(P, y, W - P * 2, barH, barH / 2);
                ctx.fillStyle = "hsl(146,63%," + shade + "%)";
                ctx.fill();
                ctx.fillStyle = i < 2 ? "#0b1f13" : "rgba(255,255,255,0.92)";
                ctx.font = "800 52px " + FONT;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText("#" + (i + 1), P + 44, y + barH / 2);
                ctx.fillText(ellipsize(it.name, W - P * 2 - 220), P + 170, y + barH / 2);
                ctx.textBaseline = "alphabetic";
            });
            footer();
        }

        function cardMinutes(d) {
            background();
            wordmark(P + 46);
            ctx.textAlign = "center";
            ls(6);
            ctx.font = "700 32px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText("YOU LISTENED FOR", W / 2, 520);
            ls(0);
            ctx.font = "800 240px " + FONT;
            ctx.fillStyle = WHITE;
            ctx.fillText(fmtInt(d.totalMinutes), W / 2, 760);
            ctx.font = "700 54px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText("minutes of music", W / 2, 850);
            ctx.font = "500 40px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText("that's about " + fmtInt(d.totalMinutes / 60) + " hours", W / 2, 930);
            const strip = (d.tracks.length ? d.tracks : d.albums).slice(0, 4);
            const size = 200, gap = 24, totalW = strip.length * size + (strip.length - 1) * gap;
            let sx = (W - totalW) / 2;
            const sy = 1180;
            strip.forEach((it) => {
                cover(it.img, sx, sy, size, size, 24, initial(it.name));
                sx += size + gap;
            });
            ctx.textAlign = "left";
            footer();
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
            footer();
        }

        function cardRecap(d) {
            background();
            wordmark(P + 46);
            kicker("THE RECAP", P, P + 150);
            ctx.fillStyle = WHITE;
            ctx.font = "800 104px " + FONT;
            ctx.fillText("Your Rewind", P, P + 250);

            const rows = [
                { label: "Top artist", it: d.artists[0], circle: true },
                { label: "Top song", it: d.tracks[0], circle: false },
                { label: "Top album", it: d.albums[0], circle: false },
            ];
            const top = 560, rowH = 300, thumb = 200;
            rows.forEach((r, i) => {
                if (!r.it) return;
                const y = top + i * rowH;
                cover(r.it.img, P, y, thumb, thumb, r.circle ? thumb / 2 : 24, initial(r.it.name));
                const tx = P + thumb + 40;
                ls(4);
                ctx.font = "700 30px " + FONT;
                ctx.fillStyle = GREEN;
                ctx.fillText(r.label.toUpperCase(), tx, y + 70);
                ls(0);
                ctx.font = "800 64px " + FONT;
                ctx.fillStyle = WHITE;
                ctx.fillText(ellipsize(r.it.name, W - tx - P), tx, y + 140);
                if (r.it.artist) {
                    ctx.font = "500 40px " + FONT;
                    ctx.fillStyle = GRAY;
                    ctx.fillText(ellipsize(r.it.artist, W - tx - P), tx, y + 195);
                }
            });
            const gy = top + rows.length * rowH + 40;
            ctx.font = "800 90px " + FONT;
            ctx.fillStyle = GREEN;
            ctx.fillText(fmtInt(d.totalMinutes), P, gy + 70);
            ctx.font = "500 40px " + FONT;
            ctx.fillStyle = GRAY;
            ctx.fillText("minutes listened", P, gy + 125);
            footer();
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

        async function attachCovers(kind, items) {
            const ids = items.map((it) => it.id).filter(Boolean);
            if (!ids.length || !window.fetchWithTimeout) return;
            let map = {};
            try {
                const res = await window.fetchWithTimeout(
                    "/api/images?kind=" + kind + "&ids=" + encodeURIComponent(ids.join(",")), {}, 15000);
                map = (res.ok && res.data && res.data.images) || {};
            } catch (_e) { /* covers optional */ }
            await Promise.all(items.map(async (it) => {
                if (it.id && map[it.id]) it.img = await loadImage(map[it.id]);
            }));
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

            await Promise.all([
                attachCovers("artist", artists),
                attachCovers("track", tracks),
                attachCovers("album", albums),
            ]);
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
            footer();
        }

        function buildDeck(d) {
            if (!d) {
                deck = [{ title: "Rewind", render: cardNoData }];
                return;
            }
            const topArtist = d.artists[0] || { name: "\u2014" };
            const topTrack = d.tracks[0] || { name: "\u2014" };
            deck = [
                { title: "Intro", render: () => cardIntro(d) },
                { title: "Top artist", render: () => cardHero("My #1 artist", topArtist, topArtist.minutes != null ? fmtInt(topArtist.minutes) + " minutes" : "", true) },
                { title: "Top 5 artists", render: () => cardList("My top artists", "Top artists", d.artists, { circle: true }) },
                { title: "Top song", render: () => cardHero("My #1 song", topTrack, topTrack.artist || "", false) },
                { title: "Top 5 songs", render: () => cardList("My top songs", "Top songs", d.tracks, { showArtist: true }) },
                { title: "Top 5 albums", render: () => cardList("My top albums", "Top albums", d.albums, { showArtist: true }) },
                { title: "Top 5 genres", render: () => cardGenres(d) },
                { title: "Minutes", render: () => cardMinutes(d) },
                { title: "Your vibe", render: () => cardVibe(d) },
                { title: "Recap", render: () => cardRecap(d) },
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
            if (captionEl) captionEl.textContent = deck[index].title + "  ·  " + (index + 1) + " / " + deck.length;
            if (dotsEl) {
                dotsEl.querySelectorAll(".share-dot").forEach((dot, i) => {
                    dot.classList.toggle("bg-primary", i === index);
                    dot.classList.toggle("w-5", i === index);
                    dot.classList.toggle("bg-white/30", i !== index);
                });
            }
        }

        function go(delta) { index += delta; renderCurrent(); }

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
        }

        /* ─────────────────────── open / close / export ─────────────────────── */

        async function openModal() {
            modal.classList.remove("hidden");
            if (nativeBtn && navigator.canShare) {
                nativeBtn.classList.remove("hidden");
                nativeBtn.classList.add("flex");
            }
            await ensureBuilt();
            renderCurrent();
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
        document.addEventListener("keydown", (e) => {
            if (modal.classList.contains("hidden")) return;
            if (e.key === "Escape") closeModal();
            else if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "ArrowRight") go(1);
        });

        if (downloadBtn) {
            downloadBtn.addEventListener("click", async () => {
                const blob = await toBlob();
                if (blob) downloadBlob(blob, "rewind-" + slugTitle() + ".png");
            });
        }

        if (downloadAllBtn) {
            downloadAllBtn.addEventListener("click", async () => {
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
