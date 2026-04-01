const { runDepthPressureCycle } = require('./depthPressureService');
const { runHistoricalIngestionCycle } = require('./historicalIngestionService');
const { notifyDepthPressureSnapshots, notifySignalPulseTransitions } = require('./phase12NotificationService');
const { runSignalRefreshCycle } = require('./signalPulseService');

const MARKET_TIMEZONE = String(process.env.BD_MARKET_TIMEZONE || 'Asia/Dhaka').trim();
const MARKET_OPEN = String(process.env.BD_MARKET_OPEN || '10:00').trim();
const MARKET_CLOSE = String(process.env.BD_MARKET_CLOSE || '14:30').trim();

const ENABLE_HIST_SYNC = String(process.env.PHASE12_ENABLE_HIST_SYNC || '').toLowerCase() === 'true';
const ENABLE_SIGNAL_MONITOR = String(process.env.PHASE12_ENABLE_SIGNAL_MONITOR || '').toLowerCase() === 'true';
const ENABLE_DEPTH_MONITOR = String(process.env.PHASE12_ENABLE_DEPTH_MONITOR || '').toLowerCase() === 'true';
const PHASE12_LOG_ERROR_LIMIT = Number(process.env.PHASE12_LOG_ERROR_LIMIT || 5);
const PHASE12_LOG_SAMPLE_RATE = Number(process.env.PHASE12_LOG_SAMPLE_RATE || 1);
const PHASE12_LOG_INCLUDE_PAYLOADS = String(process.env.PHASE12_LOG_INCLUDE_PAYLOADS || '').toLowerCase() === 'true';

const intervals = {
    historical: null,
    signal: null,
    depth: null
};

const runtimeFlags = {
    depth: ENABLE_DEPTH_MONITOR
};

const state = {
    startedAt: null,
    lastHistoricalCycleAt: null,
    lastSignalCycleAt: null,
    lastDepthCycleAt: null,
    lastHistoricalStats: null,
    lastSignalStats: null,
    lastDepthStats: null,
    errors: []
};

function parseClock(clockValue) {
    const [hourText, minuteText] = String(clockValue).split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
        return null;
    }

    return { hour, minute };
}

function getTimeParts(date = new Date(), timeZone = MARKET_TIMEZONE) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((part) => part.type === 'hour');
    const minutePart = parts.find((part) => part.type === 'minute');

    return {
        hour: Number(hourPart?.value || 0),
        minute: Number(minutePart?.value || 0)
    };
}

function isWithinMarketWindow(date = new Date()) {
    const open = parseClock(MARKET_OPEN);
    const close = parseClock(MARKET_CLOSE);
    if (!open || !close) {
        return false;
    }

    const now = getTimeParts(date);
    const nowMinutes = (now.hour * 60) + now.minute;
    const openMinutes = (open.hour * 60) + open.minute;
    const closeMinutes = (close.hour * 60) + close.minute;

    return nowMinutes >= openMinutes && nowMinutes <= closeMinutes;
}

function getDepthMonitorStatus() {
    return {
        configuredEnabled: ENABLE_DEPTH_MONITOR,
        runtimeEnabled: runtimeFlags.depth,
        effectiveEnabled: ENABLE_DEPTH_MONITOR && runtimeFlags.depth,
        intervalActive: Boolean(intervals.depth)
    };
}

function startDepthMonitorInterval() {
    if (!ENABLE_DEPTH_MONITOR || !runtimeFlags.depth || intervals.depth) {
        return;
    }

    runDepthCycle();
    intervals.depth = setInterval(runDepthCycle, 2 * 60 * 1000);
}

function stopDepthMonitorInterval() {
    if (!intervals.depth) {
        return;
    }

    clearInterval(intervals.depth);
    intervals.depth = null;
}

function syncDepthMonitorInterval() {
    if (!state.startedAt) {
        return getDepthMonitorStatus();
    }

    if (ENABLE_DEPTH_MONITOR && runtimeFlags.depth) {
        startDepthMonitorInterval();
        return getDepthMonitorStatus();
    }

    stopDepthMonitorInterval();
    return getDepthMonitorStatus();
}

function pushError(cycleType, error) {
    state.errors.push({
        cycleType,
        message: error.message,
        at: new Date().toISOString()
    });

    if (state.errors.length > 30) {
        state.errors = state.errors.slice(-30);
    }
}

function trimErrorList(errors = []) {
    if (!Array.isArray(errors) || !errors.length) {
        return [];
    }

    const limit = Number.isFinite(PHASE12_LOG_ERROR_LIMIT) && PHASE12_LOG_ERROR_LIMIT > 0
        ? PHASE12_LOG_ERROR_LIMIT
        : 5;

    return errors.slice(0, limit);
}

function shouldLogCycle() {
    if (!Number.isFinite(PHASE12_LOG_SAMPLE_RATE) || PHASE12_LOG_SAMPLE_RATE <= 0) {
        return true;
    }

    if (PHASE12_LOG_SAMPLE_RATE >= 1) {
        return true;
    }

    return Math.random() < PHASE12_LOG_SAMPLE_RATE;
}

function sanitizeStatsForLog(stats = {}) {
    const sanitized = {
        symbolCount: stats.symbolCount || 0,
        successCount: stats.successCount || 0,
        failureCount: stats.failureCount || 0,
        skippedCount: stats.skippedCount || 0,
        notificationStats: stats.notificationStats || null,
        topErrors: trimErrorList(stats.errors)
    };

    if (PHASE12_LOG_INCLUDE_PAYLOADS) {
        sanitized.snapshotCount = Array.isArray(stats.snapshots) ? stats.snapshots.length : 0;
        sanitized.updatedSignalCount = Array.isArray(stats.updatedSignals) ? stats.updatedSignals.length : 0;
    }

    return sanitized;
}

function logCycleCompleted(cycleType, startedAtMs, stats = {}) {
    if (!shouldLogCycle()) {
        return;
    }

    const durationMs = Date.now() - startedAtMs;
    const sanitized = sanitizeStatsForLog(stats);
    console.log(JSON.stringify({
        event: 'phase12.cycle.completed',
        cycleType,
        startedAt: new Date(startedAtMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        ...sanitized
    }));
}

function logCycleFailed(cycleType, startedAtMs, error) {
    console.error(JSON.stringify({
        event: 'phase12.cycle.failed',
        cycleType,
        startedAt: new Date(startedAtMs).toISOString(),
        failedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        error: error.message
    }));
}

async function runPhase12CyclesOnce({ cycle = 'all' } = {}) {
    const normalizedCycle = String(cycle || 'all').trim().toLowerCase();
    const result = {
        requestedCycle: normalizedCycle,
        executedAt: new Date().toISOString(),
        historical: null,
        signal: null,
        depth: null
    };

    if (['all', 'historical'].includes(normalizedCycle)) {
        await runHistoricalCycle();
        result.historical = state.lastHistoricalStats;
    }

    if (['all', 'signal'].includes(normalizedCycle)) {
        await runSignalCycle();
        result.signal = state.lastSignalStats;
    }

    if (['all', 'depth'].includes(normalizedCycle)) {
        await runDepthCycle();
        result.depth = state.lastDepthStats;
    }

    return result;
}

async function runHistoricalCycle() {
    const startedAt = Date.now();
    try {
        const stats = await runHistoricalIngestionCycle();
        state.lastHistoricalCycleAt = new Date().toISOString();
        state.lastHistoricalStats = {
            ...stats,
            durationMs: Date.now() - startedAt
        };
        logCycleCompleted('historical', startedAt, state.lastHistoricalStats);
    } catch (error) {
        pushError('historical', error);
        logCycleFailed('historical', startedAt, error);
    }
}

async function runSignalCycle() {
    const startedAt = Date.now();
    try {
        const stats = await runSignalRefreshCycle();
        const notificationStats = await notifySignalPulseTransitions(stats.updatedSignals || []);
        state.lastSignalCycleAt = new Date().toISOString();
        state.lastSignalStats = {
            ...stats,
            notificationStats,
            durationMs: Date.now() - startedAt
        };
        logCycleCompleted('signal', startedAt, state.lastSignalStats);
    } catch (error) {
        pushError('signal', error);
        logCycleFailed('signal', startedAt, error);
    }
}

async function runDepthCycle() {
    if (!isWithinMarketWindow()) {
        return;
    }

    const startedAt = Date.now();
    try {
        const stats = await runDepthPressureCycle();
        const notificationStats = await notifyDepthPressureSnapshots(stats.snapshots || []);
        state.lastDepthCycleAt = new Date().toISOString();
        state.lastDepthStats = {
            ...stats,
            notificationStats,
            durationMs: Date.now() - startedAt
        };
        logCycleCompleted('depth', startedAt, state.lastDepthStats);
    } catch (error) {
        pushError('depth', error);
        logCycleFailed('depth', startedAt, error);
    }
}

function startPhase12Monitor(options = {}) {
    if (state.startedAt) {
        return;
    }

    if (typeof options.depthMonitorEnabled === 'boolean') {
        runtimeFlags.depth = options.depthMonitorEnabled;
    }

    state.startedAt = new Date().toISOString();

    if (ENABLE_HIST_SYNC) {
        runHistoricalCycle();
        intervals.historical = setInterval(runHistoricalCycle, 6 * 60 * 60 * 1000);
    }

    if (ENABLE_SIGNAL_MONITOR) {
        runSignalCycle();
        intervals.signal = setInterval(() => {
            if (isWithinMarketWindow()) {
                runSignalCycle();
                return;
            }

            const now = Date.now();
            const lastRun = state.lastSignalCycleAt ? new Date(state.lastSignalCycleAt).getTime() : 0;
            if ((now - lastRun) >= 6 * 60 * 60 * 1000) {
                runSignalCycle();
            }
        }, 30 * 60 * 1000);
    }

    syncDepthMonitorInterval();

    console.log(JSON.stringify({
        event: 'phase12.monitor.started',
        startedAt: state.startedAt,
        flags: {
            hist: ENABLE_HIST_SYNC,
            signal: ENABLE_SIGNAL_MONITOR,
            depth: ENABLE_DEPTH_MONITOR && runtimeFlags.depth,
            depthConfigured: ENABLE_DEPTH_MONITOR,
            depthRuntime: runtimeFlags.depth
        },
        marketWindow: {
            timezone: MARKET_TIMEZONE,
            open: MARKET_OPEN,
            close: MARKET_CLOSE
        }
    }));
}

function stopPhase12Monitor() {
    Object.keys(intervals).forEach((key) => {
        if (intervals[key]) {
            clearInterval(intervals[key]);
            intervals[key] = null;
        }
    });

    state.startedAt = null;
}

function setDepthMonitorEnabled(enabled) {
    runtimeFlags.depth = Boolean(enabled);
    return syncDepthMonitorInterval();
}

function getPhase12Status() {
    return {
        startedAt: state.startedAt,
        marketWindow: {
            timezone: MARKET_TIMEZONE,
            open: MARKET_OPEN,
            close: MARKET_CLOSE,
            isWithinWindowNow: isWithinMarketWindow()
        },
        depthMonitor: getDepthMonitorStatus(),
        lastHistoricalCycleAt: state.lastHistoricalCycleAt,
        lastSignalCycleAt: state.lastSignalCycleAt,
        lastDepthCycleAt: state.lastDepthCycleAt,
        lastHistoricalStats: state.lastHistoricalStats,
        lastSignalStats: state.lastSignalStats,
        lastDepthStats: state.lastDepthStats,
        recentErrors: state.errors
    };
}

module.exports = {
    getDepthMonitorStatus,
    getPhase12Status,
    runPhase12CyclesOnce,
    setDepthMonitorEnabled,
    startPhase12Monitor,
    stopPhase12Monitor
};
