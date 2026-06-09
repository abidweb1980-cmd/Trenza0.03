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

// Stream from real data file (for replay)
const REAL_DATA_FILE = path.join(REAL_DATA_DIR, 'DAT_MT_XAUUSD_M1_2025.json');

async function* streamAllCandles(startTimestamp) {
    // First stream from real data file
    yield* streamCandles(REAL_DATA_FILE, startTimestamp);
    // Then fallback to sample files
    for (const file of DATA_FILES) {
        yield* streamCandles(file, startTimestamp);
    }
}

// ============================================================================
// REPLAY ENGINE STATE
// ============================================================================

/**
 * Global replay state - tracks the active replay session.
 */
const replayState = {
    isPlaying: false,
    currentReplayTimestamp: null,
    replaySpeed: 1000, // ms per bar (1 second = 1 bar per second)
    replayBuffer: [], // Preloaded future candles
    replayIntervalId: null,
    targetWindow: null, // The BrowserWindow to send ticks to
    bufferFilePath: null, // Current file being streamed
    bufferFileIndex: 0, // Position in the file
};

const REPLAY_BUFFER_SIZE = 10000; // Pre-buffer 10k bars
const REPLAY_BUFFER_REFILL_THRESHOLD = 500; // Refill when below this

// ============================================================================
// REPLAY ENGINE FUNCTIONS
// ============================================================================

/**
 * Load candles into the replay buffer from the real data file.
 * This pre-loads future candles into memory for smooth playback.
 */
async function fillReplayBuffer(startTimestamp) {
     console.log('[main] Filling replay buffer from timestamp:', startTimestamp);
     
     if (realDataIndex.length === 0) {
         console.warn('[main] No real data index available');
         return;
     }

     // Find the file containing the start timestamp
     const fileEntry = realDataIndex.find(e => e.firstTimestamp <= startTimestamp && e.lastTimestamp >= startTimestamp);
     if (!fileEntry) {
         console.warn('[main] No file found for timestamp:', startTimestamp);
         return;
     }

replayState.bufferFilePath = fileEntry.file;
    
    // Clear existing buffer before refill to avoid duplicates
    replayState.replayBuffer = [];
    
    const rl = createInterface({
        input: fs.createReadStream(fileEntry.file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let buf = '', depth = 0, inObj = false;
    let collected = 0;
    let lastTs = replayState.currentReplayTimestamp || startTimestamp;
    
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
                 // Only add candles strictly after the last timestamp we've seen
                 if (obj.timestamp > lastTs) {
                     replayState.replayBuffer.push(obj);
                     collected++;
                     if (collected >= REPLAY_BUFFER_SIZE) break;
                 }
             } catch (_) { /* skip */ }
             buf = '';
             inObj = false;
         }
     }
     
     console.log('[main] Buffer filled with', collected, 'bars');
 }

/**
 * Helper to get historical data before a timestamp for replay initialization.
 */
async function getHistoricalChunkForReplay(endTimestamp, limit) {
    if (realDataIndex.length === 0) return [];
    const entry = realDataIndex[realDataIndex.length - 1]; // Most recent file
    if (!entry) return [];
    
    const rl = createInterface({ input: fs.createReadStream(entry.file), crlfDelay: Infinity });
    const win = new Array(limit).fill(null);
    let wSize = 0, wStart = 0;
    let buf = '', depth = 0, inObj = false;
    
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
            } catch (_) {}
            buf = '';
            inObj = false;
        }
    }
    
    if (wSize === 0) return [];
    const out = new Array(wSize);
    for (let i = 0; i < wSize; i++) out[i] = win[(wStart + i) % limit];
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
}

/**
 * Start the playback interval that sends ticks to the renderer.
 */
function startReplayInterval() {
    if (replayState.replayIntervalId) {
        clearInterval(replayState.replayIntervalId);
    }
    
    replayState.isPlaying = true;
    
replayState.replayIntervalId = setInterval(async () => {
         // Refill buffer if it's running low
         if (replayState.replayBuffer.length < REPLAY_BUFFER_REFILL_THRESHOLD && replayState.currentReplayTimestamp) {
             await fillReplayBuffer(replayState.currentReplayTimestamp);
         }
        
        // Send next candle if available
        if (replayState.replayBuffer.length > 0 && replayState.targetWindow) {
            const nextCandle = replayState.replayBuffer.shift();
            replayState.currentReplayTimestamp = nextCandle.timestamp;
            replayState.targetWindow.webContents.send('replay:tick', nextCandle);
        } else if (replayState.isPlaying) {
            // No more data - pause playback
            console.log('[main] Replay buffer exhausted, pausing');
            stopReplayInterval();
        }
    }, replayState.replaySpeed);
    
    console.log('[main] Replay interval started, speed:', replayState.replaySpeed, 'ms');
}

function stopReplayInterval() {
    if (replayState.replayIntervalId) {
        clearInterval(replayState.replayIntervalId);
        replayState.replayIntervalId = null;
    }
    replayState.isPlaying = false;
    console.log('[main] Replay interval stopped');
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
            // Read from real data file first
            if (fs.existsSync(REAL_DATA_FILE)) {
                const rl = createInterface({ input: fs.createReadStream(REAL_DATA_FILE), crlfDelay: Infinity });
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
            // Then from sample files
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
            const LIMIT = 2000;
            const win = new Array(LIMIT).fill(null);
            let wSize = 0;
            let wStart = 0;

            // Read from real data file
            if (fs.existsSync(REAL_DATA_FILE)) {
                const rl = createInterface({ input: fs.createReadStream(REAL_DATA_FILE), crlfDelay: Infinity });
                let buf = '', depth = 0, inObj = false;
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
                                const idx = (wStart + wSize) % LIMIT;
                                win[idx] = obj;
                                if (wSize < LIMIT) wSize++;
                                else wStart = (wStart + 1) % LIMIT;
                            }
                        } catch (_) {}
                        buf = '';
                        inObj = false;
                    }
                }
            }

            if (wSize === 0) return [];
            const out = new Array(wSize);
            for (let i = 0; i < wSize; i++) out[i] = win[(wStart + i) % LIMIT];
            out.sort((a, b) => a.timestamp - b.timestamp);
            return out;
        });

        // The new interval-based replay handlers - using the replay engine above
        ipcMain.handle('replay:start-stream', async (event, { startTimestamp, chunkSize = 500 }) => {
            console.log('[main] replay:start-stream called with', startTimestamp, chunkSize);
            
            // Store the target window for sending ticks
            replayState.targetWindow = BrowserWindow.fromWebContents(event.sender);
            
            // Get historical data before the start point
            const historicalChunk = await getHistoricalChunkForReplay(startTimestamp - 1440 * 60000, 500);
            console.log('[main] Historical chunk:', historicalChunk.length, 'bars');
            
            // Fill the replay buffer with future candles
            await fillReplayBuffer(startTimestamp);
            
            return { 
                replayId: 'interval-based', 
                totalBars: historicalChunk.length, 
                chunk: historicalChunk, 
                hasMore: replayState.replayBuffer.length > 0 
            };
        });

        // New handler: Start playback (interval-based tick sending)
        ipcMain.handle('replay:play', async (event) => {
            console.log('[main] replay:play called');
            replayState.isPlaying = true;
            startReplayInterval();
            return { success: true };
        });

        // New handler: Step forward one bar
        ipcMain.handle('replay:step', async (event) => {
            console.log('[main] replay:step called');
            if (replayState.replayBuffer.length > 0 && replayState.targetWindow) {
                const nextCandle = replayState.replayBuffer.shift();
                replayState.currentReplayTimestamp = nextCandle.timestamp;
                replayState.targetWindow.webContents.send('replay:tick', nextCandle);
            }
            return { success: true };
        });

        // New handler: Pause playback
        ipcMain.handle('replay:pause', async (event) => {
            console.log('[main] replay:pause called');
            stopReplayInterval();
            return { success: true };
        });

        // New handler: Set playback speed
        ipcMain.handle('replay:set-speed', async (event, { speedMs }) => {
            console.log('[main] replay:set-speed called:', speedMs);
            replayState.replaySpeed = speedMs;
            if (replayState.isPlaying) {
                stopReplayInterval();
                startReplayInterval();
            }
            return { success: true };
        });

        // Keep old handlers for compatibility with existing frontend
        ipcMain.handle('replay:request-chunk', async (event, { replayId }) => {
            // Redirect to tick-based playback - this shouldn't be used in new system
            return { chunk: [], hasMore: false };
        });

        ipcMain.handle('replay:stop-stream', (event, { replayId }) => {
            console.log('[main] replay:stop-stream called');
            stopReplayInterval();
            replayState.replayBuffer = [];
            return { success: true };
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
                // Check if there's older data in the same file
                const hasMore = oldest !== null && oldest > entry.firstTimestamp;
                return { chunk: tail, hasMore, oldestTimestamp: oldest };
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
            const hasMore = oldest > entry.firstTimestamp;
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
