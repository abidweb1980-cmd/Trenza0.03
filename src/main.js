import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Resolve the project root regardless of whether we're running the SOURCE
// (src/main.js) or the BUNDLED output (.vite/build/main.js). We walk up from
// __dirname until we find the package.json — that's our project root.
function resolveProjectRoot() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return __dirname;
}
const PROJECT_ROOT = resolveProjectRoot();
const DATA_DIR = path.join(PROJECT_ROOT, 'src', 'data');
const DATA_FILES = [
    path.join(DATA_DIR, 'sample.json'),
    path.join(DATA_DIR, 'sample2.json'),
];
const REAL_DATA_DIR = path.join(DATA_DIR, 'real');

console.log('[main] PROJECT_ROOT =', PROJECT_ROOT);
console.log('[main] REAL_DATA_DIR =', REAL_DATA_DIR);

// Map to keep async iterators alive between IPC calls
const replayIterators = new Map();

// Stream parser: reads a JSON array file line-by-line and yields
// individual candle objects once their timestamp is >= startTimestamp.
async function* streamCandles(filePath, startTimestamp) {
    if (!fs.existsSync(filePath)) return;
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
            try {
                let cleanBuf = buf.trim();
                if (cleanBuf.endsWith(',')) cleanBuf = cleanBuf.slice(0, -1).trim();
                const obj = JSON.parse(cleanBuf);
                if (obj.timestamp >= startTimestamp) {
                    yield obj;
                }
            } catch (e) { /* skip */ }
            buf = '';
            inObj = false;
        }
    }
}

async function* streamAllCandles(startTimestamp) {
    for (const file of DATA_FILES) {
        yield* streamCandles(file, startTimestamp);
    }
}

// ============================================================================
// LAZY LOADING / PAGINATION — Real Data Bridge
// ============================================================================

let realDataIndex = [];

async function readCandlesBefore(filePath, endTimestamp, limit) {
    if (!fs.existsSync(filePath)) return [];
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buf = '';
    let depth = 0;
    let inObj = false;

    const win = new Array(limit).fill(null);
    let wSize = 0;
    let wStart = 0;

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line === '' || line === '[' || line === ']') continue;

        for (const ch of line) {
            if (ch === '{') { depth++; inObj = true; }
            else if (ch === '}') depth--;
        }

        buf += rawLine + '\n';

        if (inObj && depth === 0) {
            try {
                let cleanBuf = buf.trim();
                if (cleanBuf.endsWith(',')) cleanBuf = cleanBuf.slice(0, -1).trim();
                const obj = JSON.parse(cleanBuf);
                if (obj.timestamp < endTimestamp) {
                    const idx = (wStart + wSize) % limit;
                    win[idx] = obj;
                    if (wSize < limit) wSize++;
                    else wStart = (wStart + 1) % limit;
                }
            } catch (_) { /* skip */ }
            buf = '';
            inObj = false;
        }
    }

    if (wSize === 0) return [];
    const out = new Array(wSize);
    for (let i = 0; i < wSize; i++) out[i] = win[(wStart + i) % limit];
    return out;
}

async function readLastCandles(filePath, limit) {
    if (!fs.existsSync(filePath)) return [];
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buf = '';
    let depth = 0;
    let inObj = false;

    const win = new Array(limit).fill(null);
    let wSize = 0;
    let wStart = 0;

    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line === '' || line === '[' || line === ']') continue;

        for (const ch of line) {
            if (ch === '{') { depth++; inObj = true; }
            else if (ch === '}') depth--;
        }

        buf += rawLine + '\n';

        if (inObj && depth === 0) {
            try {
                let cleanBuf = buf.trim();
                if (cleanBuf.endsWith(',')) cleanBuf = cleanBuf.slice(0, -1).trim();
                const obj = JSON.parse(cleanBuf);
                const idx = (wStart + wSize) % limit;
                win[idx] = obj;
                if (wSize < limit) wSize++;
                else wStart = (wStart + 1) % limit;
            } catch (_) { /* skip */ }
            buf = '';
            inObj = false;
        }
    }

    if (wSize === 0) return [];
    const out = new Array(wSize);
    for (let i = 0; i < wSize; i++) out[i] = win[(wStart + i) % limit];
    return out;
}

function mergeSortedAsc(a, b) {
    if (a.length === 0) return b.slice();
    if (b.length === 0) return a.slice();
    const out = new Array(a.length + b.length);
    let i = 0, j = 0, k = 0;
    while (i < a.length && j < b.length) {
        if (a[i].timestamp <= b[j].timestamp) out[k++] = a[i++];
        else out[k++] = b[j++];
    }
    while (i < a.length) out[k++] = a[i++];
    while (j < b.length) out[k++] = b[j++];
    return out;
}

async function getLastTimestampFromFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const rl = createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    let buf = '', depth = 0, inObj = false, lastTs = null;
    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (line === '' || line === '[' || line === ']') continue;
        for (const ch of line) {
            if (ch === '{') { depth++; inObj = true; }
            else if (ch === '}') depth--;
        }
        buf += rawLine + '\n';
        if (inObj && depth === 0) {
            try {
                let cleanBuf = buf.trim();
                if (cleanBuf.endsWith(',')) cleanBuf = cleanBuf.slice(0, -1).trim();
                const obj = JSON.parse(cleanBuf);
                lastTs = obj.timestamp;
            } catch (_) { /* skip */ }
            buf = '';
            inObj = false;
        }
    }
    return lastTs;
}

async function buildRealDataIndex() {
    realDataIndex = [];

    if (!fs.existsSync(REAL_DATA_DIR)) {
        console.warn('[main] real data directory does not exist:', REAL_DATA_DIR);
        return;
    }

    const entries = fs.readdirSync(REAL_DATA_DIR)
        .filter(name => name.toLowerCase().endsWith('.json'))
        .sort();

    for (const name of entries) {
        const filePath = path.join(REAL_DATA_DIR, name);
        const stat = fs.statSync(filePath);

        let firstTs = null;
        {
            const rl = createInterface({
                input: fs.createReadStream(filePath, { encoding: 'utf8' }),
                crlfDelay: Infinity,
            });
            let buf = '', depth = 0, started = false;
            for await (const rawLine of rl) {
                const line = rawLine.trim();
                if (line === '' || line === '[' || line === ']') continue;
                for (const ch of line) {
                    if (ch === '{') { depth++; started = true; }
                    else if (ch === '}') depth--;
                }
                if (started) {
                    buf += rawLine + '\n';
                    if (depth === 0) {
                        try {
                            let cleanBuf = buf.trim();
                            if (cleanBuf.endsWith(',')) cleanBuf = cleanBuf.slice(0, -1).trim();
                            const obj = JSON.parse(cleanBuf);
                            firstTs = obj.timestamp;
                        } catch (_) { /* skip */ }
                        break;
                    }
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

    realDataIndex.sort((a, b) => a.firstTimestamp - b.firstTimestamp);
    console.log('[main] real data index built:',
        realDataIndex.map(e => `${e.name} [${e.firstTimestamp}..${e.lastTimestamp}]`).join('  ')
    );
}

// Register ALL IPC handlers once at module load. Wrapping in try/catch so a
// misbehaving handler doesn't kill the others.
function registerIpcHandlers() {
    console.log('[main] registering IPC handlers...');
    try {
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
                        } catch (_) {}
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
                        } catch (_) {}
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

        ipcMain.handle('get-historical-chunk', async (event, payload = {}) => {
            console.log('[main] get-historical-chunk called with', payload);
            const { targetTimestamp = null, fileName = null } = payload || {};
            const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 2000, 100), 5000);

            if (realDataIndex.length === 0) {
                console.warn('[main] realDataIndex is empty — returning no data');
                return { chunk: [], hasMore: false, oldestTimestamp: null };
            }

            if (targetTimestamp === null || targetTimestamp === undefined) {
                let entry;
                if (fileName) {
                    entry = realDataIndex.find(e => e.name === fileName);
                } else {
                    const ordered = [...realDataIndex].sort((a, b) => b.lastTimestamp - a.lastTimestamp);
                    entry = ordered[0];
                }
                if (!entry) return { chunk: [], hasMore: false, oldestTimestamp: null };
                const tail = await readLastCandles(entry.file, limit);
                const oldest = tail.length ? tail[0].timestamp : null;
                return { chunk: tail, hasMore: oldest !== null, oldestTimestamp: oldest };
            }

            let entry;
            if (fileName) {
                entry = realDataIndex.find(e => e.name === fileName);
                if (!entry) return { chunk: [], hasMore: false, oldestTimestamp: null };
            } else {
                const candidates = realDataIndex.filter(e => e.lastTimestamp < targetTimestamp);
                if (candidates.length === 0) return { chunk: [], hasMore: false, oldestTimestamp: null };
                entry = [...candidates].sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
            }

            const part = await readCandlesBefore(entry.file, targetTimestamp, limit);
            if (part.length === 0) return { chunk: [], hasMore: false, oldestTimestamp: null };

            const oldest = part[0].timestamp;
            const earliestFile = realDataIndex[0];
            const hasMore = !!(earliestFile && oldest !== null && earliestFile.firstTimestamp < oldest);
            return { chunk: part, hasMore, oldestTimestamp: oldest };
        });

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

        console.log('[main] all IPC handlers registered.');
    } catch (err) {
        console.error('[main] ERROR registering IPC handlers:', err);
    }
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.webContents.openDevTools();
};

// Register handlers at module load (synchronous) so they are available
// the moment the renderer is created.
registerIpcHandlers();

app.whenReady().then(async () => {
  try {
    await buildRealDataIndex();
  } catch (error) {
    console.error('[main] failed to build real data index:', error);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
