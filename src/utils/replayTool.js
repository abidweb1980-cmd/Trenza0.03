// Replay Tool - Handles the replay start point selection on the chart
export function createReplayTool({ state, chart, series, replayManager }) {
    let isActive = false;
    let selectedTimestamp = null;
    let crosshairPosition = null;
    let splitLineMarker = null;

    // DOM elements
    const toolStatus = document.getElementById('tool-status');

    // Activate the replay tool
    function activate() {
        if (isActive) return;
        
        isActive = true;
        state.activeTool = 'replay';
        
        // Show tool status
        if (toolStatus) {
            toolStatus.textContent = 'Click on the chart to select the replay start point';
            toolStatus.classList.add('visible');
        }
        
        // Change cursor
        const chartArea = document.getElementById('chart-area');
        if (chartArea) {
            chartArea.classList.add('cursor-crosshair');
        }
        
        console.log('[ReplayTool] Activated');
    }

    // Deactivate the replay tool
    function deactivate() {
        if (!isActive) return;
        
        isActive = false;
        state.activeTool = null;
        selectedTimestamp = null;
        
        // Hide tool status
        if (toolStatus) {
            toolStatus.classList.remove('visible');
        }
        
        // Reset cursor
        const chartArea = document.getElementById('chart-area');
        if (chartArea) {
            chartArea.classList.remove('cursor-crosshair');
        }
        
        // Remove split line marker
        removeSplitLine();
        
        console.log('[ReplayTool] Deactivated');
    }

    // Toggle active state
    function toggle() {
        if (isActive) {
            deactivate();
        } else {
            activate();
        }
    }

    // Check if tool is active
    function getIsActive() {
        return isActive;
    }

    // Handle chart click
    function handleChartClick(param) {
        if (!isActive) return;
        
        if (!param.point || !param.time) {
            console.warn('[ReplayTool] No valid point or time clicked');
            return;
        }
        
        // Get the timestamp at the clicked position
        const clickedTime = param.time;
        const timestamp = clickedTime * 1000; // Convert to milliseconds
        
        console.log('[ReplayTool] Selected replay start point:', new Date(timestamp).toISOString());
        
        // Store selected timestamp
        selectedTimestamp = timestamp;
        
        // Draw split line at the selected position
        drawSplitLine(clickedTime);
        
        // Update tool status
        if (toolStatus) {
            toolStatus.textContent = 'Click "Start Replay" to begin, or click another point to change the start';
        }
    }

    // Handle crosshair move
    function handleCrosshairMove(param) {
        if (!isActive) return;
        
        if (param.point && param.time) {
            crosshairPosition = param.time;
        } else {
            crosshairPosition = null;
        }
    }

    let splitLineEl = null;
    let splitLineTime = null;
    let unsubRange = null;

    function ensureSplitLineEl() {
        if (!splitLineEl) {
            splitLineEl = document.createElement('div');
            splitLineEl.id = 'replay-split-line';
            splitLineEl.style.position = 'absolute';
            splitLineEl.style.top = '0';
            splitLineEl.style.bottom = '0';
            splitLineEl.style.width = '1px';
            splitLineEl.style.backgroundColor = '#2962ff';
            splitLineEl.style.pointerEvents = 'none';
            splitLineEl.style.zIndex = '15';
            const label = document.createElement('div');
            label.style.position = 'absolute';
            label.style.top = '4px';
            label.style.left = '4px';
            label.style.background = '#2962ff';
            label.style.color = '#fff';
            label.style.fontSize = '10px';
            label.style.padding = '2px 4px';
            label.style.borderRadius = '2px';
            label.textContent = 'Replay Start';
            splitLineEl.appendChild(label);
            const chartArea = document.getElementById('chart-area');
            if (chartArea) chartArea.appendChild(splitLineEl);
        }
    }

    function positionSplitLine() {
        if (!splitLineEl || splitLineTime == null || !chart) return;
        const x = chart.timeScale().timeToCoordinate(splitLineTime);
        if (x == null) return;
        splitLineEl.style.transform = `translateX(${x}px)`;
        splitLineEl.style.display = 'block';
    }

    function removeSplitLine() {
        if (unsubRange) { unsubRange(); unsubRange = null; }
        if (splitLineEl) {
            splitLineEl.remove();
            splitLineEl = null;
        }
        splitLineTime = null;
    }

    // Draw a vertical split line at the selected position
    function drawSplitLine(time) {
        removeSplitLine();
        splitLineTime = time;
        ensureSplitLineEl();
        positionSplitLine();
        unsubRange = chart.timeScale().subscribeVisibleLogicalRangeChange(positionSplitLine);
        console.log('[ReplayTool] Split line drawn at:', time);
    }

    // Get the selected timestamp
    function getSelectedTimestamp() {
        return selectedTimestamp;
    }

    // Cancel the current selection
    function cancelSelection() {
        selectedTimestamp = null;
        removeSplitLine();
        
        if (toolStatus) {
            toolStatus.textContent = 'Click on the chart to select the replay start point';
        }
    }

    // Start the replay with the selected timestamp
    async function startReplay() {
        if (!selectedTimestamp) {
            console.warn('[ReplayTool] No replay start point selected');
            return false;
        }
        
        console.log('[ReplayTool] Starting replay at:', new Date(selectedTimestamp).toISOString());
        
        // Deactivate the tool
        deactivate();
        
        // Start the replay through the manager
        const success = await replayManager.startReplay(selectedTimestamp);
        
        if (success) {
            console.log('[ReplayTool] Replay started successfully');
        } else {
            console.error('[ReplayTool] Failed to start replay');
        }
        
        return success;
    }

    // Public API
    return {
        activate,
        deactivate,
        toggle,
        getIsActive,
        handleChartClick,
        handleCrosshairMove,
        getSelectedTimestamp,
        cancelSelection,
        startReplay
    };
}