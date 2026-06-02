// Shared state used by the renderer and its helper modules.

export const TRENDLINE_COLOR = '#ffeb3b';
export const RECTANGLE_COLOR = '#2962ff';
export const FIBONACCI_COLOR = '#2962ff';

export function createState() {
    return {
        // 'idle'                - no tool active
        // 'drawing'             - trendline tool active
        // 'rectangle-drawing'   - rectangle tool active
        // 'fibonacci-drawing'   - fibonacci tool active
        mode: 'idle',

        // First point placed while in drawing mode
        drawingFirstPoint: null,

        // Live preview primitives while the second anchor is pending
        previewTrendLine: null,
        previewRectangle: null,
        previewFib: null,

        // Currently selected primitives (or null)
        selectedTrendLine: null,
        selectedRectangle: null,
        selectedFib: null,

        // All primitives on the chart
        trendLines: [],
        rectangles: [],
        fibs: [],

        // Active drag operation
        drag: null,

        // Crosshair mode for visual feedback.
        crosshairMode: 'Normal',
    };
}
