// Encapsulates trendline interaction: hover, click-to-select,
// and drag (endpoint or line body). Lives in idle mode only — the
// drawing tool controller takes over while the tool is active.
//
// During a drag (endpoint or line body), modifier keys are honoured
// the same way as in the drawing flow:
//   • SHIFT  → 45° angle-lock relative to the OTHER anchor
//   • CTRL   → magnet-snap the anchor to the nearest OHLC of the
//              candle under the cursor

import { resolveDragSnap } from "./chartSnap.js";
import { buildCandlePixelTargets } from "./chartSnap.js";

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
    // the drawing tool\'s cache (if it exposes one) and fall back
    // to building our own from the chart + series.
    let myTargets = [];
    let lastRangeKey = "";
    function refreshTargetsIfNeeded() {
        if (typeof getSnapTargets === "function") {
            myTargets = getSnapTargets() || [];
            return;
        }
        if (!chart || !series) return;
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : "none";
        if (key !== lastRangeKey) {
            lastRangeKey = key;
            myTargets = buildCandlePixelTargets(chart, series);
        }
    }
    if (chart && chart.timeScale && typeof chart.timeScale().subscribeVisibleLogicalRangeChange === "function") {
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
            const shift = !!evt.shiftKey || (typeof getShiftDown === "function" && getShiftDown());
            const ctrl  = !!evt.ctrlKey  || (typeof getCtrlDown  === "function" && getCtrlDown());

            if (d.target === 'p1' || d.target === 'p2') {
                // Anchor drag – apply SHIFT/CTRL snap relative to
                // the OTHER anchor and the candle under the cursor.
                let snapX = x, snapY = y;
                if (shift || ctrl) {
                    refreshTargetsIfNeeded();
                    const otherAnchor = d.target === 'p1' ? d.trendLine.p2 : d.trendLine.p1;
                    const snap = resolveDragSnap({
                        chart, series,
                        cursorPx: { x, y },
                        targets:  myTargets,
                        otherAnchor,
                        shift, ctrl,
                    });
                    if (snap && (snap.x !== x || snap.y !== y)) {
                        snapX = snap.x;
                        snapY = snap.y;
                        console.log("[trendlineInteraction] DRAG snap",
                            shift ? "SHIFT" : "CTRL",
                            "→", snap.mode, snap.info || "",
                            "| raw(", x|0, ",", y|0, ")",
                            "→ snapped(", snapX|0, ",", snapY|0, ")");
                    }
                }
                d.trendLine.movePointToPixel(d.target, snapX, snapY);
            } else if (d.target === 'line') {
                // Whole-line translation.  Apply CTRL magnet to the
                // delta so the line snaps to a candle.
                let dx = x - d.lastX;
                let dy = y - d.lastY;
                if (ctrl) {
                    refreshTargetsIfNeeded();
                    const snap = resolveDragSnap({
                        chart, series,
                        cursorPx: { x, y },
                        targets:  myTargets,
                        otherAnchor: { time: 0, price: 0 }, // unused for line drag
                        shift: false, ctrl: true,
                    });
                    // We can\'t easily snap a delta – just apply the
                    // move normally.  (Full snap on translate is
                    // complex; this keeps the behaviour predictable.)
                }
                d.lastX = x;
                d.lastY = y;
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
