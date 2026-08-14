document.addEventListener("DOMContentLoaded", () => {
  const monitor = document.getElementById("ingestion-monitor");
  const totalRows = document.getElementById("ingestion-total-rows");
  const uniqueTracks = document.getElementById("ingestion-unique-tracks");
  const featuresLoaded = document.getElementById("ingestion-features-loaded");
  const featuresDetail = document.getElementById("ingestion-features-detail");
  const stage = document.getElementById("ingestion-stage");
  const stageDetail = document.getElementById("ingestion-stage-detail");
  const summary = document.getElementById("ingestion-summary");
  const statusDot = document.getElementById("ingestion-status-dot");
  const statusText = document.getElementById("ingestion-status-text");
  const progressLabel = document.getElementById("ingestion-progress-label");
  const progressValue = document.getElementById("ingestion-progress-value");
  const progressBar = document.getElementById("ingestion-progress-bar");
  const sampleCount = document.getElementById("ingestion-sample-count");
  const featureRows = document.getElementById("ingestion-feature-rows");

  if (!monitor || !window.fetchWithTimeout) return;

  const phaseLabels = {
    queued: "Queued",
    seeding_cache: "Indexing tracks",
    audio_features: "Loading track features",
    images: "Loading artwork",
    release_dates: "Loading release dates",
    complete: "Up to date",
    error: "Enrichment error",
    cancelled: "Enrichment cancelled",
  };

  let requestInFlight = false;
  let refreshTimer = null;
  let refreshDelay = 10000;

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

  function formatFeature(value) {
    if (value === null || value === undefined) return "--";
    return Number(value).toFixed(2);
  }

  function renderRows(rows) {
    featureRows.replaceChildren();
    sampleCount.textContent = `${rows.length} shown`;

    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.className = "h-20 px-4 text-center text-on-surface-variant";
      cell.textContent = "Track features will appear here as Embeat batches are committed.";
      row.appendChild(cell);
      featureRows.appendChild(row);
      return;
    }

    rows.forEach((item) => {
      const row = document.createElement("tr");
      row.className = "h-12 hover:bg-white/[0.02]";

      const values = [
        item.track_name || "Unknown track",
        item.genre || "Unclassified",
        item.popularity ?? "--",
        formatFeature(item.danceability),
        formatFeature(item.energy),
        formatFeature(item.valence),
        item.tempo === null || item.tempo === undefined
          ? "--"
          : `${Math.round(item.tempo)} BPM`,
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.className = index < 2 ? "truncate px-4 py-2.5" : "px-3 py-2.5 text-right tabular-nums";
        if (index === 0) cell.classList.add("font-bold");
        if (index === 1) cell.classList.add("text-on-surface-variant");
        cell.textContent = value;
        cell.title = value;
        row.appendChild(cell);
      });

      featureRows.appendChild(row);
    });
  }

  function renderProgress(job, totalTrackCount) {
    const audio = job?.stats?.audio_features || {};
    const matched = Number(audio.matched || 0);
    const processed = Number(audio.processed || 0);
    const queried = Number(audio.queried || totalTrackCount || 0);
    const percent = queried > 0 ? Math.min(100, Math.round((processed / queried) * 100)) : 0;

    featuresLoaded.textContent = matched.toLocaleString();
    featuresDetail.textContent = queried
      ? `${processed.toLocaleString()} of ${queried.toLocaleString()} checked`
      : "Waiting for Embeat";
    progressBar.style.width = `${percent}%`;
    progressValue.textContent = `${percent}%`;
    progressLabel.textContent = queried
      ? `Audio features: ${matched.toLocaleString()} matches`
      : "Waiting for feature scan";

    if (!job) {
      stage.textContent = "Idle";
      stageDetail.textContent = "No background job";
    } else {
      stage.textContent = phaseLabels[job.phase] || job.phase;
      stageDetail.textContent = job.status === "error"
        ? job.error || "Worker stopped"
        : `Job ${job.job_id.slice(0, 8)}`;
    }

    renderRows(job?.feature_samples || []);
  }

  function renderStatus(data) {
    totalRows.textContent = Number(data.total_rows || 0).toLocaleString();
    uniqueTracks.textContent = Number(data.unique_tracks || 0).toLocaleString();

    if (data.total_rows) {
      summary.textContent = `${Number(data.total_rows).toLocaleString()} listening rows are available for analytics. Metadata continues in the background.`;
    } else {
      summary.textContent = "Session database is ready for an upload.";
    }

    const job = data.enrichment;
    if (!job) {
      setStatus(data.status === "ok" ? "Ingestion ready" : "Waiting for data", "success");
      refreshDelay = 10000;
    } else if (job.status === "error") {
      setStatus(phaseLabels.error, "error");
      refreshDelay = 10000;
    } else if (job.status === "complete") {
      setStatus(phaseLabels.complete, "success");
      refreshDelay = 10000;
    } else {
      setStatus(phaseLabels[job.phase] || "Enriching metadata", "pending");
      refreshDelay = 2000;
    }

    renderProgress(job, data.unique_tracks);
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
      scheduleRefresh();
    }
  }

  function scheduleRefresh(delay = refreshDelay) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshWhenVisible, delay);
  }

  function refreshWhenVisible() {
    const overview = document.getElementById("view-overview");
    if (!document.hidden && (!overview || !overview.classList.contains("hidden"))) {
      refresh();
    } else {
      scheduleRefresh();
    }
  }

  refreshWhenVisible();
  window.addEventListener("rewind:data-updated", () => scheduleRefresh(0));
  document.addEventListener("visibilitychange", () => scheduleRefresh(0));
});