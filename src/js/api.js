/**
 * Shared API Utility for Rewind Frontend
 * Supports priority host selection (127.0.0.1:8000 -> localhost:8000)
 * and strict timeout limits using AbortController.
 */

/**
 * Multi-user guest ticket (see docs/MULTI_USER.md + API_CONTRACT.md §2).
 * Generated once per browser and persisted, so the backend can route each
 * visitor to their own isolated per-session DuckDB file.
 */
function _getSessionTicket() {
    let t = localStorage.getItem("rewind_session");
    if (!t) {
        t = crypto.randomUUID();
        localStorage.setItem("rewind_session", t);
    }
    return t;
}

async function fetchWithTimeout(endpoint, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions = {
        ...options,
        signal: controller.signal,
        headers: {
            ...(options.headers || {}),
            "X-Rewind-Session": _getSessionTicket(),
        },
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
const _warmedBytes = new Set();    // urls whose bytes we've asked the browser to cache
const _warmingImgs = new Set();    // hold Image refs until they load (so GC can't cancel)

function _applyCover(imgEl, url) {
    if (!imgEl || !url) return;
    imgEl.decoding = "async";
    const reveal = () => imgEl.classList.remove("hidden");
    imgEl.onload = reveal;
    if (imgEl.getAttribute("src") !== url) imgEl.src = url;
    // A cached image may finish before `load` is dispatched (or the event can be
    // starved during the bar-race animation loop), leaving it stuck `hidden`.
    // decode() resolves once it's paintable — from cache or network — so it's a
    // reliable safety net; complete/naturalWidth covers browsers without decode().
    if (typeof imgEl.decode === "function") {
        imgEl.decode().then(reveal).catch(() => {});
    } else if (imgEl.complete && imgEl.naturalWidth > 0) {
        reveal();
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
 * Resolve a kind's cover ids into the shared cache in one request.
 * Only unknown ids are fetched; cache hits are stored, misses/failures are left
 * uncached so a later call retries. Never touches the DOM.
 */
async function _resolveCovers(kind, ids) {
    const need = [];
    for (const id of ids) {
        if (id && !_coverCache.has(kind + ":" + id)) need.push(id);
    }
    if (!need.length) return;
    try {
        const res = await fetchWithTimeout(
            `/api/images?kind=${encodeURIComponent(kind)}&ids=${encodeURIComponent(need.join(","))}`,
            {},
            15000,  // one request for many covers; cold fetches need headroom
        );
        const map = (res.ok && res.data && res.data.images) || {};
        for (const id of need) if (map[id]) _coverCache.set(kind + ":" + id, map[id]);
    } catch (_) {
        /* transient — leave uncached so a later call retries */
    }
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
        if (!id) continue;
        if (!byKind.has(kind)) byKind.set(kind, new Set());
        byKind.get(kind).add(id);
    }

    await Promise.all(Array.from(byKind, ([kind, idSet]) => _resolveCovers(kind, Array.from(idSet))));

    for (const img of imgs) {
        const kind = img.getAttribute("data-cover-kind") || defaultKind || "track";
        _applyCover(img, _coverCache.get(kind + ":" + img.getAttribute("data-cover-id")));
    }
}

/**
 * Warm the cover cache ahead of time (e.g. to prefetch a tab the user hasn't
 * opened yet), so covers appear instantly when it's shown. Best-effort.
 */
async function preloadCovers(kind, ids) {
    if (!kind || !Array.isArray(ids) || !ids.length) return;
    await _resolveCovers(kind, ids);
    // Warm the browser image cache too — the URL cache alone still costs a CDN
    // byte-fetch on first display; pre-decoding the bytes makes the later
    // <img src> paint instantly, matching a return-visit.
    for (const id of ids) {
        const url = id && _coverCache.get(kind + ":" + id);
        if (!url || _warmedBytes.has(url)) continue;
        _warmedBytes.add(url);
        const im = new Image();
        _warmingImgs.add(im);
        im.decoding = "async";
        im.onload = im.onerror = () => _warmingImgs.delete(im);
        im.src = url;
    }
}

/**
 * Seed the cover cache from URLs the backend returned inline on a metric
 * response (item.image_url), so loadCoversBatch / preloadCovers skip the extra
 * /api/images round-trip. Null/absent urls are left uncached for the fallback.
 */
function primeCoverUrls(kind, items) {
    if (!kind || !Array.isArray(items)) return;
    for (const it of items) {
        const id = it && it.id;
        const url = it && it.image_url;
        if (id && url && !_coverCache.has(kind + ":" + id)) {
            _coverCache.set(kind + ":" + id, url);
        }
    }
}

window.loadCover = loadCover;
window.loadCoversBatch = loadCoversBatch;
window.preloadCovers = preloadCovers;
window.primeCoverUrls = primeCoverUrls;
