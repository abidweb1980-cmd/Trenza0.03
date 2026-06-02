// rectangleTool.js
// -----------------------------------------------------------------------------
// Rectangle drawing tool.  Mirrors trendlineTool.js but draws a
// rectangle.  Honours the SAME keyboard modifiers via the universal
// `resolvePoint` from chartSnap.js:
//   • SHIFT  → 45° angle-lock (p2 relative to p1, like trendline)
//   • CTRL   → magnet-snap the corner to the nearest OHLC
//
// Lifecycle: click → click (or click → drag with preview).
// ---------------------------------------------------------------------------

import { buildCandlePixelTargets, resolvePoint } from './chartSnap.js';

export function createRectangleTool({
    state,
    toolBtn,
    chart,
    series,
    ui,
    chartLock,
    preview,        // a NativeRectangle in preview mode
    rectangles,
    onDeactivate,
}) {
    let candleTargets = [];
    let lastRangeKey  = '';

    let shiftDown = false;
    let ctrlDown  = false;
    function onKeyDown(e) {
        if (e.key === 'Shift')   { shiftDown = true;  console.log('[rectangle] keydown Shift'); }
        if (e.key === 'Control') { ctrlDown  = true;  console.log('[rectangle] keydown Control'); }
    }
    function onKeyUp(e) {
        if (e.key === 'Shift')   { shiftDown = false; console.log('[rectangle] keyup   Shift'); }
        if (e.key === 'Control') { ctrlDown  = false; console.log('[rectangle] keyup   Control'); }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    function refreshTargetsIfNeeded() {
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : 'none';
        if (key !== lastRangeKey) {
            lastRangeKey = key;
            candleTargets = buildCandlePixelTargets(chart, series);
            console.log('[rectangle] rebuilt snap targets:', candleTargets.length, 'candles');
        }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshTargetsIfNeeded);

    // The most-recently-resolved second-corner (in time/price) for
    // the in-progress rectangle.  When the user clicks to commit,
    // we use THIS (the snapped value) rather than the raw click
    // position, so that CTRL/SHIFT snap is actually persisted.
    let lastResolvedAnchor = null;  // { time, price, mode }

    function setCrosshairMode(mode) {
        if (state.crosshairMode !== mode) {
            state.crosshairMode = mode;
            console.log('[rectangle] crosshairMode →', mode);
        }
    }

    function activate() {
        state.mode = 'rectangle-drawing';
        state.drawingFirstPoint = null;
        rectangles.clearSelection();
        toolBtn.classList.add('active');
        ui.setChartCursor('cursor-crosshair');
        ui.showStatus('Rectangle tool — click to place corner 1 (hold SHIFT for 45°, CTRL for OHLC snap)');
        chartLock.lock();
        refreshTargetsIfNeeded();
        setCrosshairMode('Normal');
        ui.requestRedraw();
        console.log('[rectangle] TOOL ACTIVATED');
    }

    function deactivate() {
        state.mode = 'idle';
        state.drawingFirstPoint = null;
        lastResolvedAnchor = null;
        if (preview && preview.clear) preview.clear();
        toolBtn.classList.remove('active');
        ui.setChartCursor('cursor-default');
        ui.hideStatus();
        setCrosshairMode('Normal');
        chartLock.forceUnlock();
        ui.requestRedraw();
        if (onDeactivate) onDeactivate();
        console.log('[rectangle] TOOL DEACTIVATED');
    }

    function toggle() {
        if (state.mode === 'rectangle-drawing') deactivate();
        else activate();
    }

    /**
     * Handle a click on the chart while the tool is active.
     *
     * Both the FIRST and the SECOND click honour the keyboard
     * modifiers:
     *   • SHIFT → 45° snap (relative to p1 once placed)
     *   • CTRL  → OHLC snap (the candle under the cursor)
     *
     * Mirrors the trendline drawing flow exactly.
     */
    function handleChartClick(param) {
        if (state.mode !== 'rectangle-drawing') return false;
        if (!param.time || !param.point) return true;

        refreshTargetsIfNeeded();

        // Read modifier keys from the original click event.  We also
        // fall back to the global key state so the user can hold CTRL
        // BEFORE the click.
        const src   = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey)   || shiftDown;
        const ctrl  = !!(src && src.ctrlKey)    || ctrlDown;

        // 1) Resolve the clicked anchor via the universal translator.
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
            // Re-project the SNAPPED (time, price) back to pixels so
            // the preview's p2 matches the snapped anchor.
            const snappedPxX = chart.timeScale().timeToCoordinate(clickedTime);
            const snappedPxY = series.priceToCoordinate(clickedPrice);
            if (snappedPxX !== null && snappedPxY !== null) {
                preview.update(snappedPxX, snappedPxY);
            } else {
                preview.update(param.point.x, param.point.y);
            }
            ui.showStatus('First corner set — move the cursor to preview, click to confirm (SHIFT=45°, CTRL=OHLC)');
            console.log('[rectangle] first corner set:', state.drawingFirstPoint, '| mode:', first.mode,
                '| raw(', param.point.x|0, ',', param.point.y|0, ')',
                '→ preview at snapped(', snappedPxX|0, ',', snappedPxY|0, ')');
            // Also cache this as the initial lastResolvedAnchor so the
            // second click (if no movement) commits the same value.
            lastResolvedAnchor = { time: clickedTime, price: clickedPrice, mode: first.mode };
        } else {
            const p1 = state.drawingFirstPoint;
            // For the second click, use the most recent resolved
            // anchor (which honours SHIFT/CTRL during the drag) if
            // we have one, otherwise snap the click position itself.
            const second = lastResolvedAnchor
                ? { time: lastResolvedAnchor.time, price: lastResolvedAnchor.price, mode: lastResolvedAnchor.mode }
                : first;
            const p2 = { time: second.time, price: second.price };
            const committedMode = second.mode;
            preview.clear();
            rectangles.create(p1, p2);
            state.drawingFirstPoint = null;
            lastResolvedAnchor = null;
            ui.showStatus('Rectangle created — click to draw another, or press Esc to exit');
            console.log('[rectangle] committed:', { p1, p2, mode: committedMode });
        }
        return true;
    }

    /**
     * Handle a crosshair move event.  This is where the SHIFT / CTRL
     * snap logic kicks in for the second corner.
     */
    function handleCrosshairMove(param) {
        if (state.mode !== 'rectangle-drawing') return;
        if (!state.drawingFirstPoint) return;
        if (!param.point) {
            if (state.previewRectangle) state.previewRectangle.setVisible(false);
            return;
        }

        refreshTargetsIfNeeded();

        // 1) Read modifier keys off the original event (with global
        //    fallback so a held-down modifier is detected even if
        //    the event itself has stale modifier flags).
        const src = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey)   || shiftDown;
        const ctrl  = !!(src && src.ctrlKey)    || ctrlDown;

        // 2) Compute the first corner's pixel coords.
        const firstPx = {
            x: chart.timeScale().timeToCoordinate(state.drawingFirstPoint.time),
            y: series.priceToCoordinate(state.drawingFirstPoint.price),
        };
        const cursorPx = { x: param.point.x, y: param.point.y };

        if (firstPx.x === null || firstPx.y === null) {
            console.log('[rectangle] first corner off-screen, falling back to raw cursor');
            preview.update(cursorPx.x, cursorPx.y);
            return;
        }

        // 3) Apply SHIFT / CTRL snap via the universal translator.
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
        console.log('[rectangle]', modeLabel, '| raw(', cursorPx.x|0, ',', cursorPx.y|0, ')',
            '→ snapped(', snapX|0, ',', snapY|0, ')');

        // 4) Update the preview with the (possibly snapped) pixel.
        preview.update(snapX, snapY);

        // 4b) Cache the resolved anchor in (time, price) space so the
        //     next click commits the SNAPPED value, not the raw click.
        const snapTime  = chart.timeScale().coordinateToTime(snapX);
        const snapPrice = series.coordinateToPrice(snapY);
        if (snapTime !== null && snapPrice !== null) {
            lastResolvedAnchor = {
                time: snapTime,
                price: snapPrice,
                mode: modeLabel,
            };
        }

        // 5) Show the user what's happening in the status bar.
        if (shift || ctrl) {
            ui.showStatus(modeLabel);
        } else {
            ui.showStatus('First corner set — move the cursor to preview, click to confirm');
        }
    }

    /**
     * Cancel the in-progress first corner (e.g. on Esc).
     */
    function cancelInProgress() {
        if (state.drawingFirstPoint) {
            preview.clear();
            state.drawingFirstPoint = null;
            lastResolvedAnchor = null;
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
        isActive: () => state.mode === 'rectangle-drawing',
        getSnapTargets: () => candleTargets,
        getShiftDown: () => shiftDown,
        getCtrlDown:  () => ctrlDown,
    };
}
