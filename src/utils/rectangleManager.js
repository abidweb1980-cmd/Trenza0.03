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
            () => { requestRedraw(); },
            (sel) => { select(sel); }
        );
        series.attachPrimitive(rect);
        state.rectangles.push(rect);
        select(rect);
        return rect;
    }

    function select(rect) {
        if (state.selectedRectangle && state.selectedRectangle !== rect) {
            state.selectedRectangle.setSelected(false);
        }
        state.selectedRectangle = rect;
        if (rect) rect.setSelected(true);
    }

    function clearSelection() {
        if (state.selectedRectangle) {
            state.selectedRectangle.setSelected(false);
            state.selectedRectangle = null;
        }
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
        if (state.selectedRectangle === rect) state.selectedRectangle = null;
        requestRedraw();
    }

    return { create, select, clearSelection, hitTest, remove };
}
