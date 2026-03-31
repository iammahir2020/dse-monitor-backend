const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

const logFile = path.join(logsDir, 'api.log');
const SENSITIVE_KEYS = ['password', 'passwd', 'secret', 'token', 'apiKey', 'chatId', 'authorization'];

function redactSensitiveData(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(redactSensitiveData);

    const redacted = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        const isSensitive = SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey.toLowerCase()));
        redacted[key] = isSensitive ? '[REDACTED]' : redactSensitiveData(nestedValue);
    }
    return redacted;
}

function generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function formatLog(level, requestId, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        level,
        requestId,
        message,
        ...data
    };
    return JSON.stringify(logEntry);
}

function logToFile(logEntry) {
    fs.appendFile(logFile, logEntry + '\n', (err) => {
        if (err) console.error('Error writing to log file:', err);
    });
}

function apiLogger(req, res, next) {
    const requestId = generateRequestId();
    const startTime = Date.now();
    
    // Store requestId and startTime in request object
    req.requestId = requestId;
    req.startTime = startTime;
    
    // Log incoming request
    const incomingLog = formatLog('INFO', requestId, 'Incoming Request', {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.method !== 'GET' ? redactSensitiveData(req.body) : undefined,
        ip: req.ip
    });
    
    console.log(`[${new Date().toISOString()}] 📥 ${req.method} ${req.path}`);
    logToFile(incomingLog);
    
    // Override res.json to log response
    const originalJson = res.json.bind(res);
    res.json = function(data) {
        const duration = Date.now() - startTime;
        const outgoingLog = formatLog('INFO', requestId, 'Outgoing Response', {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        });
        
        console.log(`[${new Date().toISOString()}] 📤 ${req.method} ${req.path} - Status: ${res.statusCode} (${duration}ms)`);
        logToFile(outgoingLog);
        
        return originalJson(data);
    };
    
    next();
}

module.exports = apiLogger;
