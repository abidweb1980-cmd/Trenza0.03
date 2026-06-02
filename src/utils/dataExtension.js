// Extends a candle dataset with "dummy" flat candles before and
// after the real data. This widens the chart's time axis so users
// can place trendline endpoints before the first real candle or
// after the last real candle.
//
// The dummy candles have:
//   - timestamps extrapolated by the dataset's median interval
//   - open = high = low = close = a flat "neutral" price (the
//     close of the nearest real candle), so they do not change
//     the chart's auto-scaled price range but still register
//     valid clicks.

/**
 * Build N dummy candles ending at the candle just before `first`.
 * @param {object} first - the first real candle
 * @param {number} intervalMs - time interval between consecutive candles (ms)
 * @param {number} count - how many dummy candles to generate
 */
function buildLeadingDummies(first, intervalMs, count) {
    const flatPrice = first.close;
    const dummies = [];
    for (let i = count; i >= 1; i--) {
        const ts = first.timestamp - i * intervalMs;
        dummies.push({
            timestamp: ts,
            datetime: new Date(ts).toISOString(),
            open: flatPrice, high: flatPrice, low: flatPrice, close: flatPrice,
            volume: 0,
        });
    }
    return dummies;
}

/**
 * Build N dummy candles starting at the candle just after `last`.
 * @param {object} last - the last real candle
 * @param {number} intervalMs - time interval between consecutive candles (ms)
 * @param {number} count - how many dummy candles to generate
 */
function buildTrailingDummies(last, intervalMs, count) {
    const flatPrice = last.close;
    const dummies = [];
    for (let i = 1; i <= count; i++) {
        const ts = last.timestamp + i * intervalMs;
        dummies.push({
            timestamp: ts,
            datetime: new Date(ts).toISOString(),
            open: flatPrice, high: flatPrice, low: flatPrice, close: flatPrice,
            volume: 0,
        });
    }
    return dummies;
}

/**
 * Detect the typical time interval (in ms) between consecutive
 * candles. Uses the median of the first few differences to be
 * robust against noise.
 */
function detectIntervalMs(candles) {
    if (candles.length < 2) return 60_000;
    const samples = Math.min(candles.length - 1, 10);
    const diffs = [];
    for (let i = 0; i < samples; i++) {
        diffs.push(candles[i + 1].timestamp - candles[i].timestamp);
    }
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)];
}

/**
 * Prepend and append dummy candles to the given dataset.
 *
 * @param {Array<object>} candles - real candle data
 * @param {number} [count=300] - number of dummy candles to add on each side
 * @returns {Array<object>} new array with dummies prepended/appended
 */
export function extendWithDummies(candles, count = 300) {
    if (!Array.isArray(candles) || candles.length === 0) return candles;
    const intervalMs = detectIntervalMs(candles);
    const leading = buildLeadingDummies(candles[0], intervalMs, count);
    const trailing = buildTrailingDummies(candles[candles.length - 1], intervalMs, count);
    return [...leading, ...candles, ...trailing];
}
