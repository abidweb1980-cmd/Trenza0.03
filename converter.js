const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION
// ==========================================
const TARGET_FILE_NAME = 'DAT_MT_XAUUSD_M1_2025.json'; 
const DATA_DIRECTORY = path.join(__dirname, 'src', 'data', 'real');

// Define the 10 timeframes with their interval in minutes
const TIMEFRAMES = [
    { name: 'M2', minutes: 2 },
    { name: 'M3', minutes: 3 },
    { name: 'M5', minutes: 5 },
    { name: 'M15', minutes: 15 },
    { name: 'M30', minutes: 30 },
    { name: 'H1', minutes: 60 },
    { name: 'H2', minutes: 120 },
    { name: 'H4', minutes: 240 },
    { name: 'H12', minutes: 720 },
    { name: 'D1', minutes: 1440 }
];

async function runRollup() {
    const inputFilePath = path.join(DATA_DIRECTORY, TARGET_FILE_NAME);

    if (!fs.existsSync(inputFilePath)) {
        console.error(`❌ Error: Input file not found at: ${inputFilePath}`);
        process.exit(1);
    }

    console.log(`🚀 Loading 1-minute base data from: ${TARGET_FILE_NAME}...`);
    console.time('Total Execution Time');

    // Read and parse the large 1-minute file
    const rawData = fs.readFileSync(inputFilePath, 'utf-8');
    const baseCandles = JSON.parse(rawData);

    console.log(`📦 Loaded ${baseCandles.length.toLocaleString()} 1-minute candles.`);
    console.log(`⚙️ Generating 10 higher timeframes in a single pass...`);

    // Initialize tracking arrays for each target timeframe
    for (const tf of TIMEFRAMES) {
        tf.results = [];
        tf.currentBar = null;
    }

    // Process every 1-minute candle sequentially
    for (let i = 0; i < baseCandles.length; i++) {
        const candle = baseCandles[i];
        
        // Handle both seconds and milliseconds auto-detect (13-digit vs 10-digit)
        const isMs = candle.time > 9999999999;
        const candleTimeMs = isMs ? candle.time : candle.time * 1000;

        for (const tf of TIMEFRAMES) {
            const intervalMs = tf.minutes * 60 * 1000;
            
            // Calculate strict boundary floor timestamps (e.g., 5m bars start strictly at :00, :05, :10)
            const bucketTimeMs = Math.floor(candleTimeMs / intervalMs) * intervalMs;
            const bucketTime = isMs ? bucketTimeMs : bucketTimeMs / 1000;

            if (!tf.currentBar || tf.currentBar.time !== bucketTime) {
                // If an existing bar was active, save it before starting the next one
                if (tf.currentBar) {
                    tf.results.push(tf.currentBar);
                }
                
                // Initialize a brand new candle bar for this timeframe window
                tf.currentBar = {
                    time: bucketTime,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume !== undefined ? candle.volume : 0
                };
            } else {
                // Update the running high, low, close, and volume inside the timeframe window
                tf.currentBar.high = Math.max(tf.currentBar.high, candle.high);
                tf.currentBar.low = Math.min(tf.currentBar.low, candle.low);
                tf.currentBar.close = candle.close;
                if (candle.volume !== undefined) {
                    tf.currentBar.volume += candle.volume;
                }
            }
        }
    }

    // Push the very last remaining active candle bars for each timeframe
    for (const tf of TIMEFRAMES) {
        if (tf.currentBar) {
            tf.results.push(tf.currentBar);
        }

        // Dynamically name the output file (e.g. replacing _M1_ with _M5_, _H1_, etc.)
        const baseName = path.basename(TARGET_FILE_NAME, '.json');
        const outputFileName = baseName.includes('_M1_') 
            ? baseName.replace('_M1_', `_${tf.name}_`) 
            : `${baseName}_${tf.name}`;
            
        const outputFilePath = path.join(DATA_DIRECTORY, `${outputFileName}.json`);

        console.log(`💾 Writing ${tf.name}: ${tf.results.length.toLocaleString()} bars to disk...`);
        fs.writeFileSync(outputFilePath, JSON.stringify(tf.results, null, 2), 'utf-8');
    }

    console.log('\n✅ All timeframes generated and saved successfully!');
    console.timeEnd('Total Execution Time');
}

runRollup().catch(err => console.error('❌ Critical Script Error:', err));