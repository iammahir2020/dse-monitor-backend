const VOLUME_KEYS = [
    'volume',
    'total_volume',
    'totalVolume',
    'vol',
    'qty',
    'quantity',
    'trade_volume',
    'traded_volume'
];

const TRADE_VALUE_KEYS = [
    'value',
    'trade_value',
    'tradeValue',
    'turnover',
    'total_value'
];

function toNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function getFirstNumericValue(source, keys) {
    if (!source || typeof source !== 'object') {
        return null;
    }

    for (const key of keys) {
        const numericValue = toNumber(source[key]);
        if (numericValue != null) {
            return numericValue;
        }
    }

    return null;
}

function getStockVolume(stock) {
    return getFirstNumericValue(stock, VOLUME_KEYS);
}

function getStockTradeValue(stock) {
    return getFirstNumericValue(stock, TRADE_VALUE_KEYS);
}

function computeChangePercent(stock) {
    const open = toNumber(stock?.open);
    const ltp = toNumber(stock?.ltp);

    if (!open || !ltp) {
        return null;
    }

    return ((ltp - open) / open) * 100;
}

function isAlertTriggered(alertType, currentValue, threshold) {
    switch (alertType) {
        case 'price_above':
            return currentValue > threshold;
        case 'price_below':
            return currentValue < threshold;
        case 'change_percent':
            return Math.abs(currentValue) > threshold;
        case 'volume_above':
            return currentValue > threshold;
        case 'relative_volume_above':
            return currentValue > threshold;
        default:
            return false;
    }
}

function getCurrentValueForAlert(stock, alert, averageVolume = null) {
    switch (alert.alertType) {
        case 'price_above':
        case 'price_below':
            return toNumber(stock?.ltp);
        case 'change_percent':
            return computeChangePercent(stock);
        case 'volume_above':
            return getStockVolume(stock);
        case 'relative_volume_above': {
            const currentVolume = getStockVolume(stock);
            if (!currentVolume || !averageVolume) {
                return null;
            }

            return currentVolume / averageVolume;
        }
        default:
            return null;
    }
}

function average(values) {
    const validValues = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (!validValues.length) {
        return null;
    }

    return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function simpleMovingAverage(values, period) {
    if (!Array.isArray(values) || values.length < period) {
        return null;
    }

    return average(values.slice(values.length - period));
}

module.exports = {
    toNumber,
    getStockVolume,
    getStockTradeValue,
    computeChangePercent,
    isAlertTriggered,
    getCurrentValueForAlert,
    average,
    simpleMovingAverage
};