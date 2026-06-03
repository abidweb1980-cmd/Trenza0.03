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
        
        const entryPrice = r.price;
        const entryAnchor = { time: r.time, price: entryPrice };
        
        // Calculate TP/SL based on visible chart's price range
        // This ensures the trade visualization fits within the visible area
        let tp = entryPrice + 0.50; // Default 50 ticks up for TP
        let sl = entryPrice - 0.50; // Default 50 ticks down for SL
        
        try {
            // Get visible price range to size TP/SL appropriately
            const priceScale = chart.priceScale(series);
            const visibleRange = priceScale.getVisibleRange();
            if (visibleRange) {
                const priceRange = visibleRange.max - visibleRange.min;
                // Use ~10% of visible price range for total TP+SL height
                // This gives a visible-but-manageable trade size
                const desiredHeight = priceRange * 0.10;
                const currentHeight = tp - sl;
                
                if (currentHeight > 0 && desiredHeight > 0) {
                    // Scale TP/SL to fit within desired height
                    const scale = desiredHeight / currentHeight;
                    tp = entryPrice + (tp - entryPrice) * scale;
                    sl = entryPrice - (entryPrice - sl) * scale;
                }
            }
        } catch (_) {
            // Keep defaults on error
        }
        
        longPositions.create(entryAnchor, { tp, sl });
        ui.showStatus('Long position placed — drag the TP/SL handles to fine-tune, or press Esc to exit');
        console.log('[longposition] placed at', entryAnchor, '| mode:', r.mode);

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
