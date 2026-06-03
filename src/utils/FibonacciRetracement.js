// FibonacciRetracement.js
// -----------------------------------------------------------------------------
// A lightweight-charts pane primitive that draws a Fibonacci
// Retracement between two price anchors (p1, p2).  Mirrors the
// architecture of NativeTrendLine / NativeRectangle so selection,
// hover, and drag work the same way.
//
//   • 2 handles (the two endpoint anchors, just like a trendline).
//   • Horizontal levels at the standard Fibonacci ratios.
//   • Each level shows its price and ratio label on the right side.
//   • Levels are colored, and an optional "direction" flag flips
//     them so 0 % is always at the lower anchor and 100 % at the
//     upper anchor (TradingView default).
//
// Common levels (TradingView default):
//
//     0      0.236   0.382   0.5     0.618   0.786   1
//                       1.618  (extension)
//
//  We also expose the `reversed` flag so the user can flip
//  direction if they drew the fib the other way (down→up becomes
//  up→down with 100% on the bottom).
// -----------------------------------------------------------------------------

// Common Fibonacci retracement levels with their display label, color, and line style.
// This matches the TradingView default set.
export const FIBONACCI_LEVELS = [
    { ratio: 0.000, label: '0',       color: '#787b87', dashed: false },
    { ratio: 0.236, label: '0.236',   color: '#f23645', dashed: false },
    { ratio: 0.382, label: '0.382',   color: '#ff9800', dashed: false },
    { ratio: 0.500, label: '0.5',     color: '#089981', dashed: false },
    { ratio: 0.618, label: '0.618',   color: '#2962ff', dashed: false },
    { ratio: 0.786, label: '0.786',   color: '#9c27b0', dashed: false },
    { ratio: 1.000, label: '1',       color: '#787b87', dashed: false },
];

export class NativeFibonacciRetracement {
    /**
     * @param {import('lightweight-charts').IChartApi} chart
     * @param {import('lightweight-charts').ISeriesApi} series
     * @param {{time:any,price:number}} p1 – first anchor (anchor A)
     * @param {{time:any,price:number}} p2 – second anchor (anchor B)
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
    // Hit-test: only the two endpoint handles + the body strip between
    // them (so clicking in the middle of the fib selects it for drag).
    // -------------------------------------------------------------------
    hitTest(px, py) {
        if (this._preview) return null;

        const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
        const y1 = this.series.priceToCoordinate(this.p1.price);
        const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
        const y2 = this.series.priceToCoordinate(this.p2.price);
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;

        // Endpoint hit-test
        if (this._dist(px, py, x1, y1) <= this._endPointHitRadius) return 'p1';
        if (this._dist(px, py, x2, y2) <= this._endPointHitRadius) return 'p2';

        // Body: anything between the two x columns (and within
        // the price range of the two anchors) is hit-testable.
        const left  = Math.min(x1, x2);
        const right = Math.max(x1, x2);
        const top   = Math.min(y1, y2);
        const bot   = Math.max(y1, y2);
        if (px >= left - this._lineHitWidth && px <= right + this._lineHitWidth
            && py >= top - this._lineHitWidth && py <= bot + this._lineHitWidth) {
            return 'body';
        }
        return null;
    }

    setHovering(flag) {
        if (this._preview) return;
        if (this._hovering !== flag) { this._hovering = flag; this._requestUpdate(); }
    }

    setDragging(target) { this._dragging = target; }

    movePointToPixel(which, px, py) {
        const time  = this.chart.timeScale().coordinateToTime(px);
        const price = this.series.coordinateToPrice(py);
        if (time === null || price === null) return;
        if (which === 'p1') this.p1 = { time, price };
        else if (which === 'p2') this.p2 = { time, price };
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

/**
      * Translate the whole fib by a pixel delta.
      */
    /** Anchor-at-mousedown translate. */
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
     * Preserves the fib's vertical position.
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
     * Preserves the fib's horizontal position.
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

                    const x1 = this.chart.timeScale().timeToCoordinate(this.p1.time);
                    const y1 = this.series.priceToCoordinate(this.p1.price);
                    const x2 = this.chart.timeScale().timeToCoordinate(this.p2.time);
                    const y2 = this.series.priceToCoordinate(this.p2.price);
                    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

                    // The fib spans the time range from x1..x2 and
                    // the price range from min(p1.price, p2.price)
                    // ..max(...). Each level is a horizontal line
                    // at: low + ratio * (high - low).
                    const leftPx   = Math.min(x1, x2);
                    const rightPx  = Math.max(x1, x2);
                    const lowPrice = Math.min(this.p1.price, this.p2.price);
                    const highPrice= Math.max(this.p1.price, this.p2.price);
                    const priceRange = highPrice - lowPrice;

                    target.useMediaCoordinateSpace(scope => {
                        const ctx = scope.context;
                        ctx.save();

                        // Clip the drawing to the chart's plot area
                        // so the labels don't run off into the
                        // axis area.
                        const timeScale = this.chart.timeScale();
                        let plotLeft = 0;
                        // We don't have a public API for plot-area
                        // width, so estimate from the chart
                        // container.  Use the maximum width so
                        // labels can extend to the right edge.
                        // The chart will clip on the right side
                        // automatically via canvas clip.
                        try {
                            const el = this.chart.chartElement ? this.chart.chartElement() : null;
                            if (el) {
                                const w = el.clientWidth;
                                plotLeft = 0;
                                // Cap right extent at the container width.
                                // (We can't be precise here without the
                                //  private width API, but the renderer
                                //  clips to its own area anyway.)
                                void w;
                            }
                        } catch (_) {}

                        // Determine where to place the price labels.
                        // If the second anchor (p2) is to the right,
                        // labels go on the right; if to the left,
                        // labels go on the left.
                        const x2IsRight = x2 > x1;
                        const labelX = x2IsRight
                            ? rightPx + 4   // a few px past the right anchor
                            : leftPx  - 4;  // a few px before the left anchor
                        ctx.textAlign = x2IsRight ? 'left' : 'right';
                        ctx.textBaseline = 'middle';

                        // Draw each Fibonacci level
                        for (const level of FIBONACCI_LEVELS) {
                            const levelPrice = lowPrice + level.ratio * priceRange;
                            const ly = this.series.priceToCoordinate(levelPrice);
                            if (ly === null) continue;

                            // ---- Line ----
                            ctx.beginPath();
                            if (level.dashed || this._preview) {
                                ctx.setLineDash([4, 4]);
                            } else {
                                ctx.setLineDash([]);
                            }
                            ctx.lineWidth = 1;
                            ctx.strokeStyle = level.color;
                            ctx.globalAlpha = this._preview ? 0.6 : 0.9;
                            ctx.moveTo(leftPx, ly);
                            ctx.lineTo(rightPx, ly);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.globalAlpha = 1;

                            // ---- Price + ratio label ----
                            ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                            const priceText = this._formatPrice(levelPrice);
                            const labelText = `${level.label}  ${priceText}`;
                            // Background pill
                            const padX = 5;
                            const padY = 2;
                            const textW = ctx.measureText(labelText).width;
                            const pillX = x2IsRight ? labelX - padX : (labelX - textW - padX);
                            const pillY = ly - 7;
                            const pillH = 14;
                            ctx.fillStyle = this._hexAlpha(level.color, 0.85);
                            ctx.fillRect(pillX, pillY, textW + padX * 2, pillH);
                            // Text
                            ctx.fillStyle = '#ffffff';
                            ctx.fillText(labelText, labelX, ly);
                        }

                        // ---- Connecting trendline (from p1 to p2) ----
                        if (!this._preview) {
                            ctx.beginPath();
                            if (this.selected || this._hovering) {
                                ctx.setLineDash([6, 4]);
                                ctx.globalAlpha = 0.5;
                            } else {
                                ctx.globalAlpha = 0.25;
                            }
                            ctx.lineWidth = 1.5;
                            ctx.strokeStyle = this.color;
                            ctx.moveTo(x1, y1);
                            ctx.lineTo(x2, y2);
                            ctx.stroke();
                            ctx.setLineDash([]);
                            ctx.globalAlpha = 1;
                        }

                        // ---- Endpoint handles ----
                        if (this._preview) {
                            this._drawHandle(ctx, x1, y1, true);
                            this._drawHandle(ctx, x2, y2, true);
                        } else if (this.selected || this._hovering) {
                            this._drawHandle(ctx, x1, y1, true);
                            this._drawHandle(ctx, x2, y2, true);
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

    _formatPrice(price) {
        // Compact, readable price formatting. TradingView uses
        // something like this (auto-decimal).
        if (price === null || price === undefined || isNaN(price)) return '';
        const abs = Math.abs(price);
        let digits = 2;
        if (abs < 1)        digits = 5;
        else if (abs < 10)  digits = 4;
        else if (abs < 100) digits = 3;
        else if (abs < 1000) digits = 2;
        else                digits = 1;
        return price.toFixed(digits);
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
