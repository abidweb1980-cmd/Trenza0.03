// Entry point for the renderer process.
//
// Responsibilities:
//   1. Build the lightweight-charts chart and load sample data.
//   2. Construct the helper modules (state, UI, chart lock,
//      preview manager, trendline manager, drawing tool,
//      interaction controller).
//   3. Wire up top-level events: chart click, crosshair move,
//      keyboard, and "any other sidebar button deactivates the
//      drawing tool".
//
// Both the trendline tool and the rectangle tool honour
// TradingView-style modifier keys:
//   • SHIFT held  →  angle-lock the second anchor to the closest 45°
//   • CTRL  held  →  magnet-snap the second anchor to the nearest
//                    candlestick OHLC value
// (see src/utils/trendlineTool.js + src/utils/rectangleTool.js
//  + src/utils/chartSnap.js)

import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';
import 'bootstrap-icons/font/bootstrap-icons.min.css';

import { createState, TRENDLINE_COLOR, RECTANGLE_COLOR } from './utils/state.js';
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
import { extendWithDummies } from './utils/dataExtension.js';

// How many dummy candles to prepend/append so the user can draw
// trendlines outside the real data range.
const DUMMY_COUNT = 300;

// ---------- DOM elements ----------
const container = document.getElementById('chart-container');
const chartArea = document.getElementById('chart-area');
const toolStatus = document.getElementById('tool-status');
const trendlineToolBtn = document.getElementById('trendline-tool');
const rectangleToolBtn = document.getElementById('rectangle-tool');

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

// -------------------------------------------------------------------------
// Global modifier-key → chart crosshair mode toggle.
//
// TradingView's chart library has a built-in CrosshairMode.MagnetOHLC
// option that draws a stronger crosshair on the OHLC value of the
// candle under the cursor.  We switch into that mode whenever CTRL
// is held and back to Normal when it is released.  This gives the
// user a clear visual cue that the magnet snap is active.
// -------------------------------------------------------------------------
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
// Safety: if the window loses focus while CTRL is held, make sure
// we reset the crosshair when CTRL is released outside the window.
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

        // Extend the dataset with dummy candles on both sides.
        const extended = extendWithDummies(rawData, DUMMY_COUNT);

        const formattedData = extended.map(candle => ({
            time: candle.timestamp / 1000,
            open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        }));
        candlestickSeries.setData(formattedData);

        // Focus the visible range on the real candles (with padding).
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

// ---------- 5. Cross-tool deactivation ----------
//
// We have two drawing tools (trendline + rectangle).  Activating
// one should deactivate the other so they don't fight.  We do
// this with explicit per-button listeners that ONLY call
// deactivate() if the other tool is actually active.  (Using
// `isActive()` is important: an unconditional deactivate() would
// wipe out the global state — `state.mode`, `chartLock`, etc. —
// even when no drawing tool is active, breaking subsequent
// activation of any tool.)
trendlineToolBtn.addEventListener('click', () => {
    if (rectangleDrawingTool.isActive()) rectangleDrawingTool.deactivate();
});
rectangleToolBtn.addEventListener('click', () => {
    if (drawingTool.isActive()) drawingTool.deactivate();
});

// ---------- 6. Wire up top-level events ----------
//
// Deactivate BOTH drawing tools when any other sidebar button is
// clicked.  Both checks use isActive() so the click on the
// rectangle button itself (which already activated the rectangle
// tool) doesn't immediately deactivate it via the trendline's
// unconditional-deactivate listener.
document.querySelectorAll('.sidebar-btn').forEach(btn => {
    if (btn.id === 'rectangle-tool') return;
    btn.addEventListener('click', () => {
        if (rectangleDrawingTool.isActive()) rectangleDrawingTool.deactivate();
    });
});

document.querySelectorAll('.sidebar-btn').forEach(btn => {
    if (btn.id === 'trendline-tool') return;
    btn.addEventListener('click', () => {
        if (drawingTool.isActive()) drawingTool.deactivate();
    });
});

// Chart click is consumed by whichever tool is active.
chart.subscribeClick((param) => {
    if (rectangleDrawingTool.isActive()) {
        rectangleDrawingTool.handleChartClick(param);
        return;
    }
    drawingTool.handleChartClick(param);
});

// Crosshair move is routed to the active tool.
chart.subscribeCrosshairMove((param) => {
    if (rectangleDrawingTool.isActive()) {
        rectangleDrawingTool.handleCrosshairMove(param);
        return;
    }
    drawingTool.handleCrosshairMove(param);
});

// Keyboard shortcuts.
window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
        if (rectangleDrawingTool.isActive()) {
            rectangleDrawingTool.cancelInProgress();
            rectangleDrawingTool.deactivate();
        } else if (drawingTool.isActive()) {
            drawingTool.cancelInProgress();
            drawingTool.deactivate();
        } else if (state.selectedRectangle) {
            rectanglesMgr.clearSelection();
        } else if (state.selectedTrendLine) {
            trendlines.clearSelection();
        }
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace')
               && (state.selectedRectangle || state.selectedTrendLine)) {
        if (state.selectedRectangle) {
            rectanglesMgr.remove(state.selectedRectangle);
        } else if (state.selectedTrendLine) {
            trendlines.remove(state.selectedTrendLine);
        }
        ui.requestRedraw();
    }
});

// ---------- 7. Resize observer ----------
new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
}).observe(container);

// eslint-disable-next-line no-console
console.log('[renderer] ready — click the Trend line or Rectangle button in the sidebar to start drawing');
