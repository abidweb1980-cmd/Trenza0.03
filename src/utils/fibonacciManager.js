// fibonacciManager.js
// -----------------------------------------------------------------------------
// Manages the collection of Fibonacci Retracement primitives on the
// chart: creation, selection, hit-testing, and deletion.  Mirrors
// trendlineManager.js exactly.
// -----------------------------------------------------------------------------

import { NativeFibonacciRetracement } from './FibonacciRetracement.js';

/**
 * Build a Fibonacci Retracement manager.
 * @param {import('lightweight-charts').IChartApi} chart
 * @param {import('lightweight-charts').ISeriesApi} series
 * @param {object} state - shared state object
 * @param {string} color
 * @param {() => void} requestRedraw
 */
export function createFibonacciManager(chart, series, state, color, requestRedraw) {
    /**
     * Create a new Fibonacci, attach it to the series, register it
     * in state, and auto-select it. Returns the created fib.
     */
    function create(p1, p2) {
        const fib = new NativeFibonacciRetracement(
            chart, series, p1, p2, color,
            () => { requestRedraw(); },            // onChange
            (sel) => { select(sel); }              // onSelect
        );
        series.attachPrimitive(fib);
        state.fibs.push(fib);
        select(fib);
        return fib;
    }

    /**
     * Mark the given fib as the currently-selected one (deselecting
     * the previous selection, if any).
     */
    function select(fib) {
        if (state.selectedFib && state.selectedFib !== fib) {
            state.selectedFib.setSelected(false);
        }
        state.selectedFib = fib;
        if (fib) fib.setSelected(true);
    }

    /**
     * Deselect whatever is currently selected.
     */
    function clearSelection() {
        if (state.selectedFib) {
            state.selectedFib.setSelected(false);
            state.selectedFib = null;
        }
    }

    /**
     * Hit-test a pixel point against all fibs.  Iterates in reverse
     * so the most recently drawn fib wins.
     * @returns {{fib: NativeFibonacciRetracement, target: 'p1'|'p2'|'body'} | null}
     */
    function hitTest(px, py) {
        for (let i = state.fibs.length - 1; i >= 0; i--) {
            const fib = state.fibs[i];
            const target = fib.hitTest(px, py);
            if (target) return { fib, target };
        }
        return null;
    }

    /**
     * Remove a fib: detach its primitive from the series AND
     * remove it from the registry.
     */
    function remove(fib) {
        if (!fib) return;
        try {
            if (typeof series.detachPrimitive === 'function') {
                series.detachPrimitive(fib);
            }
        } catch (e) {
            console.warn('[fibonacciManager] detachPrimitive failed:', e);
        }
        const idx = state.fibs.indexOf(fib);
        if (idx !== -1) state.fibs.splice(idx, 1);
        if (state.selectedFib === fib) state.selectedFib = null;
        requestRedraw();
    }

    return { create, select, clearSelection, hitTest, remove };
}
