// chartSnap.js
// -----------------------------------------------------------------------------
// TradingView-style keyboard-modifier snap for the LIGHTWEIGHT-CHARTS
// trendline tool.  Used while in "drawing" mode.
//
//   SHIFT held  →  angle-lock the second anchor to the closest 45°
//                  increment relative to the first anchor
//
//   CTRL  held  →  magnet-snap the second anchor to the nearest
//                  OHLC value of the candle under the CROSSHAIR.
//
// CTRL snap algorithm (the TradingView way):
//   1. The crosshair's param.time identifies the current candle
//      (e.g. #326).  We look that candle up in the series.
//   2. We translate the cursor's current pixel y → price via
//      series.coordinateToPrice.
//   3. We compare that translated price to the candle's open / high
//      / low / close and pick whichever is nearest (smallest |Δ|).
//   4. We snap the y to that OHLC's price, and the x to the
//      candle's center (timeToCoordinate).
//   5. The caller is expected to set state.crosshairMode = 'MagnetOHLC'
//      for visual feedback.
//
// SHIFT snap algorithm:
//   1. We convert the first anchor (time, price) to pixel coords
//      so the math has consistent units.
//   2. We angle-snap (first → cursor) to the closest 45° via
//      Math.atan2 + Math.round.
// -----------------------------------------------------------------------------

import { clampToNearest45Degrees } from './angleSnap.js';

/**
 * Build a list of all candles in CANVAS-PIXEL space.
 * Each entry exposes { time, x, open, high, low, close } in pixels.
 * Used as a lookup so we can find the candle at param.time.
 */
export function buildCandlePixelTargets(chart, series) {
    if (!series || typeof series.dataByIndex !== 'function') return [];
    const out = [];
    let i = 0;
    let safety = 0;
    while (safety++ < 100000) {
        const c = series.dataByIndex(i);
        if (!c) break;
        const x = chart.timeScale().timeToCoordinate(c.time);
        const open  = series.priceToCoordinate(c.open);
        const high  = series.priceToCoordinate(c.high);
        const low   = series.priceToCoordinate(c.low);
        const close = series.priceToCoordinate(c.close);
        if (
            x === null || x === undefined ||
            [open, high, low, close].some(v => v === null || v === undefined)
        ) {
            i++;
            continue;
        }
        out.push({ index: i, time: c.time, x, open, high, low, close,
                   openPrice: c.open, highPrice: c.high, lowPrice: c.low, closePrice: c.close });
        i++;
    }
    return out;
}

/**
 * Find the candle whose `time` exactly matches `t`.
 * Candle time stamps are integer seconds (UTCTimestamp), so we can
 * compare directly.
 */
function findCandleByTime(targets, t) {
    if (!targets || t === undefined || t === null) return null;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i].time === t) return targets[i];
    }
    return null;
}

/**
 * SHIFT snap: angle-lock the (start → cursor) vector to 45° and
 * return the new pixel point + the angle in degrees.
 */
export function snapAngle45(startPx, cursorPx) {
    const r = clampToNearest45Degrees(startPx, cursorPx);
    const dx = r.x - startPx.x;
    const dy = r.y - startPx.y;
    const angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    return { x: r.x, y: r.y, angleDeg };
}

/**
 * CTRL snap: snap the cursor's pixel point to the OHLC of the candle
 * under the crosshair (param.time) that is nearest to the cursor's
 * translated price.
 *
 * @param {object} opts
 * @param {object} opts.chart    lightweight-charts IChartApi
 * @param {object} opts.series   the candlestick series
 * @param {object} opts.param    the crosshair MouseEventParams
 * @param {Array}  opts.targets  result of buildCandlePixelTargets
 * @returns {{x:number, y:number, field:string, candleIndex:number, price:number}|null}
 */
export function snapToCandleOHLC({ chart, series, param, targets }) {
    // 1) Locate the candle at the crosshair's time.
    const candle = findCandleByTime(targets, param && param.time);
    if (!candle) {
        console.log('[chartSnap] CTRL pressed but no candle under crosshair at time', param && param.time);
        return null;
    }
    console.log('[chartSnap] CTRL pressed, crosshair is on candle #' + candle.index,
        'OHLC =', { o: candle.openPrice, h: candle.highPrice, l: candle.lowPrice, c: candle.closePrice });

    // 2) Translate the cursor's pixel y → price.
    const cursorPrice = series.coordinateToPrice(param.point.y);
    if (cursorPrice === null || cursorPrice === undefined) return null;
    console.log('[chartSnap] cursor price:', cursorPrice);

    // 3) Find the OHLC nearest to the cursor's price.
    const ohlc = [
        ['open',  candle.openPrice,  candle.open],
        ['high',  candle.highPrice,  candle.high],
        ['low',   candle.lowPrice,   candle.low],
        ['close', candle.closePrice, candle.close],
    ];
    let bestField = ohlc[0][0];
    let bestPrice = ohlc[0][1];
    let bestY     = ohlc[0][2];
    let bestDist  = Math.abs(cursorPrice - ohlc[0][1]);
    for (let i = 1; i < ohlc.length; i++) {
        const d = Math.abs(cursorPrice - ohlc[i][1]);
        if (d < bestDist) {
            bestDist  = d;
            bestField = ohlc[i][0];
            bestPrice = ohlc[i][1];
            bestY     = ohlc[i][2];
        }
    }
    console.log('[chartSnap] nearest OHLC:', bestField, '=', bestPrice,
        '(Δ =', bestDist, ') → snapping to', { x: candle.x, y: bestY });

    return {
        x: candle.x,
        y: bestY,
        field: bestField,
        candleIndex: candle.index,
        price: bestPrice,
    };
}

/**
 * Resolve the FIRST anchor at click time.  Same algorithm as the
 * crosshair-move CTRL snap, but applied to a click payload.
 *
 * Returns { time, price, mode, info }.
 *   • mode  – 'free' | 'angle-45' | 'magnet-ohlc'
 *   • info  – debug info (angleDeg for SHIFT, field+candleIndex for CTRL)
 */
export function resolveFirstAnchor({ chart, series, param, targets, shift, ctrl }) {
    const rawX = param.point.x;
    const rawY = param.point.y;

    // SHIFT wins over CTRL (matches TradingView).
    if (shift) {
        // No fixed start for the first anchor, so SHIFT on the
        // first click is a no-op (we just use the raw position).
        const time  = param.time;
        const price = series.coordinateToPrice(rawY);
        console.log('[chartSnap] first click SHIFT held – no anchor to angle from yet, using raw',
            { time, price });
        return { time, price, mode: 'free-shift', info: {} };
    }
    if (ctrl) {
        // Find the candle at the crosshair's time, then snap to the
        // nearest OHLC of THAT candle.
        const candle = targets ? targets.find(c => c.time === param.time) : null;
        if (!candle) {
            const time  = param.time;
            const price = series.coordinateToPrice(rawY);
            console.log('[chartSnap] first click CTRL held but no candle under cursor at time', param.time,
                '– using raw');
            return { time, price, mode: 'free-ctrl-noCandle', info: {} };
        }
        const cursorPrice = series.coordinateToPrice(rawY);
        const ohlc = [
            ['open',  candle.openPrice,  candle.open],
            ['high',  candle.highPrice,  candle.high],
            ['low',   candle.lowPrice,   candle.low],
            ['close', candle.closePrice, candle.close],
        ];
        let bestField = ohlc[0][0];
        let bestPrice = ohlc[0][1];
        let bestDist  = Math.abs(cursorPrice - ohlc[0][1]);
        for (let i = 1; i < ohlc.length; i++) {
            const d = Math.abs(cursorPrice - ohlc[i][1]);
            if (d < bestDist) { bestDist = d; bestField = ohlc[i][0]; bestPrice = ohlc[i][1]; }
        }
        console.log('[chartSnap] first click CTRL – snap to candle #' + candle.index,
            bestField, '=', bestPrice, '(Δ =', bestDist, ')');
        return {
            time:  candle.time,
            price: bestPrice,
            mode:  'magnet-ohlc-first',
            info:  { field: bestField, candleIndex: candle.index },
        };
    }

    return {
        time:  param.time,
        price: series.coordinateToPrice(rawY),
        mode:  'free',
        info:  {},
    };
}

/**
 * Resolve the snapped pixel point for an anchor DRAG (i.e. moving
 * p1 or p2 of an already-committed trendline).  Same algorithms
 * as the drawing flow:
 *   • SHIFT → 45° lock relative to the OTHER anchor
 *   • CTRL  → magnet to the nearest OHLC of the candle under the
 *             cursor (uses the current mouse x → time)
 *
 * @param {object}  opts
 * @param {object}  opts.chart
 * @param {object}  opts.series
 * @param {{x:number, y:number}} opts.cursorPx
 * @param {Array}   opts.targets
 * @param {{time:any, price:number}} opts.otherAnchor
 *              the *other* endpoint of the line – used as the angle
 *              origin for SHIFT
 * @param {boolean} opts.shift
 * @param {boolean} opts.ctrl
 * @returns {{x:number, y:number, mode:string, info?:object}}
 */
export function resolveDragSnap({ chart, series, cursorPx, targets, otherAnchor, shift, ctrl }) {
    if (shift) {
        // 45° lock relative to the other anchor.
        const otherPx = {
            x: chart.timeScale().timeToCoordinate(otherAnchor.time),
            y: series.priceToCoordinate(otherAnchor.price),
        };
        if (otherPx.x === null || otherPx.y === null) {
            return { x: cursorPx.x, y: cursorPx.y, mode: 'free' };
        }
        const r = snapAngle45(otherPx, cursorPx);
        return { x: r.x, y: r.y, mode: 'angle-45', info: { angleDeg: r.angleDeg } };
    }
    if (ctrl) {
        // OHLC magnet on the candle under the cursor's x.
        const t = chart.timeScale().coordinateToTime(cursorPx.x);
        if (t === null || t === undefined) {
            return { x: cursorPx.x, y: cursorPx.y, mode: 'free' };
        }
        const candle = targets ? targets.find(c => c.time === t) : null;
        if (!candle) {
            return { x: cursorPx.x, y: cursorPx.y, mode: 'free' };
        }
        const cursorPrice = series.coordinateToPrice(cursorPx.y);
        if (cursorPrice === null || cursorPrice === undefined) {
            return { x: cursorPx.x, y: cursorPx.y, mode: 'free' };
        }
        const ohlc = [
            ['open',  candle.openPrice,  candle.open],
            ['high',  candle.highPrice,  candle.high],
            ['low',   candle.lowPrice,   candle.low],
            ['close', candle.closePrice, candle.close],
        ];
        let bestField = ohlc[0][0];
        let bestPrice = ohlc[0][1];
        let bestY     = ohlc[0][2];
        let bestDist  = Math.abs(cursorPrice - ohlc[0][1]);
        for (let i = 1; i < ohlc.length; i++) {
            const d = Math.abs(cursorPrice - ohlc[i][1]);
            if (d < bestDist) { bestDist = d; bestField = ohlc[i][0]; bestPrice = ohlc[i][1]; bestY = ohlc[i][2]; }
        }
        return {
            x: candle.x,
            y: bestY,
            mode: 'magnet-ohlc',
            info: { field: bestField, candleIndex: candle.index, price: bestPrice },
        };
    }
    return { x: cursorPx.x, y: cursorPx.y, mode: 'free' };
}
