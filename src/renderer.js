// src/renderer.js
// Change this line:
import { CandlestickSeries, createChart, CrosshairMode } from 'lightweight-charts';

const container = document.getElementById('chart-container');

// 1. Initialize the chart
const chart = createChart(container, {
    layout: {
        background: { color: '#1a1a1a' },
        textColor: '#e1e1e1',
    },
    grid: {
        vertLines: { color: '#2b2b2b' },
        horzLines: { color: '#2b2b2b' },
    },
    crosshair: {
      mode: CrosshairMode.Normal
    }
});


const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
});

// 3. Fetch data from your local JSON file
async function loadChartData() {
    try {
        const response = await fetch('./src/data/sample.json');
        
        if (!response.ok) {
            throw new Error(`Failed to load sample.json: ${response.statusText}`);
        }
        
        const rawData = await response.json();
        
        // Optimize and transform data to fit Lightweight Charts requirements
        const formattedData = rawData.map(candle => ({
            // Convert milliseconds timestamp to seconds timestamp
            time: candle.timestamp / 1000, 
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
            // Note: 'volume' and 'datetime' are ignored here as they aren't used by the candlestick series
        }));
        
        // Load the optimized data into the series
        candlestickSeries.setData(formattedData);
        
        // Automatically fit the content nicely on the screen
        chart.timeScale().fitContent();
        
    } catch (error) {
        console.error('Error loading chart candles:', error);
    }
}

// Execute data load
loadChartData();

// 4. Handle automatic resizing
const resizeObserver = new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    chart.resize(width, height);
});

resizeObserver.observe(container);