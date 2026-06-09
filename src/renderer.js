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

const DUMMY_COUNT = 20;

const container = document.getElementById('chart-container');
const chartArea = document.getElementById('chart-area');
const toolStatus = document.getElementById('tool-status');
const trendlineToolBtn = document.getElementById('trendline-tool');
const rectangleToolBtn = document.getElementById('rectangle-tool');
const fibonacciToolBtn = document.getElementById('fibonacci-tool');
const longPositionToolBtn = document.getElementById('long-position-tool');
const moreBtn = document.getElementById('load-more-btn');

// Timeframe UI elements
const timeframeBtn = document.getElementById('timeframe-btn');
const timeframeDropdown = document.getElementById('timeframe-dropdown');
const timeframeLabel = document.getElementById('timeframe-label');
const tfOptions = document.querySelectorAll('.tf-option');

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
// LAZY-LOADING CHART DATA - Multi-Timeframe
// ============================================================================
//
// Architecture:
//  - The current timeframe is stored in `currentTimeframe` (e.g. 'M1', 'H1', 'D1').
//  - On startup, the latest 1440 candles of the active timeframe are loaded.
//  - Switching timeframe: clears the series, requests the new file, applies data.
//  - Drawings are global (absolute time/price) and re-applied after each switch.
// ============================================================================

// Global replay state for synchronization
const replayState = {
    isReplayActive: false,
    currentReplayTimestamp: null,
    currentResolution: 60, // seconds per bar (will be updated based on timeframe)
};

// Timeframe resolution mapping (seconds per bar)
const TIMEFRAME_RESOLUTION = {
    'M1': 60, 'M2': 120, 'M3': 180, 'M5': 300, 'M15': 900, 'M30': 1800,
    'H1': 3600, 'H2': 7200, 'H4': 14400, 'H12': 43200, 'D1': 86400
};

const PAGE_SIZE = 1440;
const DUMMY_COUNT_LOCAL = DUMMY_COUNT;
const INITIAL_TIMEFRAME = 'D1';
const INITIAL_TARGET_TS = null;
const ASSET = 'XAUUSD';

const TF_LABEL = {
    'M1': '1m', 'M2': '2m', 'M3': '3m', 'M5': '5m', 'M15': '15m', 'M30': '30m',
    'H1': '1H', 'H2': '2H', 'H4': '4H', 'H12': '12H', 'D1': '1D'
};

const lazyDataState = {
    realData: [],
    isLoading: false,
    hasMore: true,
    currentTimeframe: INITIAL_TIMEFRAME,
    currentFile: null,
    pageCount: 0,
    dummyCount: DUMMY_COUNT_LOCAL,
    isSwitchingTimeframe: false,
};

// Expose for other modules to access
window.lazyDataState = lazyDataState;

initLazyChartData();

async function initLazyChartData() {
    if (!window.electronAPI || !window.electronAPI.getHistoricalChunk) {
        console.error('[renderer] electronAPI.getHistoricalChunk is not available');
        return;
    }
    try {
        const res = await window.electronAPI.getHistoricalChunk({
            targetTimestamp: INITIAL_TARGET_TS,
            timeframe: lazyDataState.currentTimeframe,
            asset: ASSET,
            limit: PAGE_SIZE,
        });
        lazyDataState.realData = res.chunk || [];
        lazyDataState.hasMore = !!res.hasMore;
        lazyDataState.currentFile = res.fileName || null;
        lazyDataState.pageCount = 1;
        applyToChart({ initial: true });
        updateMoreButton();
        // Load global drawings from main process and apply them
        await loadAndApplyGlobalDrawings();
    } catch (err) {
        console.error('[renderer] lazy init failed:', err);
    }
}

/**
 * Switch to a different timeframe: clear series, request new file, apply data, reapply drawings
 * During active replay, truncates data to current replay timestamp
 */
async function switchTimeframe(newTimeframe) {
    if (newTimeframe === lazyDataState.currentTimeframe) {
        // Close the dropdown
        if (timeframeDropdown) timeframeDropdown.classList.remove('open');
        return;
    }
    if (lazyDataState.isSwitchingTimeframe) return;
    lazyDataState.isSwitchingTimeframe = true;

    // Update the label
    if (timeframeLabel) timeframeLabel.textContent = TF_LABEL[newTimeframe] || newTimeframe;
    if (tfOptions) {
        tfOptions.forEach(o => o.classList.toggle('active', o.dataset.tf === newTimeframe));
    }
    if (timeframeDropdown) timeframeDropdown.classList.remove('open');

    console.log('[renderer] switching timeframe to', newTimeframe);

    // Update current resolution
    replayState.currentResolution = TIMEFRAME_RESOLUTION[newTimeframe] || 60;

    // 1. Save current drawings to the global store before switching
    await saveAllDrawingsToMain();

    // 2. Clear the current chart series
    try {
        candlestickSeries.setData([]);
    } catch (e) {
        console.warn('[renderer] clear setData:', e);
    }

    // 3. Reset state for the new timeframe
    lazyDataState.realData = [];
    lazyDataState.hasMore = true;
    lazyDataState.pageCount = 0;
    lazyDataState.currentTimeframe = newTimeframe;
    lazyDataState.currentFile = null;

    // 4. Fetch data - during replay, truncate to current replay timestamp
    try {
        const requestParams = {
            timeframe: newTimeframe,
            asset: ASSET,
            limit: PAGE_SIZE,
        };

        // If replay is active, get truncated data using the dedicated handler
        const currentTs = getCurrentReplayTimestamp();
        if (isReplayActive() && currentTs) {
            console.log('[renderer] Getting truncated data for timeframe:', newTimeframe, 'maxTimestamp:', currentTs);
            const res = await window.replayAPI.getTruncatedData({
                timeframe: newTimeframe,
                maxTimestamp: currentTs,
                limit: PAGE_SIZE,
            });
            lazyDataState.realData = res || [];
            lazyDataState.hasMore = false; // Don't allow loading more during replay
            lazyDataState.currentFile = null;
            lazyDataState.pageCount = 1;
        } else {
            // Normal data fetch
            const res = await window.electronAPI.getHistoricalChunk(requestParams);
            lazyDataState.realData = res.chunk || [];
            lazyDataState.hasMore = !!res.hasMore;
            lazyDataState.currentFile = res.fileName || null;
            lazyDataState.pageCount = 1;
        }

        // 5. Apply new data to the chart
        applyToChart({ initial: true });
        updateMoreButton();

        // 6. Re-apply all global drawings (they use absolute time/price)
        await applyGlobalDrawingsToChart();
    } catch (err) {
        console.error('[renderer] switchTimeframe failed:', err);
    } finally {
        lazyDataState.isSwitchingTimeframe = false;
    }
}

/**
 * Sync replay state from main process
 */
async function syncReplayState() {
    if (!window.electronAPI || !window.electronAPI.getReplayState) return;
    try {
        const state = await window.electronAPI.getReplayState();
        replayState.isReplayActive = state.isPlaying;
        replayState.currentReplayTimestamp = state.currentReplayTimestamp;
        replayState.currentResolution = TIMEFRAME_RESOLUTION[lazyDataState.currentTimeframe] || 60;
        console.log('[renderer] Synced replay state:', state);
    } catch (err) {
        console.error('[renderer] Failed to sync replay state:', err);
    }
}

/**
 * Update local replay state from tick
 */
function updateReplayStateFromTick(candle) {
    replayState.currentReplayTimestamp = candle.timestamp;
    replayState.currentResolution = TIMEFRAME_RESOLUTION[lazyDataState.currentTimeframe] || 60;
}

/**
 * Get current replay timestamp (for timeframe switching)
 */
function getCurrentReplayTimestamp() {
    // First check local state
    if (replayState.currentReplayTimestamp) {
        return replayState.currentReplayTimestamp;
    }
    // Fallback to replayManager state
    if (replayManager && typeof replayManager.getReplayInfo === 'function') {
        const info = replayManager.getReplayInfo();
        return info.startTimestamp;
    }
    return null;
}

/**
 * Check if replay is currently active
 */
function isReplayActive() {
    return replayState.isReplayActive || (replayManager && replayManager.isActive());
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
        const res = await window.electronAPI.getHistoricalChunk({
            targetTimestamp: oldestTs,
            timeframe: lazyDataState.currentTimeframe,
            asset: ASSET,
            limit: PAGE_SIZE,
        });
        if (!res.chunk || res.chunk.length === 0) {
            // Try other timeframes files in chronological order
            const nextFile = await pickNextOlderFileForTimeframe(lazyDataState.currentTimeframe);
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
        lazyDataState.realData = [...res.chunk, ...lazyDataState.realData];
        lazyDataState.hasMore = !!res.hasMore;
        lazyDataState.pageCount += 1;
        applyToChart({ initial: false, prependedCount: res.chunk.length, prevRealLen });
    } catch (err) {
        console.error('[renderer] failed to load older chunk:', err);
    } finally {
        lazyDataState.isLoading = false;
        updateMoreButton();
    }
}

async function pickNextOlderFileForTimeframe(tf) {
    if (!window.electronAPI.getRealDataInfo) return null;
    try {
        const info = await window.electronAPI.getRealDataInfo();
        if (!info || !Array.isArray(info.files)) return null;
        // Only consider files for the current timeframe, sorted ascending by first timestamp
        const sameTf = info.files.filter(f => f.timeframe === tf).sort((a, b) => a.firstTimestamp - b.firstTimestamp);
        if (sameTf.length === 0) return null;
        const idx = lazyDataState.currentFile ? sameTf.findIndex(f => f.name === lazyDataState.currentFile) : -1;
        if (idx < 0 || idx >= sameTf.length - 1) return null;
        return sameTf[idx + 1].name;
    } catch (_) {
        return null;
    }
}

function updateMoreButton() {
    if (!moreBtn) return;
    moreBtn.disabled = lazyDataState.isLoading || !lazyDataState.hasMore;
    moreBtn.textContent = lazyDataState.hasMore ? '' : ' (no more)';
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
    const capturedOldRealLen = prevRealLen !== null ? prevRealLen : lazyDataState.realData.length;

    const extended = extendWithDummies(lazyDataState.realData, lazyDataState.dummyCount);

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

    try {
        candlestickSeries.setData(formatted);
    } catch (e) {
        console.error('[renderer] setData threw:', e);
    }

    if (initial) {
        const realCount = lazyDataState.realData.length;
        const pad = 5;
        const fromIdx = Math.max(0, lazyDataState.dummyCount - pad);
        const toIdx = lazyDataState.dummyCount + realCount - 1 + pad;
        chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: toIdx });
        return;
    }

    if (oldRange) {
        const shift = -prependedCount;
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
state.currentTimeframe = lazyDataState.currentTimeframe;
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

    const unsubscribeTick = window.replayAPI.onTick((candle) => {
        replayManager.handleTick(candle);
        updateReplayStateFromTick(candle);
    });
}

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

// ============================================================================
// CENTRALIZED DRAWING STORE - SYNCING LOGIC
// ============================================================================
//
// Drawings use absolute Unix timestamps (ms) and absolute prices so they are
// globally independent of any specific timeframe. They are mirrored to the
// main process's `globalDrawings` array via `save-drawings`, and re-applied
// on load or on timeframe switch via `get-drawings`.
// ============================================================================

/**
 * Collect all current drawings from the various manager arrays in `state`,
 * normalize them to { type, time1, time2, price1, price2, color, ... }
 * using ABSOLUTE Unix timestamps (ms) and ABSOLUTE prices.
 */
function collectAllDrawings() {
    const all = [];

    // Trendlines
    if (state.trendLines) {
        for (const tl of state.trendLines) {
            if (!tl || !tl.p1 || !tl.p2) continue;
            const t1 = typeof tl.p1.time === 'number' && tl.p1.time < 1e12 ? tl.p1.time * 1000 : tl.p1.time;
            const t2 = typeof tl.p2.time === 'number' && tl.p2.time < 1e12 ? tl.p2.time * 1000 : tl.p2.time;
            all.push({
                type: 'trendline',
                time1: t1,
                price1: tl.p1.price,
                time2: t2,
                price2: tl.p2.price,
                color: tl.color || TRENDLINE_COLOR,
            });
        }
    }

    // Rectangles
    if (state.rectangles) {
        for (const r of state.rectangles) {
            if (!r || !r.p1 || !r.p2) continue;
            const t1 = typeof r.p1.time === 'number' && r.p1.time < 1e12 ? r.p1.time * 1000 : r.p1.time;
            const t2 = typeof r.p2.time === 'number' && r.p2.time < 1e12 ? r.p2.time * 1000 : r.p2.time;
            all.push({
                type: 'rectangle',
                time1: t1,
                price1: r.p1.price,
                time2: t2,
                price2: r.p2.price,
                color: r.color || RECTANGLE_COLOR,
            });
        }
    }

    // Fibonacci
    if (state.fibs) {
        for (const f of state.fibs) {
            if (!f || !f.p1 || !f.p2) continue;
            const t1 = typeof f.p1.time === 'number' && f.p1.time < 1e12 ? f.p1.time * 1000 : f.p1.time;
            const t2 = typeof f.p2.time === 'number' && f.p2.time < 1e12 ? f.p2.time * 1000 : f.p2.time;
            all.push({
                type: 'fibonacci',
                time1: t1,
                price1: f.p1.price,
                time2: t2,
                price2: f.p2.price,
                color: f.color || FIBONACCI_COLOR,
                direction: f.direction || 'up',
                levels: f.levels || null,
            });
        }
    }

    // Long Positions
    if (state.longPositions) {
        for (const lp of state.longPositions) {
            if (!lp || !lp.entry || !lp.stopLoss || !lp.takeProfit) continue;
            const tEntry = typeof lp.entry.time === 'number' && lp.entry.time < 1e12 ? lp.entry.time * 1000 : lp.entry.time;
            all.push({
                type: 'longposition',
                time1: tEntry,
                price1: lp.entry.price,
                time2: tEntry,
                price2: lp.takeProfit.price,
                stopLoss: lp.stopLoss.price,
                riskRewardRatio: lp.riskRewardRatio || 2,
                color: lp.color || LONG_POSITION_COLOR,
            });
        }
    }

    return all;
}

/**
 * Save all current drawings to the main process's `globalDrawings` store
 * via the `save-drawings` IPC handler.
 */
async function saveAllDrawingsToMain() {
    if (!window.electronAPI || !window.electronAPI.saveDrawings) return;
    try {
        const all = collectAllDrawings();
        const result = await window.electronAPI.saveDrawings(all);
        console.log('[renderer] saveAllDrawingsToMain:', result);
    } catch (err) {
        console.error('[renderer] saveAllDrawingsToMain error:', err);
    }
}

/**
 * Remove every drawing from the chart (in-memory and from the series primitives)
 * before re-applying them on a different timeframe.
 */
function clearAllChartDrawings() {
    if (state.trendLines) state.trendLines.length = 0;
    if (state.rectangles) state.rectangles.length = 0;
    if (state.fibs) state.fibs.length = 0;
    if (state.longPositions) state.longPositions.length = 0;
    if (state.selectedTrendLines) state.selectedTrendLines.length = 0;
    if (state.selectedRectangles) state.selectedRectangles.length = 0;
    if (state.selectedFibs) state.selectedFibs.length = 0;
    if (state.selectedLongPositions) state.selectedLongPositions.length = 0;
    state.selectedTrendLine = null;
    // Detach all primitives from the series
    try {
        const prims = candlestickSeries._primitives || [];
        for (const p of prims) {
            try { candlestickSeries.detachPrimitive(p); } catch (_) {}
        }
        candlestickSeries._primitives = [];
    } catch (_) { /* not exposed; ignore */ }
    // Clear any internal previews
    state.previewTrendLine = null;
    state.previewRectangle = null;
    state.previewFib = null;
}

/**
 * Apply drawings from the main process to the chart, using absolute timestamps
 * and prices. Works for any timeframe because the coordinates are not bound
 * to bar indices.
 */
function applyDrawingsToChart(drawings) {
    if (!Array.isArray(drawings)) return;
    for (const d of drawings) {
        if (!d || !d.type) continue;
        // Normalize time: if it looks like seconds (<1e12) convert to ms
        const t1 = (typeof d.time1 === 'number' && d.time1 < 1e12) ? d.time1 * 1000 : d.time1;
        const t2 = (typeof d.time2 === 'number' && d.time2 < 1e12) ? d.time2 * 1000 : d.time2;
        if (t1 == null || t2 == null) continue;
        try {
            if (d.type === 'trendline') {
                trendlines.create({ time: t1, price: d.price1 }, { time: t2, price: d.price2 });
            } else if (d.type === 'rectangle') {
                rectanglesMgr.create({ time: t1, price: d.price1 }, { time: t2, price: d.price2 });
            } else if (d.type === 'fibonacci') {
                fibsMgr.create({ time: t1, price: d.price1 }, { time: t2, price: d.price2 }, d.direction);
            } else if (d.type === 'longposition') {
                longPositionsMgr.create({ time: t1, price: d.price1 }, d.stopLoss, d.price2, d.riskRewardRatio || 2);
            }
        } catch (err) {
            console.error('[renderer] failed to apply drawing:', d, err);
        }
    }
    ui.requestRedraw();
}

/**
 * Fetch all drawings from the main process and apply them to the chart.
 * Called on initial load and after each timeframe switch.
 */
async function loadAndApplyGlobalDrawings() {
    if (!window.electronAPI || !window.electronAPI.getDrawings) return;
    try {
        const drawings = await window.electronAPI.getDrawings();
        console.log('[renderer] loaded', (drawings || []).length, 'drawings from main');
        clearAllChartDrawings();
        applyDrawingsToChart(drawings || []);
    } catch (err) {
        console.error('[renderer] loadAndApplyGlobalDrawings error:', err);
    }
}

async function applyGlobalDrawingsToChart() {
    await loadAndApplyGlobalDrawings();
}

// ---------- Single, deduped click / crosshair dispatch ----------
chart.subscribeClick((param) => {
    if (longPositionDrawingTool.isActive()) {
        longPositionDrawingTool.handleChartClick(param);
        // After drawing, save the new drawing to the main store
        saveAllDrawingsToMain();
        return;
    }
    if (fibonacciDrawingTool.isActive()) {
        fibonacciDrawingTool.handleChartClick(param);
        saveAllDrawingsToMain();
        return;
    }
    if (rectangleDrawingTool.isActive()) {
        rectangleDrawingTool.handleChartClick(param);
        saveAllDrawingsToMain();
        return;
    }
    drawingTool.handleChartClick(param);
    // After clicking, persist
    saveAllDrawingsToMain();
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

// ---------- Timeframe UI ----------
if (timeframeBtn) {
    timeframeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (timeframeDropdown) timeframeDropdown.classList.toggle('open');
    });
}
if (tfOptions) {
    tfOptions.forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const tf = opt.dataset.tf;
            if (tf) switchTimeframe(tf);
        });
    });
}
// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (timeframeDropdown && timeframeDropdown.classList.contains('open')) {
        if (e.target !== timeframeBtn && !timeframeDropdown.contains(e.target) && e.target !== timeframeLabel) {
            timeframeDropdown.classList.remove('open');
        }
    }
});
// Mark the initial active option
if (tfOptions) {
    tfOptions.forEach(o => o.classList.toggle('active', o.dataset.tf === INITIAL_TIMEFRAME));
}

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
        // Persist updated drawings
        saveAllDrawingsToMain();
    }
});

new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
}).observe(container);

console.log('[renderer] ready — multi-timeframe & global drawing sync enabled');
