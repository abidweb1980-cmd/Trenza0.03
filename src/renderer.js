// src/renderer.js
import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';
import { NativeTrendLine } from './utils/Trendline.js';

const container = document.getElementById('chart-container');
const chartArea = document.getElementById('chart-area');
const toolStatus = document.getElementById('tool-status');
const trendlineToolBtn = document.getElementById('trendline-tool');

// ========================================================
// 1. Initialize the chart
// ========================================================
const chart = createChart(container, {
    layout: { background: { color: '#1a1a1a' }, textColor: '#e1e1e1' },
    grid: { vertLines: { color: '#2b2b2b' }, horzLines: { color: '#2b2b2b' } },
    timeScale: { timeVisible: true, secondsVisible: false },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#9e9e9e', width: 1, style: 0 }, horzLine: { color: '#9e9e9e', width: 1, style: 0 } },
    // Mouse-wheel zoom and drag-pan enabled by default
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
});

const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350',
    borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});

// Load your local candle data format
async function loadChartData() {
    try {
        const response = await fetch('./src/data/sample.json');
        if (!response.ok) throw new Error(`Failed to load data: ${response.statusText}`);
        const rawData = await response.json();
        const formattedData = rawData.map(candle => ({
            time: candle.timestamp / 1000,
            open: candle.open, high: candle.high, low: candle.low, close: candle.close
        }));
        candlestickSeries.setData(formattedData);
        chart.timeScale().fitContent();
    } catch (error) {
        console.error('Error loading chart candles:', error);
    }
}
loadChartData();

// ========================================================
// 2. TRENDLINE STATE
// ========================================================
const TRENDLINE_COLOR = '#ffeb3b';

const state = {
    // 'idle' - no tool active, can select existing trendlines
    // 'drawing' - trendline tool active, click to place p1 then p2
    mode: 'idle',

    // Drawing in progress
    drawingFirstPoint: null,   // { time, price } or null

    // Currently selected trendline
    selectedTrendLine: null,

    // All trendlines currently on the chart
    trendLines: [],

    // Drag state: null | { trendLine, target: 'p1'|'p2'|'line', startX, startY }
    drag: null,
};

// ========================================================
// 3. UI HELPERS
// ========================================================
function showStatus(message) {
    if (!toolStatus) return;
    toolStatus.textContent = message;
    toolStatus.classList.add('visible');
}

function hideStatus() {
    if (!toolStatus) return;
    toolStatus.classList.remove('visible');
}

function setChartCursor(cursorClass) {
    if (!chartArea) return;
    chartArea.classList.remove('cursor-crosshair', 'cursor-pointer', 'cursor-grab', 'cursor-grabbing', 'cursor-default');
    if (cursorClass) chartArea.classList.add(cursorClass);
}

function requestRedraw() {
    try { chart.timeScale().applyOptions({}); } catch (_) { /* no-op */ }
}

// ========================================================
// 3b. CHART LOCK / UNLOCK
// While drawing a trendline or dragging an existing one we
// disable scrolling, scaling and dragging on the time-scale
// so the user's clicks/drag operate on the trendline, not
// on the chart itself.
// ========================================================
let chartLocked = false;
let lockReferenceCount = 0; // allows multiple concurrent locks (drawing + dragging)

function lockChart() {
    lockReferenceCount += 1;
    if (chartLocked) return;
    chartLocked = true;
    try {
        chart.applyOptions({
            handleScroll: false,
            handleScale: false,
        });
        chart.timeScale().applyOptions({
            handleScroll: false,
            handleScale: false,
        });
    } catch (e) {
        console.warn('lockChart failed:', e);
    }
}

function unlockChart() {
    lockReferenceCount = Math.max(0, lockReferenceCount - 1);
    if (!chartLocked || lockReferenceCount > 0) return;
    chartLocked = false;
    try {
        chart.applyOptions({
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });
        chart.timeScale().applyOptions({
            handleScroll: true,
            handleScale: true,
        });
    } catch (e) {
        console.warn('unlockChart failed:', e);
    }
}

function forceUnlockChart() {
    lockReferenceCount = 0;
    chartLocked = false;
    try {
        chart.applyOptions({
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });
        chart.timeScale().applyOptions({
            handleScroll: true,
            handleScale: true,
        });
    } catch (e) {
        console.warn('forceUnlockChart failed:', e);
    }
}

// ========================================================
// 4. TRENDLINE TOOL ACTIVATION / DEACTIVATION
// ========================================================
function activateTrendlineTool() {
    state.mode = 'drawing';
    state.drawingFirstPoint = null;
    state.selectedTrendLine = null;
    trendlineToolBtn.classList.add('active');
    setChartCursor('cursor-crosshair');
    showStatus('Trendline tool active — click on the chart to place the first point');
    // Lock the chart so clicks/drag don't pan/zoom the chart
    lockChart();
    requestRedraw();
}

function deactivateTrendlineTool() {
    state.mode = 'idle';
    state.drawingFirstPoint = null;
    trendlineToolBtn.classList.remove('active');
    setChartCursor('cursor-default');
    hideStatus();
    // Unlock the chart now that the drawing tool is no longer active
    forceUnlockChart();
    requestRedraw();
}

function toggleTrendlineTool() {
    if (state.mode === 'drawing') deactivateTrendlineTool();
    else activateTrendlineTool();
}

// ========================================================
// 5. SIDEBAR TOOL BUTTON WIRING
// ========================================================
trendlineToolBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTrendlineTool();
});

// Deactivate tool when other sidebar buttons (except trendline) are clicked
document.querySelectorAll('.sidebar-btn').forEach(btn => {
    if (btn.id === 'trendline-tool') return;
    btn.addEventListener('click', () => {
        if (state.mode === 'drawing') deactivateTrendlineTool();
    });
});

// ========================================================
// 6. CHART CLICK HANDLER — place trendline endpoints
// ========================================================
chart.subscribeClick((param) => {
    if (!param.time || !param.point) return;
    if (state.mode !== 'drawing') return;

    // Convert pixel point to (time, price)
    const clickedPrice = candlestickSeries.coordinateToPrice(param.point.y);
    const clickedTime = param.time;

    if (!state.drawingFirstPoint) {
        // First click: store p1
        state.drawingFirstPoint = { time: clickedTime, price: clickedPrice };
        showStatus('First point set — click again to place the second point');
    } else {
        // Second click: create the trendline
        const p1 = state.drawingFirstPoint;
        const p2 = { time: clickedTime, price: clickedPrice };

        const trendLine = new NativeTrendLine(
            chart, candlestickSeries, p1, p2, TRENDLINE_COLOR,
            (tl) => { /* onChange */ requestRedraw(); },
            (tl) => { /* onSelect */ selectTrendLine(tl); }
        );

        candlestickSeries.attachPrimitive(trendLine);
        state.trendLines.push(trendLine);

        // Auto-select the newly created line
        selectTrendLine(trendLine);

        // Reset drawing state, but keep tool active so user can draw more
        state.drawingFirstPoint = null;
        showStatus('Trendline created — click to draw another, or press Esc to exit');
    }
});

// ========================================================
// 7. SELECTION MANAGEMENT
// ========================================================
function selectTrendLine(tl) {
    if (state.selectedTrendLine && state.selectedTrendLine !== tl) {
        state.selectedTrendLine.setSelected(false);
    }
    state.selectedTrendLine = tl;
    if (tl) tl.setSelected(true);
}

function clearSelection() {
    if (state.selectedTrendLine) {
        state.selectedTrendLine.setSelected(false);
        state.selectedTrendLine = null;
    }
}

// Hit-test a pixel point against all trendlines. Returns
// { trendLine, target: 'p1'|'p2'|'line' } or null
function hitTestTrendLines(px, py) {
    // Iterate in reverse so the most recently added line wins
    for (let i = state.trendLines.length - 1; i >= 0; i--) {
        const tl = state.trendLines[i];
        const target = tl.hitTest(px, py);
        if (target) return { trendLine: tl, target };
    }
    return null;
}

// ========================================================
// 8. MOUSE TRACKING — hover, drag endpoints, drag line
// ========================================================
let hoverHit = null; // last known hit under cursor

function getMousePixelOnChart(evt) {
    const rect = container.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top, rect };
}

container.addEventListener('mousedown', (evt) => {
    if (state.mode !== 'idle') return; // drawing mode handled by subscribeClick
    if (evt.button !== 0) return;

    const { x, y } = getMousePixelOnChart(evt);
    const hit = hitTestTrendLines(x, y);
    if (!hit) {
        // Clicked empty chart area: clear selection
        clearSelection();
        return;
    }

    // Select the trendline
    selectTrendLine(hit.trendLine);

    // Begin drag
    state.drag = {
        trendLine: hit.trendLine,
        target: hit.target,
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
    };

    // Lock the chart so dragging the endpoint doesn't pan/zoom the chart
    lockChart();
    setChartCursor('cursor-grabbing');
});

container.addEventListener('mousemove', (evt) => {
    const { x, y } = getMousePixelOnChart(evt);

    // Update hover state
    const hit = hitTestTrendLines(x, y);
    hoverHit = hit;

    // Update per-line hover flag for the line under the cursor
    state.trendLines.forEach(tl => tl.setHovering(false));
    if (hit) hit.trendLine.setHovering(true);

    // ---- Update cursor based on current state ----
    if (state.drag) {
        // We are currently dragging
        const d = state.drag;
        const dx = x - d.lastX;
        const dy = y - d.lastY;
        d.lastX = x;
        d.lastY = y;

        if (d.target === 'p1' || d.target === 'p2') {
            d.trendLine.movePointToPixel(d.target, x, y);
        } else if (d.target === 'line') {
            d.trendLine.translateByPixel(dx, dy);
        }
        setChartCursor('cursor-grabbing');
        return;
    }

    if (state.mode === 'drawing') {
        setChartCursor('cursor-crosshair');
        return;
    }

    // Idle mode: set cursor based on what's under the cursor
    if (!hit) {
        setChartCursor('cursor-default');
    } else if (hit.target === 'p1' || hit.target === 'p2') {
        setChartCursor('cursor-grab');
    } else if (hit.target === 'line') {
        setChartCursor('cursor-grab');
    } else {
        setChartCursor('cursor-default');
    }
});

window.addEventListener('mouseup', (evt) => {
    if (!state.drag) return;
    state.drag = null;
    // Unlock the chart now that dragging has ended
    unlockChart();
    setChartCursor('cursor-default');
});

// Prevent text selection while dragging
container.addEventListener('dragstart', (e) => e.preventDefault());

// ========================================================
// 9. KEYBOARD — Esc to exit drawing mode, Delete to remove
// ========================================================
window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
        if (state.mode === 'drawing') {
            deactivateTrendlineTool();
        } else if (state.selectedTrendLine) {
            clearSelection();
        }
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.selectedTrendLine) {
        // Optional: remove selected trendline
        const tl = state.selectedTrendLine;
        const idx = state.trendLines.indexOf(tl);
        if (idx !== -1) state.trendLines.splice(idx, 1);
        // Note: lightweight-charts v5 doesn't expose a clean detach API for
        // attached primitives; for full removal the chart would need to be
        // re-created. We at least clear the visual state.
        state.selectedTrendLine = null;
        requestRedraw();
    }
});

// ========================================================
// 10. AUTOMATIC RESIZING
// ========================================================
const resizeObserver = new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
});
resizeObserver.observe(container);
