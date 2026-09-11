/**
 * Shared "Top X" overview card.
 *
 * Replaces the near-identical top_artist.js / top_album.js / top_track.js.
 * Each card is driven by a small config; everything else derives from `kind`
 * (element ids follow `top-{kind}-*`, response fields follow `{kind}_name` /
 * `{kind}_id`, endpoint is `/api/metrics/top-{kind}`, cover kind == `kind`).
 */
function initTopCard(config) {
    const { kind, label, secondaryId, formatSecondary, noDataText } = config;

    const nameEl = document.getElementById(`top-${kind}-name`);
    if (!nameEl) return;

    const skeleton = document.getElementById(`top-${kind}-skeleton`);
    const content = document.getElementById(`top-${kind}-content`);
    const errorContainer = document.getElementById(`top-${kind}-error`);
    const errorMsg = document.getElementById(`top-${kind}-error-msg`);
    const retryBtn = document.getElementById(`top-${kind}-retry-btn`);
    const secondaryEl = document.getElementById(secondaryId);

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

    async function fetchCard(attempt = 0) {
        const now = Date.now();
        if (isFetching || (now - lastFetchTime < 300)) return;
        isFetching = true;
        lastFetchTime = now;

        if (attempt === 0) showSkeleton();
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data, error: `Error loading ${label}` };
        });

        try {
            const res = await fetcher(`/api/metrics/top-${kind}`, {}, 5000);
            const imgEl = document.getElementById(`top-${kind}-image`);

            if (res.ok && res.data && res.data.status === "ok") {
                const data = res.data;
                if (data[`${kind}_name`]) {
                    nameEl.textContent = data[`${kind}_name`];
                    if (secondaryEl) secondaryEl.textContent = formatSecondary(data);
                    showContent();
                    // Album art can hang off a track id when the catalog doesn't
                    // know the album — coverRef picks whichever id carries it.
                    const ref = window.coverRef
                        ? window.coverRef({ id: data[`${kind}_id`], cover_kind: data.cover_kind, cover_id: data.cover_id }, kind)
                        : { kind, id: data[`${kind}_id`] };
                    if (ref.id) {
                        if (imgEl && window.loadCover) window.loadCover(imgEl, ref.kind, ref.id);
                    } else if (attempt < 6) {
                        // Cover id not ready yet (enrichment still running) — retry shortly.
                        setTimeout(() => fetchCard(attempt + 1), 3000);
                    }
                } else {
                    nameEl.textContent = "No Data";
                    if (secondaryEl) secondaryEl.textContent = noDataText;
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
        fetchCard();
    }

    window.addEventListener("rewind:data-updated", () => fetchCard());

    if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fetchCard();
        });
    }
}

function formatMinutes(mins) {
    return mins >= 60
        ? `${(mins / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`
        : `${Math.round(mins)} min`;
}

document.addEventListener("DOMContentLoaded", () => {
    initTopCard({
        kind: "artist",
        label: "top artist",
        secondaryId: "top-artist-streams",
        noDataText: "Upload data export to view top artist",
        formatSecondary: (d) => `${Number(d.total_streams).toLocaleString()} total streams`,
    });

    initTopCard({
        kind: "album",
        label: "top album",
        secondaryId: "top-album-subtext",
        noDataText: "Upload data export to view top album",
        formatSecondary: (d) => {
            const timeStr = formatMinutes(Number(d.total_minutes) || 0);
            const artistInfo = d.artist_name ? `by ${d.artist_name}` : "";
            return `${artistInfo} • ${timeStr}`.trim();
        },
    });

    initTopCard({
        kind: "track",
        label: "top track",
        secondaryId: "top-track-subtext",
        noDataText: "Upload data export to view top track",
        formatSecondary: (d) => {
            const streams = Number(d.total_streams).toLocaleString();
            const artistInfo = d.artist_name ? `by ${d.artist_name}` : "";
            return `${artistInfo} • ${streams} streams`.trim();
        },
    });
});
