// Encapsulates the "trendline drawing tool" state machine:
// activating / deactivating the tool, handling the first/second
// click in drawing mode, and managing the chart lock while active.
//
// While in drawing mode the live preview of the second anchor
// honours TradingView-style keyboard modifiers:
//
//   • SHIFT held  →  angle-lock the second anchor to the closest 45°
//                    (relative to the first anchor)
//
//   • CTRL  held  →  magnet-snap the second anchor to the nearest
//                    OHLC value of the candle under the CROSSHAIR.
//                    The algorithm:
//                      1. The crosshair's time identifies the candle
//                         (e.g. #326).
//                      2. The cursor's pixel y is translated to a
//                         price via series.coordinateToPrice.
//                      3. The OHLC (open/high/low/close) nearest to
//                         that price is selected.
//                      4. The y is snapped to that OHLC, the x to
//                         the candle's center.
//                      5. state.crosshairMode is set to 'MagnetOHLC'
//                         so the chart can render the visual cue.

import { buildCandlePixelTargets, snapAngle45, snapToCandleOHLC,
         resolveFirstAnchor } from './chartSnap.js';

/**
 * Build a trendline drawing tool controller.
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
    // Global modifier-key state.  Updated by keydown/keyup listeners
    // so that when the user activates the trendline tool while
    // ALREADY holding CTRL/SHIFT (or holds them BEFORE clicking the
    // chart), we still know about it.
    let shiftDown = false;
    let ctrlDown  = false;

    function onKeyDown(e) {
        if (e.key === 'Shift')   { shiftDown = true;  console.log('[trendline] keydown Shift'); }
        if (e.key === 'Control') { ctrlDown  = true;  console.log('[trendline] keydown Control'); }
    }
    function onKeyUp(e) {
        if (e.key === 'Shift')   { shiftDown = false; console.log('[trendline] keyup   Shift'); }
        if (e.key === 'Control') { ctrlDown  = false; console.log('[trendline] keyup   Control'); }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    // Cache of "candle pixels" – rebuilt lazily when the chart pans
    // or zooms.  Used by CTRL-snap to look up the candle at the
    // crosshair's time.
    let candleTargets = [];
    let lastRangeKey  = '';

    // The most-recently-resolved second-anchor (in time/price) for
    // the in-progress trendline.  When the user clicks to commit,
    // we use THIS (the snapped value) rather than the raw click
    // position, so that CTRL/SHIFT snap is actually persisted.
    let lastResolvedAnchor = null;  // { time, price, mode, info }

    function refreshTargetsIfNeeded() {
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : 'none';
        if (key !== lastRangeKey) {
            lastRangeKey = key;
            candleTargets = buildCandlePixelTargets(chart, series);
            console.log('[trendline] rebuilt snap targets:', candleTargets.length, 'candles');
        }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshTargetsIfNeeded);

    function setCrosshairMode(mode) {
        if (state.crosshairMode !== mode) {
            state.crosshairMode = mode;
            console.log('[trendline] crosshairMode →', mode);
        }
    }

    function activate() {
        state.mode = 'drawing';
        state.drawingFirstPoint = null;
        trendlines.clearSelection();
        toolBtn.classList.add('active');
        ui.setChartCursor('cursor-crosshair');
        ui.showStatus('Trendline tool active — click to place the first point (hold SHIFT for 45°, CTRL for OHLC snap)');
        chartLock.lock();
        refreshTargetsIfNeeded();
        setCrosshairMode('Normal');
        ui.requestRedraw();
        console.log('[trendline] TOOL ACTIVATED — listening for shift/ctrl on crosshair move');
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
        console.log('[trendline] TOOL DEACTIVATED');
    }

    function toggle() {
        if (state.mode === 'drawing') deactivate();
        else activate();
    }

    /**
     * Handle a click on the chart while the tool is active.
     *
     * Both the FIRST and the SECOND click honour the keyboard
     * modifiers:
     *   • SHIFT → 45° snap
     *   • CTRL  → OHLC snap (the candle under the cursor)
     *
     * So if the user activates the tool while already holding CTRL
     * and clicks the chart, the first anchor will land on the
     * nearest OHLC of the candle under the cursor.
     */
    function handleChartClick(param) {
        if (state.mode !== 'drawing') return false;
        if (!param.time || !param.point) return true;

        refreshTargetsIfNeeded();

        // Read modifier keys from the original click event.  We also
        // fall back to the global key state so the user can hold CTRL
        // BEFORE the click (the click event still reports it correctly
        // in modern browsers, but this is belt-and-suspenders).
        const src   = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey)   || shiftDown;
        const ctrl  = !!(src && src.ctrlKey)    || ctrlDown;

        // 1) Resolve the clicked anchor (raw OR snapped).
        const first = resolveFirstAnchor({
            chart, series, param, targets: candleTargets, shift, ctrl,
        });
        const clickedTime  = first.time;
        const clickedPrice = first.price;

        if (!state.drawingFirstPoint) {
            state.drawingFirstPoint = { time: clickedTime, price: clickedPrice };
            preview.create(state.drawingFirstPoint);
            preview.update(param.point.x, param.point.y);
            ui.showStatus('First point set — move the cursor to preview, click to confirm (SHIFT=45°, CTRL=OHLC)');
            console.log('[trendline] first anchor set:', state.drawingFirstPoint, '| mode:', first.mode,
                '| raw(', param.point.x|0, ',', param.point.y|0, ')');
            // Also cache this as the initial lastResolvedAnchor so the
            // second click (if no movement) commits the same value.
            lastResolvedAnchor = { time: clickedTime, price: clickedPrice, mode: first.mode };
        } else {
            const p1 = state.drawingFirstPoint;
            // For the second click, use the most recent resolved anchor
            // (which honours SHIFT/CTRL during the drag) if we have one
            // and it is more recent than this click.  Otherwise, snap
            // the click position itself.
            const second = (lastResolvedAnchor && (lastResolvedAnchor.time === param.time || true))
                ? { time: lastResolvedAnchor.time, price: lastResolvedAnchor.price, mode: lastResolvedAnchor.mode }
                : first;
            const p2 = { time: second.time, price: second.price };
            const committedMode = second.mode;
            preview.clear();
            trendlines.create(p1, p2);
            state.drawingFirstPoint = null;
            lastResolvedAnchor = null;
            ui.showStatus('Trendline created — click to draw another, or press Esc to exit');
            console.log('[trendline] committed:', { p1, p2, mode: committedMode });
        }
        return true;
    }

    /**
     * Handle a crosshair move event.  This is where the SHIFT / CTRL
     * snap logic kicks in.
     */
    function handleCrosshairMove(param) {
        if (state.mode !== 'drawing') return;
        if (!state.drawingFirstPoint) return;
        if (!param.point) {
            if (state.previewTrendLine) state.previewTrendLine.setVisible(false);
            return;
        }

        refreshTargetsIfNeeded();

        // 1) Read modifier keys off the original event.
        const src = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey);
        const ctrl  = !!(src && src.ctrlKey);

        // 2) Compute the first anchor's pixel coords.
        const firstPx = {
            x: chart.timeScale().timeToCoordinate(state.drawingFirstPoint.time),
            y: series.priceToCoordinate(state.drawingFirstPoint.price),
        };
        const cursorPx = { x: param.point.x, y: param.point.y };

        if (firstPx.x === null || firstPx.y === null) {
            preview.update(cursorPx.x, cursorPx.y);
            return;
        }

        // 3) Apply SHIFT / CTRL snap.
        let snapX = cursorPx.x;
        let snapY = cursorPx.y;
        let modeLabel = 'free';

        if (shift) {
            // SHIFT wins over CTRL (matches TradingView).
            const r = snapAngle45(firstPx, cursorPx);
            snapX = r.x;
            snapY = r.y;
            modeLabel = `SHIFT ${r.angleDeg}°`;
            setCrosshairMode('Normal');
            console.log('[trendline] SHIFT snap →', modeLabel,
                '| raw(', cursorPx.x|0, ',', cursorPx.y|0, ')',
                '→ snapped(', snapX|0, ',', snapY|0, ')');
        } else if (ctrl) {
            // CTRL magnet: use the algorithm from the spec —
            // 1) find the candle at param.time
            // 2) translate cursor y → price
            // 3) pick nearest OHLC of that candle
            // 4) snap x → candle center, y → OHLC
            const snap = snapToCandleOHLC({
                chart, series, param, targets: candleTargets,
            });
            if (snap) {
                snapX = snap.x;
                snapY = snap.y;
                modeLabel = `CTRL magnet candle #${snap.candleIndex} ${snap.field}`;
                setCrosshairMode('MagnetOHLC');
                console.log('[trendline] CTRL snap →', modeLabel,
                    '| raw(', cursorPx.x|0, ',', cursorPx.y|0, ')',
                    '→ snapped(', snapX|0, ',', snapY|0, ') @ price', snap.price);
            } else {
                setCrosshairMode('Normal');
            }
        } else {
            setCrosshairMode('Normal');
        }

        // 4) Update the preview with the (possibly snapped) pixel.
        preview.update(snapX, snapY);

        // 4b) Cache the resolved anchor in (time, price) space so the
        //     next click commits the SNAPPED value, not the raw click.
        const snapTime = chart.timeScale().coordinateToTime(snapX);
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
            // While drawing, keep a neutral status text.
            ui.showStatus('First point set — move the cursor to preview, click to confirm');
        }
    }

    /**
     * Cancel the in-progress first point (e.g. on Esc).
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
        isActive: () => state.mode === 'drawing',
    };
}
