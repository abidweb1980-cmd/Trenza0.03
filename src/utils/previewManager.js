// Manages the "live preview" trendline shown after the first click
// of the drawing tool. The preview's second endpoint follows the
// cursor until the user clicks again (to commit) or escapes
// (to cancel).

import { NativeTrendLine } from './Trendline.js';

/**
 * Build a preview manager.
 * @param {import('lightweight-charts').IChartApi} chart
 * @param {import('lightweight-charts').ISeriesApi} series
 * @param {object} state - shared state object
 * @param {string} color
 * @param {() => void} requestRedraw
 */
export function createPreviewManager(chart, series, state, color, requestRedraw) {
    /**
     * Create a preview trendline anchored at the given first point.
     * The second endpoint is initially a copy of the first and will
     * be updated as the cursor moves.
     */
    function create(firstPoint) {
        const preview = new NativeTrendLine(
            chart, series,
            { ...firstPoint }, { ...firstPoint },
            color
        );
        preview.setPreview(true);
        preview.setVisible(true);
        series.attachPrimitive(preview);
        state.previewTrendLine = preview;
    }

    /**
     * Update the preview's second endpoint to follow a pixel point.
     * If the point is outside the chart, the preview is hidden.
     */
    function update(px, py) {
        if (!state.previewTrendLine) return;
        const time = chart.timeScale().coordinateToTime(px);
        const price = series.coordinateToPrice(py);
        if (time === null || price === null) {
            state.previewTrendLine.setVisible(false);
            return;
        }
        state.previewTrendLine.setVisible(true);
        state.previewTrendLine.p2 = { time, price };
        requestRedraw();
    }

    /**
     * Detach the preview from the series and forget it.
     *
     * Without detachPrimitive() the preview primitive stays in the
     * series\'s render list and is re-drawn on every frame — even
     * though we\'ve set _visible = false.  This caused a ghost line
     * to appear whenever the chart re-rendered (resize, anchor
     * drag, etc.) after the trendline was committed.
     */
    function clear() {
        if (!state.previewTrendLine) return;
        try {
            if (typeof series.detachPrimitive === "function") {
                series.detachPrimitive(state.previewTrendLine);
                console.log("[previewManager] detached preview primitive from series");
            } else {
                state.previewTrendLine.setVisible(false);
            }
        } catch (e) {
            console.warn("[previewManager] detachPrimitive failed:", e);
            state.previewTrendLine.setVisible(false);
        }
        state.previewTrendLine = null;
    }

    return { create, update, clear };
}
