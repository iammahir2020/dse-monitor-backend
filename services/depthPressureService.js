const { spawn } = require('child_process');
const path = require('path');

const DepthSnapshot = require('../models/DepthSnapshot');
const { computePressure, normalizeDepthRows } = require('./depthMath');
const { buildSymbolUniverse } = require('./symbolUniverseService');

const PYTHON_CANDIDATES = [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean);

function runDepthScript(symbol) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '../scraper/get_depth.py');

        function runWithCandidate(index) {
            if (index >= PYTHON_CANDIDATES.length) {
                reject(new Error('No usable Python executable found. Set PYTHON_BIN or install python3.'));
                return;
            }

            const pythonProcess = spawn(PYTHON_CANDIDATES[index], [scriptPath, symbol]);
            const outputChunks = [];
            const errorChunks = [];

            pythonProcess.stdout.on('data', (chunk) => outputChunks.push(chunk));
            pythonProcess.stderr.on('data', (chunk) => errorChunks.push(chunk));

            pythonProcess.on('error', (error) => {
                if (error.code === 'ENOENT') {
                    runWithCandidate(index + 1);
                    return;
                }
                reject(error);
            });

            pythonProcess.on('close', (code) => {
                const output = Buffer.concat(outputChunks).toString().trim();
                const errorOutput = Buffer.concat(errorChunks).toString().trim();

                if (code !== 0) {
                    reject(new Error(errorOutput || `Depth script exited with code ${code}`));
                    return;
                }

                if (!output) {
                    reject(new Error(errorOutput || 'Depth script returned no output'));
                    return;
                }

                try {
                    const payload = JSON.parse(output);
                    if (!payload || typeof payload !== 'object') {
                        reject(new Error('Invalid depth payload shape'));
                        return;
                    }

                    if (!payload.ok) {
                        reject(new Error(`${payload.errorType || 'DepthError'}: ${payload.errorMessage || 'Unknown error'}`));
                        return;
                    }

                    if (!Array.isArray(payload.data)) {
                        reject(new Error('Depth payload missing data array'));
                        return;
                    }

                    resolve(payload.data);
                } catch (error) {
                    reject(new Error(`Depth payload parse error: ${error.message}`));
                }
            });
        }

        runWithCandidate(0);
    });
}

async function captureDepthForSymbol(symbol) {
    const rawRows = await runDepthScript(symbol);
    const normalized = normalizeDepthRows(rawRows);
    const pressure = computePressure(normalized);

    const snapshotAt = new Date();
    const payload = {
        symbol,
        snapshotAt,
        bids: normalized.bids,
        asks: normalized.asks,
        totalBids: pressure.totalBids,
        totalAsks: pressure.totalAsks,
        buyPressureRatio: Number.isFinite(pressure.buyPressureRatio)
            ? Number(pressure.buyPressureRatio.toFixed(4))
            : pressure.buyPressureRatio,
        source: 'bdshare'
    };

    await DepthSnapshot.create(payload);

    return {
        ...payload,
        signal: pressure.signal
    };
}

async function runDepthPressureCycle({ symbols = null, maxSymbols = 150, onSnapshot = null } = {}) {
    const universe = symbols?.length ? { symbols } : await buildSymbolUniverse();
    const uniqueSymbols = [...new Set((universe.symbols || []).map((value) => value.toUpperCase()))].slice(0, maxSymbols);

    const stats = {
        symbolCount: uniqueSymbols.length,
        successCount: 0,
        failureCount: 0,
        snapshots: [],
        errors: []
    };

    for (const symbol of uniqueSymbols) {
        try {
            const snapshot = await captureDepthForSymbol(symbol);
            stats.successCount += 1;
            stats.snapshots.push(snapshot);

            if (typeof onSnapshot === 'function') {
                await onSnapshot(snapshot);
            }
        } catch (error) {
            stats.failureCount += 1;
            stats.errors.push({ symbol, message: error.message });
        }
    }

    return stats;
}

async function getDepthPressureList({ symbols = [], limit = 30 } = {}) {
    const query = symbols.length
        ? { symbol: { $in: symbols.map((value) => value.toUpperCase()) } }
        : {};

    const rows = await DepthSnapshot.find(query)
        .sort({ snapshotAt: -1 })
        .limit(limit)
        .lean();

    const threshold = Number(process.env.DEPTH_PRESSURE_THRESHOLD || 3);

    return rows.map((row) => {
        let signal = 'neutral';
        if (row.buyPressureRatio >= threshold) {
            signal = 'bullishPressure';
        } else if (row.buyPressureRatio > 0 && row.buyPressureRatio <= (1 / threshold)) {
            signal = 'bearishPressure';
        }

        return {
            symbol: row.symbol,
            buyPressureRatio: row.buyPressureRatio,
            totalBids: row.totalBids,
            totalAsks: row.totalAsks,
            signal,
            snapshotAt: row.snapshotAt
        };
    });
}

async function getLatestDepthPressure(symbol) {
    const row = await DepthSnapshot.findOne({ symbol: symbol.toUpperCase() })
        .sort({ snapshotAt: -1 })
        .lean();

    if (!row) {
        return null;
    }

    const threshold = Number(process.env.DEPTH_PRESSURE_THRESHOLD || 3);
    let signal = 'neutral';
    if (row.buyPressureRatio >= threshold) {
        signal = 'bullishPressure';
    } else if (row.buyPressureRatio > 0 && row.buyPressureRatio <= (1 / threshold)) {
        signal = 'bearishPressure';
    }

    return {
        symbol: row.symbol,
        snapshotAt: row.snapshotAt,
        topBids: row.bids,
        topAsks: row.asks,
        totalBids: row.totalBids,
        totalAsks: row.totalAsks,
        buyPressureRatio: row.buyPressureRatio,
        signal
    };
}

module.exports = {
    captureDepthForSymbol,
    computePressure,
    getDepthPressureList,
    getLatestDepthPressure,
    normalizeDepthRows,
    runDepthPressureCycle
};
