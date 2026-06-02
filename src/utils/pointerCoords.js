// pointerCoords.js
// -----------------------------------------------------------------------------
// Reusable pointer / canvas-coordinate utilities.
//
// Anything that needs to convert a mouse/pointer/touch event into
// canvas-space coordinates, or pull modifier keys off an event, lives
// here.  Other drawing tools (rectangles, fibs, etc.) can import from
// this file directly without depending on the trendline tool.
// -----------------------------------------------------------------------------

/**
 * Convert a MouseEvent / PointerEvent / Touch into canvas-space (x, y).
 *
 * Handles three coordinate systems:
 *   • clientX/Y     – viewport coords (works for Mouse & Pointer events)
 *   • touches[0]    – touch events
 *   • offsetX/Y     – canvas-relative (fallback)
 *
 * Defensive against missing `getBoundingClientRect` so it can be
 * unit-tested with bare-object canvas stubs.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {MouseEvent | PointerEvent | TouchEvent} evt
 * @returns {{x:number, y:number}}
 */
export function toCanvasPoint(canvas, evt) {
    const rect = (canvas && typeof canvas.getBoundingClientRect === 'function')
        ? canvas.getBoundingClientRect()
        : { left: 0, top: 0 };

    if (evt.touches && evt.touches.length > 0) {
        const t = evt.touches[0];
        return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    if (typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }
    return { x: evt.offsetX ?? 0, y: evt.offsetY ?? 0 };
}

/**
 * Read modifier keys straight off a DOM event. This is MORE RELIABLE
 * than tracking keydown/keyup globally:
 *   • works even if the canvas never had focus
 *   • works during OS-level shortcuts
 *   • always reflects the *current* state of the keys
 *
 * @param {MouseEvent | PointerEvent | KeyboardEvent} evt
 * @returns {{ shift:boolean, ctrl:boolean, alt:boolean, meta:boolean }}
 */
export function getEventModifiers(evt) {
    return {
        shift: !!evt.shiftKey,
        ctrl:  !!evt.ctrlKey,
        alt:   !!evt.altKey,
        meta:  !!evt.metaKey,
    };
}

/**
 * Linear distance between two points.
 */
export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Constrain a point inside a rectangle.
 */
export function clampToRect(p, rect) {
    return {
        x: Math.max(rect.x, Math.min(rect.x + rect.width,  p.x)),
        y: Math.max(rect.y, Math.min(rect.y + rect.height, p.y)),
    };
}
