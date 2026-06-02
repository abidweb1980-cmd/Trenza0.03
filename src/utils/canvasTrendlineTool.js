// canvasTrendlineTool.js
// -----------------------------------------------------------------------------
// TradingView-style trendline tool, built on top of the generic
// `createDrawingTool` (canvasDrawingTool.js) and the reusable
// coordinate utilities (pointerCoords.js, angleSnap.js, magnetSnap.js).
//
// Modifier-key behavior – read directly off the pointer event:
//   • SHIFT held  → angle-lock the second anchor to the closest 45°
//   • CTRL  held  → "magnet" – snap to the closest candlestick
//   • Both held   → SHIFT wins (matches TradingView)
//
// The "set of snappable objects" lives in `state.snapTargets`; the
// host can repopulate it (e.g. with the currently visible candles)
// any time without touching this file.
// -----------------------------------------------------------------------------

import { createDrawingTool } from './canvasDrawingTool.js';
import { clampToNearest45Degrees, radToDeg } from './angleSnap.js';
import { findClosestCandleAnchor } from './magnetSnap.js';

// -------- shared drawing state ---------------------------------------------

export const state = {
    /** Commit/manage the list of trendlines.  Each shape is:
     *  { a:{x,y}, b:{x,y}, modsAtDraw:{shift,ctrl,...}, ts:number }
     */
    shapes: [],
    /** Currently visible candles in CANVAS-PIXEL space, e.g.
     *  [{ x:120, open:100, high:110, low:90, close:105 }, ...]
     *  Re-populate this from your chart's coordinate converter
     *  before the user starts drawing. */
    snapTargets: [],
    /** Optional human-readable name (e.g. "Magnet: High"). */
    snapStatus: '',
    crosshairMode: 'Normal',  // 'Normal' | 'MagnetOHLC'
};

// -------- pure helper: resolve the live point ------------------------------

/**
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} raw
 * @param {{shift:boolean, ctrl:boolean}} mods
 */
function resolveTrendlinePoint(start, raw, mods) {
    if (mods.shift) {
        state.crosshairMode = 'Normal';
        state.snapStatus = '';
        const r = clampToNearest45Degrees(start, raw);
        state.snapStatus = `${Math.round(radToDeg(r.angle))}°`;
        return { x: r.x, y: r.y };
    }
    if (mods.ctrl) {
        const snap = findClosestCandleAnchor(state.snapTargets, raw);
        if (snap) {
            state.crosshairMode = 'MagnetOHLC';
            state.snapStatus = `Candle #${snap.targetIndex} (${snap.yField})`;
            return { x: snap.x, y: snap.y };
        }
    }
    state.crosshairMode = 'Normal';
    state.snapStatus = '';
    return { x: raw.x, y: raw.y };
}

// -------- the "shape" object: { a, b, mods, ts } ---------------------------

function makeTrendlineShape(a, b) {
    return {
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        ts: Date.now(),
    };
}

// -------- the draw routine --------------------------------------------------

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{a:{x,y}, b:{x,y}}} shape
 * @param {boolean} isLive  – true → render the in-progress preview
 *                            with a dashed line + small anchor dots
 */
function drawTrendline(ctx, shape, isLive) {
    ctx.save();
    ctx.lineWidth   = isLive ? 1.5 : 1.5;
    ctx.lineCap     = 'round';
    ctx.strokeStyle = isLive ? '#ef5350' : '#26a69a';

    if (isLive) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(shape.a.x, shape.a.y);
    ctx.lineTo(shape.b.x, shape.b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Anchor dots for both committed and live shapes (helps UX).
    ctx.fillStyle = isLive ? '#ef5350' : '#26a69a';
    for (const p of [shape.a, shape.b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// -------- public factory ----------------------------------------------------

/**
 * Build and attach a fully working trendline tool to a <canvas>.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object}  [opts]
 * @param {object}  [opts.store]  – { shapes:[] } if you want the tool
 *                                   to share a store with other tools.
 * @param {() => void}                       [opts.onCancel]
 * @param {(shape:object) => void}           [opts.onCommit]
 * @param {(p:{x:number,y:number}, mods:object) => void} [opts.onProgress]
 * @param {(ctx:CanvasRenderingContext2D) => void} [opts.underlay]
 * @returns {{
 *   setSnapTargets: (t:object[]) => void,
 *   clear: () => void,
 *   getShapes: () => object[],
 *   detach: () => void,
 *   start: () => void,
 *   stop:  () => void,
 * }}
 */
export function createTrendlineTool(canvas, opts = {}) {
    const tool = createDrawingTool(canvas, {
        name: 'trendline',
        resolvePoint: resolveTrendlinePoint,
        draw: drawTrendline,
        makeShape: makeTrendlineShape,
    }, {
        store: opts.store || state,
        underlay: opts.underlay,
        onCommit: opts.onCommit,
        onProgress: opts.onProgress,
        onCancel: opts.onCancel,
    });

    return {
        setSnapTargets(targets) { state.snapTargets = targets || []; },
        clear()   { state.shapes.length = 0; },
        getShapes(){ return state.shapes.slice(); },
        detach()  { tool.detach(); },
        start()   { tool.start(); },
        stop()    { tool.stop(); },
    };
}
