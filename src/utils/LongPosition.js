// LongPosition.js
// A lightweight-charts pane primitive that draws a TradingView-style
// Long Position visualization on the chart.
// -----------------------------------------------------------------------------

const DEFAULTS = {
    accountSize: 10000,
    riskPercent: 1.0,
    leverage: 1,
    contractSize: 1,
    pricePrecision: 2,
    tickSize: 0.01,
    pipSize: 0.01,
    accountCurrency: 'USD',
    quoteCurrency: 'USD',
    showStats: true,
    compactStats: false,
    alwaysShowStats: true,
};

export class NativeLongPosition {
    constructor(chart, series, entryAnchor, color = '#26a69a', onChange = null, onSelect = null) {
        this.chart = chart;
        this.series = series;

        const entry = { time: entryAnchor.time, price: entryAnchor.price };
        this.entry = entry;
        
        // Use small fixed distance initially (will be adjusted in resizeToFitVisibleArea)
        // For prices around 1900, typical tick size is 0.01, so use small multipliers
        const tickDistance = 10; // 10 ticks up/down from entry
        this.tp = entry.price + 2 * tickDistance * 0.01; // 2R reward (20 ticks up)  
        this.sl = entry.price - 1 * tickDistance * 0.01; // 1R risk (10 ticks down)
        this.endBarDelta = 20;
        this.endTime = null;

        this.color = color;
        this.selected = false;
        this._onChange = onChange;
        this._onSelect = onSelect;
        this._hovering = false;
        this._dragging = null;
        this._preview  = false;
        this._visible  = true;
        this.settings = { ...DEFAULTS };
        this._endPointVisualRadius = 5;
        this._endPointHitRadius   = 14;
        this._lineHitWidth        = 8;
        this.statsAnchor = 'tr';
    }

    setSelected(flag) {
        if (this.selected !== flag) {
            this.selected = flag;
            this._requestUpdate();
            if (flag && this._onSelect) this._onSelect(this);
        }
    }
    isSelected() { return this.selected; }
    setPreview(flag) { this._preview = flag; this._requestUpdate(); }
    isPreview() { return this._preview; }
    setVisible(flag) { this._visible = flag; this._requestUpdate(); }

    setHovering(flag) {
        if (this._preview) return;
        if (this._hovering !== flag) { this._hovering = flag; this._requestUpdate(); }
    }
    setDragging(target) { this._dragging = target; }

    updateSettings(patch) {
        this.settings = { ...this.settings, ...patch };
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    reverse() {
        const distUp = this.tp - this.entry.price;
        const distDn = this.entry.price - this.sl;
        this.tp = this.entry.price + distDn;
        this.sl = this.entry.price - distUp;
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    _bounds() {
        const xEntry = this.chart.timeScale().timeToCoordinate(this.entry.time);
        const yEntry = this.series.priceToCoordinate(this.entry.price);
        const yTp    = this.series.priceToCoordinate(this.tp);
        const ySl    = this.series.priceToCoordinate(this.sl);
        if (xEntry === null || yEntry === null || yTp === null || ySl === null) return null;

        let xRight = this.endTime != null
            ? this.chart.timeScale().timeToCoordinate(this.endTime)
            : null;
            
        if (xRight === null || xRight === undefined) {
            // Dynamic right edge: use ~20% of visible chart width
            const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
            const containerWidth = this.chart.chartElement ? this.chart.chartElement().clientWidth : 800;
            
            // Calculate target width as percentage of visible range
            const targetWidthPx = Math.round(containerWidth * 0.2);
            xRight = xEntry + targetWidthPx;
            
            // Convert to time for endTime tracking
            if (visibleRange) {
                const timeAtRight = this.chart.timeScale().coordinateToTime(xRight);
                if (timeAtRight !== null) {
                    this.endTime = timeAtRight;
                }
            }
        }

        return {
            left: xEntry, right: xRight,
            top: yTp, bottom: ySl,
            xEntry, yEntry, xRight, yTp, ySl,
        };
    }

    hitTest(px, py) {
        if (this._preview) return null;
        const b = this._bounds();
        if (!b) return null;
        const { left, right, top, bottom } = b;
        const m = this._lineHitWidth;
        const r = this._endPointHitRadius; // 14

        // ----- 4 corner anchors (highest priority) -----
        if (this._dist(px, py, left,  top)    <= r) return 'tl';
        if (this._dist(px, py, right, top)    <= r) return 'tr';
        if (this._dist(px, py, left,  bottom) <= r) return 'bl';
        if (this._dist(px, py, right, bottom) <= r) return 'br';

        // ----- TP / SL lines (top/bottom edges) -----
        // Generous hit zones so the user can easily grab the top
        // and bottom edges to change TP / SL.  These are the only
        // price-draggable regions besides the corners.
        if (Math.abs(py - top)    <= m && px >= left - m && px <= right + m) return 'tp';
        if (Math.abs(py - bottom) <= m && px >= left - m && px <= right + m) return 'sl';

        // ----- Body (everything else inside the rectangle) -----
        // Includes the area where the entry line sits.  Clicking
        // and dragging anywhere inside the trade moves the whole
        // rectangle in BOTH x and y directions, just like the
        // rectangle tool.  The entry line is purely a visual
        // divider — it has no separate drag target.
        if (px >= left && px <= right && py >= top && py <= bottom) return 'body';

        return null;
    }

    movePointToPixel(which, px, py) {
        switch (which) {
            case 'tp': {
                // Dragging the TP line vertically changes TP only.
                const price = this.series.coordinateToPrice(py);
                if (price !== null) { this.tp = price; this._afterChange(); }
                return;
            }
            case 'sl': {
                const price = this.series.coordinateToPrice(py);
                if (price !== null) { this.sl = price; this._afterChange(); }
                return;
            }
            case 'entry': {
                // Dragging the entry line vertically moves the
                // entire trade up/down (entry + TP + SL all shift
                // by the same delta, preserving their absolute
                // prices relative to each other).
                const price = this.series.coordinateToPrice(py);
                if (price !== null) {
                    const d = price - this.entry.price;
                    this.entry.price = price;
                    this.tp += d;
                    this.sl += d;
                    this._afterChange();
                }
                return;
            }
            // 4 corner anchors -------------------------------------------------
            // Each corner changes the relevant price (TP for top,
            // SL for bottom) AND the relevant time edge (left for
            // tl/bl, right for tr/br).  This matches the spec
            // "Changes TP Line + Adjusts Width" for top corners and
            // "Changes SL Line + Adjusts Width" for bottom corners.
            case 'tl': {
                const price = this.series.coordinateToPrice(py);
                const time  = this.chart.timeScale().coordinateToTime(px);
                if (price !== null) { this.tp = price; this._afterChange(); }
                if (time  !== null) { this.entry.time = time; this._afterChange(); }
                return;
            }
            case 'tr': {
                const price = this.series.coordinateToPrice(py);
                const time  = this.chart.timeScale().coordinateToTime(px);
                if (price !== null) { this.tp = price; this._afterChange(); }
                if (time  !== null) { this.endTime = time; this._afterChange(); }
                return;
            }
            case 'bl': {
                const price = this.series.coordinateToPrice(py);
                const time  = this.chart.timeScale().coordinateToTime(px);
                if (price !== null) { this.sl = price; this._afterChange(); }
                if (time  !== null) { this.entry.time = time; this._afterChange(); }
                return;
            }
            case 'br': {
                const price = this.series.coordinateToPrice(py);
                const time  = this.chart.timeScale().coordinateToTime(px);
                if (price !== null) { this.sl = price; this._afterChange(); }
                if (time  !== null) { this.endTime = time; this._afterChange(); }
                return;
            }
            default: return;
        }
    }

    _afterChange() {
        this._requestUpdate();
        if (this._onChange) this._onChange(this);
    }

    /**
     * Translate the trade so that the entry anchor lands at
     * (newAnchorX, newAnchorY) in pixel space.  This is the
     * "anchor at mousedown" approach: each move event calls this
     * with a freshly-computed target pixel position, so slow
     * movements get full precision (no accumulated rounding from
     * candle-snap).  The math: new entry.time / entry.price is
     * derived from coordinateToTime / coordinateToPrice of the
     * target pixel.
     */
    translateByPixelFromAnchor(newAnchorX, newAnchorY) {
        const newTime  = this.chart.timeScale().coordinateToTime(newAnchorX);
        const newPrice = this.series.coordinateToPrice(newAnchorY);
        if (newTime === null || newPrice === null) return;

        // Compute the price delta and shift tp/sl by it
        const oldY = this.series.priceToCoordinate(this.entry.price);
        const yDelta = newAnchorY - oldY;
        const dPrice = (yDelta !== 0)
            ? this.series.coordinateToPrice(oldY + yDelta) - this.entry.price
            : 0;

        // Capture the original x delta so we can preserve the
        // trade's time-window width.
        const oldX = this.chart.timeScale().timeToCoordinate(this.entry.time);
        const oldRightX = this.endTime != null
            ? this.chart.timeScale().timeToCoordinate(this.endTime)
            : null;

        this.entry.time  = newTime;
        this.entry.price = newPrice;
        if (dPrice !== 0) {
            this.tp += dPrice;
            this.sl += dPrice;
        }

        // Shift endTime by the same x pixel delta so the trade
        // window width is preserved.
        if (this.endTime != null && oldRightX != null && oldX != null) {
            const dxPx = newAnchorX - oldX;
            const newEndX = oldRightX + dxPx;
            const newEndTime = this.chart.timeScale().coordinateToTime(newEndX);
            if (newEndTime !== null) this.endTime = newEndTime;
        }
        this._afterChange();
    }

    translateByPixel(dxPx, dyPx) {
        // Body drag: move the entire trade in BOTH x (time) and
        // y (price).  Time translation shifts entry.time and
        // endTime by dxPx.  Price translation shifts entry,
        // tp, and sl by dyPx.
        const xEntry = this.chart.timeScale().timeToCoordinate(this.entry.time);
        const yEntry = this.series.priceToCoordinate(this.entry.price);
        if (xEntry === null || yEntry === null) return;

        if (dxPx !== 0) {
            const newTime = this.chart.timeScale().coordinateToTime(xEntry + dxPx);
            if (newTime !== null) {
                this.entry.time = newTime;
                if (this.endTime !== null) {
                    const xEnd = this.chart.timeScale().timeToCoordinate(this.endTime);
                    if (xEnd !== null) {
                        const newEnd = this.chart.timeScale().coordinateToTime(xEnd + dxPx);
                        if (newEnd !== null) this.endTime = newEnd;
                    }
                }
            }
        }
        if (dyPx !== 0) {
            const newPrice = this.series.coordinateToPrice(yEntry + dyPx);
            if (newPrice !== null) {
                const d = newPrice - this.entry.price;
                this.entry.price = newPrice;
                this.tp += d;
                this.sl += d;
            }
        }
        this._afterChange();
    }

    _riskDistancePrice() { return Math.abs(this.entry.price - this.sl); }
    _rewardDistancePrice() { return Math.abs(this.tp - this.entry.price); }
    _riskAmount() { return this.settings.accountSize * this.settings.riskPercent / 100; }
    _lotSize() {
        const slDist = this._riskDistancePrice();
        if (slDist === 0) return 0;
        return this._riskAmount() * this.settings.tickSize / (slDist * this.settings.contractSize);
    }
    _positionValue() { return this._lotSize() * this.settings.contractSize * this.entry.price; }
    _marginRequired() { return this.settings.leverage > 0 ? this._positionValue() / this.settings.leverage : 0; }
    _potentialProfit() {
        const r = this._riskDistancePrice();
        if (r === 0) return 0;
        return this._riskAmount() * (this._rewardDistancePrice() / r);
    }
    _riskReward() {
        const r = this._riskDistancePrice();
        if (r === 0) return 0;
        return this._rewardDistancePrice() / r;
    }
    _liquidationPrice() {
        if (this.settings.leverage <= 1) return null;
        return this.entry.price * (1 - 1 / this.settings.leverage);
    }

    paneViews() {
        return [{
            update: () => {},
            renderer: () => ({
                draw: (target) => {
                    if (!this._visible) return;
                    const b = this._bounds();
                    if (!b) return;

                    const { left, right, top, bottom, yEntry } = b;
                    const profitColor = this.color || '#26a69a';
                    const lossColor   = '#ef5350';
                    const entryColor  = '#ffffff';
                    const lineW       = (this.selected || this._hovering) ? 2 : 1.5;

                    target.useMediaCoordinateSpace(scope => {
                        const ctx = scope.context;
                        ctx.save();

                        // Loss zone
                        ctx.fillStyle = this._hexAlpha(lossColor, 0.12);
                        ctx.fillRect(left, yEntry, right - left, bottom - yEntry);

                        // Profit zone
                        ctx.fillStyle = this._hexAlpha(profitColor, 0.12);
                        ctx.fillRect(left, top, right - left, yEntry - top);

                        // SL line
                        ctx.beginPath();
                        ctx.lineWidth = lineW;
                        ctx.strokeStyle = lossColor;
                        ctx.moveTo(left, bottom);
                        ctx.lineTo(right, bottom);
                        ctx.stroke();

                        // TP line
                        ctx.beginPath();
                        ctx.lineWidth = lineW;
                        ctx.strokeStyle = profitColor;
                        ctx.moveTo(left, top);
                        ctx.lineTo(right, top);
                        ctx.stroke();

                        // Entry line — extends a bit past the trade
                        ctx.beginPath();
                        ctx.lineWidth = lineW;
                        ctx.strokeStyle = entryColor;
                        ctx.moveTo(left - 6, yEntry);
                        ctx.lineTo(right + 6, yEntry);
                        ctx.stroke();

                        // Status pip on the entry line
                        ctx.beginPath();
                        ctx.arc(left - 14, yEntry, 5, 0, Math.PI * 2);
                        ctx.fillStyle = '#2962ff';
                        ctx.fill();
                        ctx.strokeStyle = entryColor;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();

                        // Price labels on the right
                        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        const p = this.settings.pricePrecision;
                        this._drawPricePill(ctx, right + 6, top,    this.tp.toFixed(p), profitColor);
                        this._drawPricePill(ctx, right + 6, bottom, this.sl.toFixed(p), lossColor);
                        this._drawPricePill(ctx, right + 6, yEntry, this.entry.price.toFixed(p), entryColor, '#1c2030');

                        // 4 corner anchors (visible only when selected/hovered)
                        if (this.selected || this._hovering) {
                            this._drawCornerHandle(ctx, left,  top);
                            this._drawCornerHandle(ctx, right, top);
                            this._drawCornerHandle(ctx, left,  bottom);
                            this._drawCornerHandle(ctx, right, bottom);
                        }

                        // Stats panel
                        const showStats = this.settings.alwaysShowStats || this.selected || this._hovering;
                        if (showStats && this.settings.showStats) {
                            this._drawStats(ctx, left, right, top, bottom, yEntry);
                        }

                        ctx.restore();
                    });
                }
            })
        }];
    }

    _drawPricePill(ctx, x, y, text, color, bgOverride = null) {
        const padX = 5;
        const padY = 2;
        const textW = ctx.measureText(text).width;
        ctx.fillStyle = bgOverride || this._hexAlpha(color, 0.85);
        ctx.fillRect(x, y - 7, textW + padX * 2, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, x + padX, y);
    }

    _drawStats(ctx, left, right, top, bottom, yEntry) {
        if (this.settings.compactStats) {
            const text = `Long ● 1:${this._riskReward().toFixed(2)} · Risk ${this._formatMoney(this._riskAmount())} · +${this._formatMoney(this._potentialProfit())}`;
            ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const padX = 6, padY = 4;
            const textW = ctx.measureText(text).width;
            const w = textW + padX * 2;
            const h = 18;
            const x = right - w;
            const y = top - h - 4;
            ctx.fillStyle = 'rgba(28, 32, 48, 0.95)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = this.color || '#26a69a';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = '#d1d4dc';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + padX, y + h / 2);
            return;
        }

        // Full stats panel — anchored at top-right of trade
        const lines = [
            `LONG  ●  Active`,
            `Risk/Reward   1 : ${this._riskReward().toFixed(2)}`,
            `Risk          ${this._formatMoney(this._riskAmount())}`,
            `Profit        +${this._formatMoney(this._potentialProfit())}`,
            `Size          ${this._lotSize().toFixed(this.settings.pricePrecision)} lots`,
            `Margin        ${this._formatMoney(this._marginRequired())}`,
            `Entry         ${this.entry.price.toFixed(this.settings.pricePrecision)}`,
            `Take Profit   ${this.tp.toFixed(this.settings.pricePrecision)}`,
            `Stop Loss     ${this.sl.toFixed(this.settings.pricePrecision)}`,
        ];
        if (this._liquidationPrice() !== null) {
            lines.push(`Liquidation   ${this._liquidationPrice().toFixed(this.settings.pricePrecision)}`);
        }

        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const padX = 8, padY = 4, lineH = 14;
        const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
        const h = lines.length * lineH + padY * 2;
        const x = right + 8;
        const y = Math.max(top - h - 4, 4);
        ctx.fillStyle = 'rgba(28, 32, 48, 0.95)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = this.color || '#26a69a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillStyle = i === 0 ? (this.color || '#26a69a') : '#d1d4dc';
            ctx.fillText(lines[i], x + padX, y + padY + i * lineH);
        }
    }

    _formatMoney(v) {
        const sign = v < 0 ? '-' : '';
        const abs = Math.abs(v);
        const s = abs.toFixed(2);
        // Insert commas
        const parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return sign + '$' + parts.join('.');
    }

    /**
     * Draw a single square corner anchor at (x, y).  These are the
     * 4 draggable handles at the corners of the trade rectangle.
     * Visually: a white-bordered colored square so it pops on top
     * of either the green or red zone.
     */
    _drawCornerHandle(ctx, x, y) {
        const s = 8; // half-size (so the handle is 16x16)
        ctx.save();
        // White border (so it pops on green or red)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - s, y - s, s * 2, s * 2);
        // Colored fill — top corners use the profit color,
        // bottom corners use the loss color, so each handle
        // visually matches the line it controls.
        const profitColor = this.color || '#26a69a';
        const lossColor   = '#ef5350';
        // Determine which color to use based on which edge this
        // corner is on: top = profit, bottom = loss.
        // (The caller passes the y coord; we compare to the
        // entry y to know which side.)
        const yEntry = this.series.priceToCoordinate(this.entry.price);
        const useColor = (yEntry !== null && y < yEntry) ? profitColor : lossColor;
        ctx.fillStyle = useColor;
        ctx.fillRect(x - s + 1.5, y - s + 1.5, s * 2 - 3, s * 2 - 3);
        // Subtle outline
        ctx.strokeStyle = useColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - s, y - s, s * 2, s * 2);
        ctx.restore();
    }

    _drawMidHandle(ctx, x, y) {
        const r = 4;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = this.color || '#26a69a';
        ctx.fillRect(x - r + 1, y - r + 1, r * 2 - 2, r * 2 - 2);
        ctx.strokeStyle = this.color || '#26a69a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - r, y - r, r * 2, r * 2);
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

    updateAllViews() {}
    autoscaleInfo() { return null; }

    _isShort() { return this._reversed === true; }
}
