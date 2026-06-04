// longPositionManager.js
// -----------------------------------------------------------------------------
// Manages the collection of Long Position primitives on the chart.
// Mirrors trendlineManager.js.
// -----------------------------------------------------------------------------

import { NativeLongPosition } from './LongPosition.js';

export function createLongPositionManager(chart, series, state, color, requestRedraw) {
    function create(entryAnchor, tpSlOptions = null) {
        const lp = new NativeLongPosition(
            chart, series, entryAnchor, color,
            () => { requestRedraw(); },
            null,  // onSelect - not needed, selection is handled by interaction
            tpSlOptions
        );
        series.attachPrimitive(lp);
        state.longPositions.push(lp);
        select(lp);
        return lp;
    }

    /**
     * Select a long position (single select).
     * Use addToSelection() for multi-select behavior.
     */
    function select(lp) {
        if (state.selectedLongPosition) {
            state.selectedLongPosition.setSelected(false);
        }
        state.selectedLongPosition = lp;
        
        // Also add to multi-selection array
        if (lp && !state.selectedLongPositions.includes(lp)) {
            state.selectedLongPositions.push(lp);
        }
        if (lp) lp.setSelected(true);
    }

    /**
     * Add to selection (for multi-select with SHIFT).
     */
    function addToSelection(lp) {
        if (!lp || state.selectedLongPositions.includes(lp)) return;
        
        state.selectedLongPosition = lp;
        state.selectedLongPositions.push(lp);
        lp.setSelected(true);
    }

    /**
     * Deselect a specific long position
     */
    function deselect(lp) {
        const idx = state.selectedLongPositions.indexOf(lp);
        if (idx !== -1) {
            state.selectedLongPositions.splice(idx, 1);
            lp.setSelected(false);
        }
        if (state.selectedLongPosition === lp) {
            state.selectedLongPosition = state.selectedLongPositions.length > 0 
                ? state.selectedLongPositions[state.selectedLongPositions.length - 1] 
                : null;
            if (state.selectedLongPosition) {
                state.selectedLongPosition.setSelected(true);
            }
        }
    }

    function clearSelection() {
        state.selectedLongPositions.forEach(lp => lp.setSelected(false));
        state.selectedLongPositions = [];
        state.selectedLongPosition = null;
    }

    function hitTest(px, py) {
        for (let i = state.longPositions.length - 1; i >= 0; i--) {
            const lp = state.longPositions[i];
            const target = lp.hitTest(px, py);
            if (target) return { longPosition: lp, target };
        }
        return null;
    }

    function remove(lp) {
        if (!lp) return;
        try {
            if (typeof series.detachPrimitive === 'function') {
                series.detachPrimitive(lp);
            }
        } catch (e) {
            console.warn('[longPositionManager] detachPrimitive failed:', e);
        }
        const idx = state.longPositions.indexOf(lp);
        if (idx !== -1) state.longPositions.splice(idx, 1);
        const selIdx = state.selectedLongPositions.indexOf(lp);
        if (selIdx !== -1) state.selectedLongPositions.splice(selIdx, 1);
        if (state.selectedLongPosition === lp) state.selectedLongPosition = null;
        requestRedraw();
    }

    return { create, select, addToSelection, deselect, clearSelection, hitTest, remove };
}
