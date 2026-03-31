const DailySummary = require('../models/DailySummary');
const { getStockTradeValue, getStockVolume, toNumber } = require('./marketAnalytics');

function getSummaryDate(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function recordDailySummaries(liveData, capturedAt = new Date()) {
    const summaryDate = getSummaryDate(capturedAt);

    const operations = liveData
        .filter((stock) => stock?.symbol)
        .map((stock) => {
            const symbol = stock.symbol.toUpperCase();
            const latestPrice = toNumber(stock.ltp) ?? toNumber(stock.close) ?? toNumber(stock.open);
            if (latestPrice == null) {
                return null;
            }

            const open = toNumber(stock.open) ?? latestPrice;
            const high = toNumber(stock.high) ?? latestPrice;
            const low = toNumber(stock.low) ?? latestPrice;
            const volume = getStockVolume(stock);
            const tradeValue = getStockTradeValue(stock);

            return {
                updateOne: {
                    filter: { symbol, summaryDate },
                    update: {
                        $setOnInsert: {
                            symbol,
                            summaryDate,
                            open
                        },
                        $set: {
                            close: latestPrice,
                            lastSnapshotAt: capturedAt
                        },
                        ...(high != null ? { $max: { high } } : {}),
                        ...(low != null ? { $min: { low } } : {}),
                        ...(volume != null ? { $max: { volume } } : {}),
                        ...(tradeValue != null ? { $max: { tradeValue } } : {})
                    },
                    upsert: true
                }
            };
        })
        .filter(Boolean);

    if (!operations.length) {
        return { upsertedCount: 0, modifiedCount: 0 };
    }

    const result = await DailySummary.bulkWrite(operations, { ordered: false });
    return {
        upsertedCount: result.upsertedCount || 0,
        modifiedCount: result.modifiedCount || 0
    };
}

async function getSummaryHistoryForSymbols(symbols, limitPerSymbol = 30) {
    if (!symbols.length) {
        return {};
    }

    const summaries = await DailySummary.find({ symbol: { $in: symbols } })
        .sort({ summaryDate: -1 })
        .lean();

    const groupedSummaries = {};

    for (const summary of summaries) {
        if (!groupedSummaries[summary.symbol]) {
            groupedSummaries[summary.symbol] = [];
        }

        if (groupedSummaries[summary.symbol].length < limitPerSymbol) {
            groupedSummaries[summary.symbol].push(summary);
        }
    }

    return groupedSummaries;
}

module.exports = {
    getSummaryDate,
    recordDailySummaries,
    getSummaryHistoryForSymbols
};