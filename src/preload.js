// Preload bridge for secure IPC communication with the main process
const { contextBridge, ipcRenderer } = require('electron');

// Expose replay functionality to the renderer process
contextBridge.exposeInMainWorld('replayAPI', {
    // Start a replay stream from a specific timestamp
    startStream: (startTimestamp, chunkSize) =>
        ipcRenderer.invoke('replay:start-stream', { startTimestamp, chunkSize }),

    // Request the next chunk of data
    requestChunk: (replayId) =>
        ipcRenderer.invoke('replay:request-chunk', { replayId }),

    // Stop the replay stream
    stopStream: (replayId) =>
        ipcRenderer.invoke('replay:stop-stream', { replayId }),

    // Get data before a specific timestamp
    getDataBefore: (endTimestamp) =>
        ipcRenderer.invoke('replay:get-data-before', { endTimestamp }),

    // Get total data info
    getDataInfo: () =>
        ipcRenderer.invoke('replay:get-data-info'),

    // New: Start playback (interval-based tick sending)
    play: () =>
        ipcRenderer.invoke('replay:play'),

    // New: Step forward one bar
    step: () =>
        ipcRenderer.invoke('replay:step'),

    // New: Pause playback
    pause: () =>
        ipcRenderer.invoke('replay:pause'),

    // New: Set playback speed (ms per bar)
    setSpeed: (speedMs) =>
        ipcRenderer.invoke('replay:set-speed', { speedMs }),

    // Listen for replay ticks (new interval-based system)
    onTick: (callback) => {
        const subscription = (_event, candle) => callback(candle);
        ipcRenderer.on('replay:tick', subscription);
        return () => ipcRenderer.removeListener('replay:tick', subscription);
    },

    // Check if replay is currently playing
    isPlaying: () => {
        // This is set by the renderer state, not main process
        // We'll use the getState method from replayManager instead
    },

    // Listen for replay events from main process
    onReplayEvent: (channel, callback) => {
        const subscription = (_event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    }
});

// Expose lazy-loading / pagination API for the real-data bridge.
// The renderer MUST go through this API — never through ipcRenderer directly.
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Request a chunk of historical candles.
     *
     * @param {object} params
     * @param {number|null} params.targetTimestamp
     *        - null  : fetch the most recent `limit` candles
     *        - <ms>  : fetch up to `limit` candles strictly OLDER than this ts
     * @param {number} [params.limit=2000]
     *        number of candles to return (capped at 5000 by the main process)
     *
     * @returns {Promise<{chunk: Array, hasMore: boolean, oldestTimestamp: number|null}>}
     */
    getHistoricalChunk: ({ targetTimestamp = null, limit = 1440, fileName = null } = {}) =>
        ipcRenderer.invoke('get-historical-chunk', { targetTimestamp, limit, fileName }),

    /**
     * Return a small metadata summary of every indexed real-data file.
     * Useful for showing a status banner like
     *   "XAUUSD 2021..2025 — 5 files indexed"
     */
    getRealDataInfo: () =>
        ipcRenderer.invoke('get-real-data-info'),

    /**
     * Load the FULL content of a single real-data file. The renderer
     * uses this to "jump" into a file so the user sees the complete
     * contiguous year of data rather than paging through year-wide
     * gaps one tiny slice at a time.
     *
     * @param {object} params
     * @param {string} params.fileName
     *        The file's name as reported by getRealDataInfo
     *        (e.g. "DAT_MT_XAUUSD_M1_2022.json")
     *
     * @returns {Promise<{candles: Array, firstTimestamp: number, lastTimestamp: number, name: string} | null>}
     */
    getFileCandles: ({ fileName } = {}) =>
        ipcRenderer.invoke('get-file-candles', { fileName }),
});

// Expose basic app info
contextBridge.exposeInMainWorld('appInfo', {
    version: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
});
