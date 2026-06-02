// rectanglePreview.js
// -----------------------------------------------------------------------------
// Live preview of the rectangle being drawn.  Mirrors previewManager.js
// but uses NativeRectangle in preview mode.
// -----------------------------------------------------------------------------

import { NativeRectangle } from './Rectangle.js';

export function createRectanglePreview(chart, series, state, color) {
    function create(firstPoint) {
        const preview = new NativeRectangle(
            chart, series,
            { ...firstPoint }, { ...firstPoint },
            color
        );
        preview.setPreview(true);
        preview.setVisible(true);
        series.attachPrimitive(preview);
        state.previewRectangle = preview;
    }

    function update(px, py) {
        if (!state.previewRectangle) return;
        const time  = chart.timeScale().coordinateToTime(px);
        const price = series.coordinateToPrice(py);
        if (time === null || price === null) {
            state.previewRectangle.setVisible(false);
            return;
        }
        state.previewRectangle.setVisible(true);
        state.previewRectangle.p2 = { time, price };
        try { chart.applyOptions({}); } catch (_) {}
    }

    function clear() {
        if (!state.previewRectangle) return;
        try {
            if (typeof series.detachPrimitive === 'function') {
                series.detachPrimitive(state.previewRectangle);
            } else {
                state.previewRectangle.setVisible(false);
            }
        } catch (e) {
            console.warn('[rectanglePreview] detachPrimitive failed:', e);
            state.previewRectangle.setVisible(false);
        }
        state.previewRectangle = null;
    }

    return { create, update, clear };
}
