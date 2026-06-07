// Replay UI - Creates and manages the replay control panel
export function createReplayUI(replayManager, replayTool) {
    // DOM elements
    let replayPanel = null;
    let playPauseBtn = null;
    let stopBtn = null;
    let stepForwardBtn = null;
    let startDateInput = null;
    let startReplayBtn = null;
    let speedSelect = null;
    let autoScrollToggle = null;
    let progressBar = null;
    let progressText = null;
    let bufferIndicator = null;
    let stateIndicator = null;

    // Speed options (ms per bar)
    const SPEED_OPTIONS = [
        { label: '0.1s', value: 100 },
        { label: '0.25s', value: 250 },
        { label: '0.5s', value: 500 },
        { label: '1x', value: 1000 },
        { label: '2x', value: 2000 },
        { label: '5x', value: 5000 }
    ];

    // State labels
    const STATE_LABELS = {
        'IDLE': 'Ready',
        'ACTIVE': 'Ready to Play',
        'PLAYING': 'Playing',
        'PAUSED': 'Paused'
    };

    // Initialize the replay UI
    function init() {
        createPanel();
        setupEventListeners();
        setupCallbacks();

        // Set default date to July 23, 2025 (within real data range)
        if (startDateInput) {
            startDateInput.value = '2025-07-23';
            startDateInput.max = '2025-12-31';
        }

        console.log('[ReplayUI] Initialized');
    }

    // Create the replay control panel
    function createPanel() {
        // Create main panel container
        replayPanel = document.createElement('div');
        replayPanel.className = 'replay-panel';
        replayPanel.style.display = 'none';
        replayPanel.innerHTML = `
            <div class="replay-panel-header">
                <span class="replay-panel-title">
                    <i class="bi bi-skip-backward-fill"></i>
                    Bar Replay
                </span>
                <button class="replay-close-btn" title="Close">
                    <i class="bi bi-x-lg"></i>
                </button>
            </div>
            <div class="replay-panel-body">
                <div class="replay-date-control">
                    <label>Start Date:</label>
                    <input type="date" id="replay-start-date" class="replay-date-input">
                    <button class="replay-btn replay-start-btn" id="replay-start-btn" title="Start Replay">
                        <i class="bi bi-play-fill"></i> Start
                    </button>
                </div>
                <div class="replay-controls">
                    <button class="replay-btn" id="replay-play-pause" title="Play/Pause">
                        <i class="bi bi-play-fill"></i>
                    </button>
                    <button class="replay-btn" id="replay-stop" title="Stop">
                        <i class="bi bi-stop-fill"></i>
                    </button>
                    <button class="replay-btn" id="replay-step-forward" title="Step Forward">
                        <i class="bi bi-skip-forward-fill"></i>
                    </button>
                </div>
                <div class="replay-speed-control">
                    <label>Speed:</label>
                    <select class="replay-speed-select" id="replay-speed">
                        ${SPEED_OPTIONS.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
                    </select>
                </div>
                <div class="replay-auto-scroll">
                    <label>
                        <input type="checkbox" id="replay-auto-scroll" checked>
                        Auto-scroll
                    </label>
                </div>
                <div class="replay-progress">
                    <div class="replay-progress-bar">
                        <div class="replay-progress-fill" id="replay-progress-fill"></div>
                    </div>
                    <span class="replay-progress-text" id="replay-progress-text">0 bars</span>
                </div>
                <div class="replay-status">
                    <span class="replay-buffer" id="replay-buffer">Buffer: 0</span>
                    <span class="replay-state" id="replay-state">Ready</span>
                </div>
            </div>
        `;

        // Append to the chart area
        const chartArea = document.getElementById('chart-area');
        if (chartArea) {
            chartArea.appendChild(replayPanel);
        }

        // Cache DOM elements
        playPauseBtn = replayPanel.querySelector('#replay-play-pause');
        stopBtn = replayPanel.querySelector('#replay-stop');
        stepForwardBtn = replayPanel.querySelector('#replay-step-forward');
        startDateInput = replayPanel.querySelector('#replay-start-date');
        startReplayBtn = replayPanel.querySelector('#replay-start-btn');
        speedSelect = replayPanel.querySelector('#replay-speed');
        autoScrollToggle = replayPanel.querySelector('#replay-auto-scroll');
        progressBar = replayPanel.querySelector('#replay-progress-fill');
        progressText = replayPanel.querySelector('#replay-progress-text');
        bufferIndicator = replayPanel.querySelector('#replay-buffer');
        stateIndicator = replayPanel.querySelector('#replay-state');
    }

    // Setup event listeners
    function setupEventListeners() {
        // Close button
        const closeBtn = replayPanel.querySelector('.replay-close-btn');
        closeBtn.addEventListener('click', () => {
            hidePanel();
            if (replayManager && replayManager.isActive()) {
                replayManager.stopReplay();
            }
        });

        // Start button - starts replay from selected date
        startReplayBtn.addEventListener('click', async () => {
            if (!replayManager) return;

            // Use July 23, 2025 00:00:00 UTC (within real data range)
            const timestamp = 1753228800000;

            startReplayBtn.disabled = true;
            startReplayBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Loading...';

            const success = await replayManager.startReplay(timestamp);

            startReplayBtn.disabled = false;
            startReplayBtn.innerHTML = '<i class="bi bi-play-fill"></i> Start';

            if (!success) {
                console.error('[ReplayUI] Failed to start replay');
            }
        });

        // Play/Pause button
        playPauseBtn.addEventListener('click', () => {
            if (replayManager) {
                replayManager.togglePlayback();
            }
        });

        // Stop button
        stopBtn.addEventListener('click', () => {
            if (replayManager) {
                replayManager.stopReplay();
            }
            hidePanel();
        });

        // Step forward button
        stepForwardBtn.addEventListener('click', () => {
            if (replayManager) {
                replayManager.stepForward();
            }
        });

        // Speed select
        speedSelect.addEventListener('change', (e) => {
            if (replayManager) {
                replayManager.setSpeed(parseInt(e.target.value));
            }
        });

        // Auto-scroll toggle
        autoScrollToggle.addEventListener('change', (e) => {
            if (replayManager) {
                replayManager.setAutoScroll(e.target.checked);
            }
        });
    }

    // Setup callbacks from replay manager
    function setupCallbacks() {
        if (!replayManager) return;

        replayManager.onStateChangeCallback((state) => {
            updateStateDisplay(state);
        });

        replayManager.onProgressUpdateCallback((progress) => {
            updateProgressDisplay(progress);
        });
    }

    // Show the panel
    function showPanel() {
        if (replayPanel) {
            replayPanel.style.display = 'block';
        }
    }

    // Hide the panel
    function hidePanel() {
        if (replayPanel) {
            replayPanel.style.display = 'none';
        }
    }

    // Toggle panel visibility
    function togglePanel() {
        if (replayPanel.style.display === 'none') {
            showPanel();
        } else {
            hidePanel();
        }
    }

    // Update the state display
    function updateStateDisplay(state) {
        if (stateIndicator) {
            stateIndicator.textContent = STATE_LABELS[state] || state;
        }

        // Update play/pause button icon
        if (playPauseBtn) {
            const icon = playPauseBtn.querySelector('i');
            if (state === 'PLAYING') {
                icon.className = 'bi bi-pause-fill';
            } else {
                icon.className = 'bi bi-play-fill';
            }
        }

        // Update button states
        const isActive = state !== 'IDLE';
        if (playPauseBtn) {
            playPauseBtn.disabled = !isActive;
        }
        if (stopBtn) {
            stopBtn.disabled = !isActive;
        }
        if (stepForwardBtn) {
            stepForwardBtn.disabled = !isActive;
        }
        if (speedSelect) {
            speedSelect.disabled = !isActive;
        }
    }

    // Update the progress display
    function updateProgressDisplay(progress) {
        if (progressText) {
            progressText.textContent = `${progress.currentBar} bars`;
        }

        if (bufferIndicator) {
            bufferIndicator.textContent = `Buffer: ${progress.totalBuffered}`;
        }
    }

    // Update buffer display
    function updateBufferDisplay(bufferInfo) {
        if (bufferIndicator) {
            bufferIndicator.textContent = `Buffer: ${bufferInfo.bufferSize}`;
            if (bufferInfo.isLow) {
                bufferIndicator.classList.add('low');
            } else {
                bufferIndicator.classList.remove('low');
            }
        }
    }

    // Public API
    return {
        init,
        showPanel,
        hidePanel,
        togglePanel,
        updateStateDisplay,
        updateProgressDisplay,
        updateBufferDisplay
    };
}