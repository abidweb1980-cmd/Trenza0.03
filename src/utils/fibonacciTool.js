// fibonacciTool.js
// -----------------------------------------------------------------------------
// Fibonacci Retracement drawing tool.  Mirrors trendlineTool.js but
// creates a fib with horizontal levels between the two anchors.
//
// While in drawing mode the live preview of the second anchor
// honours TradingView-style keyboard modifiers (same as the trendline
// tool):
//
//   • SHIFT held  →  angle-lock the second anchor to the closest 45°
//                    (relative to the first anchor)
//   • CTRL  held  →  magnet-snap the second anchor to the nearest
//                    OHLC value of the candle under the CROSSHAIR.
//
// Lifecycle: click → click (or click → drag with preview).
// ---------------------------------------------------------------------------

import { buildCandlePixelTargets, resolvePoint } from './chartSnap.js';

/**
 * Build a Fibonacci Retracement drawing tool controller.
 */
export function createFibonacciTool({
    state,
    toolBtn,
    chart,
    series,
    ui,
    chartLock,
    preview,
    fibs,
    onDeactivate,
}) {
    // Global modifier-key state
    let shiftDown = false;
    let ctrlDown  = false;

    function onKeyDown(e) {
        if (e.key === 'Shift')   { shiftDown = true;  console.log('[fibonacci] keydown Shift'); }
        if (e.key === 'Control') { ctrlDown  = true;  console.log('[fibonacci] keydown Control'); }
    }
    function onKeyUp(e) {
        if (e.key === 'Shift')   { shiftDown = false; console.log('[fibonacci] keyup   Shift'); }
        if (e.key === 'Control') { ctrlDown  = false; console.log('[fibonacci] keyup   Control'); }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    // Cache of "candle pixels"
    let candleTargets = [];
    let lastRangeKey  = '';
    function refreshTargetsIfNeeded() {
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : 'none';
        if (key !== lastRangeKey) {
            lastRangeKey = key;
            candleTargets = buildCandlePixelTargets(chart, series);
            console.log('[fibonacci] rebuilt snap targets:', candleTargets.length, 'candles');
            // console.log(chart.timeScale());
        }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshTargetsIfNeeded);

    // The most-recently-resolved second-anchor for the in-progress fib.
    let lastResolvedAnchor = null;

    function setCrosshairMode(mode) {
        if (state.crosshairMode !== mode) {
            state.crosshairMode = mode;
            console.log('[fibonacci] crosshairMode →', mode);
        }
    }

    function activate() {
        state.mode = 'fibonacci-drawing';
        state.drawingFirstPoint = null;
        fibs.clearSelection();
        toolBtn.classList.add('active');
        ui.setChartCursor('cursor-crosshair');
        ui.showStatus('Fibonacci Retracement — click to place anchor A (hold SHIFT for 45°, CTRL for OHLC snap)');
        chartLock.lock();
        refreshTargetsIfNeeded();
        setCrosshairMode('Normal');
        ui.requestRedraw();
        console.log('[fibonacci] TOOL ACTIVATED');
    }

    function deactivate() {
        state.mode = 'idle';
        state.drawingFirstPoint = null;
        lastResolvedAnchor = null;
        preview.clear();
        toolBtn.classList.remove('active');
        ui.setChartCursor('cursor-default');
        ui.hideStatus();
        setCrosshairMode('Normal');
        chartLock.forceUnlock();
        ui.requestRedraw();
        if (onDeactivate) onDeactivate();
        console.log('[fibonacci] TOOL DEACTIVATED');
    }

    function toggle() {
        if (state.mode === 'fibonacci-drawing') deactivate();
        else activate();
    }

    function handleChartClick(param) {
        if (state.mode !== 'fibonacci-drawing') return false;
        if (!param.time || !param.point) return true;

        refreshTargetsIfNeeded();

        const src   = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey)   || shiftDown;
        const ctrl  = !!(src && src.ctrlKey)    || ctrlDown;

        const first = resolvePoint({
            chart, series,
            rawPx: { x: param.point.x, y: param.point.y },
            targets: candleTargets,
            shift, ctrl,
            context: { mode: 'click-first', otherAnchor: null, isFirst: true },
        });
        const clickedTime  = first.time;
        const clickedPrice = first.price;

        if (!state.drawingFirstPoint) {
            state.drawingFirstPoint = { time: clickedTime, price: clickedPrice };
            preview.create(state.drawingFirstPoint);
            const snappedPxX = chart.timeScale().timeToCoordinate(clickedTime);
            const snappedPxY = series.priceToCoordinate(clickedPrice);
            if (snappedPxX !== null && snappedPxY !== null) {
                preview.update(snappedPxX, snappedPxY);
            } else {
                preview.update(param.point.x, param.point.y);
            }
            ui.showStatus('Anchor A set — move the cursor to preview, click to confirm (SHIFT=45°, CTRL=OHLC)');
            console.log('[fibonacci] first anchor set:', state.drawingFirstPoint);
            lastResolvedAnchor = { time: clickedTime, price: clickedPrice, mode: first.mode };
        } else {
            const p1 = state.drawingFirstPoint;
            const second = lastResolvedAnchor
                ? { time: lastResolvedAnchor.time, price: lastResolvedAnchor.price, mode: lastResolvedAnchor.mode }
                : first;
            const p2 = { time: second.time, price: second.price };
            const committedMode = second.mode;
            preview.clear();
            fibs.create(p1, p2);
            state.drawingFirstPoint = null;
            lastResolvedAnchor = null;
            ui.showStatus('Fibonacci created — click to draw another, or press Esc to exit');
            console.log('[fibonacci] committed:', { p1, p2, mode: committedMode });
        }
        return true;
    }

    function handleCrosshairMove(param) {
        if (state.mode !== 'fibonacci-drawing') return;
        if (!state.drawingFirstPoint) return;
        if (!param.point) {
            if (state.previewFib) state.previewFib.setVisible(false);
            return;
        }

        refreshTargetsIfNeeded();

        const src = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey)   || shiftDown;
        const ctrl  = !!(src && src.ctrlKey)    || ctrlDown;

        const firstPx = {
            x: chart.timeScale().timeToCoordinate(state.drawingFirstPoint.time),
            y: series.priceToCoordinate(state.drawingFirstPoint.price),
        };
        const cursorPx = { x: param.point.x, y: param.point.y };

        if (firstPx.x === null || firstPx.y === null) {
            preview.update(cursorPx.x, cursorPx.y);
            return;
        }

        const r = resolvePoint({
            chart, series,
            rawPx: cursorPx,
            targets: candleTargets,
            shift, ctrl,
            context: { mode: 'crosshair', otherAnchor: state.drawingFirstPoint, isFirst: false },
        });
        const snapX = r.x;
        const snapY = r.y;

        let modeLabel = 'free';
        if (r.mode === 'angle-45') {
            modeLabel = `SHIFT ${r.info.angleDeg}°`;
            setCrosshairMode('Normal');
        } else if (r.mode === 'magnet-ohlc') {
            modeLabel = `CTRL magnet candle #${r.info.candleIndex} ${r.info.field}`;
            setCrosshairMode('MagnetOHLC');
        } else {
            modeLabel = 'free';
            setCrosshairMode('Normal');
        }

        preview.update(snapX, snapY);

        const snapTime  = chart.timeScale().coordinateToTime(snapX);
        const snapPrice = series.coordinateToPrice(snapY);
        if (snapTime !== null && snapPrice !== null) {
            lastResolvedAnchor = { time: snapTime, price: snapPrice, mode: modeLabel };
        }

        if (shift || ctrl) {
            ui.showStatus(modeLabel);
        } else {
            ui.showStatus('Anchor A set — move the cursor to preview, click to confirm');
        }
    }

    function cancelInProgress() {
        if (state.drawingFirstPoint) {
            preview.clear();
            state.drawingFirstPoint = null;
            lastResolvedAnchor = null;
        }
    }

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
        isActive: () => state.mode === 'fibonacci-drawing',
        getSnapTargets: () => candleTargets,
        getShiftDown: () => shiftDown,
        getCtrlDown:  () => ctrlDown,
    };
}
