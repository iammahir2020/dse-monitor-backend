function toFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSeries(values) {
    return values
        .map((value) => toFiniteNumber(value))
        .filter((value) => value != null);
}

function computeEma(values, period) {
    const series = sanitizeSeries(values);
    if (series.length < period || period <= 0) {
        return null;
    }

    const multiplier = 2 / (period + 1);
    let ema = series.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

    for (let i = period; i < series.length; i += 1) {
        ema = ((series[i] - ema) * multiplier) + ema;
    }

    return ema;
}

function computeRsi(values, period = 14) {
    const series = sanitizeSeries(values);
    if (series.length <= period) {
        return null;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i += 1) {
        const delta = series[i] - series[i - 1];
        if (delta > 0) {
            gains += delta;
        } else {
            losses -= delta;
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < series.length; i += 1) {
        const delta = series[i] - series[i - 1];
        const gain = delta > 0 ? delta : 0;
        const loss = delta < 0 ? -delta : 0;

        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }

    if (avgLoss === 0) {
        return 100;
    }

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function detectSignalTransitions(previousState, currentState) {
    const prevRsi = toFiniteNumber(previousState?.rsi14);
    const currRsi = toFiniteNumber(currentState?.rsi14);
    const prevEma9 = toFiniteNumber(previousState?.ema9);
    const prevEma21 = toFiniteNumber(previousState?.ema21);
    const currEma9 = toFiniteNumber(currentState?.ema9);
    const currEma21 = toFiniteNumber(currentState?.ema21);

    const oversoldRecovery = prevRsi != null && currRsi != null && prevRsi < 30 && currRsi > 30;
    const goldenCross = prevEma9 != null && prevEma21 != null && currEma9 != null && currEma21 != null
        && prevEma9 <= prevEma21 && currEma9 > currEma21;
    const trendCooling = prevEma9 != null && prevEma21 != null && currEma9 != null && currEma21 != null
        && prevEma9 >= prevEma21 && currEma9 < currEma21;

    let stateLabel = 'neutral';
    if (goldenCross || oversoldRecovery) {
        stateLabel = 'momentum_rising';
    } else if (trendCooling) {
        stateLabel = 'trend_cooling';
    }

    return {
        oversoldRecovery,
        goldenCross,
        trendCooling,
        stateLabel
    };
}

module.exports = {
    computeEma,
    computeRsi,
    detectSignalTransitions
};
