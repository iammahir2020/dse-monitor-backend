const HistoricalBarDaily = require('../models/HistoricalBarDaily');
const SignalStateDaily = require('../models/SignalStateDaily');
const { buildSymbolUniverse } = require('./symbolUniverseService');
const { computeEma, computeRsi, detectSignalTransitions } = require('./indicatorService');

async function fetchCloseSeries(symbol, limit = 120) {
    const rows = await HistoricalBarDaily.find({ symbol })
        .sort({ tradeDate: 1 })
        .limit(limit)
        .lean();

    return rows
        .map((row) => ({
            tradeDate: row.tradeDate,
            close: row.close
        }))
        .filter((row) => typeof row.close === 'number' && Number.isFinite(row.close));
}

async function computeSignalForSymbol(symbol) {
    const series = await fetchCloseSeries(symbol);
    if (series.length < 30) {
        return null;
    }

    const closes = series.map((entry) => entry.close);
    const lastDate = series[series.length - 1].tradeDate;

    const currentState = {
        rsi14: computeRsi(closes, 14),
        ema9: computeEma(closes, 9),
        ema21: computeEma(closes, 21)
    };

    if (currentState.rsi14 == null || currentState.ema9 == null || currentState.ema21 == null) {
        return null;
    }

    const previous = await SignalStateDaily.findOne({ symbol }).lean();
    const transitions = detectSignalTransitions(previous, currentState);

    const updatePayload = {
        symbol,
        lastDate,
        rsi14: Number(currentState.rsi14.toFixed(4)),
        ema9: Number(currentState.ema9.toFixed(4)),
        ema21: Number(currentState.ema21.toFixed(4)),
        prevRsi14: previous?.rsi14 ?? null,
        prevEma9: previous?.ema9 ?? null,
        prevEma21: previous?.ema21 ?? null,
        latestSignals: transitions,
        updatedAt: new Date()
    };

    await SignalStateDaily.updateOne(
        { symbol },
        { $set: updatePayload },
        { upsert: true }
    );

    return updatePayload;
}

async function runSignalRefreshCycle({ symbols = null, onSignal = null } = {}) {
    const universe = symbols?.length ? { symbols } : await buildSymbolUniverse();
    const uniqueSymbols = [...new Set((universe.symbols || []).map((value) => value.toUpperCase()))];

    const stats = {
        symbolCount: uniqueSymbols.length,
        successCount: 0,
        skippedCount: 0,
        failureCount: 0,
        updatedSignals: [],
        errors: []
    };

    for (const symbol of uniqueSymbols) {
        try {
            const result = await computeSignalForSymbol(symbol);
            if (!result) {
                stats.skippedCount += 1;
                continue;
            }
            stats.successCount += 1;
            stats.updatedSignals.push(result);

            if (typeof onSignal === 'function') {
                await onSignal(result);
            }
        } catch (error) {
            stats.failureCount += 1;
            stats.errors.push({ symbol, message: error.message });
        }
    }

    return stats;
}

async function getSignalPulse({ symbols = [], limit = 50 } = {}) {
    const query = symbols.length
        ? { symbol: { $in: symbols.map((value) => value.toUpperCase()) } }
        : {};

    const rows = await SignalStateDaily.find(query)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

    return rows.map((row) => ({
        symbol: row.symbol,
        rsi14: row.rsi14,
        ema9: row.ema9,
        ema21: row.ema21,
        signals: row.latestSignals || {
            oversoldRecovery: false,
            goldenCross: false,
            trendCooling: false,
            stateLabel: 'neutral'
        },
        updatedAt: row.updatedAt
    }));
}

module.exports = {
    computeSignalForSymbol,
    runSignalRefreshCycle,
    getSignalPulse
};
