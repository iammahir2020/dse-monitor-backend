const Alert = require('../models/Alert');
const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const Watchlist = require('../models/Watchlist');
const { createNotification } = require('./notificationService');
const { getLiveData } = require('./liveDataCache');
const { recordDailySummaries, getSummaryDate, getSummaryHistoryForSymbols } = require('./dailySummaryService');
const { average, getCurrentValueForAlert, getStockVolume, isAlertTriggered } = require('./marketAnalytics');

let monitorInterval = null;
let isMonitoring = false;

function buildStockMap(liveData) {
    const stockMap = {};
    liveData.forEach((stock) => {
        if (stock?.symbol) {
            stockMap[stock.symbol.toUpperCase()] = stock;
        }
    });
    return stockMap;
}

function formatTriggeredValue(alertType, currentValue) {
    if (currentValue == null) {
        return 'N/A';
    }

    if (alertType === 'change_percent' || alertType === 'relative_volume_above') {
        return `${currentValue.toFixed(2)}${alertType === 'relative_volume_above' ? 'x' : '%'}`;
    }

    if (alertType === 'volume_above') {
        return currentValue.toLocaleString();
    }

    return `Tk ${currentValue.toFixed(2)}`;
}

function buildAlertMessage(alert, currentValue) {
    switch (alert.alertType) {
        case 'price_above':
            return `Price moved above your threshold of Tk ${alert.threshold.toFixed(2)}. Current value is ${formatTriggeredValue(alert.alertType, currentValue)}.`;
        case 'price_below':
            return `Price moved below your threshold of Tk ${alert.threshold.toFixed(2)}. Current value is ${formatTriggeredValue(alert.alertType, currentValue)}.`;
        case 'change_percent':
            return `Price change exceeded ${alert.threshold.toFixed(2)}%. Current move is ${formatTriggeredValue(alert.alertType, currentValue)}.`;
        case 'volume_above':
            return `Volume moved above ${alert.threshold.toLocaleString()} shares. Current volume is ${formatTriggeredValue(alert.alertType, currentValue)}.`;
        case 'relative_volume_above':
            return `Volume is running at ${formatTriggeredValue(alert.alertType, currentValue)} of recent average, above your ${alert.threshold.toFixed(2)}x trigger.`;
        default:
            return 'Your alert condition was triggered.';
    }
}

async function checkManualAlerts(liveData) {
    const stockMap = buildStockMap(liveData);
    const activeAlerts = await Alert.find({ isActive: true });
    const symbolsNeedingHistory = [...new Set(
        activeAlerts
            .filter((alert) => alert.alertType === 'relative_volume_above')
            .map((alert) => alert.symbol.toUpperCase())
    )];
    const summaryHistory = await getSummaryHistoryForSymbols(symbolsNeedingHistory, 15);
    const todaySummaryDate = getSummaryDate().getTime();

    console.log(`🔍 Checking ${activeAlerts.length} active alerts against ${liveData.length} stocks`);

    for (const alert of activeAlerts) {
        const symbol = alert.symbol.toUpperCase();
        const stock = stockMap[symbol];

        if (!stock || !alert.userPhoneNumber) {
            continue;
        }

        const historicalSummaries = (summaryHistory[symbol] || [])
            .filter((summary) => new Date(summary.summaryDate).getTime() < todaySummaryDate)
            .slice(0, alert.lookbackDays || 5);
        const averageVolume = average(historicalSummaries.map((summary) => summary.volume));
        const currentValue = getCurrentValueForAlert(stock, alert, averageVolume);

        if (currentValue == null || !isAlertTriggered(alert.alertType, currentValue, alert.threshold)) {
            continue;
        }

        const lastTriggeredMs = alert.lastTriggered instanceof Date ? alert.lastTriggered.getTime() : NaN;
        const cooldownMs = (alert.cooldownSeconds || 300) * 1000;
        const timeSinceLastTrigger = Number.isFinite(lastTriggeredMs) ? (Date.now() - lastTriggeredMs) : Infinity;

        if (timeSinceLastTrigger <= cooldownMs) {
            continue;
        }

        await Alert.findByIdAndUpdate(alert._id, { lastTriggered: new Date() });

        await createNotification({
            userPhoneNumber: alert.userPhoneNumber,
            type: 'alert_triggered',
            source: 'manual_alert',
            symbol,
            title: `${symbol} alert triggered`,
            message: buildAlertMessage(alert, currentValue),
            payload: {
                alertId: String(alert._id),
                alertType: alert.alertType,
                threshold: alert.threshold,
                currentValue,
                averageVolume,
                stockSnapshot: stock
            },
            dedupeKey: `alert:${alert._id}`,
            cooldownMs
        });
    }
}

async function checkSmartVolumeAlerts(liveData) {
    const users = await User.find({
        $or: [
            { 'notificationSettings.portfolioVolumeAlertsEnabled': true },
            { 'notificationSettings.watchlistVolumeAlertsEnabled': true }
        ]
    }).lean();

    if (!users.length) {
        return;
    }

    const stockMap = buildStockMap(liveData);
    const phoneNumbers = users.map((user) => user.phoneNumber);
    const [portfolioEntries, watchlistEntries] = await Promise.all([
        Portfolio.find({ userPhoneNumber: { $in: phoneNumbers } }).lean(),
        Watchlist.find({ userPhoneNumber: { $in: phoneNumbers } }).lean()
    ]);

    const symbols = new Set();
    const symbolsByUser = new Map();

    users.forEach((user) => {
        symbolsByUser.set(user.phoneNumber, {
            portfolio: new Set(),
            watchlist: new Set()
        });
    });

    portfolioEntries.forEach((entry) => {
        const symbol = entry.symbol.toUpperCase();
        symbols.add(symbol);
        const userSymbols = symbolsByUser.get(entry.userPhoneNumber);
        if (userSymbols) {
            userSymbols.portfolio.add(symbol);
        }
    });

    watchlistEntries.forEach((entry) => {
        const symbol = entry.symbol.toUpperCase();
        symbols.add(symbol);
        const userSymbols = symbolsByUser.get(entry.userPhoneNumber);
        if (userSymbols) {
            userSymbols.watchlist.add(symbol);
        }
    });

    const summaryHistory = await getSummaryHistoryForSymbols([...symbols], 15);
    const todaySummaryDate = getSummaryDate().getTime();

    for (const user of users) {
        const userSymbols = symbolsByUser.get(user.phoneNumber);
        if (!userSymbols) {
            continue;
        }

        const scopedSymbols = new Set();
        if (user.notificationSettings?.portfolioVolumeAlertsEnabled) {
            userSymbols.portfolio.forEach((symbol) => scopedSymbols.add(symbol));
        }
        if (user.notificationSettings?.watchlistVolumeAlertsEnabled) {
            userSymbols.watchlist.forEach((symbol) => scopedSymbols.add(symbol));
        }

        for (const symbol of scopedSymbols) {
            const stock = stockMap[symbol];
            if (!stock) {
                continue;
            }

            const currentVolume = getStockVolume(stock);
            if (!currentVolume) {
                continue;
            }

            const historicalSummaries = (summaryHistory[symbol] || [])
                .filter((summary) => new Date(summary.summaryDate).getTime() < todaySummaryDate)
                .slice(0, user.notificationSettings?.relativeVolumeLookbackDays || 5);
            const averageVolume = average(historicalSummaries.map((summary) => summary.volume));

            const fixedThreshold = user.notificationSettings?.fixedVolumeThreshold;
            if (fixedThreshold && currentVolume >= fixedThreshold) {
                await createNotification({
                    userPhoneNumber: user.phoneNumber,
                    type: 'high_volume_trade',
                    source: 'smart_volume',
                    symbol,
                    title: `${symbol} volume spike`,
                    message: `Volume is at ${currentVolume.toLocaleString()} shares, above your fixed threshold of ${fixedThreshold.toLocaleString()} shares.`,
                    payload: {
                        currentVolume,
                        fixedThreshold,
                        scope: userSymbols.portfolio.has(symbol) ? 'portfolio' : 'watchlist',
                        stockSnapshot: stock
                    },
                    dedupeKey: `volume-fixed:${user.phoneNumber}:${symbol}`,
                    cooldownMs: 30 * 60 * 1000
                });
            }

            const relativeMultiplier = user.notificationSettings?.relativeVolumeMultiplier;
            if (averageVolume && relativeMultiplier && currentVolume >= averageVolume * relativeMultiplier) {
                await createNotification({
                    userPhoneNumber: user.phoneNumber,
                    type: 'relative_volume_trade',
                    source: 'smart_volume',
                    symbol,
                    title: `${symbol} unusual volume`,
                    message: `Volume is ${Number((currentVolume / averageVolume).toFixed(2))}x the recent ${historicalSummaries.length}-day average.`,
                    payload: {
                        currentVolume,
                        averageVolume,
                        relativeMultiplier,
                        scope: userSymbols.portfolio.has(symbol) ? 'portfolio' : 'watchlist',
                        stockSnapshot: stock
                    },
                    dedupeKey: `volume-relative:${user.phoneNumber}:${symbol}`,
                    cooldownMs: 30 * 60 * 1000
                });
            }
        }
    }
}

async function monitorAlerts() {
    if (isMonitoring) {
        console.log('⏳ Previous check still in progress, skipping...');
        return;
    }

    isMonitoring = true;
    const startTime = Date.now();

    try {
        console.log(`\n🚀 [${new Date().toLocaleTimeString()}] Starting alert check cycle...`);

        const liveData = await getLiveData(true);
        console.log(`📊 Fetched ${liveData.length} stock records`);

        await recordDailySummaries(liveData);
        await checkManualAlerts(liveData);
        await checkSmartVolumeAlerts(liveData);

        const duration = Date.now() - startTime;
        console.log(`✨ Alert check completed in ${duration}ms\n`);

    } catch (error) {
        console.error('❌ Alert monitor error:', error.message);
    } finally {
        isMonitoring = false;
    }
}

// Start the monitoring system
function startAlertMonitor() {
    if (monitorInterval) {
        console.log('⚠️  Alert monitor already running');
        return;
    }

    console.log('🟢 Starting Alert Monitor (checks every 2 minutes)');
    
    // Run first check immediately
    monitorAlerts();
    
    // Then run every 2 minutes (120000 ms)
    monitorInterval = setInterval(monitorAlerts, 2 * 60 * 1000);
}

// Stop the monitoring system
function stopAlertMonitor() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log('🔴 Alert Monitor stopped');
    }
}

module.exports = {
    startAlertMonitor,
    stopAlertMonitor,
    monitorAlerts
};
