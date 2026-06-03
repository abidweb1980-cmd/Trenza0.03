// longPositionManager.js
// -----------------------------------------------------------------------------
// Manages the collection of Long Position primitives on the chart.
// Mirrors trendlineManager.js.
// -----------------------------------------------------------------------------

import { NativeLongPosition } from './LongPosition.js';

export function createLongPositionManager(chart, series, state, color, requestRedraw) {
    function create(entryAnchor) {
        const lp = new NativeLongPosition(
            chart, series, entryAnchor, color,
            () => { requestRedraw(); },
            (sel) => { select(sel); }
        );
        series.attachPrimitive(lp);
        state.longPositions.push(lp);
        select(lp);
        return lp;
    }

    function select(lp) {
        if (state.selectedLongPosition && state.selectedLongPosition !== lp) {
            state.selectedLongPosition.setSelected(false);
        }
        state.selectedLongPosition = lp;
        if (lp) lp.setSelected(true);
    }

    function clearSelection() {
        if (state.selectedLongPosition) {
            state.selectedLongPosition.setSelected(false);
            state.selectedLongPosition = null;
        }
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
        if (state.selectedLongPosition === lp) state.selectedLongPosition = null;
        requestRedraw();
    }

    return { create, select, clearSelection, hitTest, remove };
}
