// Entry point for the renderer process.

import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';
import 'bootstrap-icons/font/bootstrap-icons.min.css';

import { createState, TRENDLINE_COLOR, RECTANGLE_COLOR, FIBONACCI_COLOR, LONG_POSITION_COLOR } from './utils/state.js';
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
import { createLongPositionManager } from './utils/longPositionManager.js';
import { createLongPositionTool } from './utils/longPositionTool.js';
import { createLongPositionInteraction } from './utils/longPositionInteraction.js';
import { extendWithDummies } from './utils/dataExtension.js';

const DUMMY_COUNT = 300;

const container = document.getElementById('chart-container');
const chartArea = document.getElementById('chart-area');
const toolStatus = document.getElementById('tool-status');
const trendlineToolBtn = document.getElementById('trendline-tool');
const rectangleToolBtn = document.getElementById('rectangle-tool');
const fibonacciToolBtn = document.getElementById('fibonacci-tool');
const longPositionToolBtn = document.getElementById('long-position-tool');

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

const state = createState();
const ui = createUI(chartArea, toolStatus, chart);
const chartLock = createChartLock(chart);

// ---------- Trendline tool ----------
const trendlines = createTrendlineManager(
    chart, candlestickSeries, state, TRENDLINE_COLOR, ui.requestRedraw
);
const trendlinePreview = createPreviewManager(
    chart, candlestickSeries, state, TRENDLINE_COLOR, ui.requestRedraw
);
const drawingTool = createTrendlineTool({
    state, toolBtn: trendlineToolBtn, chart, series: candlestickSeries,
    ui, chartLock, preview: trendlinePreview, trendlines,
});

createTrendlineInteraction({
    container, state, ui, chartLock, trendlines,
    chart, series: candlestickSeries,
    getSnapTargets: () => drawingTool.getSnapTargets(),
    getShiftDown:  () => drawingTool.getShiftDown(),
    getCtrlDown:   () => drawingTool.getCtrlDown(),
});

// ---------- Rectangle tool ----------
const rectanglesMgr = createRectangleManager(
    chart, candlestickSeries, state, RECTANGLE_COLOR, ui.requestRedraw
);
const rectanglePreview = createRectanglePreview(
    chart, candlestickSeries, state, RECTANGLE_COLOR
);
const rectangleDrawingTool = createRectangleTool({
    state, toolBtn: rectangleToolBtn, chart, series: candlestickSeries,
    ui, chartLock, preview: rectanglePreview, rectangles: rectanglesMgr,
});

createRectangleInteraction({
    container, state, ui, chartLock, rectangles: rectanglesMgr,
    chart, series: candlestickSeries,
    getSnapTargets: () => rectangleDrawingTool.getSnapTargets(),
    getShiftDown:  () => rectangleDrawingTool.getShiftDown(),
    getCtrlDown:   () => rectangleDrawingTool.getCtrlDown(),
});

// ---------- Fibonacci tool ----------
const fibsMgr = createFibonacciManager(
    chart, candlestickSeries, state, FIBONACCI_COLOR, ui.requestRedraw
);
const fibonacciPreview = createFibonacciPreview(
    chart, candlestickSeries, state, FIBONACCI_COLOR
);
const fibonacciDrawingTool = createFibonacciTool({
    state, toolBtn: fibonacciToolBtn, chart, series: candlestickSeries,
    ui, chartLock, preview: fibonacciPreview, fibs: fibsMgr,
});

createFibonacciInteraction({
    container, state, ui, chartLock, fibs: fibsMgr,
    chart, series: candlestickSeries,
    getSnapTargets: () => fibonacciDrawingTool.getSnapTargets(),
    getShiftDown:  () => fibonacciDrawingTool.getShiftDown(),
    getCtrlDown:   () => fibonacciDrawingTool.getCtrlDown(),
});

// ---------- Long Position tool ----------
const longPositionsMgr = createLongPositionManager(
    chart, candlestickSeries, state, LONG_POSITION_COLOR, ui.requestRedraw
);
const longPositionDrawingTool = createLongPositionTool({
    state, toolBtn: longPositionToolBtn, chart, series: candlestickSeries,
    ui, chartLock, longPositions: longPositionsMgr,
});

createLongPositionInteraction({
    container, state, ui, chartLock, longPositions: longPositionsMgr,
    chart, series: candlestickSeries,
    getSnapTargets: () => longPositionDrawingTool.getSnapTargets(),
    getShiftDown:  () => longPositionDrawingTool.getShiftDown(),
    getCtrlDown:   () => longPositionDrawingTool.getCtrlDown(),
});

// ---------- Cross-tool deactivation ----------
const DRAWING_TOOL_IDS = ['trendline-tool', 'rectangle-tool', 'fibonacci-tool', 'long-position-tool'];

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
        if (activeToolBtn !== longPositionToolBtn && longPositionDrawingTool.isActive()) {
            longPositionDrawingTool.deactivate();
        }
    };
}

trendlineToolBtn.addEventListener('click', deactivateOtherTools(trendlineToolBtn));
rectangleToolBtn.addEventListener('click', deactivateOtherTools(rectangleToolBtn));
fibonacciToolBtn.addEventListener('click', deactivateOtherTools(fibonacciToolBtn));
longPositionToolBtn.addEventListener('click', deactivateOtherTools(longPositionToolBtn));

document.querySelectorAll('.sidebar-btn').forEach(btn => {
    if (DRAWING_TOOL_IDS.includes(btn.id)) return;
    btn.addEventListener('click', () => {
        if (drawingTool.isActive()) drawingTool.deactivate();
        if (rectangleDrawingTool.isActive()) rectangleDrawingTool.deactivate();
        if (fibonacciDrawingTool.isActive()) fibonacciDrawingTool.deactivate();
        if (longPositionDrawingTool.isActive()) longPositionDrawingTool.deactivate();
    });
});

// ---------- Top-level events ----------
chart.subscribeClick((param) => {
    if (longPositionDrawingTool.isActive()) {
        longPositionDrawingTool.handleChartClick(param);
        return;
    }
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

chart.subscribeCrosshairMove((param) => {
    if (longPositionDrawingTool.isActive()) {
        longPositionDrawingTool.handleCrosshairMove(param);
        return;
    }
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

window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
        if (longPositionDrawingTool.isActive()) {
            longPositionDrawingTool.cancelInProgress();
            longPositionDrawingTool.deactivate();
        } else if (fibonacciDrawingTool.isActive()) {
            fibonacciDrawingTool.cancelInProgress();
            fibonacciDrawingTool.deactivate();
        } else if (rectangleDrawingTool.isActive()) {
            rectangleDrawingTool.cancelInProgress();
            rectangleDrawingTool.deactivate();
        } else if (drawingTool.isActive()) {
            drawingTool.cancelInProgress();
            drawingTool.deactivate();
        } else {
            // Clear all selections on Escape
            longPositionsMgr.clearSelection();
            fibsMgr.clearSelection();
            rectanglesMgr.clearSelection();
            trendlines.clearSelection();
        }
    } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
        // Remove all selected primitives (multi-select aware)
        const hasSelection = state.selectedLongPositions.length > 0 || 
                            state.selectedFibs.length > 0 || 
                            state.selectedRectangles.length > 0 || 
                            state.selectedTrendLines.length > 0;
        
        if (hasSelection) {
            // Remove all selected long positions
            [...state.selectedLongPositions].forEach(lp => longPositionsMgr.remove(lp));
            // Remove all selected fibs
            [...state.selectedFibs].forEach(fib => fibsMgr.remove(fib));
            // Remove all selected rectangles
            [...state.selectedRectangles].forEach(rect => rectanglesMgr.remove(rect));
            // Remove all selected trendlines
            [...state.selectedTrendLines].forEach(tl => trendlines.remove(tl));
        }
        ui.requestRedraw();
    }
});

new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
}).observe(container);

console.log('[renderer] ready — click the Trend line, Rectangle, Fibonacci, or Long Position button in the sidebar to start drawing');
