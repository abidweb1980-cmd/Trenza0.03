import { extendWithDummies } from './dataExtension.js';

// Replay Manager - Handles the bar replay functionality with precise playback timing
export function createReplayManager(chart, candlestickSeries) {
    // Replay states
    const STATES = {
        IDLE: 'IDLE',
        ACTIVE: 'ACTIVE',
        PLAYING: 'PLAYING',
        PAUSED: 'PAUSED'
    };

    // State
    let currentState = STATES.IDLE;
    let replayId = null;
    let replayStartTimestamp = null;
    let dataBeforeReplay = [];
    let buffer = [];
    let autoScroll = true;
    
    // Combined data array (initial + streamed bars)
    let allData = [];
    
    // Trailing dummies for drawing beyond the candle range
    let trailingDummies = [];
    const DUMMY_COUNT = 1000;

    // Playback timing state
    let lastBarTime = 0;
    let playbackSpeed = 1000; // ms per bar (default 1 second)
    let rafId = null;
    let targetNextTime = 0;

    // Callbacks
    let onStateChange = null;
    let onProgressUpdate = null;
    let onBufferLow = null;

    // Buffer thresholds
    const BUFFER_LOW_THRESHOLD = 200;
    const BUFFER_REQUEST_SIZE = 500;

    // Get current state
    function getState() {
        return currentState;
    }

    function isActive() {
        return currentState !== STATES.IDLE;
    }

    function isPlaying() {
        return currentState === STATES.PLAYING;
    }

    function setSpeed(msPerBar) {
        playbackSpeed = msPerBar;
        if (isPlaying()) {
            // Adjust target time so the next bar fires at the right moment
            const now = performance.now();
            if (targetNextTime > now) {
                targetNextTime = now;
            }
        }
    }

    function getSpeed() {
        return playbackSpeed;
    }

    function setAutoScroll(enabled) {
        autoScroll = enabled;
    }

    async function startReplay(timestamp) {
        if (currentState !== STATES.IDLE) {
            console.warn('[ReplayManager] Replay already active');
            return false;
        }

        try {
            console.log('[ReplayManager] Starting replay at timestamp:', timestamp, '(' + new Date(timestamp).toISOString() + ')');
            replayStartTimestamp = timestamp;

            // Get data before the replay start point
            const dataBefore = await window.replayAPI.getDataBefore(timestamp);
            console.log('[ReplayManager] Data before replay:', dataBefore.length, 'bars, last:', dataBefore.length ? new Date(dataBefore[dataBefore.length-1].timestamp).toISOString() : 'none');
            dataBeforeReplay = dataBefore;

            // Build initial data - all bars before replay starts
            let allDataTemp = [];
            for (const candle of dataBefore) {
                allDataTemp.push({
                    time: candle.timestamp / 1000,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                });
            }
            console.log('[ReplayManager] Built initial data:', allDataTemp.length);

            // Start stream and wait for first chunk
            await startStreamAndPreload(timestamp);
            console.log('[ReplayManager] Initial buffer after preload:', buffer.length, 'bars');

            // Add first bar from buffer to initial data
            if (buffer.length > 0) {
                const firstBar = buffer.shift();
                console.log('[ReplayManager] Adding first streamed bar:', new Date(firstBar.timestamp).toISOString());
                allDataTemp.push({
                    time: firstBar.timestamp / 1000,
                    open: firstBar.open,
                    high: firstBar.high,
                    low: firstBar.low,
                    close: firstBar.close,
                });
            }
            
            console.log('[ReplayManager] Final allData length:', allDataTemp.length);

            // Update module-level allData and add trailing dummies for drawing range
            allData = allDataTemp;
            // Create trailing dummies to allow drawing beyond the candle range
            if (allData.length > 0) {
                const lastRealBar = allDataTemp[allDataTemp.length - 1];
                trailingDummies = [];
                for (let i = 1; i <= DUMMY_COUNT; i++) {
                    trailingDummies.push({
                        time: lastRealBar.time + i * 60, // 60 seconds = 1 minute
                        open: lastRealBar.close,
                        high: lastRealBar.close,
                        low: lastRealBar.close,
                        close: lastRealBar.close,
                    });
                }
                allData = [...allData, ...trailingDummies];
            }
            
            // Set data on chart
            try {
                candlestickSeries.setData(allData);
                console.log('[ReplayManager] Chart data set successfully with', allData.length, 'bars');
            } catch (e) {
                console.error('[ReplayManager] Failed to set chart data:', e);
            }

            if (allData.length > 0) {
                const pad = 50;
                const fromIdx = Math.max(0, allData.length - DUMMY_COUNT - 200);
                const toIdx = allData.length + pad;
                chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: toIdx });
            }

            currentState = STATES.ACTIVE;
            console.log('[ReplayManager] State changed to ACTIVE');
            if (onStateChange) onStateChange(currentState);

            return true;
        } catch (error) {
            console.error('[ReplayManager] Error starting replay:', error);
            await stopReplay();
            return false;
        }
    }

    async function startStreamAndPreload(timestamp) {
        console.log('[ReplayManager] startStreamAndPreload called with timestamp:', timestamp, '(' + new Date(timestamp).toISOString() + ')');
        const streamInfo = await window.replayAPI.startStream(timestamp, BUFFER_REQUEST_SIZE);
        console.log('[ReplayManager] startStream returned:', streamInfo);
        replayId = streamInfo.replayId;

        if (streamInfo.chunk && streamInfo.chunk.length > 0) {
            buffer.push(...streamInfo.chunk);
        }
        console.log('[ReplayManager] Buffer after preload:', buffer.length);
    }

    function stopReplay() {
        console.log('[ReplayManager] Stopping replay');
        stopPlayback();

        if (replayId) {
            window.replayAPI.stopStream(replayId).catch(() => {});
        }

        replayId = null;
        replayStartTimestamp = null;
        dataBeforeReplay = [];
        buffer = [];
        allData = [];
        currentState = STATES.IDLE;
        lastBarTime = 0;
        targetNextTime = 0;

        if (onStateChange) onStateChange(currentState);
    }

    // requestAnimationFrame-based playback loop
    function playbackTick(timestamp) {
        if (currentState !== STATES.PLAYING) {
            rafId = null;
            return;
        }

        if (timestamp >= targetNextTime) {
            playNextBar();
            // Schedule next bar: keep precise timing by setting target to last execution + speed
            targetNextTime = timestamp + playbackSpeed;
        }

        rafId = requestAnimationFrame(playbackTick);
    }

    function startPlayback() {
        if (currentState === STATES.PLAYING) return;

        currentState = STATES.PLAYING;
        if (onStateChange) onStateChange(currentState);

        // Reset timing so first bar fires immediately
        targetNextTime = performance.now();
        lastBarTime = targetNextTime;
        rafId = requestAnimationFrame(playbackTick);

        console.log('[ReplayManager] Playback started at speed:', playbackSpeed, 'ms/bar');
    }

    function stopPlayback() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        if (currentState === STATES.PLAYING) {
            currentState = STATES.PAUSED;
            if (onStateChange) onStateChange(currentState);
        }

        console.log('[ReplayManager] Playback stopped');
    }

    function togglePlayback() {
        if (currentState === STATES.PLAYING) {
            stopPlayback();
        } else {
            startPlayback();
        }
    }

    function playNextBar() {
        // If buffer is low, request more data (non-blocking)
        if (buffer.length < BUFFER_LOW_THRESHOLD) {
            requestMoreData();
        }

        if (buffer.length === 0) {
            console.log('[ReplayManager] Buffer empty');
            return;
        }

        const nextBar = buffer.shift();
        console.log('[ReplayManager] Playing bar:', new Date(nextBar.timestamp).toISOString());
        const formattedBar = {
            time: nextBar.timestamp / 1000,
            open: nextBar.open,
            high: nextBar.high,
            low: nextBar.low,
            close: nextBar.close,
        };

        // Insert bar BEFORE trailing dummies
        const realData = allData.slice(0, -trailingDummies.length);
        realData.push(formattedBar);
        
        // Update trailing dummies starting from this new bar
        trailingDummies = [];
        const nextBarTime = formattedBar.time;
        for (let i = 1; i <= DUMMY_COUNT; i++) {
            trailingDummies.push({
                time: nextBarTime + i * 60, // 60 seconds = 1 minute
                open: nextBar.close,
                high: nextBar.close,
                low: nextBar.close,
                close: nextBar.close,
            });
        }
        
        allData = [...realData, ...trailingDummies];
        candlestickSeries.setData(allData);

        // Auto-scroll to keep the new bar in view
        if (autoScroll) {
            try {
                const currentRange = chart.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                    chart.timeScale().setVisibleLogicalRange({
                        from: currentRange.from + 1,
                        to: currentRange.to + 1,
                    });
                }
            } catch (_) { /* ignore range errors */ }
        }

        if (onProgressUpdate) {
            onProgressUpdate({
                currentBar: allData.length - trailingDummies.length,
                totalBuffered: buffer.length,
            });
        }
    }

    function stepForward() {
        console.log('[ReplayManager] stepForward called, state:', currentState, 'buffer:', buffer.length);
        if (currentState === STATES.IDLE) {
            console.warn('[ReplayManager] Cannot step, replay not active');
            return;
        }

        if (currentState === STATES.PLAYING) {
            stopPlayback();
        }

        // If buffer is empty, request chunk synchronously
        if (buffer.length === 0 && replayId) {
            console.log('[ReplayManager] Buffer empty, requesting more');
            window.replayAPI.requestChunk(replayId).then(({ chunk }) => {
                console.log('[ReplayManager] Got chunk:', chunk ? chunk.length : 0);
                if (chunk && chunk.length > 0) {
                    buffer.push(...chunk);
                }
                if (buffer.length > 0) {
                    playNextBar();
                } else {
                    console.warn('[ReplayManager] Still empty after request');
                }
            });
            return;
        }

        playNextBar();
    }

    async function requestMoreData() {
        if (!replayId) return;

        try {
            const { chunk, hasMore } = await window.replayAPI.requestChunk(replayId);

            if (chunk.length > 0) {
                buffer.push(...chunk);
            }

            if (!hasMore) {
            }

            if (onBufferLow) {
                onBufferLow({ bufferSize: buffer.length, isLow: buffer.length < BUFFER_LOW_THRESHOLD });
            }
        } catch (error) {
        }
    }

    function getBufferInfo() {
        return {
            bufferSize: buffer.length,
            isLow: buffer.length < BUFFER_LOW_THRESHOLD,
        };
    }

    function onStateChangeCallback(callback) {
        onStateChange = callback;
    }

    function onProgressUpdateCallback(callback) {
        onProgressUpdate = callback;
    }

    function onBufferLowCallback(callback) {
        onBufferLow = callback;
    }

    function getReplayInfo() {
        return {
            state: currentState,
            replayId,
            startTimestamp: replayStartTimestamp,
            bufferLength: buffer.length,
            playbackSpeed,
            autoScroll,
        };
    }

    return {
        STATES,
        getState,
        isActive,
        isPlaying,
        setSpeed,
        getSpeed,
        setAutoScroll,
        startReplay,
        stopReplay,
        startPlayback,
        stopPlayback,
        togglePlayback,
        stepForward,
        getBufferInfo,
        onStateChangeCallback,
        onProgressUpdateCallback,
        onBufferLowCallback,
        getReplayInfo,
    };
}
