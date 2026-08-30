document.addEventListener("DOMContentLoaded", () => {
    const skeleton = document.getElementById("top-track-skeleton");
    const content = document.getElementById("top-track-content");
    const errorContainer = document.getElementById("top-track-error");
    const errorMsg = document.getElementById("top-track-error-msg");
    const retryBtn = document.getElementById("top-track-retry-btn");
    const trackNameEl = document.getElementById("top-track-name");
    const trackSubtextEl = document.getElementById("top-track-subtext");

    if (!trackNameEl) return;
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

    async function fetchTopTrack() {
        const now = Date.now();
        if (isFetching || (now - lastFetchTime < 300)) return;
        isFetching = true;
        lastFetchTime = now;

        showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: "Error loading top track" };
        });

        try {
            const res = await fetcher("/api/metrics/top-track", {}, 5000);

            const imgEl = document.getElementById("top-track-image");
            if (imgEl) imgEl.classList.add("hidden");

            if (res.ok && res.data && res.data.status === "ok") {
                if (res.data.track_name) {
                    trackNameEl.textContent = res.data.track_name;
                    if (trackSubtextEl) {
                        const streamsFormatted = Number(res.data.total_streams).toLocaleString();
                        const artistInfo = res.data.artist_name ? `by ${res.data.artist_name}` : "";
                        trackSubtextEl.textContent = `${artistInfo} • ${streamsFormatted} streams`.trim();
                    }
                    if (imgEl && window.loadCover) window.loadCover(imgEl, "track", res.data.track_id);
                } else {
                    trackNameEl.textContent = "No Data";
                    if (trackSubtextEl) trackSubtextEl.textContent = "Upload data export to view top track";
                }
                showContent();
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
        fetchTopTrack();
    }

    window.addEventListener("rewind:data-updated", () => {
        fetchTopTrack();
    });

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchTopTrack();
        });
    }
});
