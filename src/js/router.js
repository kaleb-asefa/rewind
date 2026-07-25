/**
 * Single-Page Router & View Switcher for Rewind
 * Switches views dynamically without triggering browser page reloads.
 * Preserves 100% original visual design and CSS.
 */

function switchView(viewName, updateHistory = true) {
    const overviewView = document.getElementById("view-overview");
    const uploadView = document.getElementById("view-upload");

    const navOverview = document.getElementById("nav-link-overview");
    const navUpload = document.getElementById("nav-link-upload");

    if (!overviewView || !uploadView) return;

    if (viewName === "upload") {
        overviewView.classList.add("hidden");
        uploadView.classList.remove("hidden");

        if (navOverview) {
            navOverview.className = "text-secondary-fixed-dim hover:text-on-surface transition-colors font-body-lg text-body-lg cursor-pointer";
        }
        if (navUpload) {
            navUpload.className = "text-primary font-bold transition-colors font-body-lg text-body-lg border-b-2 border-primary pb-1 cursor-pointer";
        }

        if (updateHistory) {
            history.pushState({ view: "upload" }, "", "?view=upload");
        }
    } else {
        uploadView.classList.add("hidden");
        overviewView.classList.remove("hidden");

        if (navUpload) {
            navUpload.className = "text-secondary-fixed-dim hover:text-on-surface transition-colors font-body-lg text-body-lg cursor-pointer";
        }
        if (navOverview) {
            navOverview.className = "text-primary font-bold transition-colors font-body-lg text-body-lg border-b-2 border-primary pb-1 cursor-pointer";
        }

        if (updateHistory) {
            history.pushState({ view: "overview" }, "", "?view=overview");
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get("view");
    const hash = window.location.hash;

    if (viewParam === "upload" || hash === "#upload") {
        switchView("upload", false);
    } else {
        switchView("overview", false);
    }

    window.addEventListener("popstate", (e) => {
        if (e.state && e.state.view) {
            switchView(e.state.view, false);
        } else {
            const params = new URLSearchParams(window.location.search);
            const view = params.get("view") || "overview";
            switchView(view, false);
        }
    });

    const navOverview = document.getElementById("nav-link-overview");
    const navUpload = document.getElementById("nav-link-upload");

    if (navOverview) {
        navOverview.addEventListener("click", (e) => {
            e.preventDefault();
            switchView("overview");
        });
    }

    if (navUpload) {
        navUpload.addEventListener("click", (e) => {
            e.preventDefault();
            switchView("upload");
        });
    }
});

window.switchView = switchView;
