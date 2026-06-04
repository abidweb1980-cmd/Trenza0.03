// fibonacciInteraction.js
// -----------------------------------------------------------------------------
// Encapsulates Fibonacci Retracement interaction: hover, click-to-select,
// and drag (endpoint or body translation).  Lives in idle mode only —
// the drawing tool controller takes over while the tool is active.
//
// Mirrors trendlineInteraction.js so the two drawing tools feel the
// same to the user.
// -----------------------------------------------------------------------------

import { resolvePoint, buildCandlePixelTargets } from './chartSnap.js';

/**
 * Build a Fibonacci Retracement interaction controller.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.container - chart container element
 * @param {object} deps.state - shared state
 * @param {object} deps.ui - { setChartCursor, requestRedraw }
 * @param {object} deps.chartLock - { lock, unlock }
 * @param {object} deps.fibs - fib manager { hitTest, select, clearSelection }
 * @param {object} deps.chart
 * @param {object} deps.series
 * @param {Function} [deps.getSnapTargets] - optional: () => Array
 * @param {Function} [deps.getShiftDown]   - optional: () => boolean
 * @param {Function} [deps.getCtrlDown]    - optional: () => boolean
 */
export function createFibonacciInteraction({
    container,
    state,
    ui,
    chartLock,
    fibs,
    chart,
    series,
    getSnapTargets,    // optional: () => Array<{x,time,open,high,low,close,...}>
    getShiftDown,      // optional: () => boolean
    getCtrlDown,       // optional: () => boolean
}) {
    function getMousePixel(evt) {
        const rect = container.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    // Local candle-target cache for the drag snap.
    let myTargets = [];
    let lastRangeKey = '';
    function refreshTargetsIfNeeded() {
        if (typeof getSnapTargets === 'function') {
            myTargets = getSnapTargets() || [];
            return;
        }
        if (!chart || !series) return;
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : 'none';
        if (key !== lastRangeKey) {
            lastRangeKey = key;
            myTargets = buildCandlePixelTargets(chart, series);
        }
    }
    if (chart && chart.timeScale && typeof chart.timeScale().subscribeVisibleLogicalRangeChange === 'function') {
        chart.timeScale().subscribeVisibleLogicalRangeChange(refreshTargetsIfNeeded);
    }
    refreshTargetsIfNeeded();

    function setCursorForHit(hit) {
        ui.setChartCursor(hit ? 'cursor-grab' : 'cursor-default');
    }

function onMouseDown(evt) {
        if (state.mode !== 'idle') return;
        if (evt.button !== 0) return;

        const { x, y } = getMousePixel(evt);
        const hit = fibs.hitTest(x, y);
        if (!hit) {
            fibs.clearSelection();
            return;
        }

        // Check for SHIFT/CTRL modifier (used for multi-select)
        const shiftPressed = !!evt.shiftKey || (typeof getShiftDown === 'function' && getShiftDown());
        const ctrlPressed = !!evt.ctrlKey || (typeof getCtrlDown === 'function' && getCtrlDown());

        // SHIFT/CTRL-click: add to selection instead of replacing
        if ((shiftPressed || ctrlPressed) && state.selectedFibs.includes(hit.fib)) {
            // Already selected - don't change selection, allow drag
        } else if (shiftPressed || ctrlPressed) {
            fibs.addToSelection(hit.fib);
        } else {
            fibs.select(hit.fib);
        }

        const anchorX = chart.timeScale().timeToCoordinate(hit.fib.p1.time);
        const anchorY = series.priceToCoordinate(hit.fib.p1.price);
        state.drag = {
            fib: hit.fib,
            target: hit.target,
            startX: x,
            startY: y,
            anchorX,
            anchorY,
            lastX: x,
            lastY: y,
        };
        chartLock.lock();
        ui.setChartCursor('cursor-grabbing');
    }

    function onMouseMove(evt) {
        const { x, y } = getMousePixel(evt);

        const hit = fibs.hitTest(x, y);
        state.fibs.forEach(f => f.setHovering(false));
        if (hit) hit.fib.setHovering(true);

        if (state.drag && state.drag.fib) {
            const d = state.drag;
            const shift = !!evt.shiftKey || (typeof getShiftDown === 'function' && getShiftDown());
            const ctrl  = !!evt.ctrlKey  || (typeof getCtrlDown  === 'function' && getCtrlDown());

            // Calculate movement delta since mousedown
            const dx = x - d.startX;
            const dy = y - d.startY;
            
            // Threshold for determining dominant movement direction
            const DRAG_DIRECTION_THRESHOLD = 2.0;

            if (d.target === 'p1' || d.target === 'p2') {
                // Check if this should be reinterpreted as a translation
                // based on dominant movement direction
                let shouldTranslate = false;
                
                // For fibonacci points, if movement is strongly horizontal,
                // treat as horizontal translation (preserving vertical relationship)
                // This handles the case where user tries to move tool horizontally
                // but clicks slightly off-center on a point
                if (Math.abs(dx) > Math.abs(dy) * DRAG_DIRECTION_THRESHOLD) {
                    shouldTranslate = true;
                }
                
if (shouldTranslate) {
                    // Treat as translation instead of resize
                    d.lastX = x;
                    d.lastY = y;
                    // Horizontal translation: preserve vertical position
                    d.fib.translateHorizontallyByPixel(dx);
                } else {
                    // Normal point drag via endpoint.  We honour SHIFT
                    // (45° angle-lock) and CTRL (OHLC magnet) for the
                    // dragged point position.
                    refreshTargetsIfNeeded();
                    const otherAnchor = d.target === 'p1' ? d.fib.p2 : d.fib.p1;
                    const r = resolvePoint({
                        chart, series,
                        rawPx: { x, y },
                        targets: myTargets,
                        shift, ctrl,
                        context: { mode: 'drag-endpoint', otherAnchor, isFirst: false },
                    });
                    if (r.mode !== 'free') {
                        console.log('[fibonacciInteraction] DRAG',
                            shift ? 'SHIFT' : 'CTRL', '→', r.mode, r.info || '',
                            '| raw(', x|0, ',', y|0, ')',
                            '→ snapped(', r.x|0, ',', r.y|0, ')');
                    }
                    d.fib.movePointToPixel(d.target, r.x, r.y);
                }
            } else if (d.target === 'body') {
                d.lastX = x;
                d.lastY = y;
                d.fib.translateByPixelFromAnchor(
                    d.anchorX + dx, d.anchorY + dy
                );
            }
            ui.setChartCursor('cursor-grabbing');
            return;
        }

        if (state.mode === 'fibonacci-drawing') {
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
    // Prevent context menu on CTRL+click (needed for multi-select on Windows)
    container.addEventListener('contextmenu', e => e.preventDefault());
}
