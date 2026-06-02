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
// The trendline tool itself honours TradingView-style modifier keys:
//   • SHIFT held  →  angle-lock the second anchor to the closest 45°
//   • CTRL  held  →  magnet-snap the second anchor to the nearest
//                    candlestick OHLC value
// (see src/utils/trendlineTool.js + src/utils/chartSnap.js)

import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';

import { createState, TRENDLINE_COLOR } from './utils/state.js';
import { createUI } from './utils/ui.js';
import { createChartLock } from './utils/chartLock.js';
import { createPreviewManager } from './utils/previewManager.js';
import { createTrendlineManager } from './utils/trendlineManager.js';
import { createTrendlineTool } from './utils/trendlineTool.js';
import { createTrendlineInteraction } from './utils/trendlineInteraction.js';
import { extendWithDummies } from './utils/dataExtension.js';

// How many dummy candles to prepend/append so the user can draw
// trendlines outside the real data range.
const DUMMY_COUNT = 300;

// ---------- DOM elements ----------
const container = document.getElementById('chart-container');
const chartArea = document.getElementById('chart-area');
const toolStatus = document.getElementById('tool-status');
const trendlineToolBtn = document.getElementById('trendline-tool');

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

const trendlines = createTrendlineManager(
    chart, candlestickSeries, state, TRENDLINE_COLOR, ui.requestRedraw
);
const preview = createPreviewManager(
    chart, candlestickSeries, state, TRENDLINE_COLOR, ui.requestRedraw
);
const drawingTool = createTrendlineTool({
    state,
    toolBtn: trendlineToolBtn,
    chart,
    series: candlestickSeries,
    ui,
    chartLock,
    preview,
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

// ---------- 3. Wire up top-level events ----------
// Deactivate the drawing tool when any other sidebar button is clicked.
document.querySelectorAll('.sidebar-btn').forEach(btn => {
    if (btn.id === 'trendline-tool') return;
    btn.addEventListener('click', () => drawingTool.deactivate());
});

// Chart click is only consumed in drawing mode.
chart.subscribeClick((param) => drawingTool.handleChartClick(param));

// Crosshair move keeps the preview line tracking the cursor.
// (SHIFT/CTRL snap is handled inside drawingTool.handleCrosshairMove.)
chart.subscribeCrosshairMove((param) => drawingTool.handleCrosshairMove(param));

// Keyboard shortcuts.
window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
        if (drawingTool.isActive()) {
            drawingTool.cancelInProgress();
            drawingTool.deactivate();
        } else if (state.selectedTrendLine) {
            trendlines.clearSelection();
        }
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.selectedTrendLine) {
        trendlines.remove(state.selectedTrendLine);
        ui.requestRedraw();
    }
});

// ---------- 4. Resize observer ----------
new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
}).observe(container);

// eslint-disable-next-line no-console
console.log('[renderer] ready — click the Trend line button (slash icon) to start drawing');
