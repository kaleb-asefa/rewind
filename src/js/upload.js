document.addEventListener("DOMContentLoaded", () => {
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const fileListContainer = document.getElementById("file-list-container");
    const fileList = document.getElementById("file-list");
    const fileCount = document.getElementById("file-count");
    const uploadAllBtn = document.getElementById("upload-all");

    if (!dropZone || !fileInput) return;

    let selectedFiles = [];

    // Open file browser on drop zone click
    dropZone.addEventListener("click", (e) => {
        if (e.target !== fileInput && !e.target.closest("button")) {
            fileInput.click();
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
        handleFileSelection(Array.from(e.target.files));
    });

    dropZone.addEventListener("drop", (e) => {
        if (e.dataTransfer && e.dataTransfer.files) {
            handleFileSelection(Array.from(e.dataTransfer.files));
        }
    });

    function handleFileSelection(newFiles) {
        const jsonFiles = newFiles.filter(f => f.name.toLowerCase().endsWith(".json"));
        if (jsonFiles.length === 0) return;

        jsonFiles.forEach(file => {
            if (!selectedFiles.some(existing => existing.name === file.name)) {
                selectedFiles.push(file);
            }
        });

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
        uploadAllBtn.addEventListener("click", async () => {
            if (selectedFiles.length === 0) return;

            uploadAllBtn.disabled = true;
            uploadAllBtn.textContent = "Uploading & Ingesting...";
            uploadAllBtn.classList.add("opacity-75");

            let successCount = 0;
            let errorOccurred = false;

            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append("file", file);

                try {
                    const response = await fetch("http://localhost:8000/api/upload", {
                        method: "POST",
                        body: formData,
                    });

                    if (response.ok) {
                        successCount++;
                    } else {
                        const errData = await response.json().catch(() => ({}));
                        console.error(`Failed uploading ${file.name}:`, errData.detail || response.statusText);
                        errorOccurred = true;
                    }
                } catch (err) {
                    console.error(`Network error uploading ${file.name}:`, err);
                    errorOccurred = true;
                }
            }

            if (successCount > 0 && !errorOccurred) {
                uploadAllBtn.textContent = "Upload Complete! Redirecting...";
                uploadAllBtn.classList.replace("bg-on-surface", "bg-primary");
                uploadAllBtn.classList.replace("text-surface", "text-on-primary-container");
                setTimeout(() => {
                    window.location.href = "overview.html";
                }, 1000);
            } else if (successCount > 0) {
                alert(`Uploaded ${successCount} file(s). Some files failed. Redirecting to overview.`);
                window.location.href = "overview.html";
            } else {
                alert("Upload failed. Please ensure the backend server is running on http://localhost:8000 and try again.");
                uploadAllBtn.disabled = false;
                uploadAllBtn.textContent = "Analyze All Files";
                uploadAllBtn.classList.remove("opacity-75");
            }
        });
    }
});
