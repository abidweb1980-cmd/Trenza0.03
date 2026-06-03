// longPositionInteraction.js
// -----------------------------------------------------------------------------
// Encapsulates Long Position interaction: hover, click-to-select,
// and drag (TP, SL, entry, right-edge, body, corners).  Lives in
// idle mode only — the drawing tool controller takes over while the
// long-position tool is active.
// -----------------------------------------------------------------------------

import { resolvePoint, buildCandlePixelTargets } from './chartSnap.js';

/**
 * Map a hit target to a CSS cursor class.
 */
function cursorForHandle(target) {
    switch (target) {
        case 'tp':
        case 'sl':
        case 'entry':
            return 'cursor-ns-resize';
        case 'tl':
        case 'br':
            return 'cursor-nwse-resize';
        case 'tr':
        case 'bl':
            return 'cursor-nesw-resize';
        case 'body':
            return 'cursor-grab';
        default:
            return 'cursor-default';
    }
}

export function createLongPositionInteraction({
    container,
    state,
    ui,
    chartLock,
    longPositions,
    chart,
    series,
    getSnapTargets,
    getShiftDown,
    getCtrlDown,
}) {
    function getMousePixel(evt) {
        const rect = container.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

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

    function onMouseDown(evt) {
        if (state.mode !== 'idle') return;
        if (evt.button !== 0) return;

        const { x, y } = getMousePixel(evt);
        const hit = longPositions.hitTest(x, y);
        if (!hit) {
            longPositions.clearSelection();
            return;
        }

        longPositions.select(hit.longPosition);

        state.drag = {
            longPosition: hit.longPosition,
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

        const hit = longPositions.hitTest(x, y);
        state.longPositions.forEach(lp => lp.setHovering(false));
        if (hit) hit.longPosition.setHovering(true);

        if (state.drag && state.drag.longPosition) {
            const d = state.drag;
            const shift = !!evt.shiftKey || (typeof getShiftDown === 'function' && getShiftDown());
            const ctrl  = !!evt.ctrlKey  || (typeof getCtrlDown  === 'function' && getCtrlDown());

            // Body drag → translate the entire trade in BOTH x
            // (time) and y (price) directions.  We pre-compute the
            // entry's pixel position ONCE per move event and pass
            // it to translateByPixel so it doesn't have to do its
            // own round-trip.  This is the main fix for the x-axis
            // lag.
            if (d.target === 'body') {
                const dx = x - d.lastX;
                const dy = y - d.lastY;
                d.lastX = x;
                d.lastY = y;
                // Pre-compute entry's current pixel position so the
                // primitive's translateByPixel doesn't have to do
                // its own timeToCoordinate call (this round-trip is
                // the main source of x-axis lag).
                const cachedX = d.cachedX != null
                    ? d.cachedX
                    : chart.timeScale().timeToCoordinate(d.longPosition.entry.time);
                const cachedY = d.cachedY != null
                    ? d.cachedY
                    : series.priceToCoordinate(d.longPosition.entry.price);
                d.cachedX = cachedX + dx;
                d.cachedY = cachedY + dy;
                d.longPosition.translateByPixel(dx, dy, cachedX, cachedY);
            }
            // TP / SL / entry line drag → vertical only (snap to price)
            else if (d.target === 'tp' || d.target === 'sl' || d.target === 'entry') {
                refreshTargetsIfNeeded();
                const r = resolvePoint({
                    chart, series,
                    rawPx: { x, y },
                    targets: myTargets,
                    shift, ctrl,
                    context: { mode: 'drag-endpoint', otherAnchor: d.longPosition.entry, isFirst: false },
                });
                d.longPosition.movePointToPixel(d.target, r.x, r.y);
                d.lastX = x;
                d.lastY = y;
            }
            // 4 corner drags → change BOTH price (TP/SL) and time
            // edge (left/right) in one motion
            else if (['tl', 'tr', 'bl', 'br'].includes(d.target)) {
                refreshTargetsIfNeeded();
                const r = resolvePoint({
                    chart, series,
                    rawPx: { x, y },
                    targets: myTargets,
                    shift, ctrl,
                    context: { mode: 'drag-endpoint', otherAnchor: d.longPosition.entry, isFirst: false },
                });
                d.longPosition.movePointToPixel(d.target, r.x, r.y);
                d.lastX = x;
                d.lastY = y;
            }
            ui.setChartCursor('cursor-grabbing');
            return;
        }

        if (state.mode === 'long-position-drawing') {
            ui.setChartCursor('cursor-crosshair');
            return;
        }

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
    container.addEventListener('dragstart', e => e.preventDefault());
}
