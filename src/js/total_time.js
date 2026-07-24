document.addEventListener("DOMContentLoaded", () => {
    const card = document.getElementById("total-time-card");
    const valEl = document.getElementById("total-time-value");
    const unitEl = document.getElementById("total-time-unit");

    if (!card || !valEl) return;

    // Unit rotation sequence: minutes -> hours -> days -> minutes
    const units = ["minutes", "hours", "days"];
    let currentUnitIndex = 0; // Starts at minutes

    async function fetchAndDisplayTotalTime(unit) {
        try {
            valEl.textContent = "Loading...";
            const response = await fetch(`http://localhost:8000/api/metrics/total-time?unit=${unit}`);
            if (!response.ok) {
                valEl.textContent = "--";
                if (unitEl) unitEl.textContent = "No data loaded yet";
                return;
            }
            const data = await response.json();
            if (data.status === "ok") {
                const formattedValue = Number(data.value).toLocaleString(undefined, {
                    maximumFractionDigits: 2
                });
                valEl.textContent = `${formattedValue} ${data.label}`;
                if (unitEl) {
                    const nextUnit = units[(currentUnitIndex + 1) % units.length];
                    const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
                    unitEl.textContent = `Click to switch to ${capitalize(nextUnit)}`;
                }
            }
        } catch (err) {
            console.error("Failed to fetch total time metric:", err);
            valEl.textContent = "--";
            if (unitEl) unitEl.textContent = "Click to retry";
        }
    }

    // Initial fetch on page load (Minutes)
    fetchAndDisplayTotalTime(units[currentUnitIndex]);

    // On click, cycle to next unit and fetch from backend using SQLAlchemy engine
    card.addEventListener("click", () => {
        currentUnitIndex = (currentUnitIndex + 1) % units.length;
        fetchAndDisplayTotalTime(units[currentUnitIndex]);
    });
});
