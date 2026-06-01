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

        // Threshold in pixels for hit-testing endpoints
        this._endPointRadius = 10;
        // Threshold in pixels for hit-testing the line body
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
     * Hit-test this trendline against a pixel point.
     * Returns one of: 'p1', 'p2', 'line', or null.
     */
    hitTest(px, py) {
        const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const y1 = this.series.priceToCoordinate(this.p1.price);
        const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        const y2 = this.series.priceToCoordinate(this.p2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

        // Endpoints have priority
        if (this._dist(px, py, x1, y1) <= this._endPointRadius) return 'p1';
        if (this._dist(px, py, x2, y2) <= this._endPointRadius) return 'p2';

        // Distance from point to line segment
        const d = this._distToSegment(px, py, x1, y1, x2, y2);
        if (d <= this._lineHitWidth) return 'line';
        return null;
    }

    setHovering(flag) {
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
                        ctx.strokeStyle = this.color;
                        ctx.lineWidth = this.selected || this._hovering ? 3 : 2;
                        ctx.stroke();

                        // --- Draw endpoint handles when selected or hovered ---
                        if (this.selected || this._hovering) {
                            this._drawHandle(ctx, x1, y1);
                            this._drawHandle(ctx, x2, y2);
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

    _drawHandle(ctx, x, y) {
        const r = this._endPointRadius;
        // Outer ring
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        // Inner white dot
        ctx.beginPath();
        ctx.arc(x, y, r - 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        // Outline
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    _dist(ax, ay, bx, by) {
        return Math.hypot(ax - bx, ay - by);
    }

    _distToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return this._dist(px, py, x1, y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + t * dx;
        const cy = y1 + t * dy;
        return this._dist(px, py, cx, cy);
    }

    _requestUpdate() {
        // Ask the chart to redraw. Calling applyOptions with current options
        // is a cheap way to nudge the lightweight-charts engine into redrawing
        // our primitive.
        try {
            this.chart.timeScale().applyOptions({});
        } catch (_) {
            // no-op
        }
    }
}
