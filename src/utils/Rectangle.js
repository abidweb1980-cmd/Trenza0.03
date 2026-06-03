// Rectangle.js
// -----------------------------------------------------------------------------
// A lightweight-charts pane primitive that draws a rectangle between
// two corner anchors (p1, p2) and supports EIGHT resize handles
// (4 corners + 4 edge midpoints) for full TradingView-style resize.
//
// Handle layout (when selected/hovered):
//
//      tm ───────────────── tm ───────────────── tm
//       │                                      │
//      lm                                      rm
//       │                                      │
//      bl ───────────────── bm ───────────────── br
//
// Hit-test returns one of: 'tl', 'tr', 'bl', 'br', 'tm', 'bm',
// 'lm', 'rm', 'border', 'body', or null.
// -----------------------------------------------------------------------------

export class NativeRectangle {
    /**
     * @param {import('lightweight-charts').IChartApi} chart
     * @param {import('lightweight-charts').ISeriesApi} series
     * @param {{time:any,price:number}} p1  – first corner anchor
     * @param {{time:any,price:number}} p2  – second corner anchor
     * @param {string} color
     * @param {Function} [onChange]
     * @param {Function} [onSelect]
     */
    constructor(chart, series, p1, p2, color = '#2962ff', onChange = null, onSelect = null) {
        this.chart = chart;
        this.series = series;
        this.p1 = { ...p1 };
        this.p2 = { ...p2 };
        this.color = color;
        this.selected = false;
        this._onChange = onChange;
        this._onSelect = onSelect;

        this._hovering = false;
        this._dragging = null;
        this._preview  = false;
        this._visible  = true;

        this._endPointVisualRadius = 6;
        this._endPointHitRadius   = 14;
        this._lineHitWidth        = 8;
    }

    setSelected(flag) {
        if (this.selected !== flag) {
            this.selected = flag;
            this._requestUpdate();
            if (flag && this._onSelect) this._onSelect(this);
        }
    }
    isSelected() { return this.selected; }

    setPreview(flag) {
        if (this._preview !== flag) { this._preview = flag; this._requestUpdate(); }
    }
    isPreview() { return this._preview; }

    setVisible(flag) {
        if (this._visible !== flag) { this._visible = flag; this._requestUpdate(); }
    }

    // -------------------------------------------------------------------
    // Geometry helpers
    // -------------------------------------------------------------------

    /**
     * Returns the visual bounding box of the rectangle in PIXEL coords,
     * regardless of which corner p1/p2 happens to be at. Returns null
     * if any of the corner positions can't be resolved.
     */
    _bounds() {
        const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const y1 = this.series.priceToCoordinate(this.p1.price);
        const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        const y2 = this.series.priceToCoordinate(this.p2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
        return {
            left:   Math.min(x1, x2),
            right:  Math.max(x1, x2),
            top:    Math.min(y1, y2),
            bottom: Math.max(y1, y2),
            x1, y1, x2, y2,
        };
    }

    // -------------------------------------------------------------------
    // Hit-test
    // -------------------------------------------------------------------

    /**
     * Hit-test against the rectangle's 8 handles, borders, or body.
     * Returns one of: 'tl'|'tr'|'bl'|'br'|'tm'|'bm'|'lm'|'rm'|
     *                 'border'|'body'|null
     */
    hitTest(px, py) {
        if (this._preview) return null;

        const b = this._bounds();
        if (!b) return null;

        const { left, right, top, bottom } = b;
        const midX = (left + right) / 2;
        const midY = (top  + bottom) / 2;

        // Corners first (highest priority)
        if (this._dist(px, py, left,  top)    <= this._endPointHitRadius) return 'tl';
        if (this._dist(px, py, right, top)    <= this._endPointHitRadius) return 'tr';
        if (this._dist(px, py, left,  bottom) <= this._endPointHitRadius) return 'bl';
        if (this._dist(px, py, right, bottom) <= this._endPointHitRadius) return 'br';

        // Edge midpoints
        if (this._dist(px, py, midX, top)    <= this._endPointHitRadius) return 'tm';
        if (this._dist(px, py, midX, bottom) <= this._endPointHitRadius) return 'bm';
        if (this._dist(px, py, left,  midY)  <= this._endPointHitRadius) return 'lm';
        if (this._dist(px, py, right, midY)  <= this._endPointHitRadius) return 'rm';

        // Borders
        const onLeft   = Math.abs(px - left)   <= this._lineHitWidth && py >= top - 4 && py <= bottom + 4;
        const onRight  = Math.abs(px - right)  <= this._lineHitWidth && py >= top - 4 && py <= bottom + 4;
        const onTop    = Math.abs(py - top)    <= this._lineHitWidth && px >= left - 4 && px <= right + 4;
        const onBottom = Math.abs(py - bottom) <= this._lineHitWidth && px >= left - 4 && px <= right + 4;
        if (onLeft || onRight || onTop || onBottom) return 'border';

        // Body
        if (px > left && px < right && py > top && py < bottom) return 'body';

        return null;
    }

    setHovering(flag) {
        if (this._preview) return;
        if (this._hovering !== flag) { this._hovering = flag; this._requestUpdate(); }
    }

    setDragging(target) { this._dragging = target; }

    // -------------------------------------------------------------------
    // Move / resize
    // -------------------------------------------------------------------

    /**
     * Move a specific handle to a new pixel position.  The handle
     * determines which combination of (p1.time, p1.price, p2.time,
     * p2.price) gets updated:
     *
     *   'tl' / 'tr' / 'bl' / 'br'  → two adjacent anchors
     *   'tm' / 'bm'                 → both .price anchors
     *   'lm' / 'rm'                 → both .time anchors
     *   'border' / 'body'           → translate whole rectangle
     */
    movePointToPixel(which, px, py) {
        // Border / body: simple translation via the existing
        // translateByPixel would need the previous-pixel-delta, but
        // the interaction controller already supplies the delta, so
        // we fall through to the universal pixel-position-based
        // move below.
        if (which === 'body' || which === 'border') {
            // The interaction controller actually calls
            // translateByPixel(dx, dy) for body/border, so this
            // branch shouldn't be hit.  Keep it for safety.
            return;
        }

        const time  = this.chart.timeScale().coordinateToTime(px);
        const price = this.series.coordinateToPrice(py);
        if (time === null || price === null) return;

        const b = this._bounds();
        if (!b) return;

        let newLeft   = b.left;
        let newRight  = b.right;
        let newTop    = b.top;
        let newBottom = b.bottom;

        switch (which) {
            case 'tl': newLeft  = px; newTop    = py; break;
            case 'tr': newRight = px; newTop    = py; break;
            case 'bl': newLeft  = px; newBottom = py; break;
            case 'br': newRight = px; newBottom = py; break;
            case 'tm': newTop   = py; break;
            case 'bm': newBottom = py; break;
            case 'lm': newLeft  = px; break;
            case 'rm': newRight = px; break;
            default: return;
        }

        // Convert the new edge box back into (p1, p2) anchors.
        // p1 becomes the top-left corner, p2 becomes the bottom-right.
        const newP1Time  = this.chart.timeScale().coordinateToTime(newLeft);
        const newP1Price = this.series.coordinateToPrice(newTop);
        const newP2Time  = this.chart.timeScale().coordinateToTime(newRight);
        const newP2Price = this.series.coordinateToPrice(newBottom);

        if (newP1Time && newP2Time && newP1Price !== null && newP2Price !== null) {
            this.p1 = { time: newP1Time, price: newP1Price };
            this.p2 = { time: newP2Time, price: newP2Price };
            this._requestUpdate();
            if (this._onChange) this._onChange(this);
        }
    }

    /**
     * Translate the whole rectangle by a pixel delta.
     */
/**
      * Anchor-at-mousedown translate: set p1 to (newAnchorX, newAnchorY)
      * and shift p2 by the same x delta, preserving both horizontal
      * and vertical positions relative to each other.
      */
    translateByPixelFromAnchor(newAnchorX, newAnchorY) {
        const newTime  = this.chart.timeScale().coordinateToTime(newAnchorX);
        const newPrice = this.series.coordinateToPrice(newAnchorY);
        if (newTime === null || newPrice === null) return;
        
        const oldX  = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const oldY  = this.series.priceToCoordinate(this.p1.price);
        const oldX2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        const oldY2 = this.series.priceToCoordinate(this.p2.price);
        
        if (oldX === null || oldY === null || oldX2 === null || oldY2 === null) return;
        
        // Calculate deltas
        const dxPx = newAnchorX - oldX;
        const dyPx = newAnchorY - oldY;
        
        // Apply the same deltas to both points (proper translation)
        const newX2 = oldX2 + dxPx;
        const newY2 = oldY2 + dyPx;
        
        const newTime2 = this.chart.timeScale().coordinateToTime(newX2);
        const newPrice2 = this.series.coordinateToPrice(newY2);
        
        this.p1 = { time: newTime, price: newPrice };
        if (newTime2 !== null && newPrice2 !== null) {
            this.p2 = { time: newTime2, price: newPrice2 };
        }
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }
    translateByPixel(dxPx, dyPx) {
        const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const y1 = this.series.priceToCoordinate(this.p1.price);
        const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        const y2 = this.series.priceToCoordinate(this.p2.price);
        if ([x1, y1, x2, y2].some(v => v === null)) return;

        const t1 = this.chart.timeScale().coordinateToTime(x1 + dxPx);
        const p1Price = this.series.coordinateToPrice(y1 + dyPx);
        const t2 = this.chart.timeScale().coordinateToTime(x2 + dxPx);
        const p2Price = this.series.coordinateToPrice(y2 + dyPx);
        if (!t1 || !t2 || p1Price === null || p2Price === null) return;

        this.p1 = { time: t1, price: p1Price };
        this.p2 = { time: t2, price: p2Price };
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    /**
     * Translate horizontally only (time axis) by pixel delta.
     * Preserves the rectangle's vertical position/height.
     */
    translateHorizontallyByPixel(dxPx) {
        const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        if ([x1, x2].some(v => v === null)) return;

        const t1 = this.chart.timeScale().coordinateToTime(x1 + dxPx);
        const t2 = this.chart.timeScale().coordinateToTime(x2 + dxPx);
        if (!t1 || !t2) return;

        this.p1 = { time: t1, price: this.p1.price };
        this.p2 = { time: t2, price: this.p2.price };
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    /**
     * Translate vertically only (price axis) by pixel delta.
     * Preserves the rectangle's horizontal position/width.
     */
    translateVerticallyByPixel(dyPx) {
        const y1 = this.series.priceToCoordinate(this.p1.price);
        const y2 = this.series.priceToCoordinate(this.p2.price);
        if ([y1, y2].some(v => v === null)) return;

        const p1Price = this.series.coordinateToPrice(y1 + dyPx);
        const p2Price = this.series.coordinateToPrice(y2 + dyPx);
        if (p1Price === null || p2Price === null) return;

        this.p1 = { time: this.p1.time, price: p1Price };
        this.p2 = { time: this.p2.time, price: p2Price };
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    // -------------------------------------------------------------------
    // Lightweight-charts primitive interface
    // -------------------------------------------------------------------

    paneViews() {
        return [{
            update: () => {},
            renderer: () => ({
                draw: (target) => {
                    if (!this._visible) return;

                    const b = this._bounds();
                    if (!b) return;

                    const { left, right, top, bottom } = b;
                    const w = right - left;
                    const h = bottom - top;

                    target.useMediaCoordinateSpace(scope => {
                        const ctx = scope.context;
                        ctx.save();

                        // Filled translucent body
                        ctx.fillStyle = this._hexAlpha(this.color, 0.18);
                        ctx.fillRect(left, top, w, h);

                        // Border
                        if (this._preview) {
                            ctx.setLineDash([6, 4]);
                            ctx.globalAlpha = 0.85;
                            ctx.lineWidth   = 1.5;
                        } else {
                            ctx.lineWidth = this.selected || this._hovering ? 3 : 2;
                        }
                        ctx.strokeStyle = this.color;
                        ctx.strokeRect(left, top, w, h);
                        ctx.setLineDash([]);
                        ctx.globalAlpha = 1;

                        // 8 resize handles (4 corners + 4 midpoints)
                        // when selected, hovering, or previewing.
                        if (this._preview) {
                            // Preview: only show the two real anchors
                            this._drawHandle(ctx, b.x1, b.y1, true);
                            this._drawHandle(ctx, b.x2, b.y2, true);
                        } else if (this.selected || this._hovering) {
                            const midX = (left + right) / 2;
                            const midY = (top  + bottom) / 2;
                            // 4 corners
                            this._drawHandle(ctx, left,  top,    true); // tl
                            this._drawHandle(ctx, right, top,    true); // tr
                            this._drawHandle(ctx, left,  bottom, true); // bl
                            this._drawHandle(ctx, right, bottom, true); // br
                            // 4 midpoints (drawn slightly smaller)
                            this._drawMidHandle(ctx, midX, top);
                            this._drawMidHandle(ctx, midX, bottom);
                            this._drawMidHandle(ctx, left,  midY);
                            this._drawMidHandle(ctx, right, midY);
                        }

                        ctx.restore();
                    });
                }
            })
        }];
    }

    updateAllViews() {}
    autoscaleInfo() { return null; }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------

    _drawHandle(ctx, x, y, filled = true) {
        const r = this._endPointVisualRadius;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        if (filled) {
            ctx.beginPath();
            ctx.arc(x, y, r - 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /**
     * Draw a slightly smaller, square midpoint handle for the
     * edge-midpoint handles (top-middle, bottom-middle, left-middle,
     * right-middle).
     */
    _drawMidHandle(ctx, x, y) {
        const r = 4;
        ctx.save();
        // White border so it pops on top of the body fill
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = this.color;
        ctx.fillRect(x - r + 1, y - r + 1, r * 2 - 2, r * 2 - 2);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
    }

    _hexAlpha(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    _dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

    _requestUpdate() {
        // Throttled redraw: batch multiple data changes within a
        // single animation frame into ONE chart redraw.  This is
        // the main fix for x-axis drag lag — without this, every
        // mousemove event triggers 3 applyOptions() calls, each
        // of which forces a full chart re-render.  The chart's
        // time scale is the most expensive part to re-render, so
        // batching dramatically improves x-axis smoothness.
        if (this._pendingRedraw) return;
        this._pendingRedraw = requestAnimationFrame(() => {
            this._pendingRedraw = null;
            try { this.chart.timeScale().applyOptions({}); } catch (_) {}
        });
    }
}
