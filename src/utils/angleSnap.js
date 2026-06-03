// angleSnap.js
// -----------------------------------------------------------------------------
// Angle-constraining utilities (TradingView's "SHIFT = lock to 45°" mode).
// Reusable for any tool that draws a line/vector from a fixed origin:
// trendlines, arrows, measured moves, etc.
// -----------------------------------------------------------------------------

/**
 * Clamp the vector (cursor - start) to the closest multiple of
 * `angleStep` radians, preserving the original Euclidean length so the
 * cursor does not "jump" toward the origin.
 *
 *   angleStep = π/4  →  TradingView's 45° lock
 *   angleStep = π/6  →  30° lock
 *
 * @param {{x:number, y:number}} start   fixed anchor
 * @param {{x:number, y:number}} cursor  raw mouse position
 * @param {number} [angleStep=Math.PI/4]  granularity in radians
 * @returns {{x:number, y:number, angle:number, snapped:boolean}}
 *          `angle` is the snapped angle in radians, `snapped` is true
 *          unless the original point was degenerate.
 */
export function snapToAngle(start, cursor, angleStep = Math.PI / 4) {
    const dx = cursor.x - start.x;
    const dy = cursor.y - start.y;
    if (dx === 0 && dy === 0) {
        return { x: start.x, y: start.y, angle: 0, snapped: false };
    }
    const length = Math.hypot(dx, dy);
    const rawAngle = Math.atan2(dy, dx);                  // (-π, π]
    const snapped = Math.round(rawAngle / angleStep) * angleStep;
    return {
        x: start.x + length * Math.cos(snapped),
        y: start.y + length * Math.sin(snapped),
        angle: snapped,
        snapped: true,//ok
    };
}

/**
 * TradingView's "Shift → 45°" – a thin wrapper kept for readability
 * at the call-site.
 */
export function clampToNearest45Degrees(start, cursor) {
    return snapToAngle(start, cursor, Math.PI / 4);
}

/**
 * Convert radians → human-readable degrees, normalized to [0, 360).
 */
export function radToDeg(rad) {
    let d = (rad * 180) / Math.PI;
    while (d < 0) d += 360;
    while (d >= 360) d -= 360;
    return d;
}
