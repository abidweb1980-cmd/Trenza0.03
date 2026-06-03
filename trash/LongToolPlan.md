Long Position Tool — Product Specification (TradingView Parity)
A complete, implementation-ready UX spec for adding a "Long Position" drawing tool to the lightweight-charts overlay. No code yet — this is the blueprint.

1. Feature List
Core drawing features
F1. Single-click entry placement — first click on chart sets the entry price and time, draws the entry line, the default-sized profit/loss zones, and the two handles (TP, SL).
F2. TP handle (top, teal) — drag vertically to change take-profit price.
F3. SL handle (bottom, red) — drag vertically to change stop-loss price.
F4. Entry line (yellow/white) — drag vertically to move the entire trade up/down (entry + zones move together).
F5. Zone-drag (profit rectangle) — drag the green zone vertically to set TP (mirrors TP handle).
F6. Zone-drag (loss rectangle) — drag the red zone vertically to set SL (mirrors SL handle).
F7. Body-drag — drag the inside of the trade (the "body" between entry and current price) to translate the whole trade in time.
F8. Right edge-drag — drag the right edge of the zones horizontally to extend/shorten the time window of the visualization (does not affect prices).
F9. Auto size — on first placement, the zones default to: TP at +1R (1× the risk distance above entry), SL at -1R. The default time window is 30 bars.
Trade settings (Properties panel + inline)
F10. Account Size (number, default 10000, base currency)
F11. Risk % or Risk Amount (toggle, default 1% / $100)
F12. Leverage (number, default 1, range 1–500, step 1)
F13. Lot Size / Quantity (number, default auto-computed from risk, supports manual override)
F14. Entry Price (read-only mirror of where the entry is on chart, editable in panel)
F15. Take Profit (price or ticks, default 1R above entry)
F16. Stop Loss (price or ticks, default 1R below entry)
F17. TP Mode: Price | Ticks | R-Multiple (default R-Multiple: 2R)
F18. SL Mode: Price | Ticks | R-Multiple (default R-Multiple: 1R)
F19. Quantity Precision (integer, default 2 for forex, 4 for crypto, 0 for stocks; auto from symbol)
F20. Compact Stats Mode (boolean, default false) — collapses the stats panel to one line
F21. Always Show Stats (boolean, default true) — keeps stats visible even when not selected/hovered
F22. Show Stats on Hover Only (boolean, default false) — overrides "always" if true
F23. Visibility per Timeframe (multi-select, default All): 1m, 5m, 15m, 1h, 4h, 1D, 1W, 1M
F24. Color customization: profit color, loss color, entry line color, TP line color, SL line color
F25. Line Style: solid / dashed / dotted (for entry, TP, SL lines)
F26. Line Width (1–4 px)
F27. Extend Lines: None | Right | Left | Both (default Right for TP/SL)
F28. Reverse direction (a "Long Position" can be flipped to a "Short Position" by reversing, sharing most of the code)
Trade statistics (Stats Panel)
F29. Risk : Reward (e.g. 1 : 2.5)
F30. Risk Amount (in account currency, e.g. $100.00)
F31. Potential Profit (in account currency, e.g. $250.00)
F32. Position Size (in units, e.g. 1.2345 lots)
F33. Position Value (notional, e.g. $123,456.78)
F34. Margin Required (Position Value / Leverage, e.g. $1,234.57)
F35. Entry Price (e.g. 1.23456)
F36. Take Profit (e.g. 1.23891)
F37. Stop Loss (e.g. 1.23010)
F38. Distance to TP (in price and ticks)
F39. Distance to SL (in price and ticks)
F40. Pip value of the trade (derived)
F41. Win Rate Required to break even (always 100% for a single trade; shown for context)
F42. Liquidation Price (if leveraged, e.g. 1.21990)
Visual elements
F43. Entry line — horizontal line at entry, color = user-set entry color
F44. Profit zone — translucent green rectangle from entry to TP, with TP line on top
F45. Loss zone — translucent red rectangle from entry to SL, with SL line on bottom
F46. TP line — solid teal line, with price label on the right
F47. SL line — solid red line, with price label on the right
F48. Stats box — anchored to the right side of the trade, with the metrics above
F49. Status pip — small icon on the entry line that turns green/blue when price has hit TP, red when price has hit SL, white when trade is "active"
F50. Right-edge handle — small draggable triangle on the right edge of the zones
2. Interaction Rules
Placement
I1. Activate tool — sidebar button toggles mode = 'long-position-drawing'. Cursor becomes crosshair, status bar: "Long Position — click on chart to place entry".
I2. Click 1 — places entry at clicked (time, price). Tool immediately enters selected state (because freshly placed trades are auto-selected per TradingView).
I3. Click 2 on empty chart — does nothing (single-click tool).
I4. Right-click during placement — cancels placement, returns to idle.
I5. Esc during placement — same as I4.
Hover (idle, no selection)
I6. Cursor over TP line → cursor-ns-resize + handle highlight (thicker line).
I7. Cursor over SL line → cursor-ns-resize + handle highlight.
I8. Cursor over profit zone body → cursor-grab.
I9. Cursor over loss zone body → cursor-grab.
I10. Cursor over entry line → cursor-grab.
I11. Cursor over right edge → cursor-ew-resize.
I12. Cursor over stats box → cursor-grab (panel can be dragged to a different anchor position).
I13. Stats panel is shown when Always Show Stats is true OR the trade is selected/hovered.
Selection (idle, on a Long Position tool)
I14. Click on any part of the tool (entry line, TP line, SL line, profit zone, loss zone, right edge, stats box) → selects that trade. Previous selection cleared.
I15. Click on empty chart → deselects all trades.
I16. Click on a different tool (trendline, rectangle, fib, another long position) → selects that one, deselects the long position.
I17. Selected trade shows all 8 handles (top, bottom, left, right, 4 corners — same as rectangle), with 1.5× line width and the stats panel.
Drag (selected)
I18. Drag TP handle / profit zone top edge → moves TP. Updates the profit zone height. Snap modifiers apply.
I19. Drag SL handle / loss zone bottom edge → moves SL. Snap modifiers apply.
I20. Drag entry line (anywhere along the line, not on a handle) → moves entry vertically. TP and SL move with it (preserving their absolute price, not the R-multiple). Alternative: move with relative R — make this a setting: Move entry: Absolute | Relative.
I21. Drag body (interior of profit or loss zone) → translates the entire trade in time. Entry, TP, SL all keep their prices, but shift in time.
I22. Drag right edge → extends/shortens the time window of the visualization. Does not affect prices.
I23. Drag stats box → moves the stats panel to a new anchor (TL, TR, BL, BR, C of the trade). Tool's data doesn't change.
I24. Drag corner (top-left, top-right, bottom-left, bottom-right of the trade) → resizes the visualization. Top corners adjust TP, bottom corners adjust SL, left/right adjust time window.
Keyboard modifiers during drag (TradingView parity)
I25. SHIFT held during any drag → 45° angle lock (no-op for vertical-only handles, used for time-direction drags to snap to bar boundaries).
I26. CTRL held during any drag → magnet-snap the price to the nearest OHLC of the candle under the cursor.
I27. ALT held during a corner drag → free-form resize (no snap).
I28. Mouse wheel on a selected trade → nudges entry price by 1 tick up/down. SHIFT + wheel = 1 pip. ALT + wheel = 0.1 tick (fine).
Double-click
I29. Double-click on TP line → opens settings panel, focuses the Take Profit field.
I30. Double-click on SL line → opens settings panel, focuses the Stop Loss field.
I31. Double-click on entry line → opens settings panel, focuses the Entry Price field.
I32. Double-click on stats panel → toggles between full stats and compact stats.
I33. Double-click on empty chart → no-op.
Right-click (context menu)
I34. Right-click on the tool → opens context menu with:
"Edit settings…"
"Reverse position" (long ↔ short)
"Duplicate"
"Lock"
"Hide on this timeframe"
"Delete"
"Cancel"
I35. Right-click on empty chart → no-op (browser default).
Deletion
I36. DEL / Backspace while selected → removes the trade (confirmation if confirm-delete setting is on).
I37. Trash button in toolbar with trade selected → same as I36.
I38. Right-click → Delete → same as I36.
Deselection
I39. Esc while a trade is selected → deselects (does NOT delete). Second Esc → leaves drawing mode (if active).
I40. Click on empty chart → deselects.
I41. Click on different tool → deselects.
Multi-select
I42. Not supported in v1. Future: SHIFT-click to add to selection, drag to move all selected.
Mobile / touch
I43. Tap = click (places entry, selects, etc.)
I44. Long-press (≥500 ms) = right-click → context menu
I45. Pinch on a selected trade's right edge = drag right edge (zoom time window)
I46. Two-finger drag on a selected trade = body drag
I47. One-finger drag on a handle = drag that handle
I48. The Properties panel slides up from the bottom (full-width sheet) on mobile when a trade is selected.
3. State Machine

            ┌─────────────┐
            │   IDLE      │ ◀───────────────────────────┐
            └──────┬──────┘                             │
                   │ activate tool                      │ Esc / deselect
                   ▼                                    │
            ┌─────────────────┐                         │
            │ AWAITING_ENTRY  │                         │
            │  (no anchor)    │                         │
            └──────┬──────────┘                         │
                   │ click 1                            │
                   ▼                                    │
            ┌─────────────────┐                         │
            │  PLACED         │                         │
            │  (entry anchor  │──── drag handle ──────▶ │
            │   set, selected)│                         │
            └──────┬──────────┘ ◀──────────── drag end ─┘
                   │ click empty / Esc
                   ▼
                 IDLE
States (in detail)
State	Description	Visible handles	Cursor	Stats panel
IDLE	No tool active. Existing trades may be selected.	Selected: 8. Others: 0.	Default	Only on selected/hovered if Always Show is true
AWAITING_ENTRY	Tool active, no anchor yet	None	Crosshair	Hidden
PLACED	Entry set; tool selected	All 8	Per element	Shown (full)
HOVER (in IDLE)	Mouse over a non-selected trade	Top, bottom, entry, right-edge	Per element	Compact (if Always=false)
DRAGGING	User is dragging a handle	Only the dragged handle highlighted	Grabbing	Shown (full)
EDITING_SETTINGS	Properties panel open	All 8	Per element	Shown (full)
CONTEXT_MENU	Right-click menu open	All 8	Default	Shown (full)
HIDDEN	Trade is on a different timeframe and is hidden	None	—	—
Transitions
IDLE → AWAITING_ENTRY — sidebar tool button click
AWAITING_ENTRY → PLACED — chart click
AWAITING_ENTRY → IDLE — Esc, right-click, or sidebar tool button click
PLACED → IDLE — click on empty chart, Esc (with the trade still in state.longPositions[] but deselected)
IDLE → DRAGGING — mousedown on a handle/edge of a selected (or hovered, auto-select-on-drag) trade
DRAGGING → IDLE — mouseup
IDLE → EDITING_SETTINGS — double-click on a part of the trade
EDITING_SETTINGS → IDLE — close panel
* → CONTEXT_MENU — right-click on trade
CONTEXT_MENU → IDLE — click outside menu
* → HIDDEN — timeframe change hides the trade
HIDDEN → IDLE — timeframe change makes the trade visible again
Persistence
All trades in state.longPositions[]. Settings per trade stored on the trade object.
Symbol change: trades are kept but flagged as orphaned: true and rendered with a striped overlay. Re-placing at the same symbol restores.
Timeframe change: trades hidden if their visibleTimeframes setting doesn't include the current TF.
4. Visual Rules
Colors (default palette, user-overridable)
Entry line: #ffffff (1.5px solid)
Profit zone fill: #26a69a at 12% alpha
Profit zone border / TP line: #26a69a solid (2px)
Loss zone fill: #ef5350 at 12% alpha
Loss zone border / SL line: #ef5350 solid (2px)
Stats panel background: #1c2030 at 95% alpha
Stats panel text: #d1d4dc
Status pip (active): #2962ff
Status pip (TP hit): #26a69a
Status pip (SL hit): #ef5350
Geometry
Tool bounding box: left = entryTime - barWidth/2, right = entryTime + tradeWindow
Trade window default: 30 bars (configurable: 10, 20, 30, 50, 100)
TP line: horizontal, at price tp, from left to right
SL line: horizontal, at price sl, from left to right
Profit zone: rectangle from (left, entryPrice) to (right, tp) — green fill
Loss zone: rectangle from (left, sl) to (right, entryPrice) — red fill
Entry line: horizontal, at entryPrice, from (left - barWidth/2) to (right + barWidth/2) so it extends past the zones
Line styles
Entry: solid
TP: solid (default), user-configurable
SL: solid (default), user-configurable
Z



Plan Created

Long Position Tool — Product Specification (TradingView Parity)
A complete, implementation-ready UX spec for adding a "Long Position" drawing tool to the lightweight-charts overlay. No code yet — this is the blueprint.

1. Feature List
Core drawing features
F1. Single-click entry placement — first click sets entry (time, price), draws entry line + default profit/loss zones + TP/SL handles.
F2. TP handle (top, teal) — drag vertically to change take-profit price.
F3. SL handle (bottom, red) — drag vertically to change stop-loss price.
F4. Entry line (white/yellow) — drag vertically to move the entire trade up/down (entry + zones move together).
F5. Zone-drag (profit rect) — drag the green zone vertically to set TP.
F6. Zone-drag (loss rect) — drag the red zone vertically to set SL.
F7. Body-drag — drag the inside of the trade body to translate the whole trade in time.
F8. Right edge-drag — extend/shorten the time window of the visualization (does not affect prices).
F9. Auto size — on first placement, TP defaults to +1R, SL to -1R; time window defaults to 30 bars.
Trade settings
F10. Account Size (number, default 10000, base currency)
F11. Risk % (default 1%) OR Risk Amount (default $100), user-toggle
F12. Leverage (1–500, step 1, default 1)
F13. Lot Size / Quantity (auto-computed from risk; supports manual override)
F14. Entry Price (mirror of chart position; editable in panel)
F15. Take Profit (price / ticks / R-multiple)
F16. Stop Loss (price / ticks / R-multiple)
F17. TP Mode: Price | Ticks | R-Multiple (default R-Multiple: 2R)
F18. SL Mode: Price | Ticks | R-Multiple (default R-Multiple: 1R)
F19. Quantity Precision (auto from symbol; manual override)
F20. Compact Stats Mode (boolean, default false)
F21. Always Show Stats (boolean, default true)
F22. Show on Hover Only (boolean, default false; overrides Always)
F23. Visibility per Timeframe (multi-select; default All)
F24. Color customization: profit / loss / entry / TP / SL
F25. Line Style: solid / dashed / dotted
F26. Line Width: 1–4 px
F27. Extend Lines: None | Right | Left | Both (default Right for TP/SL)
F28. Reverse direction (Long ↔ Short, shares code)
Trade statistics (Stats Panel)
F29. Risk : Reward (e.g. 1 : 2.50)
F30. Risk Amount (e.g. $100.00)
F31. Potential Profit (e.g. $250.00)
F32. Position Size (e.g. 1.2345 lots)
F33. Position Value (e.g. $123,456.78)
F34. Margin Required (Position Value / Leverage)
F35. Entry Price
F36. Take Profit
F37. Stop Loss
F38. Distance to TP (price + ticks)
F39. Distance to SL (price + ticks)
F40. Pip value of the trade
F41. Win Rate Required (always 100%, shown for context)
F42. Liquidation Price (if leverage > 1)
Visual elements
F43. Entry line (horizontal, user-color)
F44. Profit zone (translucent green rect, entry→TP)
F45. Loss zone (translucent red rect, SL→entry)
F46. TP line (teal solid, with right-side price label)
F47. SL line (red solid, with right-side price label)
F48. Stats box (anchored to right side of trade, metrics stacked)
F49. Status pip (blue=active, green=TP hit, red=SL hit)
F50. Right-edge handle (small triangle, drag to resize time window)
2. Interaction Rules
Placement
I1. Activate tool — sidebar button toggles mode = 'long-position-drawing'. Cursor becomes crosshair. Status: "Long Position — click on chart to place entry".
I2. Click 1 — places entry at clicked (time, price). Tool immediately enters PLACED (auto-selected per TradingView).
I3. Click 2 on empty chart — no-op.
I4. Right-click during placement — cancels placement, returns to idle.
I5. Esc during placement — same as I4.
Hover (idle, no selection)
I6. TP line → cursor-ns-resize + thicker line.
I7. SL line → cursor-ns-resize + thicker line.
I8. Profit zone body → cursor-grab.
I9. Loss zone body → cursor-grab.
I10. Entry line → cursor-grab.
I11. Right edge → cursor-ew-resize.
I12. Stats box → cursor-grab (panel is movable).
I13. Stats shown when Always Show Stats is true OR trade is selected/hovered.
Selection (idle, on a Long Position)
I14. Click on any part of the tool (entry, TP, SL, profit zone, loss zone, right edge, stats) → selects. Previous selection cleared.
I15. Click on empty chart → deselects.
I16. Click on different tool → selects that one.
I17. Selected trade shows all 8 handles (top, bottom, left, right, 4 corners), 1.5× line width, full stats panel.
Drag (selected)
I18. Drag TP handle / profit-zone top edge → moves TP. Updates profit zone height. Snap modifiers apply.
I19. Drag SL handle / loss-zone bottom edge → moves SL. Snap modifiers apply.
I20. Drag entry line (anywhere not on a handle) → moves entry vertically. TP/SL follow. Mode setting: Move entry: Absolute | Relative (default Absolute = TP/SL keep their absolute prices; Relative = TP/SL preserve R-multiples).
I21. Drag body (interior of profit or loss zone) → translates the whole trade in time. Entry/TP/SL keep their prices, shift in time.
I22. Drag right edge → extends/shortens time window. Prices unchanged.
I23. Drag stats box → moves the stats panel anchor (TL / TR / BL / BR / C of trade). Tool data unchanged.
I24. Drag corner (TL, TR, BL, BR) → top corners adjust TP, bottom corners adjust SL, left/right corners adjust time window start/end.
Keyboard modifiers during drag
I25. SHIFT — 45° angle lock (used for time-direction drags to snap to bar boundaries).
I26. CTRL — magnet-snap the price to the nearest OHLC of the candle under the cursor.
I27. ALT — free-form resize (no snap).
I28. Mouse wheel on selected trade — nudges entry by 1 tick. SHIFT+wheel = 1 pip. ALT+wheel = 0.1 tick.
Double-click
I29. Double-click TP line → opens settings panel, focuses Take Profit field.
I30. Double-click SL line → focuses Stop Loss field.
I31. Double-click entry line → focuses Entry Price field.
I32. Double-click stats panel → toggles full ↔ compact.
I33. Double-click empty chart → no-op.
Right-click (context menu)
I34. Right-click on the tool → context menu:
"Edit settings…"
"Reverse position" (long ↔ short)
"Duplicate"
"Lock"
"Hide on this timeframe"
"Delete"
"Cancel"
I35. Right-click on empty chart → no-op.
Deletion
I36. DEL/Backspace while selected → removes (with optional confirmation).
I37. Trash button with trade selected → same.
I38. Right-click → Delete → same.
Deselection
I39. Esc while a trade is selected → deselects (does NOT delete). Second Esc → leaves drawing mode if active.
I40. Click on empty chart → deselects.
I41. Click on different tool → deselects.
Multi-select
I42. Not in v1. Future: SHIFT-click to add, drag to move all.
Mobile / touch
I43. Tap = click (places entry, selects).
I44. Long-press (≥500 ms) = right-click → context menu.
I45. Pinch on right edge = resize time window.
I46. Two-finger drag on selected trade = body drag.
I47. One-finger drag on handle = drag that handle.
I48. Properties panel = bottom sheet (full width) on mobile when trade is selected.
3. State Machine

            ┌─────────────┐
            │   IDLE      │ ◀───────────────────────────┐
            └──────┬──────┘                             │
                   │ activate tool                      │ Esc / deselect
                   ▼                                    │
            ┌─────────────────┐                         │
            │ AWAITING_ENTRY  │                         │
            └──────┬──────────┘                         │
                   │ click 1                            │
                   ▼                                    │
            ┌─────────────────┐                         │
            │  PLACED         │──── drag handle ──────▶ │
            │  (selected)     │                         │
            └──────┬──────────┘ ◀────── drag end ───────┘
                   │ click empty / Esc
                   ▼
                 IDLE
State	Description	Visible handles	Cursor	Stats
IDLE	No tool active. Trades may be selected.	Selected: 8. Others: 0.	Default	Always-only if set
AWAITING_ENTRY	Tool active, no anchor yet	None	Crosshair	Hidden
PLACED	Entry set; tool selected	All 8	Per element	Full
HOVER (in IDLE)	Mouse over non-selected trade	4 (top, bottom, entry, right)	Per element	Compact if Always=false
DRAGGING	User is dragging a handle	Only the dragged one highlighted	Grabbing	Full
EDITING_SETTINGS	Properties panel open	All 8	Per element	Full
CONTEXT_MENU	Right-click menu open	All 8	Default	Full
HIDDEN	Trade is on a hidden timeframe	None	—	—
Transitions
IDLE → AWAITING_ENTRY — sidebar tool click
AWAITING_ENTRY → PLACED — chart click
AWAITING_ENTRY → IDLE — Esc / right-click / sidebar tool click
PLACED → IDLE — click empty / Esc (trade remains, deselected)
IDLE → DRAGGING — mousedown on a handle/edge of a trade (auto-selects if not selected)
DRAGGING → IDLE — mouseup
IDLE → EDITING_SETTINGS — double-click on a part of the trade
EDITING_SETTINGS → IDLE — close panel
* → CONTEXT_MENU — right-click
CONTEXT_MENU → IDLE — click outside
* → HIDDEN — timeframe change hides the trade
HIDDEN → IDLE — timeframe change makes the trade visible
Persistence
All trades in state.longPositions[]. Per-trade settings live on the trade object.
Symbol change: trades are kept but flagged orphaned: true and rendered with a striped overlay. Re-placing at the same symbol restores.
Timeframe change: trades hidden if their visibleTimeframes setting doesn't include the current TF.
4. Visual Rules
Colors (default palette, all user-overridable)
Entry line: #ffffff (1.5px solid)
Profit fill: #26a69a at 12% alpha
Profit border / TP line: #26a69a solid (2px)
Loss fill: #ef5350 at 12% alpha
Loss border / SL line: #ef5350 solid (2px)
Stats bg: #1c2030 at 95% alpha
Stats text: #d1d4dc
Status pip (active): #2962ff
Status pip (TP hit): #26a69a
Status pip (SL hit): #ef5350
Geometry
Tool bounding box: left = entryTime - barWidth/2, right = entryTime + tradeWindow
Trade window default: 30 bars (configurable: 10, 20, 30, 50, 100)
TP line: horizontal, at tp, from left to right
SL line: horizontal, at sl, from left to right
Profit zone: rect from (left, entryPrice) to (right, tp)
Loss zone: rect from (left, sl) to (right, entryPrice)
Entry line: horizontal at entryPrice, from (left - barWidth/2) to (right + barWidth/2), extends past zones
Line styles
Entry: solid
TP / SL: solid (default), user-configurable to dashed/dotted
Z-order (back to front)
Loss zone fill
Profit zone fill
SL line
TP line
Entry line
Status pip
Right-edge handle (only when selected/hovered)
Corner handles (only when selected/hovered)
Stats panel (top-most, only when visible per visibility rule)
Selection visuals
Selected: all 8 corner/edge handles drawn (small filled squares, white-bordered), line width 1.5×, status pip larger
Hovered (non-selected): 4 handles (top, bottom, entry, right), line width 1.2×, status pip normal
Idle: no handles, line width 1×, status pip small (if Always Show Stats)
Stats panel layout

┌────────────────────────────┐
│ LONG  ●  Active            │ ← header (long/short, status)
├────────────────────────────┤
│ Risk/Reward   1 : 2.50     │
│ Risk          $100.00      │
│ Profit        $250.00      │
│ Size          1.2345 lots  │
│ Value         $123,456.78  │
│ Margin        $1,234.57    │
├────────────────────────────┤
│ Entry         1.23456      │
│ Take Profit   1.23891      │
│ Stop Loss     1.23010      │
│ +TP dist      +43.5 pips   │
│ -SL dist      -44.6 pips   │
│ Liquidation   1.21990      │
└────────────────────────────┘
Compact mode: one line — Long ● 1:2.5 · Risk $100 · +$250 · SL 1.23010 · TP 1.23891.

Stats panel anchor options
Top-right (default), Top-left, Bottom-right, Bottom-left, Center of trade
5. Calculation Rules
Symbols and units (auto-derived)
pricePrecision = decimals of the price scale (e.g. EURUSD → 5, BTCUSD → 1)
tickSize = smallest price increment (e.g. EURUSD → 0.00001)
pipSize = 10 × tickSize for forex (e.g. 0.0001), 1 × tickSize for crypto
contractSize = 100000 for forex pairs, 1 for crypto, 1 for stocks
quoteCurrency = the second symbol in the pair (e.g. USD in EURUSD)
baseCurrency = the first symbol (e.g. EUR in EURUSD)
accountCurrency = USD by default; user-configurable
Default risk-based sizing
riskAmount = accountSize × riskPercent / 100 (or use Risk Amount directly)
slDistancePrice = |entryPrice - sl| (in price units)
tpDistancePrice = |tp - entryPrice|
slDistancePips = slDistancePrice / pipSize
tpDistancePips = tpDistancePrice / pipSize
tickValuePerContract = tickSize × (1 / entryPrice) × contractSize (forex-style)
For pairs quoted in USD: tickValuePerContract = tickSize × contractSize / entryPrice (in account currency)
For USD-quoted pairs (USDJPY): tickValuePerContract = tickSize × contractSize (already in USD)
lotSize = riskAmount / (slDistancePips × pipValuePerLot) where pipValuePerLot = tickValuePerContract × (pipSize / tickSize)
positionSize = lotSize × contractSize (in units of base currency)
positionValue = positionSize × entryPrice (in quote currency)
marginRequired = positionValue / leverage (in quote currency)
potentialProfit = tpDistancePips × pipValuePerLot × lotSize
riskRewardRatio = potentialProfit / riskAmount
`liquidationPrice = entryPrice × (1 - 1/leverage