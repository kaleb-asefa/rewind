/**
 * Shared API Utility for Rewind Frontend
 * Supports priority host selection (127.0.0.1:8000 -> localhost:8000)
 * and strict timeout limits using AbortController.
 */

async function fetchWithTimeout(endpoint, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions = {
        ...options,
        signal: controller.signal,
    };

    let response;
    let timedOut = false;

    try {
        try {
            response = await fetch(`http://127.0.0.1:8000${endpoint}`, fetchOptions);
        } catch (err) {
            if (err.name === "AbortError") {
                timedOut = true;
                throw err;
            }
            // Fallback to localhost if 127.0.0.1 fails immediately
            response = await fetch(`http://localhost:8000${endpoint}`, fetchOptions);
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return {
                ok: false,
                status: response.status,
                error: errorData.detail || `Server returned status ${response.status}`,
                timedOut: false,
            };
        }

        const data = await response.json();
        return {
            ok: true,
            status: response.status,
            data,
            timedOut: false,
        };
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError" || timedOut) {
            return {
                ok: false,
                status: 408,
                error: "Server took too long to respond (timeout limit 5s).",
                timedOut: true,
            };
        }
        return {
            ok: false,
            status: 0,
            error: "Backend server is offline or unreachable.",
            timedOut: false,
        };
    }
}

window.fetchWithTimeout = fetchWithTimeout;

/**
 * Cover-art loading.
 *
 * Covers are resolved through the backend (Spotify oEmbed, cached server-side)
 * and then loaded from the Spotify CDN. To keep this fast we:
 *   - remember every resolved url in a module cache (keyed "kind:id"), so the
 *     same cover is never re-requested across cards, re-renders or pages;
 *   - dedupe in-flight single requests for the same id;
 *   - batch a whole container's covers into ONE /api/images call.
 */
const _coverCache = new Map();     // "kind:id" -> url string | null (resolved miss)
const _coverInflight = new Map();  // "kind:id" -> Promise<url|null>

function _applyCover(imgEl, url) {
    if (imgEl && url) {
        imgEl.decoding = "async";
        imgEl.onload = () => imgEl.classList.remove("hidden");
        imgEl.src = url;
    }
}

/**
 * Lazily load a single Spotify cover into an <img>, revealing it once it loads.
 * Best-effort: silently does nothing if the id is missing or the fetch fails.
 */
async function loadCover(imgEl, kind, id) {
    if (!imgEl || !id) return;
    const key = kind + ":" + id;
    if (_coverCache.has(key)) {
        _applyCover(imgEl, _coverCache.get(key));
        return;
    }
    let pending = _coverInflight.get(key);
    if (!pending) {
        pending = fetchWithTimeout(
            `/api/image?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
            {},
            8000,
        )
            .then((res) => (res.ok && res.data && res.data.image_url) || null)
            .catch(() => null);
        _coverInflight.set(key, pending);
    }
    const url = await pending;
    _coverInflight.delete(key);
    if (url) _coverCache.set(key, url);  // cache hits only; misses/failures retry later
    _applyCover(imgEl, url);
}

/**
 * Batch-load every cover in a container in a single request per kind.
 * Reads each <img class="cover-img" data-cover-id> (optional data-cover-kind
 * overrides `defaultKind`). Uses the shared cache, so already-known covers show
 * instantly and only the unknown ids hit the network.
 */
async function loadCoversBatch(container, defaultKind) {
    if (!container) return;
    const imgs = Array.from(container.querySelectorAll("img.cover-img[data-cover-id]"));
    if (!imgs.length) return;

    const byKind = new Map();  // kind -> Set(id) still needing resolution
    for (const img of imgs) {
        const kind = img.getAttribute("data-cover-kind") || defaultKind || "track";
        const id = img.getAttribute("data-cover-id");
        if (!id || _coverCache.has(kind + ":" + id)) continue;
        if (!byKind.has(kind)) byKind.set(kind, new Set());
        byKind.get(kind).add(id);
    }

    await Promise.all(
        Array.from(byKind, async ([kind, idSet]) => {
            const need = Array.from(idSet);
            try {
                const res = await fetchWithTimeout(
                    `/api/images?kind=${encodeURIComponent(kind)}&ids=${encodeURIComponent(need.join(","))}`,
                    {},
                    15000,  // one request for many covers; cold fetches need headroom
                );
                const map = (res.ok && res.data && res.data.images) || {};
                // Cache hits only — never poison the cache with a miss/failure,
                // so a later render simply retries anything that didn't resolve.
                for (const id of need) if (map[id]) _coverCache.set(kind + ":" + id, map[id]);
            } catch (_) {
                /* transient — leave uncached so a later render retries */
            }
        }),
    );

    for (const img of imgs) {
        const kind = img.getAttribute("data-cover-kind") || defaultKind || "track";
        _applyCover(img, _coverCache.get(kind + ":" + img.getAttribute("data-cover-id")));
    }
}

window.loadCover = loadCover;
window.loadCoversBatch = loadCoversBatch;
