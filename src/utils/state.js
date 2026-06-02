// Shared state used by the renderer and its helper modules.

export const TRENDLINE_COLOR = '#ffeb3b';

export function createState() {
    return {
        // 'idle'   - no tool active; user can select/drag trendlines
        // 'drawing' - trendline tool active; user is placing endpoints
        mode: 'idle',

        // First point placed while in drawing mode
        drawingFirstPoint: null,

        // Live preview line while the second point is pending
        previewTrendLine: null,

        // Currently selected trendline (or null)
        selectedTrendLine: null,

        // All trendlines on the chart
        trendLines: [],

        // Active drag operation (set on mousedown, cleared on mouseup)
        drag: null,

        // Crosshair mode for visual feedback.  Set to 'MagnetOHLC'
        // when the CTRL-snap is active so the chart can render a
        // highlighted "magnet" crosshair (mirrors TradingView's
        // Magnet Mode toggle).
        crosshairMode: 'Normal',
    };
}
