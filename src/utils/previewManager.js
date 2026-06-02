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
     * Hide and forget the preview. (lightweight-charts v5 doesn't
     * expose a clean detach API, so we simply stop updating it and
     * mark it invisible.)
     */
    function clear() {
        if (!state.previewTrendLine) return;
        state.previewTrendLine.setVisible(false);
        state.previewTrendLine = null;
    }

    return { create, update, clear };
}
