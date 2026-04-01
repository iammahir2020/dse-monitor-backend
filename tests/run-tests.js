const assert = require('assert').strict;

const {
    computeEma,
    computeRsi,
    detectSignalTransitions
} = require('../services/indicatorService');
const {
    normalizeDepthRows,
    computePressure
} = require('../services/depthMath');
const {
    testDepthNotifications,
    testSignalInternals,
    testSignalNotifications
} = require('./phase12NotificationService.test');
const {
    testDepthMonitorRuntimeToggle
} = require('./phase12Monitor.test');

async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    } catch (error) {
        console.error(`FAIL ${name}: ${error.message}`);
        process.exitCode = 1;
    }
}

async function main() {
    await run('computeEma returns null for short series', () => {
        assert.equal(computeEma([1, 2, 3], 5), null);
    });

    await run('computeEma returns finite value', () => {
        const ema = computeEma([10, 11, 12, 13, 14, 15, 16, 17, 18], 5);
        assert.equal(typeof ema, 'number');
        assert.equal(Number.isFinite(ema), true);
    });

    await run('computeRsi returns null for insufficient data', () => {
        assert.equal(computeRsi([1, 2, 3, 4], 14), null);
    });

    await run('computeRsi returns bounded value', () => {
        const closes = [44, 45, 46, 44, 43, 42, 43, 44, 45, 46, 47, 46, 47, 48, 49, 50, 51];
        const rsi = computeRsi(closes, 14);
        assert.equal(typeof rsi, 'number');
        assert.equal(rsi >= 0 && rsi <= 100, true);
    });

    await run('detectSignalTransitions detects momentum rising', () => {
        const transitions = detectSignalTransitions(
            { rsi14: 28, ema9: 100, ema21: 101 },
            { rsi14: 32, ema9: 102, ema21: 101 }
        );

        assert.equal(transitions.oversoldRecovery, true);
        assert.equal(transitions.goldenCross, true);
        assert.equal(transitions.trendCooling, false);
        assert.equal(transitions.stateLabel, 'momentum_rising');
    });

    await run('detectSignalTransitions detects trend cooling', () => {
        const transitions = detectSignalTransitions(
            { rsi14: 55, ema9: 101, ema21: 100 },
            { rsi14: 50, ema9: 99, ema21: 100 }
        );

        assert.equal(transitions.trendCooling, true);
        assert.equal(transitions.stateLabel, 'trend_cooling');
    });

    await run('normalizeDepthRows normalizes both sides', () => {
        const normalized = normalizeDepthRows([
            { bid_price: '10.5', bid_qty: '1000', ask_price: '10.7', ask_qty: '500' },
            { bid_price: '10.4', bid_qty: '200', ask_price: '10.8', ask_qty: '900' }
        ]);

        assert.equal(normalized.bids.length, 2);
        assert.equal(normalized.asks.length, 2);
        assert.equal(normalized.bids[0].quantity, 1000);
        assert.equal(normalized.asks[1].quantity, 900);
    });

    await run('computePressure detects bullish', () => {
        const pressure = computePressure({ bids: [{ quantity: 3000 }], asks: [{ quantity: 500 }] });
        assert.equal(pressure.signal, 'bullishPressure');
    });

    await run('computePressure detects bearish', () => {
        const pressure = computePressure({ bids: [{ quantity: 200 }], asks: [{ quantity: 2000 }] });
        assert.equal(pressure.signal, 'bearishPressure');
    });

    await run('phase12 signal internals', testSignalInternals);
    await run('phase12 depth notification flow', testDepthNotifications);
    await run('phase12 signal notification flow', testSignalNotifications);
    await run('phase12 depth monitor runtime toggle', testDepthMonitorRuntimeToggle);

    if (process.exitCode && process.exitCode !== 0) {
        process.exit(process.exitCode);
    }
}

main();
