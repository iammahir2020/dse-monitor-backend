const test = require('node:test');
const assert = require('node:assert/strict');

const {
    computeEma,
    computeRsi,
    detectSignalTransitions
} = require('../services/indicatorService');

test('computeEma returns null when series is too short', () => {
    const ema = computeEma([1, 2, 3], 5);
    assert.equal(ema, null);
});

test('computeEma returns finite value for valid inputs', () => {
    const ema = computeEma([10, 11, 12, 13, 14, 15, 16, 17, 18], 5);
    assert.equal(typeof ema, 'number');
    assert.equal(Number.isFinite(ema), true);
});

test('computeRsi returns null when not enough data', () => {
    const rsi = computeRsi([1, 2, 3, 4], 14);
    assert.equal(rsi, null);
});

test('computeRsi returns bounded value for valid inputs', () => {
    const closes = [44, 45, 46, 44, 43, 42, 43, 44, 45, 46, 47, 46, 47, 48, 49, 50, 51];
    const rsi = computeRsi(closes, 14);
    assert.equal(typeof rsi, 'number');
    assert.equal(rsi >= 0 && rsi <= 100, true);
});

test('detectSignalTransitions identifies oversold recovery and golden cross', () => {
    const previousState = {
        rsi14: 28,
        ema9: 100,
        ema21: 101
    };

    const currentState = {
        rsi14: 32,
        ema9: 102,
        ema21: 101
    };

    const transitions = detectSignalTransitions(previousState, currentState);
    assert.equal(transitions.oversoldRecovery, true);
    assert.equal(transitions.goldenCross, true);
    assert.equal(transitions.trendCooling, false);
    assert.equal(transitions.stateLabel, 'momentum_rising');
});

test('detectSignalTransitions identifies trend cooling', () => {
    const previousState = {
        rsi14: 55,
        ema9: 101,
        ema21: 100
    };

    const currentState = {
        rsi14: 50,
        ema9: 99,
        ema21: 100
    };

    const transitions = detectSignalTransitions(previousState, currentState);
    assert.equal(transitions.trendCooling, true);
    assert.equal(transitions.stateLabel, 'trend_cooling');
});
