/**
 * Rewind — Charts share card.
 * Draws a Spotify-Wrapped-style Top 10 card (own theme) onto a canvas and
 * exports it as a PNG. Pure canvas — no external libs, no cross-origin taint,
 * so the preview the user sees IS exactly the shared image.
 */
(function () {
    "use strict";

    const GREEN = "#1ed760";
    const WHITE = "#ffffff";
    const GRAY = "rgba(255,255,255,0.42)";
    const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";

    document.addEventListener("DOMContentLoaded", () => {
        const modal = document.getElementById("share-modal");
        const canvas = document.getElementById("share-canvas");
        const openBtn = document.getElementById("share-open-btn");
        const closeBtn = document.getElementById("share-close-btn");
        const downloadBtn = document.getElementById("share-download-btn");
        const nativeBtn = document.getElementById("share-native-btn");
        if (!modal || !canvas || !openBtn) return;

        function snapshot() {
            return window.RewindCharts && window.RewindCharts.snapshot
                ? window.RewindCharts.snapshot()
                : { label: "Artists", rangeLabel: "All-time", hasArtist: false, items: [] };
        }

        function ellipsize(ctx, text, maxW) {
            text = String(text == null ? "" : text);
            if (ctx.measureText(text).width <= maxW) return text;
            let t = text;
            while (t.length > 1 && ctx.measureText(t + "\u2026").width > maxW) t = t.slice(0, -1);
            return t + "\u2026";
        }

        function radialGlow(ctx, W, H, x, y, r, alpha) {
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, "rgba(30,215,96," + alpha + ")");
            g.addColorStop(1, "rgba(30,215,96,0)");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
        }

        function draw() {
            const snap = snapshot();
            const ctx = canvas.getContext("2d");
            const W = canvas.width, H = canvas.height;   // 1080 x 1920
            const P = 84;

            // background + green glows
            ctx.fillStyle = "#0e0e0e";
            ctx.fillRect(0, 0, W, H);
            radialGlow(ctx, W, H, W * 0.92, H * 0.06, W * 0.75, 0.22);
            radialGlow(ctx, W, H, W * 0.05, H * 0.96, W * 0.85, 0.12);

            ctx.textBaseline = "alphabetic";
            ctx.textAlign = "left";

            // wordmark: play triangle + "Rewind"
            let y = P + 52;
            ctx.fillStyle = GREEN;
            ctx.beginPath();
            ctx.moveTo(P, y - 34);
            ctx.lineTo(P, y - 2);
            ctx.lineTo(P + 30, y - 18);
            ctx.closePath();
            ctx.fill();
            ctx.font = "800 46px " + FONT;
            ctx.fillText("Rewind", P + 46, y);

            // "MY TOP 10"
            y += 120;
            if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";
            ctx.fillStyle = GRAY;
            ctx.font = "700 28px " + FONT;
            ctx.fillText("MY TOP 10", P, y);

            // heading (entity label)
            y += 96;
            if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
            ctx.fillStyle = WHITE;
            ctx.font = "800 104px " + FONT;
            ctx.fillText(ellipsize(ctx, snap.label, W - P * 2), P, y);

            // range
            y += 52;
            if ("letterSpacing" in ctx) ctx.letterSpacing = "5px";
            ctx.fillStyle = GREEN;
            ctx.font = "700 30px " + FONT;
            ctx.fillText(String(snap.rangeLabel || "").toUpperCase(), P, y);
            if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

            // numbered list
            const items = (snap.items || []).slice(0, 10);
            const listTop = y + 60;
            const footerY = H - P - 8;
            const rowH = items.length ? (footerY - 70 - listTop) / items.length : 0;
            const nameX = P + 96;
            const maxW = W - nameX - P;

            if (!items.length) {
                ctx.fillStyle = GRAY;
                ctx.font = "500 34px " + FONT;
                ctx.fillText("No data yet \u2014 upload your history.", P, listTop + 40);
            }

            items.forEach((it, i) => {
                const cy = listTop + i * rowH + rowH * 0.5;
                const twoLine = snap.hasArtist && it.artist;
                // rank
                ctx.fillStyle = GREEN;
                ctx.font = "800 46px " + FONT;
                ctx.textAlign = "right";
                ctx.fillText(String(i + 1), P + 60, cy + (twoLine ? 6 : 16));
                ctx.textAlign = "left";
                // name
                ctx.fillStyle = WHITE;
                ctx.font = "700 46px " + FONT;
                ctx.fillText(ellipsize(ctx, it.name, maxW), nameX, twoLine ? cy - 4 : cy + 16);
                // artist
                if (twoLine) {
                    ctx.fillStyle = GRAY;
                    ctx.font = "500 32px " + FONT;
                    ctx.fillText(ellipsize(ctx, it.artist, maxW), nameX, cy + 40);
                }
            });

            // footer
            if ("letterSpacing" in ctx) ctx.letterSpacing = "5px";
            ctx.fillStyle = GRAY;
            ctx.font = "700 26px " + FONT;
            ctx.textAlign = "left";
            ctx.fillText("MY REWIND", P, footerY);
            ctx.fillStyle = GREEN;
            ctx.textAlign = "right";
            ctx.fillText("REWIND", W - P, footerY);
            ctx.textAlign = "left";
            if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
        }

        async function openModal() {
            modal.classList.remove("hidden");
            // Make sure the web font is ready so canvas text isn't a fallback.
            if (document.fonts && document.fonts.ready) {
                try { await document.fonts.ready; } catch (_e) { /* ignore */ }
            }
            draw();
            if (nativeBtn && navigator.canShare) {
                nativeBtn.classList.remove("hidden");
                nativeBtn.classList.add("flex");
            }
        }
        function closeModal() {
            modal.classList.add("hidden");
        }

        openBtn.addEventListener("click", openModal);
        if (closeBtn) closeBtn.addEventListener("click", closeModal);
        modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
        });

        function toBlob() {
            return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        }
        function fileName() {
            return "my-top-" + String(snapshot().label || "top").toLowerCase() + ".png";
        }

        if (downloadBtn) {
            downloadBtn.addEventListener("click", async () => {
                const blob = await toBlob();
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName();
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        if (nativeBtn) {
            nativeBtn.addEventListener("click", async () => {
                const blob = await toBlob();
                if (!blob) return;
                const file = new File([blob], fileName(), { type: "image/png" });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({ files: [file], title: "My Rewind Top 10" });
                    } catch (_e) { /* dismissed */ }
                }
            });
        }
    });
})();
