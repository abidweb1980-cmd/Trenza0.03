// Entry point for the renderer process.

import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';
import 'bootstrap-icons/font/bootstrap-icons.min.css';

import { createState, TRENDLINE_COLOR, RECTANGLE_COLOR, FIBONACCI_COLOR, LONG_POSITION_COLOR } from './utils/state.js';
import { createUI } from './utils/ui.js';
import { createChartLock } from './utils/chartLock.js';
import { createPreviewManager } from './utils/previewManager.js';
import { createReplayManager } from './utils/replayManager.js';
import { createReplayUI } from './utils/replayUI.js';
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
const moreBtn = document.getElementById('load-more-btn');

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

// Wire the "More" button to load 1440 more candles.
if (moreBtn) {
    moreBtn.addEventListener('click', () => {
        loadOlderChunk();
    });
}

// ============================================================================
// LAZY-LOADING CHART DATA
// ============================================================================
//
// Simple pagination model:
//   - Initial load: last 1440 candles of the 2025 real-data file.
//   - "More" button: when clicked, loads the previous 1440 candles
//     (still scoped to the same file until the file is exhausted,
//     then the renderer falls back to older files).
//
// The renderer's in-memory `realData` is the source of truth for the
// chart; the main process just returns 1440-candle slices on demand.
// ============================================================================

const FALLBACK_FILE = 'DAT_MT_XAUUSD_M1_2025.json';
const PAGE_SIZE = 1440;
const DUMMY_COUNT_LOCAL = DUMMY_COUNT;
const INITIAL_TARGET_TS = 1753228800000; // 2025-07-23 00:00:00 UTC

const lazyDataState = {
    realData: [],       // current in-memory candles (oldest -> newest)
    isLoading: false,
    hasMore: true,
    currentFile: FALLBACK_FILE,  // file we are currently paging through
    pageCount: 0,                  // number of pages already loaded
    dummyCount: DUMMY_COUNT_LOCAL,
};

initLazyChartData();

async function initLazyChartData() {
    if (!window.electronAPI || !window.electronAPI.getHistoricalChunk) {
        console.error('[renderer] electronAPI.getHistoricalChunk is not available');
        return;
    }

    try {
        const res = await window.electronAPI.getHistoricalChunk({
            targetTimestamp: INITIAL_TARGET_TS,
            fileName: lazyDataState.currentFile,
            limit: PAGE_SIZE,
        });
        lazyDataState.realData = res.chunk || [];
        lazyDataState.hasMore = !!res.hasMore;
        lazyDataState.pageCount = 1;
        applyToChart({ initial: true });
        updateMoreButton();
    } catch (err) {
        console.error('[renderer] lazy init failed:', err);
    }
}

/**
 * Click handler for the "More" button: load the previous 1440 candles
 * from the same file. If that file is exhausted, walk to the next-older
 * file in the index and load from the END of that file.
 */
async function loadOlderChunk() {
    if (lazyDataState.isLoading || !lazyDataState.hasMore) return;
    if (lazyDataState.realData.length === 0) return;

    const oldestTs = lazyDataState.realData[0].timestamp;
    lazyDataState.isLoading = true;
    if (moreBtn) moreBtn.disabled = true;

    try {
        console.log('[renderer] loadOlderChunk: oldestTs=', oldestTs, 'file=', lazyDataState.currentFile);
        const res = await window.electronAPI.getHistoricalChunk({
            targetTimestamp: oldestTs,
            fileName: lazyDataState.currentFile,
            limit: PAGE_SIZE,
        });
        console.log('[renderer] loadOlderChunk: got chunk length=', res?.chunk?.length, 'hasMore=', res?.hasMore, 'first ts=', res?.chunk?.[0]?.timestamp, 'last ts=', res?.chunk?.[res.chunk.length-1]?.timestamp);
        if (!res.chunk || res.chunk.length === 0) {
            // Nothing left in this file. Try to move to the next-older
            // file in the index.
            const nextFile = await pickNextOlderFile(lazyDataState.currentFile);
            if (nextFile) {
                lazyDataState.currentFile = nextFile;
                const head = await window.electronAPI.getHistoricalChunk({
                    targetTimestamp: null,
                    fileName: nextFile,
                    limit: PAGE_SIZE,
                });
                if (head.chunk && head.chunk.length > 0) {
                    lazyDataState.realData = [...head.chunk, ...lazyDataState.realData];
                    lazyDataState.hasMore = !!head.hasMore;
                    lazyDataState.pageCount += 1;
                    applyToChart({ initial: false });
                    return;
                }
            }
            lazyDataState.hasMore = false;
            return;
        }

        // PREPEND the newly fetched older data
        const prevRealLen = lazyDataState.realData.length;
        console.log('[renderer] prepending', res.chunk.length, 'candles. Old realData length:', prevRealLen);
        lazyDataState.realData = [...res.chunk, ...lazyDataState.realData];
        lazyDataState.hasMore = !!res.hasMore;
        lazyDataState.pageCount += 1;
        console.log('[renderer] new realData length:', lazyDataState.realData.length, 'first ts:', lazyDataState.realData[0]?.timestamp, 'last ts:', lazyDataState.realData[lazyDataState.realData.length-1]?.timestamp);

        // If we got back fewer than PAGE_SIZE candles AND hasMore is false,
        // we should also try to move into the next-older file automatically.
        if (res.chunk.length < PAGE_SIZE && !lazyDataState.hasMore) {
            const nextFile = await pickNextOlderFile(lazyDataState.currentFile);
            if (nextFile) {
                lazyDataState.currentFile = nextFile;
                // nothing to load here — user will hit "More" again.
                // (Or we could chain automatically, but keeping it
                // explicit via the button is clearer.)
            }
        }

        applyToChart({ initial: false, prependedCount: res.chunk.length, prevRealLen });
    } catch (err) {
        console.error('[renderer] failed to load older chunk:', err);
    } finally {
        lazyDataState.isLoading = false;
        updateMoreButton();
    }
}

/**
 * Find the file immediately older than `currentFileName` in the real-data
 * index. Returns null if there is no such file or the index isn't loaded.
 */
async function pickNextOlderFile(currentFileName) {
    if (!window.electronAPI.getRealDataInfo) return null;
    try {
        const info = await window.electronAPI.getRealDataInfo();
        if (!info || !Array.isArray(info.files)) return null;
        const sorted = info.files.slice().sort((a, b) => a.firstTimestamp - b.firstTimestamp);
        const idx = sorted.findIndex(f => f.name === currentFileName);
        if (idx < 0 || idx >= sorted.length - 1) return null;
        return sorted[idx + 1].name;
    } catch (_) {
        return null;
    }
}

function updateMoreButton() {
    if (!moreBtn) return;
    moreBtn.disabled = lazyDataState.isLoading || !lazyDataState.hasMore;
    moreBtn.textContent = lazyDataState.hasMore ? '' : ' (no more)';
    // Restore the icon + label
    if (!moreBtn.querySelector('i')) {
        moreBtn.innerHTML = '<i class="bi bi-arrow-left-circle"></i><span>More</span>';
    }
    if (lazyDataState.isLoading) {
        moreBtn.innerHTML = '<i class="bi bi-hourglass-split"></i><span>Loading…</span>';
    } else if (!lazyDataState.hasMore) {
        moreBtn.innerHTML = '<i class="bi bi-arrow-left-circle"></i><span>No more</span>';
    } else {
        moreBtn.innerHTML = '<i class="bi bi-arrow-left-circle"></i><span>More</span>';
    }
}

/**
 * Push the current in-memory dataset to the chart, wrapping it in dummy
 * candles (so trendline endpoints can be placed beyond the real data) and
 * preserving the user's current visible range across prepend operations.
 */
function applyToChart({ initial = false, prependedCount = 0, prevRealLen = null } = {}) {
    try {
    const oldRange = chart.timeScale().getVisibleLogicalRange();
    // If we were given an explicit prependedCount + prevRealLen (the
    // length of realData BEFORE the prepend), use those — they are
    // authoritative. Otherwise fall back to the in-function value.
    const capturedOldRealLen = prevRealLen !== null ? prevRealLen : lazyDataState.realData.length;
    console.log('[renderer] applyToChart: initial=', initial, 'capturedOldRealLen=', capturedOldRealLen, 'oldRange=', JSON.stringify(oldRange), 'prependedCount=', prependedCount);

    const extended = extendWithDummies(lazyDataState.realData, lazyDataState.dummyCount);

    // Dedupe by timestamp and ensure strict ascending order, otherwise
    // Lightweight Charts' setData() throws and the chart goes blank.
    const seenTs = new Set();
    const deduped = [];
    for (const c of extended) {
        if (!c || typeof c.timestamp !== 'number') continue;
        if (seenTs.has(c.timestamp)) continue;
        seenTs.add(c.timestamp);
        deduped.push(c);
    }
    deduped.sort((a, b) => a.timestamp - b.timestamp);

    const formatted = deduped.map(c => ({
        time: c.timestamp / 1000,
        open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    console.log('[renderer] setData: formatted.length=', formatted.length, 'first ts=', formatted[0]?.time, 'last ts=', formatted[formatted.length-1]?.time);
    try {
        candlestickSeries.setData(formatted);
        console.log('[renderer] setData: OK');
    } catch (e) {
        console.error('[renderer] setData threw:', e);
    }

    if (initial) {
        // Fit the view to the loaded chunk
        const realCount = lazyDataState.realData.length;
        const pad = 5;
        const fromIdx = Math.max(0, lazyDataState.dummyCount - pad);
        const toIdx = lazyDataState.dummyCount + realCount - 1 + pad;
        chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: toIdx });
        return;
    }

    if (oldRange) {
        // We just prepended N candles. Shift the visible range LEFT by
        // N so the user actually sees the newly-loaded older data.
        // (prependedCount is set by the caller; for the initial load
        // it stays 0 and we use the dedicated initial branch above.)
        const shift = -prependedCount;
        console.log('[renderer] applyToChart: shifting visible range by', shift, '(prependedCount=', prependedCount, ')');
        try {
            chart.timeScale().setVisibleLogicalRange({
                from: oldRange.from + shift,
                to: oldRange.to + shift,
            });
        } catch (e) {
            console.error('[renderer] setVisibleLogicalRange threw:', e);
        }
    }
    } catch (e) {
        console.error('[renderer] applyToChart threw:', e);
    }
}

const state = createState();
const ui = createUI(chartArea, toolStatus, chart);
const chartLock = createChartLock(chart);

// ---------- Replay functionality ----------
const replayManager = createReplayManager(chart, candlestickSeries);
const replayToolBtn = document.querySelector('button[title="Replay"]');
let replayUI = null;

if (replayToolBtn) {
    replayUI = createReplayUI(replayManager, replayToolBtn);
    replayUI.init();

    replayToolBtn.addEventListener('click', () => {
        if (replayManager.isActive()) {
            replayUI.togglePanel();
        } else {
            replayUI.showPanel();
        }
    });

    replayManager.onStateChangeCallback((newState) => {
        if (newState === 'IDLE') {
            replayUI.hidePanel();
        } else {
            replayUI.showPanel();
        }
    });

    console.log('[renderer] Replay functionality initialized');
    }

    // Keyboard shortcut: Right Arrow to step forward 1 minute (1 candle) in replay mode
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' && replayManager && replayManager.isActive()) {
            console.log('[renderer] ArrowRight pressed - stepping forward, state:', replayManager.getState(), 'buffer:', replayManager.getBufferInfo());
            e.preventDefault();
            e.stopPropagation();
            replayManager.stepForward();
        }
    });

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

// ---------- Single, deduped click / crosshair dispatch ----------
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
if (replayToolBtn) {
    replayToolBtn.addEventListener('click', deactivateOtherTools(replayToolBtn));
}

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
            longPositionsMgr.clearSelection();
            fibsMgr.clearSelection();
            rectanglesMgr.clearSelection();
            trendlines.clearSelection();
        }
    } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
        const hasSelection = state.selectedLongPositions.length > 0 ||
                            state.selectedFibs.length > 0 ||
                            state.selectedRectangles.length > 0 ||
                            state.selectedTrendLines.length > 0;

        if (hasSelection) {
            [...state.selectedLongPositions].forEach(lp => longPositionsMgr.remove(lp));
            [...state.selectedFibs].forEach(fib => fibsMgr.remove(fib));
            [...state.selectedRectangles].forEach(rect => rectanglesMgr.remove(rect));
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
