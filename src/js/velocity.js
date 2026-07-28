/**
 * Rewind - Rank Velocity Chart Component (src/js/velocity.js)
 * Modular multi-year rank trajectory renderer with smooth sliding timeline camera.
 */

(function () {
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const SHORT_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    
    const TOTAL_MONTHS = 36; // 3 Years: Jan 2022 to Dec 2024
    const VISIBLE_WINDOW = 10; // 10 months visible in chart viewport
    const FOCUS_RATIO = 0.70;  // Camera locks tip avatar at 70% viewport width
    const FOCUS_OFFSET = (VISIBLE_WINDOW - 1) * FOCUS_RATIO; // 6.3 months

    function getFullDateString(monthIdx) {
        const idx = Math.min(Math.max(0, Math.floor(monthIdx)), 35);
        const year = 2022 + Math.floor(idx / 12);
        const month = MONTH_NAMES[idx % 12];
        return `${month} ${year}`;
    }

    function getShortMonthYear(monthIdx) {
        const idx = Math.min(Math.max(0, Math.floor(monthIdx)), 35);
        const year = 2022 + Math.floor(idx / 12);
        const month = SHORT_MONTHS[idx % 12];
        return `${month} '${String(year).slice(2)}`;
    }

    // 36 Months Rank Data for 8 Tracks
    const TRACKS_DATA = [
        {
            id: 'track-1',
            title: 'Neon Drift',
            subtitle: 'Solaris',
            image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150&auto=format&fit=crop&q=80',
            color: '#53e076',
            ranks: [
                2, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1,
                1, 1, 2, 1, 3, 2, 1, 1, 2, 1, 1, 1,
                1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1
            ],
            plays: Array.from({length: 36}, (_, i) => 1200 + i * 45)
        },
        {
            id: 'track-2',
            title: 'Obsidian Waves',
            subtitle: 'Null Vector',
            image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=80',
            color: '#00d2ff',
            ranks: [
                1, 1, 2, 2, 3, 1, 2, 3, 1, 2, 3, 2,
                3, 2, 1, 2, 1, 1, 3, 2, 1, 2, 3, 2,
                2, 1, 3, 2, 1, 2, 2, 1, 2, 3, 2, 2
            ],
            plays: Array.from({length: 36}, (_, i) => 1150 + i * 42)
        },
        {
            id: 'track-3',
            title: 'Midnight Protocol',
            subtitle: 'Cyber Bloom',
            image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150&auto=format&fit=crop&q=80',
            color: '#b066fe',
            ranks: [
                3, 4, 3, 4, 2, 3, 4, 2, 3, 4, 2, 3,
                2, 4, 3, 4, 2, 4, 2, 3, 4, 3, 2, 3,
                4, 3, 2, 4, 3, 3, 3, 4, 3, 2, 3, 3
            ],
            plays: Array.from({length: 36}, (_, i) => 1100 + i * 40)
        },
        {
            id: 'track-4',
            title: 'Pulse Echo',
            subtitle: 'Neon Queen',
            image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150&auto=format&fit=crop&q=80',
            color: '#ff6b6b',
            ranks: [
                4, 3, 5, 3, 4, 5, 3, 4, 5, 3, 4, 4,
                5, 3, 5, 3, 5, 3, 4, 4, 3, 4, 4, 4,
                3, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4
            ],
            plays: Array.from({length: 36}, (_, i) => 1050 + i * 38)
        },
        {
            id: 'track-5',
            title: 'Digital Rain',
            subtitle: 'Frequence',
            image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=150&auto=format&fit=crop&q=80',
            color: '#ffaa00',
            ranks: [
                5, 5, 4, 5, 5, 4, 5, 5, 4, 5, 5, 5,
                4, 5, 4, 5, 4, 5, 5, 5, 5, 5, 5, 5,
                5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5
            ],
            plays: Array.from({length: 36}, (_, i) => 1000 + i * 35)
        },
        {
            id: 'track-6',
            title: 'Synapse Drift',
            subtitle: 'Echo Shift',
            image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=150&auto=format&fit=crop&q=80',
            color: '#38f9d7',
            ranks: [
                6, 6, 7, 6, 6, 7, 6, 6, 7, 6, 6, 6,
                6, 7, 6, 6, 7, 6, 6, 7, 6, 6, 6, 6,
                6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6
            ],
            plays: Array.from({length: 36}, (_, i) => 900 + i * 32)
        },
        {
            id: 'track-7',
            title: 'Volt Horizon',
            subtitle: 'Vortex',
            image: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=150&auto=format&fit=crop&q=80',
            color: '#ff54b0',
            ranks: [
                7, 7, 6, 7, 7, 6, 7, 7, 6, 7, 7, 7,
                7, 6, 7, 8, 6, 7, 8, 6, 7, 7, 7, 7,
                7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
            ],
            plays: Array.from({length: 36}, (_, i) => 850 + i * 30)
        },
        {
            id: 'track-8',
            title: 'Glitch Theory',
            subtitle: 'Signal Zero',
            image: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=150&auto=format&fit=crop&q=80',
            color: '#4d94ff',
            ranks: [
                8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
                8, 8, 8, 7, 8, 8, 7, 8, 8, 8, 8, 8,
                8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8
            ],
            plays: Array.from({length: 36}, (_, i) => 800 + i * 28)
        }
    ];

    // 36 Months Rank Data for 8 Artists
    const ARTISTS_DATA = [
        {
            id: 'artist-1',
            title: 'Solaris',
            subtitle: 'Synthwave',
            image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150&auto=format&fit=crop&q=80',
            color: '#53e076',
            ranks: [
                1, 2, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1,
                2, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1,
                1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1
            ],
            plays: Array.from({length: 36}, (_, i) => 3500 + i * 110)
        },
        {
            id: 'artist-2',
            title: 'The Glitch',
            subtitle: 'Cyberpunk',
            image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=80',
            color: '#00d2ff',
            ranks: [
                2, 1, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2,
                1, 2, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2,
                2, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2, 2
            ],
            plays: Array.from({length: 36}, (_, i) => 3400 + i * 105)
        },
        {
            id: 'artist-3',
            title: 'Null Vector',
            subtitle: 'Darkwave',
            image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150&auto=format&fit=crop&q=80',
            color: '#b066fe',
            ranks: [
                3, 3, 4, 3, 3, 3, 4, 3, 3, 3, 3, 3,
                4, 3, 3, 4, 3, 3, 3, 4, 3, 3, 3, 3,
                3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3
            ],
            plays: Array.from({length: 36}, (_, i) => 3100 + i * 95)
        },
        {
            id: 'artist-4',
            title: 'Neon Queen',
            subtitle: 'Electropop',
            image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150&auto=format&fit=crop&q=80',
            color: '#ff6b6b',
            ranks: [
                4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4, 4,
                3, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4,
                4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4
            ],
            plays: Array.from({length: 36}, (_, i) => 3000 + i * 90)
        },
        {
            id: 'artist-5',
            title: 'Frequence',
            subtitle: 'Techno',
            image: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=150&auto=format&fit=crop&q=80',
            color: '#ffaa00',
            ranks: [
                5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
                5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
                5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5
            ],
            plays: Array.from({length: 36}, (_, i) => 2700 + i * 80)
        },
        {
            id: 'artist-6',
            title: 'Echo Shift',
            subtitle: 'Lo-Fi',
            image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=150&auto=format&fit=crop&q=80',
            color: '#38f9d7',
            ranks: [
                6, 6, 6, 7, 6, 6, 7, 6, 6, 6, 6, 6,
                7, 6, 6, 7, 6, 6, 7, 6, 6, 6, 6, 6,
                6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6
            ],
            plays: Array.from({length: 36}, (_, i) => 2400 + i * 75)
        },
        {
            id: 'artist-7',
            title: 'Vortex',
            subtitle: 'Industrial',
            image: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=150&auto=format&fit=crop&q=80',
            color: '#ff54b0',
            ranks: [
                7, 7, 7, 6, 7, 7, 6, 7, 7, 7, 7, 7,
                6, 7, 7, 6, 7, 7, 6, 7, 7, 7, 7, 7,
                7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
            ],
            plays: Array.from({length: 36}, (_, i) => 2300 + i * 70)
        },
        {
            id: 'artist-8',
            title: 'Signal Zero',
            subtitle: 'Glitch Hop',
            image: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=150&auto=format&fit=crop&q=80',
            color: '#4d94ff',
            ranks: [
                8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
                8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
                8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8
            ],
            plays: Array.from({length: 36}, (_, i) => 2000 + i * 65)
        }
    ];

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

    function getWindowBounds(prog) {
        const maxProg = TOTAL_MONTHS - 1;
        const windowSpan = VISIBLE_WINDOW - 1;
        
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
        return PADDING_LEFT + ((monthIdx - winStart) / (VISIBLE_WINDOW - 1)) * CHART_W;
    }

    function getRankY(rankVal) {
        return PADDING_TOP + ((rankVal - 1) / 7) * CHART_H;
    }

    function getInterpolatedRank(ranks, prog) {
        if (prog <= 0) return ranks[0];
        if (prog >= 35) return ranks[35];
        
        const idx = Math.floor(prog);
        const frac = prog - idx;
        if (idx >= 35) return ranks[35];

        const r1 = ranks[idx];
        const r2 = ranks[idx + 1];
        
        const smoothFrac = (1 - Math.cos(frac * Math.PI)) / 2;
        return r1 + (r2 - r1) * smoothFrac;
    }

    function generatePathD(ranks, prog, winStart) {
        const currentMaxMonth = Math.min(prog, 35);
        const points = [];

        const minIdx = Math.max(0, Math.floor(winStart) - 1);
        const maxIdx = Math.ceil(currentMaxMonth);

        for (let m = minIdx; m <= maxIdx; m++) {
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

        const { winStart, winEnd } = getWindowBounds(progress);

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

        // Dynamic Sliding X-Axis Month Ticks
        const minMonthVisible = Math.max(0, Math.floor(winStart) - 1);
        const maxMonthVisible = Math.min(TOTAL_MONTHS - 1, Math.ceil(winEnd) + 1);

        for (let m = minMonthVisible; m <= maxMonthVisible; m++) {
            const x = getMonthX(m, winStart);

            if (x >= PADDING_LEFT - 30 && x <= SVG_W - PADDING_RIGHT + 30) {
                const isJanNewYear = m % 12 === 0;

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
                    <img src="${item.image}" alt="${item.title}" class="w-full h-full rounded-full object-cover" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150'"/>
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
        const currentMonthIdx = Math.min(Math.floor(progress), 35);
        const fullDateLabel = getFullDateString(currentMonthIdx);
        
        const monthDisp = document.getElementById('current-month-display');
        if (monthDisp) monthDisp.textContent = fullDateLabel;
        
        const scrubber = document.getElementById('timeline-scrubber');
        if (scrubber) scrubber.value = progress;
    }

    function startAnimationLoop() {
        function step(timestamp) {
            if (!lastTimestamp) lastTimestamp = timestamp;
            const dt = (timestamp - lastTimestamp) / 1000;
            lastTimestamp = timestamp;

            if (isPlaying) {
                progress += (dt / 0.8) * playSpeed;
                if (progress >= 35) {
                    progress = 0;
                }

                renderChart();
                updateDisplay();
            }

            animationFrameId = requestAnimationFrame(step);
        }
        animationFrameId = requestAnimationFrame(step);
    }

    // Exposed Global Actions for Controls
    window.switchCategory = function (category) {
        currentCategory = category;
        currentData = category === 'tracks' ? TRACKS_DATA : ARTISTS_DATA;
        progress = 0.0; // Restart timeline on category switch

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
    });

})();
