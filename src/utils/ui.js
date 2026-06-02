// Small UI helpers shared across the app: status toast, cursor classes,
// and a small request-redraw helper for the lightweight-charts engine.

/**
 * Build a UI helper bundle.
 * @param {HTMLElement} chartArea - .chart-area element (used for cursor classes)
 * @param {HTMLElement} toolStatus - .tool-status element (the toast)
 * @param {import('lightweight-charts').IChartApi} chart
 */
export function createUI(chartArea, toolStatus, chart) {
    function showStatus(message) {
        if (!toolStatus) return;
        toolStatus.textContent = message;
        toolStatus.classList.add('visible');
    }

    function hideStatus() {
        if (!toolStatus) return;
        toolStatus.classList.remove('visible');
    }

    function setChartCursor(cursorClass) {
        if (!chartArea) return;
        chartArea.classList.remove(
            'cursor-crosshair',
            'cursor-pointer',
            'cursor-grab',
            'cursor-grabbing',
            'cursor-default'
        );
        if (cursorClass) chartArea.classList.add(cursorClass);
    }

    function requestRedraw() {
        try {
            chart.timeScale().applyOptions({});
        } catch (_) {
            // no-op
        }
    }

    return { showStatus, hideStatus, setChartCursor, requestRedraw };
}
