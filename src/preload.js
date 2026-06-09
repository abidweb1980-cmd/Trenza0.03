// Preload bridge for secure IPC communication with the main process
const { contextBridge, ipcRenderer } = require('electron');

// Expose replay functionality to the renderer process
contextBridge.exposeInMainWorld('replayAPI', {
    // Start a replay stream from a specific timestamp
    startStream: (startTimestamp, chunkSize, timeframe = null) =>
        ipcRenderer.invoke('replay:start-stream', { startTimestamp, chunkSize, timeframe }),

    // Request the next chunk of data
    requestChunk: (replayId) =>
        ipcRenderer.invoke('replay:request-chunk', { replayId }),

    // Stop the replay stream
    stopStream: (replayId) =>
        ipcRenderer.invoke('replay:stop-stream', { replayId }),

    // Get data before a specific timestamp
    getDataBefore: (endTimestamp, timeframe = null) =>
        ipcRenderer.invoke('replay:get-data-before', { endTimestamp, timeframe }),

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

    // Get current replay state from main process
    getReplayState: () =>
        ipcRenderer.invoke('replay:get-state'),

    // Get truncated data for replay (timeframe + maxTimestamp)
    getTruncatedData: ({ timeframe = null, maxTimestamp = null, limit = 2000 }) =>
        ipcRenderer.invoke('replay:get-truncated-data', { timeframe, maxTimestamp, limit }),

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
     * @param {string} [params.fileName]
     *        specific file to load from (optional)
     * @param {string} [params.timeframe]
     *        timeframe to load (e.g., 'M1', 'M5', 'H1', 'D1', '1m', '5m', '1h', '1d')
     *        if provided, dynamically finds the matching file
     * @param {string} [params.asset='XAUUSD']
     *        asset symbol (for future multi-asset support)
     * @param {number|null} [params.maxTimestamp]
     *        maximum timestamp to include (filters out future data during replay)
     *
     * @returns {Promise<{chunk: Array, hasMore: boolean, oldestTimestamp: number|null, timeframe: string|null, fileName: string|null}>}
     */
    getHistoricalChunk: ({ targetTimestamp = null, limit = 1440, fileName = null, timeframe = null, asset = 'XAUUSD', maxTimestamp = null } = {}) =>
        ipcRenderer.invoke('get-historical-chunk', { targetTimestamp, limit, fileName, timeframe, asset, maxTimestamp }),

    /**
     * Return a small metadata summary of every indexed real-data file.
     * Useful for showing a status banner like
     *   "XAUUSD 2021..2025 — 5 files indexed"
     */
    getRealDataInfo: () =>
        ipcRenderer.invoke('get-real-data-info'),

    /**
     * Save drawings to the main process (centralized store).
     * Drawings should use absolute Unix timestamps (ms) and absolute prices.
     * @param {Array} drawings - Array of drawing objects
     * @returns {Promise<{success: boolean, count: number}>}
     */
    saveDrawings: (drawings) =>
        ipcRenderer.invoke('save-drawings', drawings),

    /**
     * Get all drawings from the main process (centralized store).
     * @returns {Promise<Array>} Array of drawing objects with absolute timestamps and prices
     */
    getDrawings: () =>
        ipcRenderer.invoke('get-drawings'),
});

// Expose basic app info
contextBridge.exposeInMainWorld('appInfo', {
    version: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
});
