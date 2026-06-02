// Shared state used by the renderer and its helper modules.

export const TRENDLINE_COLOR = '#ffeb3b';
export const RECTANGLE_COLOR = '#2962ff';

export function createState() {
    return {
        // 'idle'              - no tool active; user can select/drag trendlines/rectangles
        // 'drawing'           - trendline tool active; user is placing endpoints
        // 'rectangle-drawing' - rectangle tool active; user is placing corners
        mode: 'idle',

        // First point placed while in drawing mode
        drawingFirstPoint: null,

        // Live preview line while the second point is pending
        previewTrendLine: null,

        // Live preview rectangle while the second corner is pending
        previewRectangle: null,

        // Currently selected trendline (or null)
        selectedTrendLine: null,

        // All trendlines on the chart
        trendLines: [],

        // All rectangles on the chart
        rectangles: [],

        // Currently selected rectangle (or null)
        selectedRectangle: null,

        // Active drag operation (set on mousedown, cleared on mouseup)
        drag: null,

        // Crosshair mode for visual feedback.  Set to 'MagnetOHLC'
        // when the CTRL-snap is active so the chart can render a
        // highlighted "magnet" crosshair (mirrors TradingView's
        // Magnet Mode toggle).
        crosshairMode: 'Normal',
    };
}
