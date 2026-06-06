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
            console.log('[ReplayManager] Starting replay at timestamp:', timestamp);
            replayStartTimestamp = timestamp;

            // Get data before the replay start point
            const dataBefore = await window.replayAPI.getDataBefore(timestamp);
            dataBeforeReplay = dataBefore;
            console.log('[ReplayManager] Data before replay:', dataBefore.length, 'bars');

            const formattedData = dataBefore.map(candle => ({
                time: candle.timestamp / 1000,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
            }));

            candlestickSeries.setData(formattedData);

            if (formattedData.length > 0) {
                const pad = 50;
                const fromIdx = Math.max(0, formattedData.length - 100);
                const toIdx = formattedData.length + pad;
                chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: toIdx });
            }

            // Start stream and wait for first chunk
            await startStreamAndPreload(timestamp);

            currentState = STATES.ACTIVE;
            if (onStateChange) onStateChange(currentState);

            console.log('[ReplayManager] Replay ready, buffer:', buffer.length, 'bars');
            return true;
        } catch (error) {
            console.error('[ReplayManager] Error starting replay:', error);
            await stopReplay();
            return false;
        }
    }

    async function startStreamAndPreload(timestamp) {
        const streamInfo = await window.replayAPI.startStream(timestamp, BUFFER_REQUEST_SIZE);
        replayId = streamInfo.replayId;

        if (streamInfo.chunk && streamInfo.chunk.length > 0) {
            buffer.push(...streamInfo.chunk);
            console.log('[ReplayManager] Initial buffer:', buffer.length, 'bars');
        } else {
            console.warn('[ReplayManager] Stream returned empty first chunk');
        }
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
        currentState = STATES.IDLE;
        lastBarTime = 0;
        targetNextTime = 0;

        if (onStateChange) onStateChange(currentState);
        console.log('[ReplayManager] Replay stopped');
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
            console.log('[ReplayManager] Buffer empty, pausing playback');
            stopPlayback();
            return;
        }

        const nextBar = buffer.shift();
        const formattedBar = {
            time: nextBar.timestamp / 1000,
            open: nextBar.open,
            high: nextBar.high,
            low: nextBar.low,
            close: nextBar.close,
        };

        candlestickSeries.update(formattedBar);

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
                currentBar: dataBeforeReplay.length + 1,
                totalBuffered: buffer.length,
            });
        }
    }

    function stepForward() {
        if (currentState === STATES.IDLE) {
            console.warn('[ReplayManager] Cannot step, replay not active');
            return;
        }

        if (currentState === STATES.PLAYING) {
            stopPlayback();
        }

        playNextBar();
    }

    async function requestMoreData() {
        if (!replayId) return;

        try {
            const { chunk, hasMore } = await window.replayAPI.requestChunk(replayId);

            if (chunk.length > 0) {
                buffer.push(...chunk);
                console.log('[ReplayManager] Buffered', chunk.length, 'bars, total:', buffer.length);
            }

            if (!hasMore) {
                console.log('[ReplayManager] No more data available');
            }

            if (onBufferLow) {
                onBufferLow({ bufferSize: buffer.length, isLow: buffer.length < BUFFER_LOW_THRESHOLD });
            }
        } catch (error) {
            console.error('[ReplayManager] Error requesting chunk:', error);
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
