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

        fibs.select(hit.fib);

        state.drag = {
            fib: hit.fib,
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

        const hit = fibs.hitTest(x, y);
        state.fibs.forEach(f => f.setHovering(false));
        if (hit) hit.fib.setHovering(true);

        if (state.drag && state.drag.fib) {
            const d = state.drag;
            const shift = !!evt.shiftKey || (typeof getShiftDown === 'function' && getShiftDown());
            const ctrl  = !!evt.ctrlKey  || (typeof getCtrlDown  === 'function' && getCtrlDown());

            if (d.target === 'p1' || d.target === 'p2') {
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
            } else if (d.target === 'body') {
                const dx = x - d.lastX;
                const dy = y - d.lastY;
                d.lastX = x;
                d.lastY = y;
                d.fib.translateByPixel(dx, dy);
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
}
