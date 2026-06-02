// canvasDrawingTool.js
// -----------------------------------------------------------------------------
// A generic, reusable "click → drag → release" drawing tool for an
// HTML5 <canvas>.
//
// ANY tool that needs exactly two anchors (trendline, arrow, measure,
// parallel channel, etc.) can plug in by providing a small `hooks`
// object that knows:
//   • how to compute the *current* point from a raw mouse position
//     (the modifier-key behaviors live here – Shift/angle lock,
//      Ctrl/magnet, etc.)
//   • how to draw itself on a 2D context
//   • how to serialize a finished shape
//
// This file owns the *generic* plumbing:
//   • pointerdown ON the canvas (start of drag)
//   • pointermove / pointerup on WINDOW (so dragging continues smoothly
//     even when the cursor leaves the canvas – critical for CTRL+drag
//     where the browser may try to "open in new tab" otherwise)
//   • keydown (Escape) on window
//   • modifier-key resolution straight from the pointer event
//   • the requestAnimationFrame render loop
//   • the live "in-progress" preview vs. committed shapes
// -----------------------------------------------------------------------------

import { toCanvasPoint, getEventModifiers } from './pointerCoords.js';

/**
 * @typedef {Object} ToolHooks
 * @property {(start:{x:number,y:number}, raw:{x:number,y:number}, mods:{shift:boolean,ctrl:boolean,alt:boolean,meta:boolean}) => {x:number,y:number}} resolvePoint
 * @property {(ctx:CanvasRenderingContext2D, shape:object, isLive:boolean) => void} draw
 * @property {(start:{x:number,y:number}, end:{x:number,y:number}) => object} makeShape
 * @property {string} [name]
 */

/**
 * Create and wire a drawing tool onto a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {ToolHooks} hooks
 * @param {object}  [opts]
 * @param {object}  [opts.store]      – { shapes:[] } external store
 * @param {(line:object)=>void} [opts.onCommit]
 * @param {(p:{x:number,y:number}, mods:object)=>void} [opts.onProgress]
 * @param {()=>void}              [opts.onCancel]
 * @param {(ctx:CanvasRenderingContext2D)=>void} [opts.underlay]
 *
 * @returns {{
 *   start:    () => void,
 *   stop:     () => void,
 *   detach:   () => void,
 *   addShape: (s:object) => void,
 *   clearShapes: () => void,
 *   getShapes:   () => object[],
 * }}
 */
export function createDrawingTool(canvas, hooks, opts = {}) {
    if (!canvas) throw new Error('createDrawingTool: canvas is required');
    if (!hooks || typeof hooks.resolvePoint !== 'function' ||
        typeof hooks.draw !== 'function' ||
        typeof hooks.makeShape !== 'function') {
        throw new Error('createDrawingTool: hooks must provide resolvePoint, draw, makeShape');
    }

    const ctx = canvas.getContext('2d');
    const store = opts.store || { shapes: [] };

    // -------- live state ----------------------------------------------------
    const live = {
        active: false,
        drawing: false,
        pointerId: null,           // the active pointer (so we ignore other fingers/stylus)
        start: { x: 0, y: 0 },
        end:   { x: 0, y: 0 },
        mods:  { shift: false, ctrl: false, alt: false, meta: false },
    };

    // -------- input handlers ------------------------------------------------

    /**
     * We only act on a pointerdown if EITHER:
     *   • it's a normal primary-button click (button === 0), OR
     *   • it's a CTRL/Meta-modified click (button === -1 in some
     *     browsers, e.g. when the browser intends to "open in new tab")
     *
     * We explicitly handle CTRL+click as "start drawing" so the user
     * can hold CTRL and the magnet-snap behavior actually triggers.
     */
    function shouldStartDraw(e) {
        if (e.button === 0) return true;
        if (e.button === undefined) return true;
        if (e.button === -1 && (e.ctrlKey || e.metaKey)) return true;
        return false;
    }

    function onPointerDown(e) {
        if (!shouldStartDraw(e)) return;
        // CRITICAL: preventDefault stops the browser's CTRL+click
        // "open link in new tab" / context-menu behavior.  This is
        // what makes CTRL-held drawing actually work.
        e.preventDefault();
        try { e.stopPropagation(); } catch {}

        const p = toCanvasPoint(canvas, e);
        live.pointerId = e.pointerId;
        live.mods = getEventModifiers(e);
        live.start = p;
        live.end   = p;
        live.drawing = true;

        if (e.pointerId !== undefined && canvas.setPointerCapture) {
            try { canvas.setPointerCapture(e.pointerId); } catch {}
        }
    }

    function onPointerMove(e) {
        if (!live.drawing) return;
        // Ignore other pointers (e.g. a second finger on a touchscreen)
        if (live.pointerId !== null && e.pointerId !== live.pointerId) return;

        const raw = toCanvasPoint(canvas, e);
        live.mods = getEventModifiers(e);
        live.end = hooks.resolvePoint(live.start, raw, live.mods);
        if (typeof opts.onProgress === 'function') {
            opts.onProgress(live.end, live.mods);
        }
    }

    function onPointerUp(e) {
        if (!live.drawing) return;
        if (live.pointerId !== null && e.pointerId !== live.pointerId) return;

        const raw = toCanvasPoint(canvas, e);
        live.mods = getEventModifiers(e);
        live.end = hooks.resolvePoint(live.start, raw, live.mods);

        const shape = hooks.makeShape(live.start, live.end);
        store.shapes.push(shape);
        live.drawing = false;
        live.pointerId = null;

        if (typeof opts.onCommit === 'function') opts.onCommit(shape);
    }

    function onKeyDown(e) {
        if (e.key === 'Escape' && live.drawing) {
            live.drawing = false;
            live.pointerId = null;
            if (typeof opts.onCancel === 'function') opts.onCancel();
        }
    }

    // -------- listeners attach / detach ------------------------------------
    //  • pointerdown  → canvas (only fires when the user "starts" on the
    //                    canvas, which is the intuitive place to start
    //                    a drawing)
    //  • pointermove  → WINDOW (so the drag continues smoothly even if
    //                    the cursor leaves the canvas – critical for
    //                    CTRL+drag where the browser may suppress
    //                    canvas-level events)
    //  • pointerup    → WINDOW (we still want to "release" the line
    //                    even if the user releases outside the canvas)
    //  • pointercancel→ WINDOW
    //  • keydown      → WINDOW (Escape)
    function attach() {
        canvas.addEventListener('pointerdown', onPointerDown);
        // Also listen on the canvas for touch fallback
        canvas.addEventListener('touchstart',  onPointerDown, { passive: false });
        // Window-level move/up so drag continues outside the canvas
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup',   onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        window.addEventListener('touchmove',   onPointerMove, { passive: false });
        window.addEventListener('touchend',    onPointerUp);
        window.addEventListener('keydown',     onKeyDown);

        // Suppress the browser's "CTRL+click opens new tab" behavior
        // on the canvas so CTRL+drag works as expected.
        canvas.addEventListener('auxclick', (e) => {
            if (e.ctrlKey || e.metaKey) e.preventDefault();
        });
        // Suppress context menu on right-click during drawing
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    function detach() {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('touchstart',  onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup',   onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('touchmove',   onPointerMove);
        window.removeEventListener('touchend',    onPointerUp);
        window.removeEventListener('keydown',     onKeyDown);
    }

    // -------- render loop ---------------------------------------------------
    let raf = 0;
    let stopped = false;

    function frame() {
        if (stopped) return;

        if (typeof opts.underlay === 'function') {
            opts.underlay(ctx);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        for (const s of store.shapes) hooks.draw(ctx, s, false);

        if (live.drawing) {
            const preview = hooks.makeShape(live.start, live.end);
            hooks.draw(ctx, preview, true);
        }

        raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // -------- public API ----------------------------------------------------
    return {
        start() { live.active = true; },
        stop()  { live.active = false; live.drawing = false; live.pointerId = null; },
        detach() {
            stopped = true;
            cancelAnimationFrame(raf);
            detach();
        },
        addShape(s) { store.shapes.push(s); },
        clearShapes() { store.shapes.length = 0; },
        getShapes() { return store.shapes.slice(); },
    };
}
