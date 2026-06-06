// Shared state used by the renderer and its helper modules.

export const TRENDLINE_COLOR = '#ffeb3b';
export const RECTANGLE_COLOR = '#2962ff';
export const FIBONACCI_COLOR = '#2962ff';
export const LONG_POSITION_COLOR = '#26a69a';

export function createState() {
    return {
        mode: 'idle',
        activeTool: null,

        // First point placed while in drawing mode
        drawingFirstPoint: null,

        // Live preview primitives while the second anchor is pending
        previewTrendLine: null,
        previewRectangle: null,
        previewFib: null,

        // Currently selected primitives (supports multi-select)
        // Use arrays for multi-selection
        selectedTrendLines: [],
        selectedRectangles: [],
        selectedFibs: [],
        selectedLongPositions: [],

        // All primitives on the chart
        trendLines: [],
        rectangles: [],
        fibs: [],
        longPositions: [],

        // Active drag operation (can track multiple for multi-drag)
        drag: null,

        // Crosshair mode for visual feedback.
        crosshairMode: 'Normal',

        // Current symbol/timeframe (used for visibility checks)
        currentSymbol: 'AAPL',
        currentTimeframe: 'D',
    };
}
