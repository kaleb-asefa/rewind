/**
 * Rewind Landing Hero: Cassette Deck Interaction
 * Ticks a tape counter, and "rewinds" it to zero on CTA click before navigating.
 */
(function () {
    const counterEl = document.getElementById('tape-counter');
    const deckEl = document.getElementById('cassette-deck');
    const cta = document.getElementById('rewind-cta');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function format(totalSeconds) {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    let seconds = 0;
    let tickTimer = null;
    if (counterEl && !reducedMotion) {
        tickTimer = setInterval(() => {
            seconds += 1;
            counterEl.textContent = format(seconds);
        }, 1000);
    }

    if (cta) {
        cta.addEventListener('click', (e) => {
            const href = cta.getAttribute('href');
            if (!href || reducedMotion) return;

            e.preventDefault();
            clearInterval(tickTimer);
            if (deckEl) deckEl.classList.add('is-rewinding');

            let remaining = seconds;
            const rewindTimer = setInterval(() => {
                remaining = Math.max(0, remaining - 4);
                if (counterEl) counterEl.textContent = format(remaining);
                if (remaining <= 0) {
                    clearInterval(rewindTimer);
                    window.location.href = href;
                }
            }, 30);

            // Safety net in case the interval stalls
            setTimeout(() => { window.location.href = href; }, 700);
        });
    }
})();
