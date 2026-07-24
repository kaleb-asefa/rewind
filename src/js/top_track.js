document.addEventListener("DOMContentLoaded", () => {
    const skeleton = document.getElementById("top-track-skeleton");
    const content = document.getElementById("top-track-content");
    const errorContainer = document.getElementById("top-track-error");
    const errorMsg = document.getElementById("top-track-error-msg");
    const retryBtn = document.getElementById("top-track-retry-btn");
    const trackNameEl = document.getElementById("top-track-name");
    const trackSubtextEl = document.getElementById("top-track-subtext");

    if (!trackNameEl) return;

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
        showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: "Error loading top track" };
        });

        const res = await fetcher("/api/metrics/top-track", {}, 5000);

        if (res.ok && res.data && res.data.status === "ok") {
            if (res.data.track_name) {
                trackNameEl.textContent = res.data.track_name;
                if (trackSubtextEl) {
                    const streamsFormatted = Number(res.data.total_streams).toLocaleString();
                    const artistInfo = res.data.artist_name ? `by ${res.data.artist_name}` : "";
                    trackSubtextEl.textContent = `${artistInfo} • ${streamsFormatted} streams`.trim();
                }
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
    }

    fetchTopTrack();

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchTopTrack();
        });
    }
});
