const { spawnSync } = require('child_process');
const path = require('path');

const requirementsPath = path.join(__dirname, '../scraper/requirements.txt');
const candidates = [process.env.PYTHON_BIN, 'python3', 'python'].filter(Boolean);

if (String(process.env.SKIP_PYTHON_DEPS || '').toLowerCase() === 'true') {
    console.log('Skipping Python dependency installation because SKIP_PYTHON_DEPS=true');
    process.exit(0);
}

let lastError = null;

for (const command of candidates) {
    const result = spawnSync(command, ['-m', 'pip', 'install', '-r', requirementsPath], {
        stdio: 'inherit'
    });

    if (result.status === 0) {
        console.log(`Installed Python scraper dependencies using ${command}`);
        process.exit(0);
    }

    lastError = result.error || new Error(`Command failed with exit code ${result.status}`);
}

console.error('Failed to install Python scraper dependencies. Ensure Python 3 and pip are available.');
if (lastError) {
    console.error(lastError.message);
}
process.exit(1);