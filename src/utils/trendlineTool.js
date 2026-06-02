// Encapsulates the "trendline drawing tool" state machine:
// activating / deactivating the tool, handling the first/second
// click in drawing mode, and managing the chart lock while active.

/**
 * Build a trendline drawing tool controller.
 *
 * @param {object} deps
 * @param {object} deps.state - shared state
 * @param {HTMLElement} deps.toolBtn - sidebar button element
 * @param {object} deps.chart - lightweight-charts chart instance
 * @param {object} deps.series - candlestick series
 * @param {object} deps.ui - { showStatus, hideStatus, setChartCursor, requestRedraw }
 * @param {object} deps.chartLock - { lock, unlock, forceUnlock }
 * @param {object} deps.preview - { create, update, clear }
 * @param {object} deps.trendlines - { create, clearSelection }
 * @param {() => void} [deps.onDeactivate] - optional callback when the tool is turned off
 */
export function createTrendlineTool({
    state,
    toolBtn,
    chart,
    series,
    ui,
    chartLock,
    preview,
    trendlines,
    onDeactivate,
}) {
    function activate() {
        state.mode = 'drawing';
        state.drawingFirstPoint = null;
        trendlines.clearSelection();
        toolBtn.classList.add('active');
        ui.setChartCursor('cursor-crosshair');
        ui.showStatus('Trendline tool active — click on the chart to place the first point');
        chartLock.lock();
        ui.requestRedraw();
    }

    function deactivate() {
        state.mode = 'idle';
        state.drawingFirstPoint = null;
        preview.clear();
        toolBtn.classList.remove('active');
        ui.setChartCursor('cursor-default');
        ui.hideStatus();
        chartLock.forceUnlock();
        ui.requestRedraw();
        if (onDeactivate) onDeactivate();
    }

    function toggle() {
        if (state.mode === 'drawing') deactivate();
        else activate();
    }

    /**
     * Handle a click on the chart while the tool is active.
     * Returns true if the click was consumed.
     */
    function handleChartClick(param) {
        if (state.mode !== 'drawing') return false;
        if (!param.time || !param.point) return true;

        const clickedPrice = series.coordinateToPrice(param.point.y);
        const clickedTime = param.time;

        if (!state.drawingFirstPoint) {
            // First click: anchor the preview
            state.drawingFirstPoint = { time: clickedTime, price: clickedPrice };
            preview.create(state.drawingFirstPoint);
            preview.update(param.point.x, param.point.y);
            ui.showStatus('First point set — move the cursor to preview, click to confirm');
        } else {
            // Second click: commit the trendline
            const p1 = state.drawingFirstPoint;
            const p2 = { time: clickedTime, price: clickedPrice };
            preview.clear();
            trendlines.create(p1, p2);
            state.drawingFirstPoint = null;
            ui.showStatus('Trendline created — click to draw another, or press Esc to exit');
        }
        return true;
    }

    /**
     * Handle a crosshair move event to keep the preview tracking
     * the cursor while the first point is placed.
     */
    function handleCrosshairMove(param) {
        if (state.mode !== 'drawing') return;
        if (!state.drawingFirstPoint) return;
        if (!param.point) {
            if (state.previewTrendLine) state.previewTrendLine.setVisible(false);
            return;
        }
        preview.update(param.point.x, param.point.y);
    }

    /**
     * Cancel the in-progress first point (e.g. on Esc).
     */
    function cancelInProgress() {
        if (state.drawingFirstPoint) {
            preview.clear();
            state.drawingFirstPoint = null;
        }
    }

    // Wire the sidebar button
    toolBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
    });

    return {
        activate,
        deactivate,
        toggle,
        handleChartClick,
        handleCrosshairMove,
        cancelInProgress,
        isActive: () => state.mode === 'drawing',
    };
}
