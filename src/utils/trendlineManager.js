// Manages the collection of trendline primitives on the chart:
// creation, selection, hit-testing, and deletion.

import { NativeTrendLine } from './Trendline.js';

/**
 * Build a trendline manager.
 * @param {import('lightweight-charts').IChartApi} chart
 * @param {import('lightweight-charts').ISeriesApi} series
 * @param {object} state - shared state object
 * @param {string} color
 * @param {() => void} requestRedraw
 */
export function createTrendlineManager(chart, series, state, color, requestRedraw) {
    /**
     * Create a new trendline, attach it to the series, register it
     * in state, and auto-select it. Returns the created trendline.
     */
    function create(p1, p2) {
        const tl = new NativeTrendLine(
            chart, series, p1, p2, color,
            (changed) => { requestRedraw(); },            // onChange
            (sel) => { select(sel); }                      // onSelect
        );
        series.attachPrimitive(tl);
        state.trendLines.push(tl);
        select(tl);
        return tl;
    }

    /**
     * Mark the given trendline as the currently-selected one
     * (deselecting the previous selection, if any).
     */
    function select(tl) {
        if (state.selectedTrendLine && state.selectedTrendLine !== tl) {
            state.selectedTrendLine.setSelected(false);
        }
        state.selectedTrendLine = tl;
        if (tl) tl.setSelected(true);
    }

    /**
     * Deselect whatever is currently selected.
     */
    function clearSelection() {
        if (state.selectedTrendLine) {
            state.selectedTrendLine.setSelected(false);
            state.selectedTrendLine = null;
        }
    }

    /**
     * Hit-test a pixel point against all trendlines. Iterates in
     * reverse so the most recently drawn trendline wins.
     * @returns {{trendLine: NativeTrendLine, target: 'p1'|'p2'|'line'} | null}
     */
    function hitTest(px, py) {
        for (let i = state.trendLines.length - 1; i >= 0; i--) {
            const tl = state.trendLines[i];
            const target = tl.hitTest(px, py);
            if (target) return { trendLine: tl, target };
        }
        return null;
    }

    /**
     * Remove a trendline from the registry. (Note: lightweight-charts
     * v5 doesn't expose a clean detach API for attached primitives,
     * so the visual primitive stays attached but stops being tracked
     * here. A full removal would require recreating the series.)
     */
    function remove(tl) {
        const idx = state.trendLines.indexOf(tl);
        if (idx !== -1) state.trendLines.splice(idx, 1);
        if (state.selectedTrendLine === tl) state.selectedTrendLine = null;
    }

    return { create, select, clearSelection, hitTest, remove };
}
