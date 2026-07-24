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
