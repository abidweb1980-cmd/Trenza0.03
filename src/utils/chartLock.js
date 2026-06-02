// Locks the chart (panning, scrolling, scaling) so that user clicks
// and drags operate on trendline primitives, not on the chart.
//
// Uses a reference counter so concurrent operations (e.g. drawing
// while dragging) can each take a lock and the chart stays locked
// until all of them are released.

const SCROLL_OPTIONS = {
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
};

/**
 * Build a chart-lock helper bundle.
 * @param {import('lightweight-charts').IChartApi} chart
 */
export function createChartLock(chart) {
    let locked = false;
    let refCount = 0;

    function applyLocked() {
        chart.applyOptions({ handleScroll: false, handleScale: false });
        chart.timeScale().applyOptions({ handleScroll: false, handleScale: false });
    }

    function applyUnlocked() {
        chart.applyOptions({ ...SCROLL_OPTIONS });
        chart.timeScale().applyOptions({ handleScroll: true, handleScale: true });
    }

    function lock() {
        refCount += 1;
        if (locked) return;
        locked = true;
        try { applyLocked(); } catch (e) { console.warn('chart lock failed:', e); }
    }

    function unlock() {
        refCount = Math.max(0, refCount - 1);
        if (!locked || refCount > 0) return;
        locked = false;
        try { applyUnlocked(); } catch (e) { console.warn('chart unlock failed:', e); }
    }

    function forceUnlock() {
        refCount = 0;
        if (!locked) return;
        locked = false;
        try { applyUnlocked(); } catch (e) { console.warn('chart force-unlock failed:', e); }
    }

    function isLocked() {
        return locked;
    }

    return { lock, unlock, forceUnlock, isLocked };
}
