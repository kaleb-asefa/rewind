/**
 * Rewind Listening Behavior Cards
 * Populates the "Total Songs" and "Most Active Day" overview cards from the
 * backend. The hate cards remain static placeholders.
 */
document.addEventListener("DOMContentLoaded", () => {
  const songsEl = document.getElementById("total-songs-value");
  const dayEl = document.getElementById("active-day-value");
  const daySub = document.getElementById("active-day-subtext");
  if (!songsEl && !dayEl) return;

  const fetcher =
    window.fetchWithTimeout ||
    (async (ep) => {
      const res = await fetch(`http://127.0.0.1:8000${ep}`);
      const data = await res.json();
      return { ok: res.ok, data };
    });

  function formatDuration(mins) {
    if (!mins || mins <= 0) return null;
    if (mins >= 60) {
      const h = mins / 60;
      return `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
    }
    return `${Math.round(mins)} min`;
  }

  async function loadTotalSongs() {
    if (!songsEl) return;
    try {
      const res = await fetcher("/api/metrics/total-songs", {}, 5000);
      if (res.ok && res.data && res.data.status === "ok" && res.data.total_songs > 0) {
        songsEl.textContent = Number(res.data.total_songs).toLocaleString();
      } else {
        songsEl.textContent = "\u2014";
      }
    } catch (_e) {
      songsEl.textContent = "\u2014";
    }
  }

  async function loadActiveDay() {
    if (!dayEl) return;
    try {
      const res = await fetcher("/api/metrics/active-day", {}, 5000);
      if (res.ok && res.data && res.data.status === "ok" && res.data.weekday) {
        dayEl.textContent = res.data.weekday;
        if (daySub) {
          const avg = formatDuration(res.data.average_minutes);
          daySub.textContent = avg ? `Average ${avg} listening` : "Average listening";
        }
      } else {
        dayEl.textContent = "\u2014";
        if (daySub) daySub.textContent = "No activity yet";
      }
    } catch (_e) {
      dayEl.textContent = "\u2014";
      if (daySub) daySub.textContent = "Average listening";
    }
  }

  function loadAll() {
    loadTotalSongs();
    loadActiveDay();
  }

  loadAll();
  window.addEventListener("rewind:data-updated", loadAll);
});
