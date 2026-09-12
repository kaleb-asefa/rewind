document.addEventListener("DOMContentLoaded", () => {
    const card = document.getElementById("total-time-card");
    const skeleton = document.getElementById("total-time-skeleton");
    const content = document.getElementById("total-time-content");
    const errorContainer = document.getElementById("total-time-error");
    const errorMsg = document.getElementById("total-time-error-msg");
    const retryBtn = document.getElementById("total-time-retry-btn");
    const valEl = document.getElementById("total-time-value");
    const unitEl = document.getElementById("total-time-unit");

    if (!card || !valEl) return;

    let totalMinutes = null;
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

    function updateDisplay() {
        if (totalMinutes === null) return;

        const mins = Math.round(totalMinutes);
        const hours = totalMinutes / 60;
        // Whole hours read as a rounder headline figure, but anything under an
        // hour would collapse to "0 hours", so keep a decimal while it matters.
        const hoursText = hours < 10
            ? hours.toLocaleString(undefined, { maximumFractionDigits: 1 })
            : Math.round(hours).toLocaleString();

        valEl.textContent = `${mins.toLocaleString()} ${mins === 1 ? "Minute" : "Minutes"}`;
        if (unitEl) {
            unitEl.textContent = `${hoursText} ${hoursText === "1" ? "hour" : "hours"}`;
        }
    }

    async function fetchTotalTime() {
        const now = Date.now();
        if (isFetching || (now - lastFetchTime < 300)) return;
        isFetching = true;
        lastFetchTime = now;

        showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: "Error loading total time" };
        });

        try {
            const res = await fetcher("/api/metrics/total-time", {}, 5000);

            if (res.ok && res.data && res.data.status === "ok") {
                totalMinutes = res.data.total_minutes;
                updateDisplay();
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
        fetchTotalTime();
    }

    window.addEventListener("rewind:data-updated", () => {
        fetchTotalTime();
    });

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchTotalTime();
        });
    }
});
