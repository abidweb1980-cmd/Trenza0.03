const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { createInterface } = require('readline');

const DATA_DIR = path.join(__dirname, 'src', 'data');
const DATA_FILES = [
    path.join(DATA_DIR, 'sample.json'),
    path.join(DATA_DIR, 'sample2.json'),
];

const REAL_DATA_DIR = path.join(DATA_DIR, 'real');

let fileRanges = [];

function buildFileIndex() {
    fileRanges = [];
    for (const file of DATA_FILES) {
        if (!fs.existsSync(file)) continue;
        const stat = fs.statSync(file);
        fileRanges.push({ file, size: stat.size });
    }
}

buildFileIndex();

async function* streamCandles(filePath, startTimestamp) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    let buf = '';
    let inObj = false;
    let depth = 0;

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line === '[' || line === ']' || line === '') continue;

        for (const ch of line) {
            if (ch === '{') { depth++; inObj = true; }
            else if (ch === '}') depth--;
        }

        buf += rawLine + '\n';

        if (inObj && depth === 0) {
            const clean = buf.trim().replace(/,\s*$/, '');
            try {
                const obj = JSON.parse(clean);
                if (obj.timestamp >= startTimestamp) {
                    yield obj;
                }
            } catch (_) { }
            buf = '';
            inObj = false;
        }
    }
}

async function* streamAllCandles(startTimestamp) {
    for (const { file } of fileRanges) {
        yield* streamCandles(file, startTimestamp);
    }
}

ipcMain.handle('replay:get-data-info', async () => {
    let totalBars = 0;
    let minTimestamp = Infinity;
    let maxTimestamp = -Infinity;

    for (const file of DATA_FILES) {
        if (!fs.existsSync(file)) continue;
        const rl = createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
        for await (const line of rl) {
            const trimmed = line.trim();
            if (trimmed.startsWith('{')) {
                try {
                    const obj = JSON.parse(trimmed);
                    totalBars++;
                    if (obj.timestamp < minTimestamp) minTimestamp = obj.timestamp;
                    if (obj.timestamp > maxTimestamp) maxTimestamp = obj.timestamp;
                } catch (_) { }
            }
        }
    }

    return {
        totalBars,
        minTimestamp: isFinite(minTimestamp) ? minTimestamp : null,
        maxTimestamp: isFinite(maxTimestamp) ? maxTimestamp : null,
    };
});

ipcMain.handle('replay:get-data-before', async (event, { endTimestamp }) => {
    const results = [];
    for (const file of DATA_FILES) {
        if (!fs.existsSync(file)) continue;
        const rl = createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
        for await (const line of rl) {
            const trimmed = line.trim();
            if (trimmed.startsWith('{')) {
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.timestamp < endTimestamp) results.push(obj);
                } catch (_) { }
            }
        }
    }
    results.sort((a, b) => a.timestamp - b.timestamp);
    return results;
});

ipcMain.handle('replay:start-stream', async (event, { startTimestamp, chunkSize = 500 }) => {
    const replayId = `replay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const iterator = streamAllCandles(startTimestamp);
    const firstChunk = [];
    for (let i = 0; i < chunkSize; i++) {
        const { value, done } = await iterator.next();
        if (done) break;
        firstChunk.push(value);
    }
    replayIterators.set(replayId, { iterator, chunkSize, startTimestamp });
    return { replayId, totalBars: firstChunk.length, chunk: firstChunk, hasMore: true };
});

ipcMain.handle('replay:request-chunk', async (event, { replayId }) => {
    const entry = replayIterators.get(replayId);
    if (!entry) return { chunk: [], hasMore: false };
    const { iterator, chunkSize } = entry;
    const chunk = [];
    for (let i = 0; i < chunkSize; i++) {
        const { value, done } = await iterator.next();
        if (done) { replayIterators.delete(replayId); return { chunk, hasMore: false }; }
        chunk.push(value);
    }
    return { chunk, hasMore: true };
});

ipcMain.handle('replay:stop-stream', (event, { replayId }) => {
    const deleted = replayIterators.delete(replayId);
    return { success: deleted };
});

const replayIterators = new Map();

let realDataIndex = [];
let globalDrawings = [];

function normalizeTimeframe(tf) {
    if (!tf) return null;
    const upper = tf.toUpperCase();
    const map = {
        '1M': 'M1', 'M1': 'M1', '2M': 'M2', 'M2': 'M2', '3M': 'M3', 'M3': 'M3',
        '5M': 'M5', 'M5': 'M5', '15M': 'M15', 'M15': 'M15', '30M': 'M30', 'M30': 'M30',
        '1H': 'H1', 'H1': 'H1', '2H': 'H2', 'H2': 'H2', '4H': 'H4', 'H4': 'H4',
        '12H': 'H12', 'H12': 'H12', '1D': 'D1', 'D1': 'D1',
    };
    return map[upper] || upper;
}

function findFileForTimeframe(timeframe, asset = 'XAUUSD') {
    const normalizedTf = normalizeTimeframe(timeframe);
    if (!normalizedTf) return null;
    const expectedName = `DAT_MT_${asset}_${normalizedTf}_2025.json`;
    return realDataIndex.find(e => e.name === expectedName) || null;
}

async function readCandlesBefore(filePath, endTimestamp, limit) {
    const rl = createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    let buf = ''; let depth = 0; let inObj = false; let firstTs = null;
    const window = new Array(limit).fill(null);
    let windowSize = 0; let windowStart = 0;
    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;
            for (const ch of line) { if (ch === '{') { depth++; inObj = true; } else if (ch === '}') depth--; }
            buf += rawLine + '\n';
            if (inObj && depth === 0) {
                const clean = buf.trim().replace(/,\s*$/, '');
                try {
                    const obj = JSON.parse(clean);
                    if (firstTs === null) { firstTs = obj.timestamp; if (firstTs >= endTimestamp) return []; }
                    if (obj.timestamp < endTimestamp) { window[windowStart] = obj; windowStart = (windowStart + 1) % limit; if (windowSize < limit) windowSize++; }
                } catch (_) { }
                buf = ''; inObj = false;
            }
        }
    } catch (err) { console.error('[main] readCandlesBefore stream error:', err); }
    const result = [];
    if (windowSize === limit) { for (let i = 0; i < limit; i++) { const idx = (windowStart + i) % limit; result.push(window[idx]); } }
    else { for (let i = 0; i < windowSize; i++) { result.push(window[i]); } }
    return result;
}

async function readLastCandles(filePath, limit) {
    const rl = createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    let buf = ''; let depth = 0; let inObj = false;
    const window = new Array(limit).fill(null);
    let windowSize = 0; let windowStart = 0;
    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;
            for (const ch of line) { if (ch === '{') { depth++; inObj = true; } else if (ch === '}') depth--; }
            buf += rawLine + '\n';
            if (inObj && depth === 0) {
                const clean = buf.trim().replace(/,\s*$/, '');
                try { const obj = JSON.parse(clean); window[windowStart] = obj; windowStart = (windowStart + 1) % limit; if (windowSize < limit) windowSize++; } catch (_) { }
                buf = ''; inObj = false;
            }
        }
    } catch (err) { console.error('[main] readLastCandles stream error:', err); }
    const result = [];
    if (windowSize === limit) { for (let i = 0; i < limit; i++) { const idx = (windowStart + i) % limit; result.push(window[idx]); } }
    else { for (let i = 0; i < windowSize; i++) { result.push(window[i]); } }
    return result;
}

async function readAllCandles(filePath) {
    const rl = createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    const candles = []; let buf = ''; let depth = 0; let inObj = false;
    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;
            for (const ch of line) { if (ch === '{') { depth++; inObj = true; } else if (ch === '}') depth--; }
            buf += rawLine + '\n';
            if (inObj && depth === 0) { const clean = buf.trim().replace(/,\s*$/, ''); try { const obj = JSON.parse(clean); candles.push(obj); } catch (_) { } buf = ''; inObj = false; }
        }
    } catch (err) { console.error('[main] readAllCandles stream error:', err); }
    return candles;
}

async function getLastTimestampFromFile(filePath) {
    const rl = createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    let buf = ''; let depth = 0; let inObj = false; let lastTs = null;
    try {
        for (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;
            for (const ch of line) { if (ch === '{') { depth++; inObj = true; } else if (ch === '}') depth--; }
            buf += rawLine + '\n';
            if (inObj && depth === 0) { const clean = buf.trim().replace(/,\s*$/, ''); try { const obj = JSON.parse(clean); lastTs = obj.timestamp; } catch (_) { } buf = ''; inObj = false; }
        }
    } catch (err) { console.error('[main] getLastTimestampFromFile stream error:', err); }
    return lastTs;
}

function mergeSortedAsc(a, b) {
    const result = []; let i = 0, j = 0;
    while (i < a.length && j < b.length) { if (a[i].timestamp <= b[j].timestamp) { result.push(a[i++]); } else { result.push(b[j++]); } }
    while (i < a.length) result.push(a[i++]);
    while (j < b.length) result.push(b[j++]);
    return result;
}

async function buildRealDataIndex() {
    realDataIndex = [];
    if (!fs.existsSync(REAL_DATA_DIR)) { console.warn('[main] real data directory does not exist:', REAL_DATA_DIR); return; }
    const entries = fs.readdirSync(REAL_DATA_DIR).filter(name => name.toLowerCase().endsWith('.json')).sort();
    for (const name of entries) {
        const filePath = path.join(REAL_DATA_DIR, name);
        const stat = fs.statSync(filePath);
        let firstTs = null; let firstObjBuf = ''; let firstObjDepth = 0; let firstObjStarted = false;
        const rl = createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;
            for (const ch of line) { if (ch === '{') { firstObjDepth++; firstObjStarted = true; } else if (ch === '}') firstObjDepth--; }
            if (firstObjStarted) {
                firstObjBuf += rawLine + '\n';
                if (firstObjDepth === 0) { try { const obj = JSON.parse(firstObjBuf.trim()); firstTs = obj.timestamp; } catch (_) { } firstObjStarted = false; break; }
            }
        }
        const lastTs = await getLastTimestampFromFile(filePath);
        if (firstTs !== null && lastTs !== null) {
            const tfMatch = name.match(/DAT_MT_[A-Z]+_([A-Z0-9]+)_\d{4}\.json/);
            const timeframe = tfMatch ? tfMatch[1] : null;
            realDataIndex.push({ file: filePath, name, firstTimestamp: firstTs, lastTimestamp: lastTs, size: stat.size, timeframe });
        } else { console.warn('[main] could not index file (no candles):', filePath); }
    }
    realDataIndex.sort((a, b) => a.firstTimestamp - b.firstTimestamp);
    console.log('[main] real data index built:', realDataIndex.map(e => `${e.name} [${e.firstTimestamp}..${e.lastTimestamp}]`).join('  '));
}

ipcMain.handle('get-historical-chunk', async (event, payload = {}) => {
    const { targetTimestamp = null, fileName = null, timeframe = null, asset = 'XAUUSD' } = payload;
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 1440, 100), 5000);

    if (realDataIndex.length === 0) return { chunk: [], hasMore: false, oldestTimestamp: null, timeframe: null, fileName: null };

    let entry = null;
    let usedTimeframe = null;

    if (targetTimestamp === null || targetTimestamp === undefined) {
        if (timeframe) {
            entry = findFileForTimeframe(timeframe, asset);
            usedTimeframe = timeframe;
        } else if (fileName) {
            entry = realDataIndex.find(e => e.name === fileName);
        } else {
            entry = [...realDataIndex].sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
        }
        if (!entry) return { chunk: [], hasMore: false, oldestTimestamp: null, timeframe: usedTimeframe, fileName: null };
        const tail = await readLastCandles(entry.file, limit);
        const oldest = tail.length ? tail[0].timestamp : null;
        const earliestFile = realDataIndex[0];
        const hasMore = !!(earliestFile && oldest !== null && earliestFile.firstTimestamp < oldest);
        console.log('[main] get-historical-chunk (initial) returning', tail.length, 'candles for', entry.name, ', hasMore=', hasMore);
        return { chunk: tail, hasMore, oldestTimestamp: oldest, timeframe: usedTimeframe || entry.timeframe, fileName: entry.name };
    }

    if (timeframe) {
        entry = findFileForTimeframe(timeframe, asset);
        usedTimeframe = timeframe;
        if (!entry) return { chunk: [], hasMore: false, oldestTimestamp: null, timeframe: usedTimeframe, fileName: null };
    } else if (fileName) {
        entry = realDataIndex.find(e => e.name === fileName);
    } else {
        const candidates = realDataIndex.filter(e => e.firstTimestamp < targetTimestamp);
        if (candidates.length === 0) return { chunk: [], hasMore: false, oldestTimestamp: null, timeframe: null, fileName: null };
        const ordered = [...candidates].sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        let collected = [];
        for (const e of ordered) {
            const part = await readCandlesBefore(e.file, targetTimestamp, limit);
            if (part.length === 0) continue;
            collected = mergeSortedAsc(collected, part);
            if (collected.length >= limit) { collected = collected.slice(collected.length - limit); break; }
        }
        const oldest = collected.length ? collected[0].timestamp : null;
        const earliestFile = realDataIndex[0];
        const hasMore = !!(earliestFile && oldest !== null && earliestFile.firstTimestamp < oldest);
        console.log('[main] get-historical-chunk returning', collected.length, 'candles, hasMore=', hasMore, 'oldest=', oldest);
        return { chunk: collected, hasMore, oldestTimestamp: oldest, timeframe: usedTimeframe, fileName: entry ? entry.name : null };
    }

    if (!entry) return { chunk: [], hasMore: false, oldestTimestamp: null, timeframe: usedTimeframe, fileName: null };

    const part = await readCandlesBefore(entry.file, targetTimestamp, limit);
    const oldest = part.length ? part[0].timestamp : null;
    const earliestFile = realDataIndex[0];
    const hasMore = !!(earliestFile && oldest !== null && earliestFile.firstTimestamp < oldest);
    console.log('[main] get-historical-chunk (timeframe) returning', part.length, 'candles, hasMore=', hasMore, 'oldest=', oldest);
    return { chunk: part, hasMore, oldestTimestamp: oldest, timeframe: usedTimeframe, fileName: entry.name };
});

ipcMain.handle('get-real-data-info', async () => {
    return {
        files: realDataIndex.map(e => ({
            name: e.name,
            firstTimestamp: e.firstTimestamp,
            lastTimestamp: e.lastTimestamp,
            size: e.size,
            timeframe: e.timeframe,
        })),
        overallFirstTimestamp: realDataIndex.length ? realDataIndex[0].firstTimestamp : null,
        overallLastTimestamp: realDataIndex.length
            ? realDataIndex[realDataIndex.length - 1].lastTimestamp
            : null,
    };
});

ipcMain.handle('get-file-candles', async (event, payload = {}) => {
    const { fileName = null } = payload;
    if (!fileName) return null;
    const entry = realDataIndex.find(e => e.name === fileName);
    if (!entry) return null;
    const candles = await readAllCandles(entry.file);
    return {
        candles,
        firstTimestamp: entry.firstTimestamp,
        lastTimestamp: entry.lastTimestamp,
        name: entry.name,
        timeframe: entry.timeframe,
    };
});

// ============================================================================
// CENTRALIZED DRAWING STORE - IPC HANDLERS
// ============================================================================
//
// Drawings use absolute Unix timestamps (ms) and absolute prices, making them
// globally independent of any specific timeframe. They are stored in
// `globalDrawings` in the main process and served to the renderer on demand.
// ============================================================================

/**
 * Save drawings to the global store. Each drawing should have:
 *   - type: 'trendline' | 'rectangle' | 'fibonacci' | 'longposition' | etc.
 *   - time1/time2: absolute Unix timestamps in milliseconds
 *   - price1/price2: absolute prices
 *   - id: unique identifier (optional, will be auto-generated if not provided)
 *   - color: drawing color (optional)
 *   - createdAt: creation timestamp
 *   - updatedAt: last update timestamp
 */
ipcMain.handle('save-drawings', (event, drawingData) => {
    try {
        if (!Array.isArray(drawingData)) {
            console.warn('[main] save-drawings received non-array data');
            return { success: false, count: 0, error: 'drawings must be an array' };
        }
        globalDrawings = drawingData;
        console.log('[main] saved', drawingData.length, 'drawings to global store');
        return { success: true, count: drawingData.length };
    } catch (err) {
        console.error('[main] save-drawings error:', err);
        return { success: false, count: 0, error: err.message };
    }
});

/**
 * Get all drawings from the global store. Returns absolute Unix timestamps
 * and absolute prices, so they can be re-applied to any timeframe.
 */
ipcMain.handle('get-drawings', () => {
    return globalDrawings;
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1366,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'src', 'preload.js'),
        },
    });

    win.loadFile('index.html');
}

app.whenReady().then(async () => {
    try {
        await buildRealDataIndex();
    } catch (err) {
        console.error('[main] failed to build real data index:', err);
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
