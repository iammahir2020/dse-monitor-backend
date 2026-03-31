const { spawn } = require('child_process');
const path = require('path');

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

let cache = {
    data: [],
    lastFetched: null,
};

function fetchFromScraper() {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '../scraper/get_data.py');
        const pythonProcess = spawn('python3', [scriptPath]);

        let outputChunks = [];
        let errorChunks = [];

        pythonProcess.stdout.on('data', (chunk) => outputChunks.push(chunk));
        pythonProcess.stderr.on('data', (data) => {
            errorChunks.push(data);
            console.error(`PYTHON DEBUG: ${data.toString()}`);
        });

        pythonProcess.on('close', (code) => {
            const fullOutput = Buffer.concat(outputChunks).toString().trim();
            const fullError = Buffer.concat(errorChunks).toString().trim();

            if (code !== 0) {
                return reject(new Error(fullError || `Python exited with code ${code}`));
            }

            try {
                const jsonData = JSON.parse(fullOutput);
                resolve(jsonData);
            } catch (e) {
                reject(new Error(`JSON parse error: ${e.message}`));
            }
        });
    });
}

/**
 * Returns live data from cache if fresh, otherwise fetches new data.
 * @param {boolean} forceRefresh - Skip cache and always fetch fresh
 */
async function getLiveData(forceRefresh = false) {
    const now = Date.now();
    const isCacheStale = !cache.lastFetched || (now - cache.lastFetched) > CACHE_TTL_MS;

    if (forceRefresh || isCacheStale) {
        console.log('🔄 Cache stale or forced refresh — fetching from scraper...');
        const freshData = await fetchFromScraper();
        cache.data = freshData;
        cache.lastFetched = now;
        console.log(`✅ Cache updated with ${freshData.length} records`);
    } else {
        const ageSeconds = Math.round((now - cache.lastFetched) / 1000);
        console.log(`⚡ Serving from cache (${ageSeconds}s old)`);
    }

    return cache.data;
}

/**
 * Returns cache metadata
 */
function getCacheInfo() {
    return {
        recordCount: cache.data.length,
        lastFetched: cache.lastFetched ? new Date(cache.lastFetched).toISOString() : null,
        ageSeconds: cache.lastFetched ? Math.round((Date.now() - cache.lastFetched) / 1000) : null,
    };
}

module.exports = { getLiveData, getCacheInfo };
