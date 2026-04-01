const { spawn } = require('child_process');
const path = require('path');

const HistoricalBarDaily = require('../models/HistoricalBarDaily');
const { buildSymbolUniverse } = require('./symbolUniverseService');

const PYTHON_CANDIDATES = [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean);

function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(row) {
    const rawDate = row.date || row.trade_date || row.tradeDate || row.dt || row.timestamp;
    if (!rawDate) {
        return null;
    }

    const date = new Date(rawDate);
    return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeHistoricalRows(rows) {
    return rows
        .map((row) => {
            const tradeDate = normalizeDate(row);
            if (!tradeDate) {
                return null;
            }

            return {
                tradeDate,
                open: toNumber(row.open),
                high: toNumber(row.high),
                low: toNumber(row.low),
                close: toNumber(row.close),
                volume: toNumber(row.volume)
            };
        })
        .filter(Boolean);
}

function runHistoryScript(symbol, startDate, endDate) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '../scraper/get_history.py');

        function runWithCandidate(index) {
            if (index >= PYTHON_CANDIDATES.length) {
                reject(new Error('No usable Python executable found. Set PYTHON_BIN or install python3.'));
                return;
            }

            const pythonProcess = spawn(PYTHON_CANDIDATES[index], [scriptPath, symbol, startDate, endDate]);
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
                    reject(new Error(errorOutput || `History script exited with code ${code}`));
                    return;
                }

                if (!output) {
                    reject(new Error(errorOutput || 'History script returned no output'));
                    return;
                }

                try {
                    const payload = JSON.parse(output);
                    if (!payload || typeof payload !== 'object') {
                        reject(new Error('Invalid historical payload shape'));
                        return;
                    }

                    if (!payload.ok) {
                        reject(new Error(`${payload.errorType || 'HistoryError'}: ${payload.errorMessage || 'Unknown error'}`));
                        return;
                    }

                    if (!Array.isArray(payload.data)) {
                        reject(new Error('Historical payload missing data array'));
                        return;
                    }

                    resolve(payload.data);
                } catch (error) {
                    reject(new Error(`Historical payload parse error: ${error.message}`));
                }
            });
        }

        runWithCandidate(0);
    });
}

async function upsertDailyBars(symbol, rows) {
    if (!rows.length) {
        return { upsertedCount: 0, modifiedCount: 0 };
    }

    const operations = rows.map((row) => ({
        updateOne: {
            filter: { symbol, tradeDate: row.tradeDate },
            update: {
                $set: {
                    open: row.open,
                    high: row.high,
                    low: row.low,
                    close: row.close,
                    volume: row.volume,
                    source: 'bdshare',
                    fetchedAt: new Date()
                }
            },
            upsert: true
        }
    }));

    const result = await HistoricalBarDaily.bulkWrite(operations, { ordered: false });
    return {
        upsertedCount: result.upsertedCount || 0,
        modifiedCount: result.modifiedCount || 0
    };
}

function getDateWindow(days = 180) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);

    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10)
    };
}

async function runHistoricalIngestionCycle({ lookbackDays = 180, symbols = null } = {}) {
    const universe = symbols?.length ? { symbols } : await buildSymbolUniverse();
    const uniqueSymbols = [...new Set((universe.symbols || []).map((value) => value.toUpperCase()))];
    const { startDate, endDate } = getDateWindow(lookbackDays);

    const stats = {
        startDate,
        endDate,
        symbolCount: uniqueSymbols.length,
        successCount: 0,
        failureCount: 0,
        upsertedCount: 0,
        modifiedCount: 0,
        errors: []
    };

    for (const symbol of uniqueSymbols) {
        try {
            const rawRows = await runHistoryScript(symbol, startDate, endDate);
            const rows = normalizeHistoricalRows(rawRows);
            const writeStats = await upsertDailyBars(symbol, rows);

            stats.successCount += 1;
            stats.upsertedCount += writeStats.upsertedCount;
            stats.modifiedCount += writeStats.modifiedCount;
        } catch (error) {
            stats.failureCount += 1;
            stats.errors.push({ symbol, message: error.message });
        }
    }

    return stats;
}

module.exports = {
    buildSymbolUniverse,
    normalizeHistoricalRows,
    runHistoricalIngestionCycle,
    upsertDailyBars
};
