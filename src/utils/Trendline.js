export class NativeTrendLine {
    /**
     * @param {import('lightweight-charts').IChartApi} chart
     * @param {import('lightweight-charts').ISeriesApi} series
     * @param {{time:any,price:number}} p1
     * @param {{time:any,price:number}} p2
     * @param {string} color
     * @param {Function} [onChange] - callback fired when endpoints change
     * @param {Function} [onSelect] - callback fired when this line becomes selected
     */
    constructor(chart, series, p1, p2, color = '#ffeb3b', onChange = null, onSelect = null) {
        this.chart = chart;
        this.series = series;
        this.p1 = { ...p1 };
        this.p2 = { ...p2 };
        this.color = color;
        this.selected = false;
        this._onChange = onChange;
        this._onSelect = onSelect;

        // Interaction state (driven by renderer.js)
        this._hovering = false;       // is mouse over line or endpoint
        this._dragging = null;        // null | 'p1' | 'p2' | 'line'
        this._preview = false;        // true if this is a preview line (dashed, transparent)
        this._visible = true;         // visibility flag (hide when out of chart)

        // Visual size of the endpoint handle (the yellow circle drawn
        // on the chart). Kept small so the UI stays clean.
        this._endPointVisualRadius = 6;

        // Hit-test radius for endpoints — can be much larger than the
        // visual radius so the user has a generous target near the
        // endpoint without making the handle look big.
        this._endPointHitRadius = 14;

        // Hit-test "thickness" of the line body (perpendicular distance)
        this._lineHitWidth = 8;
    }

    // ---------- Public API used by renderer.js ----------

    setSelected(flag) {
        if (this.selected !== flag) {
            this.selected = flag;
            this._requestUpdate();
            if (flag && this._onSelect) this._onSelect(this);
        }
    }

    isSelected() {
        return this.selected;
    }

    /**
     * Mark this line as a preview line (used while drawing).
     * Preview lines are drawn dashed, slightly transparent, and
     * do not show endpoint handles.
     */
    setPreview(flag) {
        if (this._preview !== flag) {
            this._preview = flag;
            this._requestUpdate();
        }
    }

    isPreview() {
        return this._preview;
    }

    /**
     * Toggle visibility (used to hide the preview when the cursor
     * leaves the chart area).
     */
    setVisible(flag) {
        if (this._visible !== flag) {
            this._visible = flag;
            this._requestUpdate();
        }
    }

    /**
     * Hit-test this trendline against a pixel point.
     * Returns one of: 'p1', 'p2', 'line', or null.
     *
     * Strategy: the endpoint hit zones get priority and a generous
     * radius so users don't accidentally grab the line body when
     * they intend to move an endpoint. The line-body hit-test is
     * restricted to the segment between p1 and p2 (not the infinite
     * extension) so clicks far from the line don't grab the wrong
     * thing.
     */
    hitTest(px, py) {
        if (this._preview) return null; // preview lines are not interactive

        const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const y1 = this.series.priceToCoordinate(this.p1.price);
        const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        const y2 = this.series.priceToCoordinate(this.p2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

        // -------- Endpoint hit-test (priority) --------
        // Use a generous radius so the user has a forgiving target
        // when reaching for the endpoint.
        const d1 = this._dist(px, py, x1, y1);
        const d2 = this._dist(px, py, x2, y2);

        if (d1 <= this._endPointHitRadius) return 'p1';
        if (d2 <= this._endPointHitRadius) return 'p2';

        // -------- Line-body hit-test --------
        // Only allow grabbing the line body when the cursor is
        // reasonably close to the actual segment (not the
        // infinite line extension).
        const result = this._projectOnSegment(px, py, x1, y1, x2, y2);
        if (result.perpDist <= this._lineHitWidth && result.t >= 0 && result.t <= 1) {
            return 'line';
        }
        return null;
    }

    setHovering(flag) {
        if (this._preview) return; // preview lines never show hover
        if (this._hovering !== flag) {
            this._hovering = flag;
            this._requestUpdate();
        }
    }

    setDragging(target) {
        this._dragging = target;
    }

    /**
     * Move a specific point to a new pixel position and convert back to (time, price).
     * @param {'p1'|'p2'} which
     * @param {number} px - x pixel
     * @param {number} py - y pixel
     */
    movePointToPixel(which, px, py) {
        const time = this.chart.timeScale().coordinateToTime(px);
        const price = this.series.coordinateToPrice(py);
        if (time === null || price === null) return;
        if (which === 'p1') this.p1 = { time, price };
        else if (which === 'p2') this.p2 = { time, price };
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    /**
     * Translate the whole line by a pixel delta.
     */
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

    // ---------- Lightweight-charts primitive interface ----------

    paneViews() {
        return [{
            update: () => {},
            renderer: () => ({
                draw: (target) => {
                    if (!this._visible) return;

                    const timeScale = this.chart.timeScale();
                    const x1 = timeScale.timeToCoordinate(this.p1.time);
                    const y1 = this.series.priceToCoordinate(this.p1.price);
                    const x2 = timeScale.timeToCoordinate(this.p2.time);
                    const y2 = this.series.priceToCoordinate(this.p2.price);

                    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

                    target.useMediaCoordinateSpace(scope => {
                        const ctx = scope.context;
                        ctx.save();

                        // --- Draw the main line ---
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);

                        if (this._preview) {
                            ctx.setLineDash([6, 4]);
                            ctx.globalAlpha = 0.75;
                            ctx.lineWidth = 2;
                        } else {
                            ctx.lineWidth = this.selected || this._hovering ? 3 : 2;
                        }

                        ctx.strokeStyle = this.color;
                        ctx.stroke();
                        ctx.setLineDash([]);
                        ctx.globalAlpha = 1;

                        // --- Draw endpoint handles ---
                        if (this._preview) {
                            this._drawHandle(ctx, x1, y1, /*filled*/ true);
                            this._drawCursorHandle(ctx, x2, y2);
                        } else if (this.selected || this._hovering) {
                            this._drawHandle(ctx, x1, y1, /*filled*/ true);
                            this._drawHandle(ctx, x2, y2, /*filled*/ true);
                        }

                        ctx.restore();
                    });
                }
            })
        }];
    }

    updateAllViews() {}

    autoscaleInfo() { return null; }

    // ---------- Internal helpers ----------

    _drawHandle(ctx, x, y, filled = true) {
        const r = this._endPointVisualRadius;
        // Outer ring
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        // Inner white dot
        if (filled) {
            ctx.beginPath();
            ctx.arc(x, y, r - 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        // Outline
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    /**
     * Draws a smaller hollow circle with a cross to mark the
     * current cursor position during preview.
     */
    _drawCursorHandle(ctx, x, y) {
        const r = 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(19, 23, 34, 0.9)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Tiny crosshair inside
        ctx.beginPath();
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x + 2, y);
        ctx.moveTo(x, y - 2);
        ctx.lineTo(x, y + 2);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    _dist(ax, ay, bx, by) {
        return Math.hypot(ax - bx, ay - by);
    }

    /**
     * Project a point onto a line segment and return the
     * perpendicular distance plus the parameter t (clamped to [0,1]
     * if the projection lies outside the segment).
     */
    _projectOnSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            return { perpDist: this._dist(px, py, x1, y1), t: 0 };
        }
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        // Clamp to the segment for distance measurement
        const tClamped = Math.max(0, Math.min(1, t));
        const cx = x1 + tClamped * dx;
        const cy = y1 + tClamped * dy;
        return { perpDist: this._dist(px, py, cx, cy), t };
    }

    _requestUpdate() {
        // In lightweight-charts v5, the most reliable way to force a
        // primitive to re-render is to nudge the series.  We call
        // applyOptions({}) on the chart, time scale, AND series to
        // be sure the primitive's paneView.renderer() is invoked
        // again with the latest p1 / p2 values.
        try { this.chart.applyOptions({}); } catch (_) {}
        try { this.chart.timeScale().applyOptions({}); } catch (_) {}
        try { this.series.applyOptions({}); } catch (_) {}
    }
}
