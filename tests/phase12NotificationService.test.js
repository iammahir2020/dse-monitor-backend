const assert = require('assert').strict;

const Watchlist = require('../models/Watchlist');
const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const notificationService = require('../services/notificationService');
const websocketService = require('../services/websocketService');
const {
    notifyDepthPressureSnapshots,
    notifySignalPulseTransitions,
    __private
} = require('../services/phase12NotificationService');

async function testSignalInternals() {
    const kinds = __private.getSignalKinds({ latestSignals: { oversoldRecovery: true, goldenCross: false, trendCooling: true } });
    assert.deepEqual(kinds, ['oversoldRecovery', 'trendCooling']);
    assert.equal(__private.hasSignalTrigger({ latestSignals: { oversoldRecovery: false, goldenCross: false, trendCooling: false } }), false);
    assert.equal(__private.hasSignalTrigger({ latestSignals: { oversoldRecovery: true, goldenCross: false, trendCooling: false } }), true);
}

async function testDepthNotifications() {
    const originalWatchlistFind = Watchlist.find;
    const originalPortfolioFind = Portfolio.find;
    const originalUserFind = User.find;
    const originalCreateNotification = notificationService.createNotification;
    const originalEmitToUser = websocketService.emitToUser;

    const capturedNotifications = [];
    const wsEvents = [];

    Watchlist.find = () => ({
        lean: async () => [{ symbol: 'AAA', userPhoneNumber: '+8801000000001' }]
    });
    Portfolio.find = () => ({ lean: async () => [] });
    User.find = () => ({
        lean: async () => [{
            phoneNumber: '+8801000000001',
            notificationSettings: {
                depthPressureAlertsEnabled: true,
                depthPressureThreshold: 3,
                signalPulseAlertsEnabled: true
            }
        }]
    });

    notificationService.createNotification = async (options) => {
        capturedNotifications.push(options);
        return { deduplicated: false, notification: options };
    };

    websocketService.emitToUser = (phone, event, data) => {
        wsEvents.push({ phone, event, data });
        return 1;
    };

    const result = await notifyDepthPressureSnapshots([
        {
            symbol: 'AAA',
            buyPressureRatio: 4,
            totalBids: 10000,
            totalAsks: 2000,
            signal: 'bullishPressure',
            snapshotAt: new Date().toISOString()
        }
    ]);

    assert.equal(result.sent, 1);
    assert.equal(capturedNotifications.length, 1);
    assert.equal(capturedNotifications[0].type, 'order_book_pressure');
    assert.equal(capturedNotifications[0].source, 'depth_pressure');
    assert.equal(capturedNotifications[0].dedupeKey.includes('pressure:+8801000000001:AAA:bullish'), true);

    Watchlist.find = originalWatchlistFind;
    Portfolio.find = originalPortfolioFind;
    User.find = originalUserFind;
    notificationService.createNotification = originalCreateNotification;
    websocketService.emitToUser = originalEmitToUser;

    return wsEvents;
}

async function testSignalNotifications() {
    const originalWatchlistFind = Watchlist.find;
    const originalPortfolioFind = Portfolio.find;
    const originalUserFind = User.find;
    const originalCreateNotification = notificationService.createNotification;

    const capturedNotifications = [];

    Watchlist.find = () => ({
        lean: async () => [{ symbol: 'BBB', userPhoneNumber: '+8801000000002' }]
    });
    Portfolio.find = () => ({ lean: async () => [] });
    User.find = () => ({
        lean: async () => [{
            phoneNumber: '+8801000000002',
            notificationSettings: {
                signalPulseAlertsEnabled: true,
                depthPressureAlertsEnabled: true,
                depthPressureThreshold: 3
            }
        }]
    });

    notificationService.createNotification = async (options) => {
        capturedNotifications.push(options);
        return { deduplicated: false, notification: options };
    };

    const result = await notifySignalPulseTransitions([
        {
            symbol: 'BBB',
            rsi14: 31,
            ema9: 101,
            ema21: 100,
            latestSignals: {
                oversoldRecovery: true,
                goldenCross: true,
                trendCooling: false,
                stateLabel: 'momentum_rising'
            },
            updatedAt: new Date().toISOString()
        }
    ]);

    assert.equal(result.sent, 2);
    assert.equal(capturedNotifications.length, 2);
    assert.equal(capturedNotifications[0].type, 'signal_pulse');
    assert.equal(capturedNotifications[0].source, 'signal_pulse');
    assert.equal(capturedNotifications[0].dedupeKey.includes('signal:+8801000000002:BBB:'), true);

    Watchlist.find = originalWatchlistFind;
    Portfolio.find = originalPortfolioFind;
    User.find = originalUserFind;
    notificationService.createNotification = originalCreateNotification;
}

module.exports = {
    testDepthNotifications,
    testSignalInternals,
    testSignalNotifications
};
