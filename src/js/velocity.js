/**
 * Rewind - Rank Velocity Chart Component (src/js/velocity.js)
 * Dynamic multi-year rank trajectory renderer with smooth sliding timeline camera.
 */

(function () {
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const SHORT_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    const MUSIC_NOTE_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23201f1f'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' fill='%2353e076' font-family='sans-serif' font-size='40'>♪</text></svg>";
    const ARTIST_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23201f1f'/><text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' fill='%2353e076' font-family='sans-serif' font-size='40'>👤</text></svg>";

    let dynamicMonthsList = [];

    function getFullDateString(monthIdx) {
        if (!dynamicMonthsList.length) return "NO DATA";
        const idx = Math.min(Math.max(0, Math.floor(monthIdx)), dynamicMonthsList.length - 1);
        const yyyymm = dynamicMonthsList[idx];
        const y = yyyymm.slice(0, 4);
        const m = parseInt(yyyymm.slice(5, 7), 10) - 1;
        return `${MONTH_NAMES[m]} ${y}`;
    }

    function getShortMonthYear(monthIdx) {
        if (!dynamicMonthsList.length) return "";
        const idx = Math.min(Math.max(0, Math.floor(monthIdx)), dynamicMonthsList.length - 1);
        const yyyymm = dynamicMonthsList[idx];
        const y = yyyymm.slice(0, 4);
        const m = parseInt(yyyymm.slice(5, 7), 10) - 1;
        return `${SHORT_MONTHS[m]} '${y.slice(2)}`;
    }

    // Dynamic Rank Data populated from FastAPI endpoints
    const TRACKS_DATA = [];
    const ARTISTS_DATA = [];

    // Module State
    let currentCategory = 'tracks';
    let currentData = TRACKS_DATA;
    let progress = 0.0;
    let isPlaying = true;
    let playSpeed = 1.0;
    let animationFrameId = null;
    let lastTimestamp = null;

    // SVG Canvas Constants
    const SVG_W = 1000;
    const SVG_H = 440;
    const PADDING_LEFT = 60;
    const PADDING_RIGHT = 185;
    const PADDING_TOP = 25;
    const PADDING_BOTTOM = 35;
    const CHART_W = SVG_W - PADDING_LEFT - PADDING_RIGHT;
    const CHART_H = SVG_H - PADDING_TOP - PADDING_BOTTOM;
    const VISIBLE_WINDOW = 10;
    const FOCUS_RATIO = 0.70;
    const FOCUS_OFFSET = (VISIBLE_WINDOW - 1) * FOCUS_RATIO;

    function getWindowBounds(prog) {
        const totalM = Math.max(1, dynamicMonthsList.length);
        const maxProg = Math.max(0, totalM - 1);
        const windowSpan = Math.min(VISIBLE_WINDOW - 1, maxProg);
        
        let winStart;
        if (prog <= FOCUS_OFFSET) {
            winStart = 0;
        } else if (prog >= maxProg - (windowSpan - FOCUS_OFFSET)) {
            winStart = maxProg - windowSpan;
        } else {
            winStart = prog - FOCUS_OFFSET;
        }

        const winEnd = winStart + windowSpan;
        return { winStart, winEnd };
    }

    function getMonthX(monthIdx, winStart) {
        const span = Math.max(1, VISIBLE_WINDOW - 1);
        return PADDING_LEFT + ((monthIdx - winStart) / span) * CHART_W;
    }

    function getRankY(rankVal) {
        return PADDING_TOP + ((rankVal - 1) / 7) * CHART_H;
    }

    function getInterpolatedRank(ranks, prog) {
        if (!ranks || ranks.length === 0) return 8;
        const maxIdx = ranks.length - 1;
        if (prog <= 0) return ranks[0];
        if (prog >= maxIdx) return ranks[maxIdx];
        
        const idx = Math.floor(prog);
        const frac = prog - idx;
        if (idx >= maxIdx) return ranks[maxIdx];

        const r1 = ranks[idx];
        const r2 = ranks[idx + 1];
        
        const smoothFrac = (1 - Math.cos(frac * Math.PI)) / 2;
        return r1 + (r2 - r1) * smoothFrac;
    }

    function generatePathD(ranks, prog, winStart) {
        if (!ranks || ranks.length === 0) return '';
        const maxIdx = ranks.length - 1;
        const currentMaxMonth = Math.min(prog, maxIdx);
        const points = [];

        const minIdx = Math.max(0, Math.floor(winStart) - 1);
        const maxIdxPoint = Math.ceil(currentMaxMonth);

        for (let m = minIdx; m <= maxIdxPoint; m++) {
            if (m < currentMaxMonth) {
                points.push({ x: getMonthX(m, winStart), y: getRankY(ranks[m]) });
            } else {
                const currentRank = getInterpolatedRank(ranks, currentMaxMonth);
                points.push({ x: getMonthX(currentMaxMonth, winStart), y: getRankY(currentRank) });
            }
        }

        if (points.length === 0) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

        let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i === 0 ? i : i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }

        return d;
    }

    function renderChart() {
        const yGroup = document.getElementById('y-grid-group');
        const xGroup = document.getElementById('x-grid-group');
        const pathsGroup = document.getElementById('paths-group');
        const tipsOverlay = document.getElementById('tips-overlay');
        
        if (!yGroup || !xGroup || !pathsGroup || !tipsOverlay) return;

        yGroup.innerHTML = '';
        xGroup.innerHTML = '';
        pathsGroup.innerHTML = '';
        tipsOverlay.innerHTML = '';

        const totalM = dynamicMonthsList.length;

        // Fixed Y-Axis Lines (#1 to #8)
        for (let r = 1; r <= 8; r++) {
            const y = getRankY(r);
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', PADDING_LEFT);
            line.setAttribute('y1', y);
            line.setAttribute('x2', SVG_W - PADDING_RIGHT + 20);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', r === 1 ? 'rgba(83, 224, 118, 0.25)' : 'rgba(255, 255, 255, 0.05)');
            line.setAttribute('stroke-width', r === 1 ? '1.5' : '1');
            if (r !== 1) line.setAttribute('stroke-dasharray', '4 4');
            yGroup.appendChild(line);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', PADDING_LEFT - 12);
            text.setAttribute('y', y + 4);
            text.setAttribute('text-anchor', 'end');
            text.setAttribute('fill', r === 1 ? '#53e076' : '#bccbb9');
            text.setAttribute('font-size', '10');
            text.setAttribute('font-weight', r === 1 ? '800' : '600');
            text.setAttribute('font-family', 'Space Mono, monospace');
            text.textContent = `#${r}`;
            yGroup.appendChild(text);
        }

        if (totalM === 0 || !currentData || currentData.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant text-body-sm font-medium gap-2';
            emptyMsg.innerHTML = `
                <span class="material-symbols-outlined text-3xl text-primary opacity-80">info</span>
                <span>No listening rank data loaded yet.</span>
                <span class="text-xs opacity-60">Upload your Spotify listening data export to view rank velocity.</span>
            `;
            tipsOverlay.appendChild(emptyMsg);
            return;
        }

        const { winStart, winEnd } = getWindowBounds(progress);

        // Dynamic Sliding X-Axis Month Ticks
        const minMonthVisible = Math.max(0, Math.floor(winStart) - 1);
        const maxMonthVisible = Math.min(totalM - 1, Math.ceil(winEnd) + 1);

        for (let m = minMonthVisible; m <= maxMonthVisible; m++) {
            const x = getMonthX(m, winStart);

            if (x >= PADDING_LEFT - 30 && x <= SVG_W - PADDING_RIGHT + 30) {
                const isJanNewYear = dynamicMonthsList[m] && dynamicMonthsList[m].endsWith('-01');

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', x);
                line.setAttribute('y1', PADDING_TOP - 10);
                line.setAttribute('x2', x);
                line.setAttribute('y2', SVG_H - PADDING_BOTTOM + 5);
                line.setAttribute('stroke', isJanNewYear ? 'rgba(83, 224, 118, 0.2)' : 'rgba(255, 255, 255, 0.04)');
                line.setAttribute('stroke-width', isJanNewYear ? '1.5' : '1');
                xGroup.appendChild(line);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', x);
                text.setAttribute('y', SVG_H - PADDING_BOTTOM + 20);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', isJanNewYear ? '#53e076' : '#bccbb9');
                text.setAttribute('font-size', isJanNewYear ? '11' : '10');
                text.setAttribute('font-weight', isJanNewYear ? '800' : '700');
                text.setAttribute('font-family', 'Space Mono, monospace');
                text.textContent = getShortMonthYear(m);
                xGroup.appendChild(text);
            }
        }

        // Draw Rank Trajectories & Position Tip Avatars
        currentData.forEach((item) => {
            const pathD = generatePathD(item.ranks, progress, winStart);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathD);
            path.setAttribute('stroke', item.color);
            path.setAttribute('class', 'rank-path');
            path.setAttribute('id', `path-${item.id}`);

            pathsGroup.appendChild(path);

            const currentRank = getInterpolatedRank(item.ranks, progress);
            const tipX_svg = getMonthX(progress, winStart);
            const tipY_svg = getRankY(currentRank);

            const tipX_percent = (tipX_svg / SVG_W) * 100;
            const tipY_percent = (tipY_svg / SVG_H) * 100;

            const isRankOne = Math.round(currentRank) === 1;

            const tipEl = document.createElement('div');
            tipEl.className = 'tip-container';
            tipEl.style.left = `${tipX_percent}%`;
            tipEl.style.top = `${tipY_percent}%`;
            tipEl.id = `tip-${item.id}`;

            tipEl.innerHTML = `
                <div class="tip-avatar-ring" style="border: 2px solid ${item.color};">
                    ${isRankOne ? '<div class="pulse-ring"></div>' : ''}
                    <img src="${item.image}" alt="${item.title}" class="w-full h-full rounded-full object-cover"/>
                    <div class="rank-badge-pill" style="border-color: ${item.color}; color: ${isRankOne ? '#53e076' : '#ffffff'};">
                        #${Math.round(currentRank)}
                    </div>
                </div>
                <div class="tip-title-tag">
                    ${item.title}
                </div>
            `;

            tipsOverlay.appendChild(tipEl);
        });
    }

    function updateDisplay() {
        const totalM = dynamicMonthsList.length;
        if (!totalM) return;
        const currentMonthIdx = Math.min(Math.floor(progress), totalM - 1);
        const fullDateLabel = getFullDateString(currentMonthIdx);
        
        const monthDisp = document.getElementById('current-month-display');
        if (monthDisp) monthDisp.textContent = fullDateLabel;
        
        const scrubber = document.getElementById('timeline-scrubber');
        if (scrubber) {
            scrubber.max = Math.max(0, totalM - 1);
            scrubber.value = progress;
        }
    }

    function startAnimationLoop() {
        function step(timestamp) {
            if (!lastTimestamp) lastTimestamp = timestamp;
            const dt = (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;

            if (isPlaying && dynamicMonthsList.length > 0) {
                const maxP = Math.max(0, dynamicMonthsList.length - 1);
                progress += (dt / 0.8) * playSpeed;
                if (progress >= maxP) {
                    progress = 0;
                }

                renderChart();
                updateDisplay();
            }

            animationFrameId = requestAnimationFrame(step);
        }
        animationFrameId = requestAnimationFrame(step);
    }

    const DEFAULT_COLORS = [
        '#53e076', '#00d2ff', '#b066fe', '#ff6b6b',
        '#ffaa00', '#38f9d7', '#ff54b0', '#4d94ff'
    ];

    async function fetchRankData() {
        const fetcher = window.fetchWithTimeout || (async (ep) => {
            const res = await fetch(`http://127.0.0.1:8000${ep}`);
            const data = await res.json();
            return { ok: res.ok, data };
        });

        try {
            const [tracksRes, artistsRes] = await Promise.all([
                fetcher('/api/metrics/track-rank?limit=8', {}, 5000),
                fetcher('/api/metrics/artist-rank?limit=8', {}, 5000)
            ]);

            let activeMonths = [];

            if (tracksRes.ok && tracksRes.data && tracksRes.data.status === "ok" && Array.isArray(tracksRes.data.months)) {
                activeMonths = tracksRes.data.months;
            } else if (artistsRes.ok && artistsRes.data && artistsRes.data.status === "ok" && Array.isArray(artistsRes.data.months)) {
                activeMonths = artistsRes.data.months;
            }

            if (activeMonths.length > 0) {
                dynamicMonthsList = activeMonths;
                const startY = activeMonths[0].slice(0, 4);
                const endY = activeMonths[activeMonths.length - 1].slice(0, 4);
                
                const startEl = document.getElementById('timeline-start-year');
                const endEl = document.getElementById('timeline-end-year');
                if (startEl) startEl.textContent = startY;
                if (endEl) endEl.textContent = endY;

                const scrubber = document.getElementById('timeline-scrubber');
                if (scrubber) {
                    scrubber.max = Math.max(0, activeMonths.length - 1);
                }
            }

            if (tracksRes.ok && tracksRes.data && tracksRes.data.status === "ok" && Array.isArray(tracksRes.data.data) && tracksRes.data.data.length > 0) {
                const mappedTracks = tracksRes.data.data.map((item, idx) => ({
                    id: `track-${idx + 1}`,
                    title: item.track_name || 'Unknown Track',
                    subtitle: item.artist_name || 'Unknown Artist',
                    image: MUSIC_NOTE_AVATAR,
                    color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                    ranks: Array.isArray(item.monthly_ranks) ? item.monthly_ranks : [],
                    plays: Array(dynamicMonthsList.length).fill(item.total_streams || 0)
                }));
                TRACKS_DATA.splice(0, TRACKS_DATA.length, ...mappedTracks);
            }

            if (artistsRes.ok && artistsRes.data && artistsRes.data.status === "ok" && Array.isArray(artistsRes.data.data) && artistsRes.data.data.length > 0) {
                const mappedArtists = artistsRes.data.data.map((item, idx) => ({
                    id: `artist-${idx + 1}`,
                    title: item.artist_name || 'Unknown Artist',
                    subtitle: `${item.total_streams || 0} streams`,
                    image: ARTIST_AVATAR,
                    color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                    ranks: Array.isArray(item.monthly_ranks) ? item.monthly_ranks : [],
                    plays: Array(dynamicMonthsList.length).fill(item.total_streams || 0)
                }));
                ARTISTS_DATA.splice(0, ARTISTS_DATA.length, ...mappedArtists);
            }

            currentData = currentCategory === 'tracks' ? TRACKS_DATA : ARTISTS_DATA;
            renderChart();
            updateDisplay();
        } catch (e) {
            console.warn("Could not load backend rank data, using default view.", e);
        }
    }

    // Exposed Global Actions for Controls
    window.switchCategory = function (category) {
        currentCategory = category;
        currentData = category === 'tracks' ? TRACKS_DATA : ARTISTS_DATA;
        progress = 0.0;

        const tracksBtn = document.getElementById('tab-tracks');
        const artistsBtn = document.getElementById('tab-artists');
        
        if (tracksBtn && artistsBtn) {
            if (category === 'tracks') {
                tracksBtn.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-label-bold font-label-bold transition-all bg-primary text-on-primary shadow-sm";
                artistsBtn.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-label-bold font-label-bold transition-all text-on-surface-variant hover:text-on-surface";
            } else {
                artistsBtn.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-label-bold font-label-bold transition-all bg-primary text-on-primary shadow-sm";
                tracksBtn.className = "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-label-bold font-label-bold transition-all text-on-surface-variant hover:text-on-surface";
            }
        }

        renderChart();
        updateDisplay();
    };

    window.togglePlay = function () {
        isPlaying = !isPlaying;
        const playIcon = document.getElementById('play-icon');
        if (playIcon) playIcon.textContent = isPlaying ? 'pause' : 'play_arrow';
    };

    window.resetTimeline = function () {
        progress = 0;
        renderChart();
        updateDisplay();
    };

    window.onScrub = function (val) {
        progress = parseFloat(val);
        renderChart();
        updateDisplay();
    };

    window.setSpeed = function (spd) {
        playSpeed = spd;
        document.querySelectorAll('[id^="speed-"]').forEach(btn => btn.className = 'px-2 py-0.5 rounded-full text-on-surface-variant hover:text-on-surface transition-colors');
        const activeBtn = document.getElementById(`speed-${spd === 0.5 ? '05' : spd === 1 ? '10' : '20'}`);
        if (activeBtn) activeBtn.className = 'px-2 py-0.5 rounded-full bg-primary/20 text-primary font-bold';
    };

    window.toggleFullscreen = function () {
        const card = document.getElementById('chart-card');
        if (!card) return;

        if (!document.fullscreenElement) {
            if (card.requestFullscreen) {
                card.requestFullscreen();
            } else if (card.webkitRequestFullscreen) {
                card.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    // Fullscreen and Resize Listeners
    document.addEventListener('fullscreenchange', () => {
        const isFS = !!document.fullscreenElement;
        const fsIcon = document.getElementById('fullscreen-icon');
        const viewport = document.getElementById('chart-viewport');
        
        if (fsIcon) fsIcon.textContent = isFS ? 'fullscreen_exit' : 'fullscreen';
        if (viewport) {
            if (isFS) {
                viewport.classList.remove('h-[440px]');
                viewport.classList.add('h-[calc(100vh-140px)]');
            } else {
                viewport.classList.remove('h-[calc(100vh-140px)]');
                viewport.classList.add('h-[440px]');
            }
        }
        renderChart();
    });

    window.addEventListener('resize', () => {
        renderChart();
    });

    // Initialize on DOM Ready
    document.addEventListener('DOMContentLoaded', () => {
        renderChart();
        updateDisplay();
        startAnimationLoop();
        fetchRankData();
    });

    window.addEventListener('rewind:data-updated', () => {
        fetchRankData();
    });

})();
