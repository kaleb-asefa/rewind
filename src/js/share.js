/**
 * Rewind — Share snapshot as image.
 * Populates the share card from the loaded overview DOM and exports a PNG
 * via html-to-image, using the Web Share API when the browser supports it.
 */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("share-modal");
    const card = document.getElementById("share-card");
    const frame = document.getElementById("share-card-frame");
    const openBtn = document.getElementById("share-open-btn");
    const closeBtn = document.getElementById("share-close-btn");
    const downloadBtn = document.getElementById("share-download-btn");
    const nativeBtn = document.getElementById("share-native-btn");
    if (!modal || !card || !openBtn) return;

    const readText = (id) => {
      const el = document.getElementById(id);
      const value = el ? el.textContent.trim() : "";
      return value && value !== "--" ? value : "\u2014";
    };

    function populate() {
      document.getElementById("share-total-time").textContent = readText("total-time-value");
      document.getElementById("share-top-artist").textContent = readText("top-artist-name");
      document.getElementById("share-top-track").textContent = readText("top-track-name");
      document.getElementById("share-top-album").textContent = readText("top-album-name");
      document.getElementById("share-days").textContent = readText("heatmap-summary");
      document.getElementById("share-streams").textContent = readText("heatmap-total");
    }

    // Scale the 360×640 card down to whatever the viewport can show, measuring
    // the action row (it wraps on narrow screens) instead of guessing at it.
    // The transform lives on the frame, so html-to-image still captures the
    // card at full size.
    function fitCard() {
      if (!frame) return;
      const actions = document.getElementById("share-actions");
      const chrome = (actions ? actions.offsetHeight : 54) + 20;  // + gap-5
      const scale = Math.max(0.3, Math.min(
        1,
        (modal.clientHeight - 32 - chrome - 8) / 640,
        (modal.clientWidth - 32) / 360,
      ));
      frame.style.transform = "scale(" + scale + ")";
      frame.style.marginBottom = -Math.round(640 * (1 - scale)) + "px";
    }

    function openModal() {
      populate();
      modal.classList.remove("hidden");
      fitCard();
      if (nativeBtn && navigator.canShare) {
        nativeBtn.classList.remove("hidden");
        nativeBtn.classList.add("flex");
      }
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
    });
    window.addEventListener("resize", () => {
      if (!modal.classList.contains("hidden")) fitCard();
    });

    async function renderBlob() {
      if (!window.htmlToImage) {
        console.warn("html-to-image is unavailable; cannot export share card.");
        return null;
      }
      return window.htmlToImage.toBlob(card, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#0e0e0e",
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", async () => {
        const blob = await renderBlob();
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "my-rewind.png";
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    if (nativeBtn) {
      nativeBtn.addEventListener("click", async () => {
        const blob = await renderBlob();
        if (!blob) return;
        const file = new File([blob], "my-rewind.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: "My Rewind" });
          } catch (_e) {
            /* user dismissed the share sheet */
          }
        }
      });
    }
  });
})();
