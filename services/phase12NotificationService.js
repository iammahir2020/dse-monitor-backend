const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const notificationService = require('./notificationService');
const websocketService = require('./websocketService');

const ENABLE_DEPTH_WS_EVENTS = String(process.env.PHASE12_ENABLE_DEPTH_WS_EVENTS || '').toLowerCase() === 'true';
const DEPTH_COOLDOWN_MS = 15 * 60 * 1000;
const SIGNAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

function hasSignalTrigger(signal) {
    const s = signal?.latestSignals || signal?.signals || {};
    return Boolean(s.oversoldRecovery || s.goldenCross || s.trendCooling);
}

function getSignalKinds(signal) {
    const s = signal?.latestSignals || signal?.signals || {};
    return [
        ...(s.oversoldRecovery ? ['oversoldRecovery'] : []),
        ...(s.goldenCross ? ['goldenCross'] : []),
        ...(s.trendCooling ? ['trendCooling'] : [])
    ];
}

async function buildSymbolUserMap(symbols) {
    const normalizedSymbols = [...new Set(symbols.map((symbol) => String(symbol).toUpperCase()))];
    if (!normalizedSymbols.length) {
        return new Map();
    }

    const [watchlistRows, portfolioRows] = await Promise.all([
        Watchlist.find({ symbol: { $in: normalizedSymbols } }, { symbol: 1, userPhoneNumber: 1 }).lean(),
        Portfolio.find({ symbol: { $in: normalizedSymbols } }, { symbol: 1, userPhoneNumber: 1 }).lean()
    ]);

    const map = new Map();
    const register = (symbol, phone) => {
        if (!map.has(symbol)) {
            map.set(symbol, new Set());
        }
        map.get(symbol).add(phone);
    };

    watchlistRows.forEach((row) => register(String(row.symbol).toUpperCase(), row.userPhoneNumber));
    portfolioRows.forEach((row) => register(String(row.symbol).toUpperCase(), row.userPhoneNumber));

    return map;
}

async function notifyDepthPressureSnapshots(snapshots) {
    if (!Array.isArray(snapshots) || !snapshots.length) {
        return { sent: 0, deduplicated: 0, skipped: 0 };
    }

    const symbols = snapshots.map((snapshot) => snapshot.symbol);
    const symbolUsers = await buildSymbolUserMap(symbols);
    const allPhones = [...new Set([...symbolUsers.values()].flatMap((set) => [...set]))];

    if (!allPhones.length) {
        return { sent: 0, deduplicated: 0, skipped: snapshots.length };
    }

    const users = await User.find({ phoneNumber: { $in: allPhones } }, { phoneNumber: 1, notificationSettings: 1 }).lean();
    const usersByPhone = new Map(users.map((user) => [user.phoneNumber, user]));

    let sent = 0;
    let deduplicated = 0;
    let skipped = 0;

    for (const snapshot of snapshots) {
        const symbol = String(snapshot.symbol).toUpperCase();
        const phones = symbolUsers.get(symbol) || new Set();

        if (ENABLE_DEPTH_WS_EVENTS) {
            phones.forEach((phone) => {
                websocketService.emitToUser(phone, 'depth_pressure.updated', {
                    symbol,
                    buyPressureRatio: snapshot.buyPressureRatio,
                    totalBids: snapshot.totalBids,
                    totalAsks: snapshot.totalAsks,
                    signal: snapshot.signal,
                    snapshotAt: snapshot.snapshotAt
                });
            });
        }

        for (const phone of phones) {
            const user = usersByPhone.get(phone);
            const settings = user?.notificationSettings || {};

            if (!settings.depthPressureAlertsEnabled) {
                skipped += 1;
                continue;
            }

            const threshold = Number(settings.depthPressureThreshold || process.env.DEPTH_PRESSURE_THRESHOLD || 3);
            const isBullish = snapshot.buyPressureRatio >= threshold;
            const isBearish = snapshot.buyPressureRatio > 0 && snapshot.buyPressureRatio <= (1 / threshold);

            if (!isBullish && !isBearish) {
                skipped += 1;
                continue;
            }

            const direction = isBullish ? 'bullish' : 'bearish';
            const title = `${symbol} ${isBullish ? 'bullish' : 'bearish'} depth pressure`;
            const message = isBullish
                ? `Buy pressure is ${snapshot.buyPressureRatio.toFixed(2)}x (bids ${snapshot.totalBids.toLocaleString()} vs asks ${snapshot.totalAsks.toLocaleString()}).`
                : `Sell pressure is elevated (buy pressure ratio ${snapshot.buyPressureRatio.toFixed(2)}x, bids ${snapshot.totalBids.toLocaleString()} vs asks ${snapshot.totalAsks.toLocaleString()}).`;

            const result = await notificationService.createNotification({
                userPhoneNumber: phone,
                type: 'order_book_pressure',
                source: 'depth_pressure',
                symbol,
                title,
                message,
                payload: {
                    symbol,
                    direction,
                    buyPressureRatio: snapshot.buyPressureRatio,
                    totalBids: snapshot.totalBids,
                    totalAsks: snapshot.totalAsks,
                    threshold,
                    snapshotAt: snapshot.snapshotAt
                },
                dedupeKey: `pressure:${phone}:${symbol}:${direction}`,
                cooldownMs: DEPTH_COOLDOWN_MS
            });

            if (result.deduplicated) {
                deduplicated += 1;
            } else {
                sent += 1;
            }
        }
    }

    return { sent, deduplicated, skipped };
}

async function notifySignalPulseTransitions(signals) {
    if (!Array.isArray(signals) || !signals.length) {
        return { sent: 0, deduplicated: 0, skipped: 0 };
    }

    const filteredSignals = signals.filter((signal) => hasSignalTrigger(signal));
    if (!filteredSignals.length) {
        return { sent: 0, deduplicated: 0, skipped: signals.length };
    }

    const symbols = filteredSignals.map((signal) => signal.symbol);
    const symbolUsers = await buildSymbolUserMap(symbols);
    const allPhones = [...new Set([...symbolUsers.values()].flatMap((set) => [...set]))];

    if (!allPhones.length) {
        return { sent: 0, deduplicated: 0, skipped: filteredSignals.length };
    }

    const users = await User.find({ phoneNumber: { $in: allPhones } }, { phoneNumber: 1, notificationSettings: 1 }).lean();
    const usersByPhone = new Map(users.map((user) => [user.phoneNumber, user]));

    let sent = 0;
    let deduplicated = 0;
    let skipped = 0;

    for (const signal of filteredSignals) {
        const symbol = String(signal.symbol).toUpperCase();
        const phones = symbolUsers.get(symbol) || new Set();
        const signalKinds = getSignalKinds(signal);
        const stateLabel = signal.latestSignals?.stateLabel || 'neutral';

        for (const phone of phones) {
            const user = usersByPhone.get(phone);
            const settings = user?.notificationSettings || {};

            if (!settings.signalPulseAlertsEnabled) {
                skipped += 1;
                continue;
            }

            for (const signalKind of signalKinds) {
                const kindLabel = signalKind === 'oversoldRecovery'
                    ? 'Oversold recovery'
                    : signalKind === 'goldenCross'
                        ? 'Golden cross'
                        : 'Trend cooling';

                const result = await notificationService.createNotification({
                    userPhoneNumber: phone,
                    type: 'signal_pulse',
                    source: 'signal_pulse',
                    symbol,
                    title: `${symbol} signal pulse: ${kindLabel}`,
                    message: `${kindLabel} detected (RSI14 ${Number(signal.rsi14 || 0).toFixed(2)}, EMA9 ${Number(signal.ema9 || 0).toFixed(2)}, EMA21 ${Number(signal.ema21 || 0).toFixed(2)}).`,
                    payload: {
                        symbol,
                        signalKind,
                        stateLabel,
                        rsi14: signal.rsi14,
                        ema9: signal.ema9,
                        ema21: signal.ema21,
                        updatedAt: signal.updatedAt
                    },
                    dedupeKey: `signal:${phone}:${symbol}:${signalKind}`,
                    cooldownMs: SIGNAL_COOLDOWN_MS
                });

                if (result.deduplicated) {
                    deduplicated += 1;
                } else {
                    sent += 1;
                }
            }
        }
    }

    return { sent, deduplicated, skipped };
}

module.exports = {
    notifyDepthPressureSnapshots,
    notifySignalPulseTransitions,
    __private: {
        buildSymbolUserMap,
        getSignalKinds,
        hasSignalTrigger
    }
};
