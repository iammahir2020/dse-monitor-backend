const axios = require('axios');

function readConfig() {
    const baseUrl = String(process.env.BACKEND_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
    const token = String(process.env.TEST_AUTH_TOKEN || '').trim();

    return {
        baseUrl,
        token,
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    };
}

async function safeGet(url, config) {
    try {
        const response = await axios.get(url, config);
        return { ok: true, status: response.status, data: response.data };
    } catch (error) {
        if (error.response) {
            return {
                ok: false,
                status: error.response.status,
                data: error.response.data
            };
        }

        return { ok: false, status: null, data: { error: error.message } };
    }
}

async function main() {
    const { baseUrl, headers } = readConfig();

    console.log(`Running phase12 dry-run against ${baseUrl}`);

    const health = await safeGet(`${baseUrl}/api/health`, { headers });
    console.log('GET /api/health ->', health.status, health.ok ? 'ok' : 'failed');
    if (health.data?.phase12) {
        const phase12 = health.data.phase12;
        console.log('phase12.startedAt:', phase12.startedAt || null);
        console.log('phase12.marketWindow:', phase12.marketWindow || null);
        console.log('phase12.lastSignalCycleAt:', phase12.lastSignalCycleAt || null);
        console.log('phase12.lastDepthCycleAt:', phase12.lastDepthCycleAt || null);
    }

    const signal = await safeGet(`${baseUrl}/api/insights/signal-pulse?limit=5`, { headers });
    console.log('GET /api/insights/signal-pulse ->', signal.status, signal.ok ? 'ok' : 'failed');

    const depth = await safeGet(`${baseUrl}/api/market/depth-pressure?limit=5`, { headers });
    console.log('GET /api/market/depth-pressure ->', depth.status, depth.ok ? 'ok' : 'failed');

    if (!health.ok) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error('phase12 dry-run failed:', error.message);
    process.exit(1);
});
