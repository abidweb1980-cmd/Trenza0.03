const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { createInterface } = require('readline');

// Data files configuration
const DATA_DIR = path.join(__dirname, 'src', 'data');
const DATA_FILES = [
    path.join(DATA_DIR, 'sample.json'),
    path.join(DATA_DIR, 'sample2.json'),
];

// Real data directory (lazy-loaded by the renderer in chunks)
const REAL_DATA_DIR = path.join(DATA_DIR, 'real');

// Pre-computed file ranges for fast lookup
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

// Stream parser: reads a JSON array file line-by-line and yields
// individual candle objects once their timestamp is >= startTimestamp.
// Skips everything before startTimestamp without loading the whole file.
async function* streamCandles(filePath, startTimestamp) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    let buf = '';
    let inObj = false;
    let depth = 0;

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line === '[' || line === ']' || line === '') continue;

        // Count braces in this line
        for (const ch of line) {
            if (ch === '{') { depth++; inObj = true; }
            else if (ch === '}') depth--;
        }

        buf += rawLine + '\n';

        // When we close the outermost object, try to parse
        if (inObj && depth === 0) {
            const clean = buf.trim().replace(/,\s*$/, '');
            try {
                const obj = JSON.parse(clean);
                if (obj.timestamp >= startTimestamp) {
                    yield obj;
                }
            } catch (_) {
                // skip malformed chunk
            }
            buf = '';
            inObj = false;
        }
    }
}

// Combined stream: iterate files in order, yield from each
async function* streamAllCandles(startTimestamp) {
    for (const { file } of fileRanges) {
        yield* streamCandles(file, startTimestamp);
    }
}

// ---------- IPC Handlers ----------

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
                } catch (_) { /* skip */ }
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
                } catch (_) { /* skip */ }
            }
        }
    }
    results.sort((a, b) => a.timestamp - b.timestamp);
    return results;
});

ipcMain.handle('replay:start-stream', async (event, { startTimestamp, chunkSize = 500 }) => {
    const replayId = `replay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Prime the stream iterator
    const iterator = streamAllCandles(startTimestamp);

    // Pre-fetch the first chunk synchronously-ish
    const firstChunk = [];
    for (let i = 0; i < chunkSize; i++) {
        const { value, done } = await iterator.next();
        if (done) break;
        firstChunk.push(value);
    }

    // We keep the iterator alive via a Map so it persists across IPC calls
    // Use the iterator's internal state stored in the Map
    replayIterators.set(replayId, { iterator, chunkSize, startTimestamp });

    return {
        replayId,
        totalBars: firstChunk.length, // initial estimate; actual total unknown until stream ends
        chunk: firstChunk,
        hasMore: true,
    };
});

ipcMain.handle('replay:request-chunk', async (event, { replayId }) => {
    const entry = replayIterators.get(replayId);
    if (!entry) {
        return { chunk: [], hasMore: false };
    }

    const { iterator, chunkSize } = entry;
    const chunk = [];

    for (let i = 0; i < chunkSize; i++) {
        const { value, done } = await iterator.next();
        if (done) {
            replayIterators.delete(replayId);
            return { chunk, hasMore: false };
        }
        chunk.push(value);
    }

    return { chunk, hasMore: true };
});

ipcMain.handle('replay:stop-stream', (event, { replayId }) => {
    const deleted = replayIterators.delete(replayId);
    return { success: deleted };
});

// Map to keep async iterators alive between IPC calls
const replayIterators = new Map();


// ============================================================================
// LAZY LOADING / PAGINATION — Real Data Bridge
// ============================================================================
//
// Architecture:
//  1. On startup, scan src/data/real for *.json files.
//  2. Build a tiny pre-index: { file, firstTimestamp, lastTimestamp, size }.
//  3. Serve small chunks to the renderer on demand.
//     - get-historical-chunk with targetTimestamp=null  -> most recent N candles
//     - get-historical-chunk with targetTimestamp=ts   -> N candles older than ts
//
// The renderer must never load all data at once. It requests chunks as the
// user scrolls left on the chart.
// ============================================================================

// In-memory pre-index of every real-data file
// Each entry: { file, firstTimestamp, lastTimestamp, size }
let realDataIndex = [];

/**
 * Read candles from `filePath` keeping only those with
 *   timestamp < endTimestamp
 * and return at most `limit` items, sorted ascending by timestamp.
 *
 * Uses a ring buffer of size `limit` so memory stays O(limit) even for
 * multi-hundred-MB files. The returned candles are the LAST `limit`
 * ones that satisfy the predicate — i.e. the candles that sit
 * IMMEDIATELY before `endTimestamp` in time, which is what the
 * renderer wants when it asks for "older data" adjacent to its window.
 *
 * Bonus: as soon as we discover the file's first candle is already
 * >= endTimestamp we abort the stream (no qualifying candles in the
 * whole file), saving a lot of I/O.
 */
async function readCandlesBefore(filePath, endTimestamp, limit) {
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buf = '';
    let depth = 0;
    let inObj = false;
    let firstTs = null;

    const window = new Array(limit).fill(null);
    let windowSize = 0;
    let windowStart = 0;

    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;

            for (const ch of line) {
                if (ch === '{') { depth++; inObj = true; }
                else if (ch === '}') depth--;
            }

            buf += rawLine + '\n';

            if (inObj && depth === 0) {
                // Strip the trailing comma (the file format is
                // "{...}," between objects). Without this, JSON.parse
                // throws "Unexpected non-whitespace character after JSON".
                const clean = buf.trim().replace(/,\s*$/, '');
                try {
                    const obj = JSON.parse(clean);
                    if (firstTs === null) {
                        firstTs = obj.timestamp;
                        // Fast-path: the very first candle in the file
                        // is already past our endTimestamp, so the
                        // whole file is irrelevant. Bail.
                        if (firstTs >= endTimestamp) return [];
                    }
                    // Add to ring buffer if it qualifies — including the
                    // very first candle (which is what we missed before).
                    if (obj.timestamp < endTimestamp) {
                        const idx = (windowStart + windowSize) % limit;
                        window[idx] = obj;
                        if (windowSize < limit) {
                            windowSize++;
                        } else {
                            windowStart = (windowStart + 1) % limit;
                        }
                    }
                } catch (_) { /* skip */ }
                buf = '';
                inObj = false;
            }
        }
    } catch (err) {
        console.error('[main] readCandlesBefore stream error:', err);
    }

    if (windowSize === 0) return [];
    const out = new Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
        out[i] = window[(windowStart + i) % limit];
    }
    return out; // file is already chronologically ordered
}

/**
 * Read ALL candles from `filePath` and return them sorted ascending by
 * timestamp. Used by the "load entire next file" path so the renderer
 * can show the complete file at once and avoid a year-wide visual gap.
 *
 * Memory note: this loads the whole file. Each real-data file is
 * roughly 60MB, so we only call this when we know the file fits in
 * the renderer's in-memory budget.
 */
async function readAllCandles(filePath) {
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    const out = [];
    let buf = '';
    let depth = 0;
    let inObj = false;

    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;

            for (const ch of line) {
                if (ch === '{') { depth++; inObj = true; }
                else if (ch === '}') depth--;
            }

            buf += rawLine + '\n';

            if (inObj && depth === 0) {
                const clean = buf.trim().replace(/,\s*$/, '');
                try {
                    const obj = JSON.parse(clean);
                    out.push(obj);
                } catch (_) { /* skip */ }
                buf = '';
                inObj = false;
            }
        }
    } catch (err) {
        console.error('[main] readAllCandles stream error:', err);
    }

    return out; // file is already chronologically ordered
}

/**
 * Read up to `limit` candles from `filePath` and return the LAST `limit`
 * ones sorted ascending by timestamp. Memory usage is O(limit) via a
 * ring buffer.
 */
async function readLastCandles(filePath, limit) {
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buf = '';
    let depth = 0;
    let inObj = false;

    const window = new Array(limit).fill(null);
    let windowSize = 0;
    let windowStart = 0;

    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;

            for (const ch of line) {
                if (ch === '{') { depth++; inObj = true; }
                else if (ch === '}') depth--;
            }

            buf += rawLine + '\n';

            if (inObj && depth === 0) {
                const clean = buf.trim().replace(/,\s*$/, '');
                try {
                    const obj = JSON.parse(clean);
                    const idx = (windowStart + windowSize) % limit;
                    window[idx] = obj;
                    if (windowSize < limit) {
                        windowSize++;
                    } else {
                        windowStart = (windowStart + 1) % limit;
                    }
                } catch (_) { /* skip */ }
                buf = '';
                inObj = false;
            }
        }
    } catch (err) {
        console.error('[main] readLastCandles stream error:', err);
    }

    if (windowSize === 0) return [];
    const out = new Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
        out[i] = window[(windowStart + i) % limit];
    }
    return out; // file is already chronologically ordered
}

/**
 * Merge two arrays that are already sorted ascending by timestamp.
 * O(n+m), no per-element sort needed afterwards.
 */
function mergeSortedAsc(a, b) {
    if (a.length === 0) return b.slice();
    if (b.length === 0) return a.slice();
    const out = new Array(a.length + b.length);
    let i = 0, j = 0, k = 0;
    while (i < a.length && j < b.length) {
        if (a[i].timestamp <= b[j].timestamp) {
            out[k++] = a[i++];
        } else {
            out[k++] = b[j++];
        }
    }
    while (i < a.length) out[k++] = a[i++];
    while (j < b.length) out[k++] = b[j++];
    return out;
}

/**
 * Find the LAST candle's timestamp in a file by streaming it fully and
 * remembering the most recently parsed object.
 */
async function getLastTimestampFromFile(filePath) {
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buf = '';
    let depth = 0;
    let inObj = false;
    let lastTs = null;

    try {
        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;

            for (const ch of line) {
                if (ch === '{') { depth++; inObj = true; }
                else if (ch === '}') depth--;
            }

            buf += rawLine + '\n';

            if (inObj && depth === 0) {
                const clean = buf.trim().replace(/,\s*$/, '');
                try {
                    const obj = JSON.parse(clean);
                    lastTs = obj.timestamp;
                } catch (_) { /* skip */ }
                buf = '';
                inObj = false;
            }
        }
    } catch (err) {
        console.error('[main] getLastTimestampFromFile stream error:', err);
    }

    return lastTs;
}

/**
 * Scan the real-data directory and build a pre-index of every JSON file.
 * For each file we record its FIRST and LAST candle timestamps (in ms).
 * Streams each file once and only keeps the boundary objects.
 */
async function buildRealDataIndex() {
    realDataIndex = [];

    if (!fs.existsSync(REAL_DATA_DIR)) {
        console.warn('[main] real data directory does not exist:', REAL_DATA_DIR);
        return;
    }

    const entries = fs.readdirSync(REAL_DATA_DIR)
        .filter(name => name.toLowerCase().endsWith('.json'))
        .sort(); // ISO year names sort lexicographically

    for (const name of entries) {
        const filePath = path.join(REAL_DATA_DIR, name);
        const stat = fs.statSync(filePath);

        let firstTs = null;
        let firstObjBuf = '';
        let firstObjDepth = 0;
        let firstObjStarted = false;

        const rl = createInterface({
            input: fs.createReadStream(filePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });

        for await (const rawLine of rl) {
            const line = rawLine.trim();
            if (line === '' || line === '[' || line === ']') continue;

            for (const ch of line) {
                if (ch === '{') { firstObjDepth++; firstObjStarted = true; }
                else if (ch === '}') firstObjDepth--;
            }

            if (firstObjStarted) {
                firstObjBuf += rawLine + '\n';
                if (firstObjDepth === 0) {
                    try {
                        const obj = JSON.parse(firstObjBuf.trim());
                        firstTs = obj.timestamp;
                    } catch (_) { /* skip */ }
                    firstObjStarted = false;
                    break; // we have the first object; bail to save I/O
                }
            }
        }

        const lastTs = await getLastTimestampFromFile(filePath);

        if (firstTs !== null && lastTs !== null) {
            realDataIndex.push({
                file: filePath,
                name,
                firstTimestamp: firstTs,
                lastTimestamp: lastTs,
                size: stat.size,
            });
        } else {
            console.warn('[main] could not index file (no candles):', filePath);
        }
    }

    // Sort by first timestamp ascending (oldest files first)
    realDataIndex.sort((a, b) => a.firstTimestamp - b.firstTimestamp);

    console.log('[main] real data index built:',
        realDataIndex.map(e => `${e.name} [${e.firstTimestamp}..${e.lastTimestamp}]`).join('  ')
    );
}

/**
 * IPC: 'get-historical-chunk'
 *
 * Args:
 *   targetTimestamp : number | null
 *       - null   : return the most recent `limit` candles across all files
 *       - number : return up to `limit` candles with timestamp < targetTimestamp
 *   limit           : number   (default 2000, hard-capped at 5000)
 *
 * Returns: { chunk: [...candles], hasMore: boolean, oldestTimestamp: number|null }
 */
ipcMain.handle('get-historical-chunk', async (event, payload = {}) => {
    const { targetTimestamp = null, fileName = null } = payload;
    const limit = Math.min(Math.max(parseInt(payload.limit, 10) || 1440, 100), 5000);

    if (realDataIndex.length === 0) {
        return { chunk: [], hasMore: false, oldestTimestamp: null };
    }

    // ---------- Initial / latest load ----------
    if (targetTimestamp === null || targetTimestamp === undefined) {
        // If a fileName is given, just take the tail of that file.
        // Otherwise fall back to the newest file in the index.
        const entry = fileName
            ? realDataIndex.find(e => e.name === fileName)
            : [...realDataIndex].sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
        if (!entry) {
            return { chunk: [], hasMore: false, oldestTimestamp: null };
        }
        const tail = await readLastCandles(entry.file, limit);
        const oldest = tail.length ? tail[0].timestamp : null;
        // hasMore = there is data in older files.
        const earliestFile = realDataIndex[0];
        const hasMore = !!(earliestFile && oldest !== null && earliestFile.firstTimestamp < oldest);
        console.log('[main] get-historical-chunk (initial) returning', tail.length, 'candles for', entry.name, ', hasMore=', hasMore);
        return { chunk: tail, hasMore, oldestTimestamp: oldest };
    }

    // ---------- Historical pagination load ----------
    // If a fileName is given, scope the search to that file only.
    // Otherwise use every file whose FIRST candle is strictly older than
    // the target — that way the file we're paging into isn't skipped
    // just because its last candle is past the target.
    let candidates;
    if (fileName) {
        candidates = realDataIndex.filter(e => e.name === fileName);
    } else {
        candidates = realDataIndex.filter(e => e.firstTimestamp < targetTimestamp);
    }
    if (candidates.length === 0) {
        return { chunk: [], hasMore: false, oldestTimestamp: null };
    }

    // We want the candles IMMEDIATELY older than `targetTimestamp`.
    // Process files from newest to oldest, and stop as soon as we have
    // accumulated `limit` candles (which are the most-recent qualifying
    // ones — the ones the renderer should prepend).
    const ordered = [...candidates].sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    let collected = [];
    for (const entry of ordered) {
        const part = await readCandlesBefore(entry.file, targetTimestamp, limit);
        if (part.length === 0) continue;
        collected = mergeSortedAsc(collected, part);
        if (collected.length >= limit) {
            // Trim to the LAST `limit` so we always return candles
            // immediately preceding the target, not the oldest from
            // an earlier file.
            collected = collected.slice(collected.length - limit);
            break;
        }
    }

    const oldest = collected.length ? collected[0].timestamp : null;
    const earliestFile = realDataIndex[0];
    // hasMore is true if there is data older than what we just returned,
    // either in this file or in an earlier file.
    const hasMore = !!(earliestFile && oldest !== null && earliestFile.firstTimestamp < oldest);

    console.log('[main] get-historical-chunk returning', collected.length, 'candles, hasMore=', hasMore, 'oldest=', oldest);
    return { chunk: collected, hasMore, oldestTimestamp: oldest };
});

/**
 * IPC: 'get-real-data-info'
 * Returns the pre-index summary so the renderer can show a status message.
 */
ipcMain.handle('get-real-data-info', async () => {
    return {
        files: realDataIndex.map(e => ({
            name: e.name,
            firstTimestamp: e.firstTimestamp,
            lastTimestamp: e.lastTimestamp,
            size: e.size,
        })),
        overallFirstTimestamp: realDataIndex.length ? realDataIndex[0].firstTimestamp : null,
        overallLastTimestamp: realDataIndex.length
            ? realDataIndex[realDataIndex.length - 1].lastTimestamp
            : null,
    };
});

/**
 * IPC: 'get-file-candles'
 * Returns the full content of a single real-data file. Used by the
 * renderer to load the whole next-older file at once so it doesn't
 * have to page through year-wide gaps one tiny slice at a time.
 *
 * Args: { fileName: string }
 * Returns: { candles: [...], firstTimestamp, lastTimestamp, name } or null
 */
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
    };
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
    // Build the pre-index BEFORE creating the window so the renderer can
    // request chunks immediately when the chart mounts.
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
