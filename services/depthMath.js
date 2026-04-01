function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSideRow(row, side) {
    const sidePrefix = side === 'bid' ? 'bid' : 'ask';

    const price = toNumber(
        row[`${sidePrefix}_price`]
        ?? row[`${sidePrefix}Price`]
        ?? row[`${sidePrefix}price`]
        ?? row[`${sidePrefix}Rate`]
        ?? row[`${sidePrefix}_rate`]
    );

    const quantity = toNumber(
        row[`${sidePrefix}_qty`]
        ?? row[`${sidePrefix}_quantity`]
        ?? row[`${sidePrefix}Qty`]
        ?? row[`${sidePrefix}Quantity`]
    );

    const orders = toNumber(
        row[`${sidePrefix}_orders`]
        ?? row[`${sidePrefix}Orders`]
        ?? row[`${sidePrefix}_order`]
    );

    if (price == null && quantity == null && orders == null) {
        return null;
    }

    return {
        price,
        quantity: quantity ?? 0,
        ...(orders != null ? { orders } : {})
    };
}

function normalizeDepthRows(rawRows) {
    const bids = [];
    const asks = [];

    rawRows.forEach((row) => {
        const bid = normalizeSideRow(row, 'bid');
        const ask = normalizeSideRow(row, 'ask');

        if (bid) {
            bids.push(bid);
        }

        if (ask) {
            asks.push(ask);
        }
    });

    return {
        bids,
        asks
    };
}

function computePressure({ bids, asks }) {
    const totalBids = bids.reduce((sum, row) => sum + (toNumber(row.quantity) || 0), 0);
    const totalAsks = asks.reduce((sum, row) => sum + (toNumber(row.quantity) || 0), 0);
    const buyPressureRatio = totalAsks > 0 ? totalBids / totalAsks : totalBids > 0 ? Number.POSITIVE_INFINITY : 0;

    const threshold = Number(process.env.DEPTH_PRESSURE_THRESHOLD || 3);
    let signal = 'neutral';
    if (buyPressureRatio >= threshold) {
        signal = 'bullishPressure';
    } else if (buyPressureRatio > 0 && buyPressureRatio <= (1 / threshold)) {
        signal = 'bearishPressure';
    }

    return {
        totalBids,
        totalAsks,
        buyPressureRatio,
        signal
    };
}

module.exports = {
    toNumber,
    normalizeDepthRows,
    computePressure
};
