require('dotenv').config();

const mongoose = require('mongoose');
const { runPhase12CyclesOnce } = require('../services/phase12Monitor');

function parseCycleArg(argv) {
    const rawArg = argv.find((arg) => arg.startsWith('--cycle='));
    if (!rawArg) {
        return 'all';
    }

    const value = rawArg.split('=')[1];
    const normalized = String(value || '').trim().toLowerCase();
    return ['all', 'historical', 'signal', 'depth'].includes(normalized) ? normalized : 'all';
}

async function main() {
    const cycle = parseCycleArg(process.argv.slice(2));

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    try {
        const result = await runPhase12CyclesOnce({ cycle });
        console.log(JSON.stringify({ event: 'phase12.run-cycle.completed', ...result }, null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({
        event: 'phase12.run-cycle.failed',
        error: error.message
    }));
    process.exit(1);
});
