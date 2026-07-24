document.addEventListener("DOMContentLoaded", () => {
    const trackNameEl = document.getElementById("top-track-name");
    const trackSubtextEl = document.getElementById("top-track-subtext");

    if (!trackNameEl) return;

    async function fetchTopTrack() {
        try {
            trackNameEl.textContent = "Loading...";
            if (trackSubtextEl) trackSubtextEl.textContent = "...";

            let response;
            try {
                response = await fetch("http://localhost:8000/api/metrics/top-track");
            } catch (e) {
                response = await fetch("http://127.0.0.1:8000/api/metrics/top-track");
            }

            if (!response.ok) {
                trackNameEl.textContent = "--";
                if (trackSubtextEl) trackSubtextEl.textContent = "No data loaded yet";
                return;
            }

            const data = await response.json();
            if (data.status === "ok" && data.track_name) {
                trackNameEl.textContent = data.track_name;
                if (trackSubtextEl) {
                    const streamsFormatted = Number(data.total_streams).toLocaleString();
                    const artistInfo = data.artist_name ? `by ${data.artist_name}` : "";
                    trackSubtextEl.textContent = `${artistInfo} • ${streamsFormatted} streams`.trim();
                }
            } else {
                trackNameEl.textContent = "No Data";
                if (trackSubtextEl) trackSubtextEl.textContent = "Upload data to view top track";
            }
        } catch (err) {
            console.error("Failed to fetch top track metric:", err);
            trackNameEl.textContent = "--";
            if (trackSubtextEl) trackSubtextEl.textContent = "Error loading metric";
        }
    }

    fetchTopTrack();
});
