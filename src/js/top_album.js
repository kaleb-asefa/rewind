document.addEventListener("DOMContentLoaded", () => {
    const albumNameEl = document.getElementById("top-album-name");
    const albumSubtextEl = document.getElementById("top-album-subtext");

    if (!albumNameEl) return;

    async function fetchTopAlbum() {
        try {
            albumNameEl.textContent = "Loading...";
            if (albumSubtextEl) albumSubtextEl.textContent = "...";

            let response;
            try {
                response = await fetch("http://localhost:8000/api/metrics/top-album");
            } catch (e) {
                response = await fetch("http://127.0.0.1:8000/api/metrics/top-album");
            }

            if (!response.ok) {
                albumNameEl.textContent = "--";
                if (albumSubtextEl) albumSubtextEl.textContent = "No data loaded yet";
                return;
            }

            const data = await response.json();
            if (data.status === "ok" && data.album_name) {
                albumNameEl.textContent = data.album_name;
                if (albumSubtextEl) {
                    const streamsFormatted = Number(data.total_streams).toLocaleString();
                    const artistInfo = data.artist_name ? `by ${data.artist_name}` : "";
                    albumSubtextEl.textContent = `${artistInfo} • ${streamsFormatted} streams`.trim();
                }
            } else {
                albumNameEl.textContent = "No Data";
                if (albumSubtextEl) albumSubtextEl.textContent = "Upload data to view top album";
            }
        } catch (err) {
            console.error("Failed to fetch top album metric:", err);
            albumNameEl.textContent = "--";
            if (albumSubtextEl) albumSubtextEl.textContent = "Error loading metric";
        }
    }

    fetchTopAlbum();
});
