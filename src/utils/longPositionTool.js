// longPositionTool.js
// -----------------------------------------------------------------------------
// Long Position drawing tool.  Single-click placement: click on chart
// to set the entry.  After placement, the tool auto-selects and the
// TP/SL handles + stats panel are interactive in idle mode.
// -----------------------------------------------------------------------------

import { buildCandlePixelTargets, resolvePoint } from './chartSnap.js';

export function createLongPositionTool({
    state,
    toolBtn,
    chart,
    series,
    ui,
    chartLock,
    longPositions,
    onDeactivate,
}) {
    let shiftDown = false;
    let ctrlDown  = false;
    function onKeyDown(e) {
        if (e.key === 'Shift')   { shiftDown = true; }
        if (e.key === 'Control') { ctrlDown  = true; }
    }
    function onKeyUp(e) {
        if (e.key === 'Shift')   { shiftDown = false; }
        if (e.key === 'Control') { ctrlDown  = false; }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    let candleTargets = [];
    let lastRangeKey  = '';
    function refreshTargetsIfNeeded() {
        const range = chart.timeScale().getVisibleLogicalRange();
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : 'none';
        if (key !== lastRangeKey) {
            lastRangeKey = key;
            candleTargets = buildCandlePixelTargets(chart, series);
        }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(refreshTargetsIfNeeded);

    function activate() {
        state.mode = 'long-position-drawing';
        longPositions.clearSelection();
        toolBtn.classList.add('active');
        ui.setChartCursor('cursor-crosshair');
        ui.showStatus('Long Position — click on chart to place entry (hold CTRL to snap to OHLC)');
        chartLock.lock();
        refreshTargetsIfNeeded();
        ui.requestRedraw();
        console.log('[longposition] TOOL ACTIVATED');
    }

    function deactivate() {
        state.mode = 'idle';
        toolBtn.classList.remove('active');
        ui.setChartCursor('cursor-default');
        ui.hideStatus();
        chartLock.forceUnlock();
        ui.requestRedraw();
        if (onDeactivate) onDeactivate();
        console.log('[longposition] TOOL DEACTIVATED');
    }

    function toggle() {
        if (state.mode === 'long-position-drawing') deactivate();
        else activate();
    }

/**
      * Single-click placement.  The first (and only) click sets the
      * entry; the tool then exits drawing mode and the freshly
      * placed position is auto-selected.
      */
    function handleChartClick(param) {
        if (state.mode !== 'long-position-drawing') return false;
        if (!param.time || !param.point) return true;

        refreshTargetsIfNeeded();

        const src   = param.sourceEvent || null;
        const shift = !!(src && src.shiftKey) || shiftDown;
        const ctrl  = !!(src && src.ctrlKey)  || ctrlDown;

        // Resolve the entry anchor through the universal point
        // translator (CTRL = OHLC snap).
        const r = resolvePoint({
            chart, series,
            rawPx: { x: param.point.x, y: param.point.y },
            targets: candleTargets,
            shift, ctrl,
            context: { mode: 'click-first', otherAnchor: null, isFirst: true },
        });
        
        // Calculate volatility-based TP/SL
        const entryPrice = r.price;
        const entryAnchor = { time: r.time, price: entryPrice };
        
        // Calculate average candle range (high-low) for visible data to estimate volatility
        let avgCandleRange = 0.01; // Default fallback
        try {
            const visibleRange = chart.timeScale().getVisibleLogicalRange();
            if (visibleRange) {
                let totalRange = 0;
                let count = 0;
                const startIdx = Math.max(0, Math.floor(visibleRange.from));
                const endIdx = Math.min(1000, Math.floor(visibleRange.to));
                
                for (let i = startIdx; i < endIdx && count < 100; i++) {
                    const bar = series.dataByIndex(i - startIdx);
                    if (bar && bar.high != null && bar.low != null) {
                        totalRange += bar.high - bar.low;
                        count++;
                    }
                }
                if (count > 0) {
                    avgCandleRange = totalRange / count;
                }
            }
        } catch (_) {
            // Use fallback on error
        }
        
        // Calculate risk distance: roughly 2x average candle range (typical RR)
        // This makes the trade fit well within the visible chart area
        const riskDistance = Math.max(avgCandleRange * 1.5, 0.01);
        
        // Create position with volatility-based sizing
        longPositions.create(entryAnchor, riskDistance);
        ui.showStatus('Long position placed — drag the TP/SL handles to fine-tune, or press Esc to exit');
        console.log('[longposition] placed at', entryAnchor, '| volatility:', avgCandleRange, '| mode:', r.mode);

        // Auto-exit drawing mode so the user can interact normally
        // with the freshly placed position.
        deactivate();
        return true;
    }

    function handleCrosshairMove(_param) {
        // No-op: long position is single-click, no live preview.
    }

    function cancelInProgress() {
        // Nothing to cancel — single-click tool.
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
        isActive: () => state.mode === 'long-position-drawing',
        getSnapTargets: () => candleTargets,
        getShiftDown: () => shiftDown,
        getCtrlDown:  () => ctrlDown,
    };
}
