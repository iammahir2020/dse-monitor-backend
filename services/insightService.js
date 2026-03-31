const Portfolio = require('../models/Portfolio');
const Watchlist = require('../models/Watchlist');
const { getLiveData } = require('./liveDataCache');
const { getSummaryDate, getSummaryHistoryForSymbols } = require('./dailySummaryService');
const {
    average,
    computeChangePercent,
    getStockVolume,
    simpleMovingAverage,
    toNumber
} = require('./marketAnalytics');

function buildEntrySignal(symbol, stock, summaries, sourceLabels) {
    const todaySummaryDate = getSummaryDate().getTime();
    const historicalSummaries = summaries
        .filter((summary) => new Date(summary.summaryDate).getTime() < todaySummaryDate)
        .slice(0, 20)
        .reverse();

    const currentPrice = toNumber(stock?.ltp);
    if (!currentPrice) {
        return null;
    }

    const closes = historicalSummaries.map((summary) => summary.close).filter((value) => value != null);
    const highs = historicalSummaries.map((summary) => summary.high).filter((value) => value != null);
    const lows = historicalSummaries.map((summary) => summary.low).filter((value) => value != null);
    const volumes = historicalSummaries.map((summary) => summary.volume).filter((value) => value != null);

    if (closes.length < 5 || highs.length < 5 || lows.length < 5) {
        return {
            symbol,
            sources: sourceLabels,
            score: 15,
            confidence: 'low',
            recommendation: 'insufficient_history',
            currentPrice,
            reasons: ['Not enough recent daily history is stored yet for a reliable entry signal.'],
            cautions: ['Collect a few more trading days before using this signal.'],
            entryZone: null,
            stopLoss: null,
            targetPrice: null,
            riskRewardRatio: null,
            metrics: {
                changePercent: computeChangePercent(stock),
                currentVolume: getStockVolume(stock)
            }
        };
    }

    const sma5 = simpleMovingAverage(closes, 5);
    const sma10 = simpleMovingAverage(closes, Math.min(10, closes.length));
    const recentResistance = Math.max(...highs.slice(-10));
    const recentSupport = Math.min(...lows.slice(-10));
    const averageVolume5 = average(volumes.slice(-5));
    const currentVolume = getStockVolume(stock);
    const changePercent = computeChangePercent(stock);

    let score = 0;
    const reasons = [];
    const cautions = [];

    if (sma5 && currentPrice > sma5) {
        score += 15;
        reasons.push('Price is trading above the short-term moving average.');
    }

    if (sma5 && sma10 && sma5 > sma10) {
        score += 15;
        reasons.push('Short-term trend is stronger than the medium-term trend.');
    }

    const supportDistancePercent = recentSupport > 0
        ? ((currentPrice - recentSupport) / recentSupport) * 100
        : null;

    if (supportDistancePercent != null && supportDistancePercent <= 4) {
        score += 20;
        reasons.push('Price is close to recent support, which improves entry discipline.');
    }

    const nearBreakout = currentPrice >= recentResistance * 0.99;
    if (nearBreakout) {
        score += 12;
        reasons.push('Price is testing recent resistance and could break out.');
    }

    if (currentVolume && averageVolume5 && currentVolume >= averageVolume5 * 1.5) {
        score += 18;
        reasons.push('Current volume is meaningfully above recent average volume.');
    } else if (averageVolume5 && currentVolume && currentVolume < averageVolume5 * 0.7) {
        cautions.push('Volume is below recent average, so conviction is weaker.');
    }

    if (typeof changePercent === 'number' && Math.abs(changePercent) >= 8) {
        cautions.push('Price has already moved sharply today; waiting for a calmer entry may reduce risk.');
    }

    const stopLoss = recentSupport;
    const targetPrice = currentPrice > recentResistance
        ? currentPrice + Math.max(currentPrice - recentSupport, 0) * 2
        : recentResistance;
    const riskPerShare = currentPrice - stopLoss;
    const rewardPerShare = targetPrice - currentPrice;
    const riskRewardRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : null;

    if (riskRewardRatio != null && riskRewardRatio >= 1.5) {
        score += 20;
        reasons.push('Estimated reward is at least 1.5x the risk to nearby support.');
    } else if (riskRewardRatio != null) {
        cautions.push('Estimated reward-to-risk is not compelling yet.');
    }

    const confidence = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
    const recommendation = score >= 65 ? 'good_entry' : score >= 40 ? 'watch_closely' : 'not_ready';
    const entryZone = supportDistancePercent != null && supportDistancePercent <= 4
        ? {
            min: Number(recentSupport.toFixed(2)),
            max: Number((recentSupport * 1.02).toFixed(2))
        }
        : nearBreakout
            ? {
                min: Number((recentResistance * 0.995).toFixed(2)),
                max: Number((recentResistance * 1.01).toFixed(2))
            }
            : null;

    return {
        symbol,
        sources: sourceLabels,
        score,
        confidence,
        recommendation,
        currentPrice,
        entryZone,
        stopLoss: Number(stopLoss.toFixed(2)),
        targetPrice: Number(targetPrice.toFixed(2)),
        riskRewardRatio: riskRewardRatio != null ? Number(riskRewardRatio.toFixed(2)) : null,
        reasons,
        cautions,
        metrics: {
            sma5: sma5 != null ? Number(sma5.toFixed(2)) : null,
            sma10: sma10 != null ? Number(sma10.toFixed(2)) : null,
            recentResistance: Number(recentResistance.toFixed(2)),
            recentSupport: Number(recentSupport.toFixed(2)),
            averageVolume5: averageVolume5 != null ? Number(averageVolume5.toFixed(0)) : null,
            currentVolume,
            changePercent: changePercent != null ? Number(changePercent.toFixed(2)) : null
        }
    };
}

async function getEntrySignalsForUser(userPhoneNumber) {
    const [holdings, watchlistItems, liveData] = await Promise.all([
        Portfolio.find({ userPhoneNumber }).lean(),
        Watchlist.find({ userPhoneNumber }).lean(),
        getLiveData()
    ]);

    const sourceMap = new Map();

    holdings.forEach((holding) => {
        const symbol = holding.symbol.toUpperCase();
        const existingSources = sourceMap.get(symbol) || new Set();
        existingSources.add('portfolio');
        sourceMap.set(symbol, existingSources);
    });

    watchlistItems.forEach((watchlistItem) => {
        const symbol = watchlistItem.symbol.toUpperCase();
        const existingSources = sourceMap.get(symbol) || new Set();
        existingSources.add('watchlist');
        sourceMap.set(symbol, existingSources);
    });

    const symbols = [...sourceMap.keys()];
    if (!symbols.length) {
        return [];
    }

    const liveDataBySymbol = {};
    liveData.forEach((stock) => {
        if (stock?.symbol) {
            liveDataBySymbol[stock.symbol.toUpperCase()] = stock;
        }
    });

    const summaryHistory = await getSummaryHistoryForSymbols(symbols, 25);

    return symbols
        .map((symbol) => buildEntrySignal(
            symbol,
            liveDataBySymbol[symbol],
            summaryHistory[symbol] || [],
            [...(sourceMap.get(symbol) || [])]
        ))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);
}

module.exports = {
    getEntrySignalsForUser
};