// Encapsulates trendline interaction: hover, click-to-select,
// and drag (endpoint or line body). Lives in idle mode only — the
// drawing tool controller takes over while the tool is active.

/**
 * Build a trendline interaction controller.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.container - chart container element
 * @param {object} deps.state - shared state
 * @param {object} deps.ui - { setChartCursor, requestRedraw }
 * @param {object} deps.chartLock - { lock, unlock }
 * @param {object} deps.trendlines - trendline manager { hitTest, select, clearSelection }
 */
export function createTrendlineInteraction({
    container,
    state,
    ui,
    chartLock,
    trendlines,
}) {
    function getMousePixel(evt) {
        const rect = container.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function setCursorForHit(hit) {
        ui.setChartCursor(hit ? 'cursor-grab' : 'cursor-default');
    }

    function onMouseDown(evt) {
        if (state.mode !== 'idle') return;
        if (evt.button !== 0) return;

        const { x, y } = getMousePixel(evt);
        const hit = trendlines.hitTest(x, y);
        if (!hit) {
            trendlines.clearSelection();
            return;
        }

        trendlines.select(hit.trendLine);

        state.drag = {
            trendLine: hit.trendLine,
            target: hit.target,
            startX: x,
            startY: y,
            lastX: x,
            lastY: y,
        };
        chartLock.lock();
        ui.setChartCursor('cursor-grabbing');
    }

    function onMouseMove(evt) {
        const { x, y } = getMousePixel(evt);

        const hit = trendlines.hitTest(x, y);
        state.trendLines.forEach(tl => tl.setHovering(false));
        if (hit) hit.trendLine.setHovering(true);

        if (state.drag) {
            const d = state.drag;
            const dx = x - d.lastX;
            const dy = y - d.lastY;
            d.lastX = x;
            d.lastY = y;

            if (d.target === 'p1' || d.target === 'p2') {
                d.trendLine.movePointToPixel(d.target, x, y);
            } else if (d.target === 'line') {
                d.trendLine.translateByPixel(dx, dy);
            }
            ui.setChartCursor('cursor-grabbing');
            return;
        }

        if (state.mode === 'drawing') {
            ui.setChartCursor('cursor-crosshair');
            return;
        }

        setCursorForHit(hit);
    }

    function onMouseUp() {
        if (!state.drag) return;
        state.drag = null;
        chartLock.unlock();
        ui.setChartCursor('cursor-default');
    }

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    // Prevent text selection while dragging
    container.addEventListener('dragstart', e => e.preventDefault());
}
