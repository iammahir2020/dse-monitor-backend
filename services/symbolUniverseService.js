const Portfolio = require('../models/Portfolio');
const Watchlist = require('../models/Watchlist');

function parseGlobalSymbols() {
    const rawValue = String(process.env.PHASE12_GLOBAL_SYMBOLS || '').trim();
    if (!rawValue) {
        return [];
    }

    return [...new Set(
        rawValue
            .split(',')
            .map((symbol) => String(symbol || '').trim().toUpperCase())
            .filter(Boolean)
    )];
}

async function buildSymbolUniverse() {
    const [watchlistSymbols, portfolioSymbols] = await Promise.all([
        Watchlist.distinct('symbol'),
        Portfolio.distinct('symbol')
    ]);

    const normalizedWatchlist = watchlistSymbols
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter(Boolean);
    const normalizedPortfolio = portfolioSymbols
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter(Boolean);
    const globalSymbols = parseGlobalSymbols();

    const symbols = [...new Set([
        ...normalizedWatchlist,
        ...normalizedPortfolio,
        ...globalSymbols
    ])].sort();

    return {
        symbols,
        sources: {
            watchlistCount: normalizedWatchlist.length,
            portfolioCount: normalizedPortfolio.length,
            globalCount: globalSymbols.length,
            totalCount: symbols.length
        }
    };
}

module.exports = {
    buildSymbolUniverse,
    parseGlobalSymbols
};
