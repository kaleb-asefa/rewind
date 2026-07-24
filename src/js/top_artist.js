document.addEventListener("DOMContentLoaded", () => {
    const nameEl = document.getElementById("top-artist-name");
    const streamsEl = document.getElementById("top-artist-streams");

    if (!nameEl) return;

    async function fetchTopArtist() {
        try {
            nameEl.textContent = "Loading...";
            if (streamsEl) streamsEl.textContent = "...";

            let response;
            try {
                response = await fetch("http://localhost:8000/api/metrics/top-artist");
            } catch (e) {
                response = await fetch("http://127.0.0.1:8000/api/metrics/top-artist");
            }

            if (!response.ok) {
                nameEl.textContent = "--";
                if (streamsEl) streamsEl.textContent = "No data loaded yet";
                return;
            }

            const data = await response.json();
            if (data.status === "ok" && data.artist_name) {
                nameEl.textContent = data.artist_name;
                if (streamsEl) {
                    const streamsFormatted = Number(data.total_streams).toLocaleString();
                    streamsEl.textContent = `${streamsFormatted} total streams`;
                }
            } else {
                nameEl.textContent = "No Data";
                if (streamsEl) streamsEl.textContent = "Upload data to view top artist";
            }
        } catch (err) {
            console.error("Failed to fetch top artist metric:", err);
            nameEl.textContent = "--";
            if (streamsEl) streamsEl.textContent = "Error loading metric";
        }
    }

    fetchTopArtist();
});
