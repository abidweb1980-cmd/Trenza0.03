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

import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';

import { createState, TRENDLINE_COLOR } from './utils/state.js';
import { createUI } from './utils/ui.js';
import { createChartLock } from './utils/chartLock.js';
import { createPreviewManager } from './utils/previewManager.js';
import { createTrendlineManager } from './utils/trendlineManager.js';
import { createTrendlineTool } from './utils/trendlineTool.js';
import { createTrendlineInteraction } from './utils/trendlineInteraction.js';

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

loadChartData();

async function loadChartData() {
    try {
        const response = await fetch('./src/data/sample.json');
        if (!response.ok) throw new Error(`Failed to load data: ${response.statusText}`);
        const rawData = await response.json();
        const formattedData = rawData.map(candle => ({
            time: candle.timestamp / 1000,
            open: candle.open, high: candle.high, low: candle.low, close: candle.close,
        }));
        candlestickSeries.setData(formattedData);
        chart.timeScale().fitContent();
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
