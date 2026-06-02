// magnetSnap.js
// -----------------------------------------------------------------------------
// "Magnet mode" – TradingView's CTRL-held behavior: snap the second
// anchor of a drawing tool to the closest visible data point.
//
// Designed to be reusable across tools.  Pass in whatever the
// "snappable objects" are for your tool:
//   • trendline   → candlesticks
//   • fib retracement → swing highs/lows
//   • channel     → trendlines
//   • etc.
//
// The objects must expose an "x" field and one or more Y fields.
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} SnapTarget
 * @property {number} x        – horizontal position (any unit, must be
 *                               comparable to the cursor's x)
 * @property {number} [open]
 * @property {number} [high]
 * @property {number} [low]
 * @property {number} [close]
 * @property {number[]} [ys]   – generic Y candidates (used when the
 *                               target is not a candle, e.g. a
 *                               trendline or pivot)
 */

/** Internal: linear-scan the closest-X index. */
function indexOfClosestX(arr, x) {
    let bestIdx = 0;
    let bestDist = Math.abs(arr[0].x - x);
    for (let i = 1; i < arr.length; i++) {
        const d = Math.abs(arr[i].x - x);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/** Internal: gather the anchorable Y values from a target. */
function targetYs(t) {
    if (Array.isArray(t.ys) && t.ys.length) return t.ys;
    const out = [];
    if (typeof t.open  === 'number') out.push(t.open);
    if (typeof t.high  === 'number') out.push(t.high);
    if (typeof t.low   === 'number') out.push(t.low);
    if (typeof t.close === 'number') out.push(t.close);
    return out;
}

/**
 * Find the closest target on the X-axis, then snap Y to the value in
 * that target nearest the cursor.
 *
 * @param {SnapTarget[]} targets
 * @param {{x:number, y:number}} cursor
 * @returns {{x:number, y:number, targetIndex:number, yField:string}|null}
 */
export function findClosestAnchor(targets, cursor) {
    if (!targets || targets.length === 0) return null;

    const idx = indexOfClosestX(targets, cursor.x);
    const t = targets[idx];

    const ys = targetYs(t);
    if (ys.length === 0) {
        return { x: t.x, y: cursor.y, targetIndex: idx, yField: 'none' };
    }

    let bestY = ys[0];
    let bestDist = Math.abs(cursor.y - ys[0]);
    for (let i = 1; i < ys.length; i++) {
        const d = Math.abs(cursor.y - ys[i]);
        if (d < bestDist) {
            bestDist = d;
            bestY = ys[i];
        }
    }

    return { x: t.x, y: bestY, targetIndex: idx, yField: 'ohlc/ys' };
}

/** Convenience wrapper for the common "snap to candle" case. */
export function findClosestCandleAnchor(candles, cursor) {
    return findClosestAnchor(candles, cursor);
}
