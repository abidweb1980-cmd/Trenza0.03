// Entry point for the renderer process.
//
// Responsibilities:
//   1. Build the lightweight-charts chart and load sample data.
//   2. Construct the helper modules (state, UI, chart lock,
//      preview manager, trendline/rectangle/fibonacci manager,
//      drawing tools, interaction controllers).
//   3. Wire up top-level events: chart click, crosshair move,
//      keyboard, and "any other sidebar button deactivates the
//      active drawing tool".
//
// All three drawing tools (trendline, rectangle, fibonacci) honour
// TradingView-style modifier keys:
//   • SHIFT held  →  angle-lock the second anchor to the closest 45°
//   • CTRL  held  →  magnet-snap the second anchor to the nearest
//                    candlestick OHLC value

import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';
import 'bootstrap-icons/font/bootstrap-icons.min.css';

import { createState, TRENDLINE_COLOR, RECTANGLE_COLOR, FIBONACCI_COLOR } from './utils/state.js';
import { createUI } from './utils/ui.js';
import { createChartLock } from './utils/chartLock.js';
import { createPreviewManager } from './utils/previewManager.js';
import { createTrendlineManager } from './utils/trendlineManager.js';
import { createTrendlineTool } from './utils/trendlineTool.js';
import { createTrendlineInteraction } from './utils/trendlineInteraction.js';
import { createRectangleManager } from './utils/rectangleManager.js';
import { createRectanglePreview } from './utils/rectanglePreview.js';
import { createRectangleTool } from './utils/rectangleTool.js';
import { createRectangleInteraction } from './utils/rectangleInteraction.js';
import { createFibonacciManager } from './utils/fibonacciManager.js';
import { createFibonacciPreview } from './utils/fibonacciPreview.js';
import { createFibonacciTool } from './utils/fibonacciTool.js';
import { createFibonacciInteraction } from './utils/fibonacciInteraction.js';
import { extendWithDummies } from './utils/dataExtension.js';

const DUMMY_COUNT = 300;

// ---------- DOM elements ----------
const container = document.getElementById('chart-container');
const chartArea = document.getElementById('chart-area');
const toolStatus = document.getElementById('tool-status');
const trendlineToolBtn = document.getElementById('trendline-tool');
const rectangleToolBtn = document.getElementById('rectangle-tool');
const fibonacciToolBtn = document.getElementById('fibonacci-tool');

// ---------- 1. Chart + series ----------
const chart = createChart(container, {
    layout: { background: { color: '#1a1a1a' }, textColor: '#e1e1e1' },
    grid: { vertLines: { color: '#2b2b2b' }, horzLines: { color: '#2b2b2b' } },
    timeScale: { timeVisible: true, secondsVisible: false },
    crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9e9e9e', width: 1, style: 0 },
        horzLine: { color: '#9e9e9e', width: 1, style: 0 },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
});

const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350',
    borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});

function setChartCrosshairMode(mode) {
    try {
        chart.applyOptions({ crosshair: { mode } });
        console.log('[renderer] chart.crosshair.mode →', mode);
    } catch (e) {
        console.warn('[renderer] failed to set crosshair mode:', e);
    }
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !e.repeat) {
        setChartCrosshairMode(CrosshairMode.MagnetOHLC);
    }
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') {
        setChartCrosshairMode(CrosshairMode.Normal);
    }
});
window.addEventListener('blur', () => {
    setChartCrosshairMode(CrosshairMode.Normal);
});

loadChartData();

async function loadChartData() {
    try {
        const response = await fetch('./src/data/sample.json');
        if (!response.ok) throw new Error(`Failed to load data: ${response.statusText}`);
        const rawData = await response.json();
        const realCount = rawData.length;

        const extended = extendWithDummies(rawData, DUMMY_COUNT);

        const formattedData = extended.map(candle => ({
            time: candle.timestamp / 1000,
            open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        }));
        candlestickSeries.setData(formattedData);

        const leadingDummies = DUMMY_COUNT;
        const pad = 5;
        const fromIdx = Math.max(0, leadingDummies - pad);
        const toIdx = leadingDummies + realCount - 1 + pad;
        chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: toIdx });
    } catch (error) {
        console.error('Error loading chart candles:', error);
    }
}

// ---------- 2. Helper modules ----------
const state = createState();

const ui = createUI(chartArea, toolStatus, chart);
const chartLock = createChartLock(chart);

// ---------- 3. Trendline tool ----------
const trendlines = createTrendlineManager(
    chart, candlestickSeries, state, TRENDLINE_COLOR, ui.requestRedraw
);
const trendlinePreview = createPreviewManager(
    chart, candlestickSeries, state, TRENDLINE_COLOR, ui.requestRedraw
);
const drawingTool = createTrendlineTool({
    state,
    toolBtn: trendlineToolBtn,
    chart,
    series: candlestickSeries,
    ui,
    chartLock,
    preview: trendlinePreview,
    trendlines,
});

createTrendlineInteraction({
    container,
    state,
    ui,
    chartLock,
    trendlines,
    chart,
    series: candlestickSeries,
    getSnapTargets: () => drawingTool.getSnapTargets(),
    getShiftDown:  () => drawingTool.getShiftDown(),
    getCtrlDown:   () => drawingTool.getCtrlDown(),
});

// ---------- 4. Rectangle tool ----------
const rectanglesMgr = createRectangleManager(
    chart, candlestickSeries, state, RECTANGLE_COLOR, ui.requestRedraw
);
const rectanglePreview = createRectanglePreview(
    chart, candlestickSeries, state, RECTANGLE_COLOR
);
const rectangleDrawingTool = createRectangleTool({
    state,
    toolBtn: rectangleToolBtn,
    chart,
    series: candlestickSeries,
    ui,
    chartLock,
    preview: rectanglePreview,
    rectangles: rectanglesMgr,
});

createRectangleInteraction({
    container,
    state,
    ui,
    chartLock,
    rectangles: rectanglesMgr,
    chart,
    series: candlestickSeries,
    getSnapTargets: () => rectangleDrawingTool.getSnapTargets(),
    getShiftDown:  () => rectangleDrawingTool.getShiftDown(),
    getCtrlDown:   () => rectangleDrawingTool.getCtrlDown(),
});

// ---------- 5. Fibonacci tool ----------
const fibsMgr = createFibonacciManager(
    chart, candlestickSeries, state, FIBONACCI_COLOR, ui.requestRedraw
);
const fibonacciPreview = createFibonacciPreview(
    chart, candlestickSeries, state, FIBONACCI_COLOR
);
const fibonacciDrawingTool = createFibonacciTool({
    state,
    toolBtn: fibonacciToolBtn,
    chart,
    series: candlestickSeries,
    ui,
    chartLock,
    preview: fibonacciPreview,
    fibs: fibsMgr,
});

createFibonacciInteraction({
    container,
    state,
    ui,
    chartLock,
    fibs: fibsMgr,
    chart,
    series: candlestickSeries,
    getSnapTargets: () => fibonacciDrawingTool.getSnapTargets(),
    getShiftDown:  () => fibonacciDrawingTool.getShiftDown(),
    getCtrlDown:   () => fibonacciDrawingTool.getCtrlDown(),
});

// ---------- 6. Cross-tool deactivation ----------
//
// We have THREE drawing tools (trendline, rectangle, fibonacci).
// Activating any one should deactivate the other two.  All checks
// use isActive() so an unconditional deactivate() doesn't wipe
// out the global state of the just-activated tool.
//
// IMPORTANT: when adding a "deactivate X" listener to a sidebar
// button, we MUST skip X's own button — otherwise clicking that
// button activates X via its toggle listener, then immediately
// deactivates it via this loop's listener.
const DRAWING_TOOL_IDS = ['trendline-tool', 'rectangle-tool', 'fibonacci-tool'];

function deactivateOtherTools(activeToolBtn) {
    return () => {
        if (activeToolBtn !== rectangleToolBtn && rectangleDrawingTool.isActive()) {
            rectangleDrawingTool.deactivate();
        }
        if (activeToolBtn !== fibonacciToolBtn && fibonacciDrawingTool.isActive()) {
            fibonacciDrawingTool.deactivate();
        }
        if (activeToolBtn !== trendlineToolBtn && drawingTool.isActive()) {
            drawingTool.deactivate();
        }
    };
}

trendlineToolBtn.addEventListener('click', deactivateOtherTools(trendlineToolBtn));
rectangleToolBtn.addEventListener('click', deactivateOtherTools(rectangleToolBtn));
fibonacciToolBtn.addEventListener('click', deactivateOtherTools(fibonacciToolBtn));

// Any other (non-drawing) sidebar button → deactivate ALL drawing
// tools.  All checks use isActive() to avoid wiping just-set state.
document.querySelectorAll('.sidebar-btn').forEach(btn => {
    if (DRAWING_TOOL_IDS.includes(btn.id)) return;
    btn.addEventListener('click', () => {
        if (drawingTool.isActive()) drawingTool.deactivate();
        if (rectangleDrawingTool.isActive()) rectangleDrawingTool.deactivate();
        if (fibonacciDrawingTool.isActive()) fibonacciDrawingTool.deactivate();
    });
});

// ---------- 7. Wire up top-level events ----------
// Chart click is consumed by whichever tool is active.
chart.subscribeClick((param) => {
    if (fibonacciDrawingTool.isActive()) {
        fibonacciDrawingTool.handleChartClick(param);
        return;
    }
    if (rectangleDrawingTool.isActive()) {
        rectangleDrawingTool.handleChartClick(param);
        return;
    }
    drawingTool.handleChartClick(param);
});

// Crosshair move is routed to the active tool.
chart.subscribeCrosshairMove((param) => {
    if (fibonacciDrawingTool.isActive()) {
        fibonacciDrawingTool.handleCrosshairMove(param);
        return;
    }
    if (rectangleDrawingTool.isActive()) {
        rectangleDrawingTool.handleCrosshairMove(param);
        return;
    }
    drawingTool.handleCrosshairMove(param);
});

// Keyboard shortcuts.
window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
        if (fibonacciDrawingTool.isActive()) {
            fibonacciDrawingTool.cancelInProgress();
            fibonacciDrawingTool.deactivate();
        } else if (rectangleDrawingTool.isActive()) {
            rectangleDrawingTool.cancelInProgress();
            rectangleDrawingTool.deactivate();
        } else if (drawingTool.isActive()) {
            drawingTool.cancelInProgress();
            drawingTool.deactivate();
        } else if (state.selectedFib) {
            fibsMgr.clearSelection();
        } else if (state.selectedRectangle) {
            rectanglesMgr.clearSelection();
        } else if (state.selectedTrendLine) {
            trendlines.clearSelection();
        }
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace')
               && (state.selectedFib || state.selectedRectangle || state.selectedTrendLine)) {
        if (state.selectedFib) {
            fibsMgr.remove(state.selectedFib);
        } else if (state.selectedRectangle) {
            rectanglesMgr.remove(state.selectedRectangle);
        } else if (state.selectedTrendLine) {
            trendlines.remove(state.selectedTrendLine);
        }
        ui.requestRedraw();
    }
});

// ---------- 8. Resize observer ----------
new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
}).observe(container);

// eslint-disable-next-line no-console
console.log('[renderer] ready — click the Trend line, Rectangle, or Fibonacci button in the sidebar to start drawing');
