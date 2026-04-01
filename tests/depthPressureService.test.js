const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeDepthRows,
    computePressure
} = require('../services/depthPressureService');

test('normalizeDepthRows maps bid/ask rows into normalized arrays', () => {
    const rows = [
        {
            bid_price: '10.5',
            bid_qty: '1000',
            ask_price: '10.7',
            ask_qty: '500'
        },
        {
            bid_price: '10.4',
            bid_qty: '200',
            ask_price: '10.8',
            ask_qty: '900'
        }
    ];

    const normalized = normalizeDepthRows(rows);
    assert.equal(Array.isArray(normalized.bids), true);
    assert.equal(Array.isArray(normalized.asks), true);
    assert.equal(normalized.bids.length, 2);
    assert.equal(normalized.asks.length, 2);
    assert.equal(normalized.bids[0].quantity, 1000);
    assert.equal(normalized.asks[1].quantity, 900);
});

test('computePressure calculates bullish signal when ratio exceeds threshold', () => {
    const pressure = computePressure({
        bids: [{ quantity: 3000 }],
        asks: [{ quantity: 500 }]
    });

    assert.equal(pressure.totalBids, 3000);
    assert.equal(pressure.totalAsks, 500);
    assert.equal(pressure.buyPressureRatio > 1, true);
    assert.equal(pressure.signal, 'bullishPressure');
});

test('computePressure calculates bearish signal when ratio is very low', () => {
    const pressure = computePressure({
        bids: [{ quantity: 200 }],
        asks: [{ quantity: 2000 }]
    });

    assert.equal(pressure.totalBids, 200);
    assert.equal(pressure.totalAsks, 2000);
    assert.equal(pressure.buyPressureRatio < 1, true);
    assert.equal(pressure.signal, 'bearishPressure');
});
