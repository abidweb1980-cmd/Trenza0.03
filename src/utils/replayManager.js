import { extendWithDummies } from './dataExtension.js';

// Replay Manager - Handles the bar replay functionality with interval-based tick system
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
    let replayStartTimestamp = null;
    let dataBeforeReplay = [];
    let autoScroll = true;
    
    // Combined data array (initial + streamed bars)
    let allData = [];
    
    // Trailing dummies for drawing beyond the candle range
    let trailingDummies = [];
    const DUMMY_COUNT = 1000;

    // Playback timing state
    let playbackSpeed = 1000; // ms per bar (default 1 second)

    // Callbacks
    let onStateChange = null;
    let onProgressUpdate = null;

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
        if (isPlaying() && window.replayAPI) {
            // Update speed in main process
            window.replayAPI.setSpeed(msPerBar);
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

            // Initialize streaming - buffer will receive ticks via onTick
            await window.replayAPI.startStream(timestamp, 500);
            console.log('[ReplayManager] Stream initialized, waiting for ticks');
            
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
            stopReplay();
            return false;
        }
    }

    function stopReplay() {
        console.log('[ReplayManager] Stopping replay');
        if (currentState === STATES.PLAYING && window.replayAPI) {
            window.replayAPI.pause();
        }

        replayStartTimestamp = null;
        dataBeforeReplay = [];
        allData = [];
        trailingDummies = [];
        currentState = STATES.IDLE;

        if (onStateChange) onStateChange(currentState);
    }

    function startPlayback() {
        // Trigger playback via main process
        if (window.replayAPI && currentState !== STATES.PLAYING) {
            window.replayAPI.play();
            currentState = STATES.PLAYING;
            if (onStateChange) onStateChange(currentState);
        }
    }

    function stopPlayback() {
        // Trigger pause via main process
        if (window.replayAPI && currentState === STATES.PLAYING) {
            window.replayAPI.pause();
            currentState = STATES.PAUSED;
            if (onStateChange) onStateChange(currentState);
        }
    }

    function togglePlayback() {
        if (currentState === STATES.PLAYING) {
            stopPlayback();
        } else {
            startPlayback();
        }
    }

    function stepForward() {
        console.log('[ReplayManager] stepForward called, state:', currentState);
        if (currentState === STATES.IDLE) {
            console.warn('[ReplayManager] Cannot step, replay not active');
            return;
        }

        if (currentState === STATES.PLAYING) {
            stopPlayback();
        }

        // Trigger step via IPC (uses tick-based system)
        if (window.replayAPI && window.replayAPI.step) {
            window.replayAPI.step();
        }
    }

    function onStateChangeCallback(callback) {
        onStateChange = callback;
    }

    function onProgressUpdateCallback(callback) {
        onProgressUpdate = callback;
    }

    function onBufferLowCallback(callback) {}

    function getReplayInfo() {
        return {
            state: currentState,
            startTimestamp: replayStartTimestamp,
            bufferLength: 0,
            playbackSpeed,
            autoScroll,
        };
    }

    /**
     * Handle incoming tick from the main process (interval-based playback).
     * This updates the chart data with a new candle and maintains trailing dummies.
     */
    function handleTick(candle) {
        if (currentState === STATES.IDLE) return;
        
        const formattedBar = {
            time: candle.timestamp / 1000,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        };

        // Insert bar BEFORE trailing dummies
        const realData = allData.slice(0, -trailingDummies.length);
        realData.push(formattedBar);
        
        // Update trailing dummies starting from this new bar
        const nextBarTime = formattedBar.time;
        trailingDummies = [];
        for (let i = 1; i <= DUMMY_COUNT; i++) {
            trailingDummies.push({
                time: nextBarTime + i * 60, // 60 seconds = 1 minute
                open: candle.close,
                high: candle.close,
                low: candle.close,
                close: candle.close,
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
            } catch (_) { }
        }

        if (onProgressUpdate) {
            onProgressUpdate({
                currentBar: allData.length - trailingDummies.length,
                totalBuffered: 0,
            });
        }
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
        getBufferInfo: () => ({ bufferSize: 0, isLow: false }),
        onStateChangeCallback,
        onProgressUpdateCallback,
        onBufferLowCallback,
        getReplayInfo,
        handleTick,
    };
}