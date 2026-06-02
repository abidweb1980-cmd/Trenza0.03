// fibonacciPreview.js
// -----------------------------------------------------------------------------
// Live preview of the Fibonacci Retracement being drawn.  Mirrors
// previewManager.js but uses NativeFibonacciRetracement in preview mode.
// -----------------------------------------------------------------------------

import { NativeFibonacciRetracement } from './FibonacciRetracement.js';

export function createFibonacciPreview(chart, series, state, color) {
    function create(firstPoint) {
        const preview = new NativeFibonacciRetracement(
            chart, series,
            { ...firstPoint }, { ...firstPoint },
            color
        );
        preview.setPreview(true);
        preview.setVisible(true);
        series.attachPrimitive(preview);
        state.previewFib = preview;
    }

    function update(px, py) {
        if (!state.previewFib) return;
        const time  = chart.timeScale().coordinateToTime(px);
        const price = series.coordinateToPrice(py);
        if (time === null || price === null) {
            state.previewFib.setVisible(false);
            return;
        }
        state.previewFib.setVisible(true);
        state.previewFib.p2 = { time, price };
        try { chart.applyOptions({}); } catch (_) {}
    }

    function clear() {
        if (!state.previewFib) return;
        try {
            if (typeof series.detachPrimitive === 'function') {
                series.detachPrimitive(state.previewFib);
            } else {
                state.previewFib.setVisible(false);
            }
        } catch (e) {
            console.warn('[fibonacciPreview] detachPrimitive failed:', e);
            state.previewFib.setVisible(false);
        }
        state.previewFib = null;
    }

    return { create, update, clear };
}
