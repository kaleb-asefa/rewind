document.addEventListener("DOMContentLoaded", () => {
    const skeleton = document.getElementById("top-album-skeleton");
    const content = document.getElementById("top-album-content");
    const errorContainer = document.getElementById("top-album-error");
    const errorMsg = document.getElementById("top-album-error-msg");
    const retryBtn = document.getElementById("top-album-retry-btn");
    const albumNameEl = document.getElementById("top-album-name");
    const albumSubtextEl = document.getElementById("top-album-subtext");

    if (!albumNameEl) return;
    let isFetching = false;
    let lastFetchTime = 0;

    function showSkeleton() {
        if (skeleton) skeleton.classList.remove("hidden");
        if (content) content.classList.add("hidden");
        if (errorContainer) errorContainer.classList.add("hidden");
    }

    function showContent() {
        if (skeleton) skeleton.classList.add("hidden");
        if (errorContainer) errorContainer.classList.add("hidden");
        if (content) content.classList.remove("hidden");
    }

    function showError(msg) {
        if (skeleton) skeleton.classList.add("hidden");
        if (content) content.classList.add("hidden");
        if (errorContainer) {
            errorContainer.classList.remove("hidden");
            if (errorMsg) errorMsg.textContent = msg;
        }
    }

    async function fetchTopAlbum(attempt = 0) {
        const now = Date.now();
        if (isFetching || (now - lastFetchTime < 300)) return;
        isFetching = true;
        lastFetchTime = now;

        if (attempt === 0) showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: "Error loading top album" };
        });

        try {
            const res = await fetcher("/api/metrics/top-album", {}, 5000);

            const imgEl = document.getElementById("top-album-image");

            if (res.ok && res.data && res.data.status === "ok") {
                if (res.data.album_name) {
                    albumNameEl.textContent = res.data.album_name;
                    if (albumSubtextEl) {
                        const mins = Number(res.data.total_minutes) || 0;
                        const timeStr = mins >= 60
                            ? `${(mins / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`
                            : `${Math.round(mins)} min`;
                        const artistInfo = res.data.artist_name ? `by ${res.data.artist_name}` : "";
                        albumSubtextEl.textContent = `${artistInfo} • ${timeStr}`.trim();
                    }
                    showContent();
                    if (res.data.album_id) {
                        if (imgEl && window.loadCover) window.loadCover(imgEl, "album", res.data.album_id);
                    } else if (attempt < 6) {
                        // Cover id not ready yet (enrichment still running) — retry shortly.
                        setTimeout(() => fetchTopAlbum(attempt + 1), 3000);
                    }
                } else {
                    albumNameEl.textContent = "No Data";
                    if (albumSubtextEl) albumSubtextEl.textContent = "Upload data export to view top album";
                    if (imgEl) imgEl.classList.add("hidden");
                    showContent();
                }
            } else {
                const note = res.timedOut
                    ? "Server connection timed out (5s limit)."
                    : (res.error || "No listening history loaded yet.");
                showError(note);
            }
        } finally {
            isFetching = false;
        }
    }

    const overviewView = document.getElementById("view-overview");
    if (overviewView && !overviewView.classList.contains("hidden")) {
        fetchTopAlbum();
    }

    window.addEventListener("rewind:data-updated", () => {
        fetchTopAlbum();
    });

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchTopAlbum();
        });
    }
});
