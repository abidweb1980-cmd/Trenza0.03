// rectangleInteraction.js
// -----------------------------------------------------------------------------
// Encapsulates rectangle interaction: hover, click-to-select, and drag
// (8 handles + border + body).  Lives in idle mode only — the drawing
// tool controller takes over while the rectangle tool is active.
//
// The 8 resize handles are:
//   • 4 corners  : 'tl' (top-left),  'tr' (top-right),
//                  'bl' (bottom-left), 'br' (bottom-right)
//   • 4 midpoints: 'tm' (top-middle), 'bm' (bottom-middle),
//                  'lm' (left-middle), 'rm' (right-middle)
//
// During a drag, modifier keys are honoured the same way as in the
// drawing flow:
//   • SHIFT  → 45° angle-lock relative to the OPPOSITE corner/edge
//   • CTRL   → magnet-snap the anchor to the nearest OHLC of the
//              candle under the cursor
//
// Mirrors trendlineInteraction.js so the two drawing tools feel the
// same to the user.
// -----------------------------------------------------------------------------

import { resolvePoint, buildCandlePixelTargets } from './chartSnap.js';

/**
 * Map a hit target to the right CSS cursor class.
 *   • 4 corners   → diagonal resize cursors
 *   • 4 midpoints → horizontal / vertical resize cursors
 *   • border/body → grab cursor
 *   • none        → default cursor
 */
function cursorForHandle(target) {
    switch (target) {
        case 'tl': return 'cursor-nwse-resize';
        case 'br': return 'cursor-nwse-resize';
        case 'tr': return 'cursor-nesw-resize';
        case 'bl': return 'cursor-nesw-resize';
        case 'tm': return 'cursor-ns-resize';
        case 'bm': return 'cursor-ns-resize';
        case 'lm': return 'cursor-ew-resize';
        case 'rm': return 'cursor-ew-resize';
        case 'border':
        case 'body': return 'cursor-grab';
        default: return 'cursor-default';
    }
}

/**
 * The handle types that count as "resize" (vs. translate or hover).
 * Used by the interaction controller to know whether the drag should
 * call movePointToPixel() or translateByPixel().
 */
const HANDLE_TYPES = new Set(['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'lm', 'rm']);

/**
 * Build a rectangle interaction controller.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.container - chart container element
 * @param {object} deps.state - shared state
 * @param {object} deps.ui - { setChartCursor, requestRedraw }
 * @param {object} deps.chartLock - { lock, unlock }
 * @param {object} deps.rectangles - rectangle manager { hitTest, select, clearSelection }
 * @param {object} deps.chart
 * @param {object} deps.series
 * @param {Function} [deps.getSnapTargets] - optional: () => Array
 * @param {Function} [deps.getShiftDown]   - optional: () => boolean
 * @param {Function} [deps.getCtrlDown]    - optional: () => boolean
 */
export function createRectangleInteraction({
    container,
    state,
    ui,
    chartLock,
    rectangles,
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

    // Local candle-target cache for the drag snap.  We pull from
    // the drawing tool's cache (if it exposes one) and fall back
    // to building our own from the chart + series.
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

    /**
     * For a given drag handle, compute the "other anchor" (in
     * time/price) that should be used as the angle-lock origin for
     * SHIFT snap.  This is the corner OPPOSITE to the one being
     * dragged:
     *
     *   'tl' → opposite is 'br'  → (p2)
     *   'tr' → opposite is 'bl'  → a synthetic anchor at (p1.time, p2.price)
     *   'bl' → opposite is 'tr'  → a synthetic anchor at (p2.time, p1.price)
     *   'br' → opposite is 'tl'  → (p1)
     *   'tm' / 'bm' → no meaningful angle origin; fall back to p1
     *   'lm' / 'rm' → no meaningful angle origin; fall back to p1
     */
    function oppositeAnchor(rect, handle) {
        switch (handle) {
            case 'tl': return rect.p2;
            case 'br': return rect.p1;
            case 'tr': return { time: rect.p1.time, price: rect.p2.price };
            case 'bl': return { time: rect.p2.time, price: rect.p1.price };
            default:   return rect.p1;
        }
    }

    function onMouseDown(evt) {
        if (state.mode !== 'idle') return;
        if (evt.button !== 0) return;

        const { x, y } = getMousePixel(evt);
        const hit = rectangles.hitTest(x, y);
        if (!hit) {
            rectangles.clearSelection();
            return;
        }

        rectangles.select(hit.rectangle);

        state.drag = {
            rectangle: hit.rectangle,
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

        const hit = rectangles.hitTest(x, y);
        // Clear hover on all rectangles first
        state.rectangles.forEach(r => r.setHovering(false));
        if (hit) hit.rectangle.setHovering(true);

        if (state.drag) {
            const d = state.drag;
            const shift = !!evt.shiftKey || (typeof getShiftDown === 'function' && getShiftDown());
            const ctrl  = !!evt.ctrlKey  || (typeof getCtrlDown  === 'function' && getCtrlDown());

            if (HANDLE_TYPES.has(d.target)) {
                // Resize via one of the 8 handles.  We honour SHIFT
                // (45° angle-lock) and CTRL (OHLC magnet) for the
                // dragged handle position.
                refreshTargetsIfNeeded();
                const otherAnchor = oppositeAnchor(d.rectangle, d.target);
                const r = resolvePoint({
                    chart, series,
                    rawPx: { x, y },
                    targets: myTargets,
                    shift, ctrl,
                    context: { mode: 'drag-endpoint', otherAnchor, isFirst: false },
                });
                if (r.mode !== 'free') {
                    console.log('[rectangleInteraction] DRAG',
                        shift ? 'SHIFT' : 'CTRL', '→', r.mode, r.info || '',
                        '| raw(', x|0, ',', y|0, ')',
                        '→ snapped(', r.x|0, ',', r.y|0, ')');
                }
                d.rectangle.movePointToPixel(d.target, r.x, r.y);
            } else if (d.target === 'border' || d.target === 'body') {
                // Whole-rectangle translation.  Apply the pixel delta.
                const dx = x - d.lastX;
                const dy = y - d.lastY;
                d.lastX = x;
                d.lastY = y;
                d.rectangle.translateByPixel(dx, dy);
            }
            ui.setChartCursor('cursor-grabbing');
            return;
        }

        if (state.mode === 'rectangle-drawing') {
            ui.setChartCursor('cursor-crosshair');
            return;
        }

        // No drag: just set the right cursor for whatever the mouse
        // is currently hovering over.
        ui.setChartCursor(cursorForHandle(hit ? hit.target : null));
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
