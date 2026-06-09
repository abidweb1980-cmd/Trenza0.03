Role & Context:
You are an expert Electron, Node.js, and Vanilla JS developer. I am building a high-performance desktop charting app using TradingView's Lightweight Charts.

Current Architecture:
My data consists of massive 1-minute OHLCV JSON files. I have already successfully implemented a "Pre-Indexing" strategy. My Main process maps the start/end timestamps of each JSON file. My Renderer successfully lazy-loads historical data via an IPC handler called get-historical-chunk. I have also started scaffolding the replay feature with an IPC handler called replay:start-stream.

The Goal:
Implement a complete, TradingView-style "Bar Replay" feature. The replay engine must handle Multi-Timeframe (MTF) updates, meaning the Main process will drip-feed 1-minute base candles, and the Renderer must dynamically aggregate these into higher timeframes (e.g., 5m, 15m, 1H) on the fly.

Implementation Blueprint & Strict Requirements:

1. Main Process (main.js) - The Replay Engine:

State Management: Create a state object to track the active replay session: isPlaying, currentReplayTimestamp, replaySpeed (ms interval), and replayBuffer (an array holding the upcoming future candles).

replay:start-stream Update: When called with a targetTimestamp, this handler must do two things:

Return a historical chunk of data (e.g., the 500 bars before the target) so the UI charts can initialize.

Load a massive "Replay Buffer" (e.g., 10,000 bars after the targetTimestamp) into the Main process memory. This prevents the need to read the JSON file continuously during playback.

Playback Controls (IPC Handlers): Implement replay:play, replay:pause, and replay:set-speed.

The Playback Loop: When replay:play is triggered, start a Node.js setInterval. On every tick:

Shift the next 1-minute candle out of the replayBuffer.

Send it to the Renderer via webContents.send('replay:tick', candle).

Buffer Refill Logic: If the replayBuffer runs low (e.g., less than 500 bars left), pause the tick, asynchronously read the next chunk from the appropriate JSON file using the existing file index, refill the buffer, and resume the tick.

2. Preload Script (preload.js):

Expose the new IPC handlers securely: playReplay, pauseReplay, setReplaySpeed.

Expose a listener for the tick stream: onReplayTick: (callback) => ipcRenderer.on('replay:tick', callback).

3. Renderer Process (renderer.js) - MTF Aggregation & Updating:

Chart Setup: Assume there are multiple Lightweight Charts series instantiated (e.g., series1m, series5m, series1h).

Historical Initialization: When start-stream returns the initial historical 500 bars of 1-minute data, run a setup function that aggregates those 500 base bars into the starting states for the 5m and 1h series, then call setData() on all of them.

The Tick Listener: Implement the window.electronAPI.onReplayTick((event, candle1m) => { ... }) listener.

Dynamic MTF Aggregation (Crucial): Inside the tick listener:

Immediately call series1m.update(candle1m).

Calculate the 5-minute interval start time for candle1m.time. If it matches the current 5m bar being built, update the High, Low, and Close. If it's a new 5m period, create a new 5m bar object.

Call series5m.update(current5mBar).

Repeat the dynamic aggregation logic for the 1-hour timeframe.

Output Constraints:
Do not modify my existing get-historical-chunk logic or file indexer. Update the specific code additions required for main.js (the buffering and interval logic), preload.js, and renderer.js (the MTF aggregation logic inside the update loop). Ensure code is heavily commented to explain the time % (interval * 60) math used for aggregating higher timeframes.