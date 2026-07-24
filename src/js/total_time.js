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
    const units = ["minutes", "hours", "days"];
    let currentUnitIndex = 0;

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

        let displayValue;
        let label;
        let nextUnit;

        const mode = units[currentUnitIndex];
        if (mode === "hours") {
            displayValue = (totalMinutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 });
            label = "Hours";
            nextUnit = "Days";
        } else if (mode === "days") {
            displayValue = (totalMinutes / (60 * 24)).toLocaleString(undefined, { maximumFractionDigits: 2 });
            label = "Days";
            nextUnit = "Minutes";
        } else {
            displayValue = Number(totalMinutes).toLocaleString(undefined, { maximumFractionDigits: 2 });
            label = "Minutes";
            nextUnit = "Hours";
        }

        valEl.textContent = `${displayValue} ${label}`;
        if (unitEl) {
            unitEl.textContent = `Click to switch to ${nextUnit}`;
        }
    }

    async function fetchTotalTime() {
        showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: "Error loading total time" };
        });

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
    }

    fetchTotalTime();

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchTotalTime();
        });
    }

    card.addEventListener("click", () => {
        if (totalMinutes === null) return;
        currentUnitIndex = (currentUnitIndex + 1) % units.length;
        updateDisplay();
    });
});
