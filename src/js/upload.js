document.addEventListener("DOMContentLoaded", () => {
    const dropZone = document.getElementById("drop-zone");
    const browseBtn = document.getElementById("browse-btn");
    const fileInput = document.getElementById("file-input");
    const fileListContainer = document.getElementById("file-list-container");
    const fileList = document.getElementById("file-list");
    const fileCount = document.getElementById("file-count");
    const uploadAllBtn = document.getElementById("upload-all");
    const uploadStatus = document.getElementById("upload-status");

    if (!dropZone || !fileInput) return;

    let selectedFiles = [];

    const openFilePicker = () => {
        fileInput.value = "";
        fileInput.click();
    };

    if (browseBtn) {
        browseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openFilePicker();
        });
    }

    dropZone.addEventListener("click", (e) => {
        if (fileListContainer && fileListContainer.contains(e.target)) return;
        if (e.target !== fileInput) {
            openFilePicker();
        }
    });

    // Drag-and-Drop Visual States
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("border-primary", "bg-primary/5");
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropZone.classList.remove("border-primary", "bg-primary/5");
        });
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelection(Array.from(e.target.files));
        }
    });

    dropZone.addEventListener("drop", (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelection(Array.from(e.dataTransfer.files));
        }
    });

    function showStatus(message, type = "info") {
        if (!uploadStatus) return;
        uploadStatus.classList.remove("hidden", "bg-error-container/20", "text-error", "bg-primary-container/20", "text-primary", "bg-surface-variant", "text-on-surface");
        
        if (type === "error") {
            uploadStatus.classList.add("bg-error-container/20", "text-error");
        } else if (type === "success") {
            uploadStatus.classList.add("bg-primary-container/20", "text-primary");
        } else {
            uploadStatus.classList.add("bg-surface-variant", "text-on-surface");
        }
        uploadStatus.textContent = message;
    }

    function hideStatus() {
        if (uploadStatus) {
            uploadStatus.classList.add("hidden");
            uploadStatus.textContent = "";
        }
    }

    function handleFileSelection(newFiles) {
        const jsonFiles = newFiles.filter(f => f.name.toLowerCase().endsWith(".json"));
        if (jsonFiles.length === 0) {
            showStatus("Please select valid Spotify history JSON files.", "error");
            return;
        }

        let addedCount = 0;
        jsonFiles.forEach(file => {
            if (!selectedFiles.some(existing => existing.name === file.name && existing.size === file.size)) {
                selectedFiles.push(file);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            hideStatus();
        }
        renderFileList();
    }

    function renderFileList() {
        if (selectedFiles.length === 0) {
            fileListContainer.classList.add("hidden");
            dropZone.classList.remove("h-48");
            dropZone.classList.add("flex-grow");
            return;
        }

        fileListContainer.classList.remove("hidden");
        dropZone.classList.add("h-48");
        dropZone.classList.remove("flex-grow");

        fileList.innerHTML = "";
        selectedFiles.forEach((file, index) => {
            const item = document.createElement("div");
            item.className = "flex items-center justify-between p-3 bg-surface-variant/30 rounded-lg border border-white/5 animate-in slide-in-from-bottom-2 duration-300";
            item.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-primary text-[20px]">description</span>
                    <div class="flex flex-col">
                        <span class="text-body-sm text-on-surface font-medium truncate max-w-[200px]">${file.name}</span>
                        <span class="text-[10px] text-secondary-fixed-dim uppercase tracking-wider">${(file.size / 1024).toFixed(1)} KB</span>
                    </div>
                </div>
                <button type="button" data-index="${index}" class="remove-file-btn text-secondary-fixed-dim hover:text-error transition-colors">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            `;
            fileList.appendChild(item);
        });

        fileCount.textContent = `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}`;

        fileList.querySelectorAll(".remove-file-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute("data-index"), 10);
                selectedFiles.splice(idx, 1);
                renderFileList();
            });
        });
    }

    if (uploadAllBtn) {
        uploadAllBtn.addEventListener("click", () => {
            if (selectedFiles.length === 0) return;

            uploadAllBtn.disabled = true;
            uploadAllBtn.textContent = `Analyzing ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}...`;
            uploadAllBtn.classList.add("opacity-75");

            const formData = new FormData();
            selectedFiles.forEach(file => {
                formData.append("files", file);
            });

            // Send upload request to backend via shared API utility
            const fetchPromise = (window.fetchWithTimeout || fetch)(
                window.fetchWithTimeout ? "/api/upload" : "http://127.0.0.1:8000/api/upload",
                {
                    method: "POST",
                    body: formData,
                },
                15000 // Allow up to 15s for ingestion
            );

            // Immediately redirect to overview.html so user lands on dashboard with progressive skeletons active
            window.location.href = "overview.html";
        });
    }
});
