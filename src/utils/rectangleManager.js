// rectangleManager.js
// -----------------------------------------------------------------------------
// Manages the collection of rectangle primitives on the chart.
// Mirrors the trendline manager: create, select, hit-test, remove.
// -----------------------------------------------------------------------------

import { NativeRectangle } from './Rectangle.js';

export function createRectangleManager(chart, series, state, color, requestRedraw) {
    function create(p1, p2) {
        const rect = new NativeRectangle(
            chart, series, p1, p2, color,
            () => { requestRedraw(); }
        );
        series.attachPrimitive(rect);
        state.rectangles.push(rect);
        select(rect);
        return rect;
    }

    function select(rect) {
        // Clear previous single selection
        if (state.selectedRectangle) {
            state.selectedRectangle.setSelected(false);
        }
        state.selectedRectangle = rect;
        
        // Also add to multi-selection array
        if (rect && !state.selectedRectangles.includes(rect)) {
            state.selectedRectangles.push(rect);
        }
        if (rect) rect.setSelected(true);
    }

    function addToSelection(rect) {
        if (!rect || state.selectedRectangles.includes(rect)) return;
        
        state.selectedRectangle = rect;
        state.selectedRectangles.push(rect);
        rect.setSelected(true);
    }

    function deselect(rect) {
        const idx = state.selectedRectangles.indexOf(rect);
        if (idx !== -1) {
            state.selectedRectangles.splice(idx, 1);
            rect.setSelected(false);
        }
        if (state.selectedRectangle === rect) {
            state.selectedRectangle = state.selectedRectangles.length > 0 
                ? state.selectedRectangles[state.selectedRectangles.length - 1] 
                : null;
            if (state.selectedRectangle) {
                state.selectedRectangle.setSelected(true);
            }
        }
    }

    function clearSelection() {
        state.selectedRectangles.forEach(rect => rect.setSelected(false));
        state.selectedRectangles = [];
        state.selectedRectangle = null;
    }

    function hitTest(px, py) {
        for (let i = state.rectangles.length - 1; i >= 0; i--) {
            const r = state.rectangles[i];
            const target = r.hitTest(px, py);
            if (target) return { rectangle: r, target };
        }
        return null;
    }

    function remove(rect) {
        if (!rect) return;
        try {
            if (typeof series.detachPrimitive === 'function') {
                series.detachPrimitive(rect);
            }
        } catch (e) {
            console.warn('[rectangleManager] detachPrimitive failed:', e);
        }
        const idx = state.rectangles.indexOf(rect);
        if (idx !== -1) state.rectangles.splice(idx, 1);
        const selIdx = state.selectedRectangles.indexOf(rect);
        if (selIdx !== -1) state.selectedRectangles.splice(selIdx, 1);
        if (state.selectedRectangle === rect) state.selectedRectangle = null;
        requestRedraw();
    }

    return { create, select, addToSelection, deselect, clearSelection, hitTest, remove };
}
