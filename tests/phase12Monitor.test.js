const assert = require('assert').strict;

async function testDepthMonitorRuntimeToggle() {
    const depthPressureService = require('../services/depthPressureService');
    const notificationService = require('../services/phase12NotificationService');
    const phase12MonitorPath = require.resolve('../services/phase12Monitor');

    const originalEnv = {
        PHASE12_ENABLE_HIST_SYNC: process.env.PHASE12_ENABLE_HIST_SYNC,
        PHASE12_ENABLE_SIGNAL_MONITOR: process.env.PHASE12_ENABLE_SIGNAL_MONITOR,
        PHASE12_ENABLE_DEPTH_MONITOR: process.env.PHASE12_ENABLE_DEPTH_MONITOR,
        BD_MARKET_OPEN: process.env.BD_MARKET_OPEN,
        BD_MARKET_CLOSE: process.env.BD_MARKET_CLOSE
    };
    const originalRunDepthPressureCycle = depthPressureService.runDepthPressureCycle;
    const originalNotifyDepthPressureSnapshots = notificationService.notifyDepthPressureSnapshots;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;

    let runDepthPressureCycleCalls = 0;
    let nextIntervalId = 1;
    const scheduledIntervals = [];
    const clearedIntervals = [];

    try {
        process.env.PHASE12_ENABLE_HIST_SYNC = 'false';
        process.env.PHASE12_ENABLE_SIGNAL_MONITOR = 'false';
        process.env.PHASE12_ENABLE_DEPTH_MONITOR = 'true';
        process.env.BD_MARKET_OPEN = '00:00';
        process.env.BD_MARKET_CLOSE = '23:59';

        depthPressureService.runDepthPressureCycle = async () => {
            runDepthPressureCycleCalls += 1;
            return {
                symbolCount: 0,
                successCount: 0,
                failureCount: 0,
                skippedCount: 0,
                errors: [],
                snapshots: []
            };
        };
        notificationService.notifyDepthPressureSnapshots = async () => ({ sent: 0 });

        global.setInterval = (fn, ms) => {
            const handle = { id: nextIntervalId += 1, fn, ms };
            scheduledIntervals.push(handle);
            return handle;
        };
        global.clearInterval = (handle) => {
            clearedIntervals.push(handle);
        };

        delete require.cache[phase12MonitorPath];
        const phase12Monitor = require('../services/phase12Monitor');

        phase12Monitor.startPhase12Monitor({ depthMonitorEnabled: false });

        let status = phase12Monitor.getPhase12Status();
        assert.equal(status.depthMonitor.configuredEnabled, true);
        assert.equal(status.depthMonitor.runtimeEnabled, false);
        assert.equal(status.depthMonitor.intervalActive, false);
        assert.equal(scheduledIntervals.length, 0);

        phase12Monitor.setDepthMonitorEnabled(true);

        status = phase12Monitor.getPhase12Status();
        assert.equal(status.depthMonitor.runtimeEnabled, true);
        assert.equal(status.depthMonitor.effectiveEnabled, true);
        assert.equal(status.depthMonitor.intervalActive, true);
        assert.equal(scheduledIntervals.length, 1);
        assert.equal(scheduledIntervals[0].ms, 2 * 60 * 1000);
        assert.equal(runDepthPressureCycleCalls, 1);

        phase12Monitor.setDepthMonitorEnabled(true);
        assert.equal(scheduledIntervals.length, 1);

        phase12Monitor.setDepthMonitorEnabled(false);

        status = phase12Monitor.getPhase12Status();
        assert.equal(status.depthMonitor.runtimeEnabled, false);
        assert.equal(status.depthMonitor.intervalActive, false);
        assert.equal(clearedIntervals.length, 1);

        phase12Monitor.stopPhase12Monitor();
    } finally {
        depthPressureService.runDepthPressureCycle = originalRunDepthPressureCycle;
        notificationService.notifyDepthPressureSnapshots = originalNotifyDepthPressureSnapshots;
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;

        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key];
                return;
            }

            process.env[key] = value;
        });

        delete require.cache[phase12MonitorPath];
    }
}

module.exports = {
    testDepthMonitorRuntimeToggle
};