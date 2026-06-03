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

        // Capture the original mouse position AND the primitive's
        // original anchor pixel position at drag start.  This is
        // the key to the precision fix: instead of accumulating
        // tiny pixel deltas (each of which goes through
        // coordinateToTime's candle-snap rounding), we always
        // translate from a single fixed anchor — so 1-pixel
        // movements of the mouse always produce a fresh, full-
        // precision translation.
        const anchorX = chart.timeScale().timeToCoordinate(hit.longPosition.entry.time);
        const anchorY = series.priceToCoordinate(hit.longPosition.entry.price);

        state.drag = {
            longPosition: hit.longPosition,
            target: hit.target,
            startX: x,         // mouse position at drag start
            startY: y,
            anchorX,          // primitive anchor pixel position at drag start
            anchorY,
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
            // (time) and y (price) directions.  We use the ANCHOR-
            // AT-MOUSEDOWN approach: dx/dy is the offset from the
            // original mouse-down position, and the new entry
            // position is anchor + dx/dy.  This gives full precision
            // for slow movements (each move event uses a single
            // fresh coordinateToTime call, NOT accumulated tiny
            // deltas that lose precision to candle-snap rounding).
            if (d.target === 'body') {
                const dx = x - d.startX;     // offset from drag-start mouse
                const dy = y - d.startY;
                d.lastX = x;
                d.lastY = y;
                // The primitive's translateByPixel does the actual
                // math: new entry pixel = anchor + (dx, dy).
                d.longPosition.translateByPixelFromAnchor(
                    d.anchorX + dx, d.anchorY + dy
                );
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
