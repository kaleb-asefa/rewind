document.addEventListener("DOMContentLoaded", () => {
    const skeleton = document.getElementById("top-artist-skeleton");
    const content = document.getElementById("top-artist-content");
    const errorContainer = document.getElementById("top-artist-error");
    const errorMsg = document.getElementById("top-artist-error-msg");
    const retryBtn = document.getElementById("top-artist-retry-btn");
    const nameEl = document.getElementById("top-artist-name");
    const streamsEl = document.getElementById("top-artist-streams");

    if (!nameEl) return;
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

    async function fetchTopArtist(attempt = 0) {
        const now = Date.now();
        if (isFetching || (now - lastFetchTime < 300)) return;
        isFetching = true;
        lastFetchTime = now;

        if (attempt === 0) showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: "Error loading top artist" };
        });

        try {
            const res = await fetcher("/api/metrics/top-artist", {}, 5000);

            const imgEl = document.getElementById("top-artist-image");

            if (res.ok && res.data && res.data.status === "ok") {
                if (res.data.artist_name) {
                    nameEl.textContent = res.data.artist_name;
                    if (streamsEl) {
                        const streamsFormatted = Number(res.data.total_streams).toLocaleString();
                        streamsEl.textContent = `${streamsFormatted} total streams`;
                    }
                    showContent();
                    if (res.data.artist_id) {
                        if (imgEl && window.loadCover) window.loadCover(imgEl, "artist", res.data.artist_id);
                    } else if (attempt < 6) {
                        // Cover id not ready yet (enrichment still running) — retry shortly.
                        setTimeout(() => fetchTopArtist(attempt + 1), 3000);
                    }
                } else {
                    nameEl.textContent = "No Data";
                    if (streamsEl) streamsEl.textContent = "Upload data export to view top artist";
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
        fetchTopArtist();
    }

    window.addEventListener("rewind:data-updated", () => {
        fetchTopArtist();
    });

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchTopArtist();
        });
    }
});
