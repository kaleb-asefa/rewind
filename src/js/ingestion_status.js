document.addEventListener("DOMContentLoaded", () => {
  const monitor = document.getElementById("ingestion-monitor");
  const totalRows = document.getElementById("ingestion-total-rows");
  const uniqueTracks = document.getElementById("ingestion-unique-tracks");
  const latestStream = document.getElementById("ingestion-latest-stream");
  const summary = document.getElementById("ingestion-summary");
  const statusDot = document.getElementById("ingestion-status-dot");
  const statusText = document.getElementById("ingestion-status-text");
  const recentRows = document.getElementById("ingestion-recent-rows");

  if (!monitor || !window.fetchWithTimeout) return;

  const phaseLabels = {
    queued: "Queued",
    seeding_cache: "Indexing tracks",
    audio_features: "Loading track features",
    images: "Loading artwork",
    release_dates: "Loading release dates",
    complete: "Up to date",
    error: "Enrichment error",
  };

  let requestInFlight = false;

  function setStatus(label, tone) {
    statusText.textContent = label;
    statusDot.className = "h-2 w-2 rounded-full";

    if (tone === "success") {
      statusDot.classList.add("bg-primary");
    } else if (tone === "error") {
      statusDot.classList.add("bg-error");
    } else {
      statusDot.classList.add("bg-secondary");
    }
  }

  function formatTimestamp(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatListeningTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.round((milliseconds || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function renderRows(rows) {
    recentRows.replaceChildren();

    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "h-12 px-4 text-center text-on-surface-variant";
      cell.textContent = "No ingested tracks yet.";
      row.appendChild(cell);
      recentRows.appendChild(row);
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement("tr");
      row.className = "h-12 hover:bg-white/[0.02]";

      const values = [
        formatTimestamp(item.ts),
        item.track_name || "Unknown track",
        item.artist_name || "Unknown artist",
        formatListeningTime(item.ms_played),
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.className = "truncate px-4 py-2.5";
        if (index === 0) cell.classList.add("text-on-surface-variant");
        if (index === 3) cell.classList.add("text-right", "font-bold");
        cell.textContent = value;
        cell.title = value;
        row.appendChild(cell);
      });

      recentRows.appendChild(row);
    });
  }

  function renderStatus(data) {
    totalRows.textContent = Number(data.total_rows || 0).toLocaleString();
    uniqueTracks.textContent = Number(data.unique_tracks || 0).toLocaleString();
    latestStream.textContent = formatTimestamp(data.latest_stream);

    if (data.first_stream && data.latest_stream) {
      summary.textContent = `${formatTimestamp(data.first_stream)} to ${formatTimestamp(data.latest_stream)}`;
    } else {
      summary.textContent = "Session database is ready for an upload.";
    }

    const job = data.enrichment;
    if (!job) {
      setStatus(data.status === "ok" ? "Ingestion ready" : "Waiting for data", "success");
    } else if (job.status === "error") {
      setStatus(phaseLabels.error, "error");
    } else if (job.status === "complete") {
      setStatus(phaseLabels.complete, "success");
    } else {
      setStatus(phaseLabels[job.phase] || "Enriching metadata", "pending");
    }

    renderRows(data.recent_rows || []);
  }

  async function refresh() {
    if (requestInFlight) return;
    requestInFlight = true;

    try {
      const result = await window.fetchWithTimeout(
        "/api/ingestion-status?limit=5",
        {},
        3000,
      );

      if (result.ok) {
        renderStatus(result.data);
      } else {
        setStatus("Backend unavailable", "error");
        summary.textContent = result.error;
      }
    } finally {
      requestInFlight = false;
    }
  }

  function refreshWhenVisible() {
    const overview = document.getElementById("view-overview");
    if (!document.hidden && (!overview || !overview.classList.contains("hidden"))) {
      refresh();
    }
  }

  refreshWhenVisible();
  window.setInterval(refreshWhenVisible, 2000);
  window.addEventListener("rewind:data-updated", refreshWhenVisible);
  document.addEventListener("visibilitychange", refreshWhenVisible);
});