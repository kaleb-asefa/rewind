document.addEventListener("DOMContentLoaded", () => {
    const card = document.getElementById("total-time-card");
    const valEl = document.getElementById("total-time-value");
    const unitEl = document.getElementById("total-time-unit");

    if (!card || !valEl) return;

    let totalMinutes = null;
    const units = ["minutes", "hours", "days"];
    let currentUnitIndex = 0; // Starts at minutes

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
        try {
            valEl.textContent = "Loading...";
            const response = await fetch("http://localhost:8000/api/metrics/total-time");
            if (!response.ok) {
                valEl.textContent = "--";
                if (unitEl) unitEl.textContent = "No data loaded yet";
                return;
            }
            const data = await response.json();
            if (data.status === "ok") {
                totalMinutes = data.total_minutes;
                updateDisplay();
            }
        } catch (err) {
            console.error("Failed to fetch total time metric:", err);
            valEl.textContent = "--";
            if (unitEl) unitEl.textContent = "Click to retry";
        }
    }

    // Initial fetch from backend API
    fetchTotalTime();

    // On click, perform frontend unit conversion: Minutes -> Hours -> Days -> Minutes
    card.addEventListener("click", () => {
        if (totalMinutes === null) return;
        currentUnitIndex = (currentUnitIndex + 1) % units.length;
        updateDisplay();
    });
});
