const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const apiLogger = require('./middleware/logger');
const { requireAuth } = require('./middleware/auth');
const Alert = require('./models/Alert');
const Notification = require('./models/Notification');
const OtpChallenge = require('./models/OtpChallenge');
const Portfolio = require('./models/Portfolio');
const User = require('./models/User');
const Watchlist = require('./models/Watchlist');
const {
    createTelegramLinkToken,
    dispatchOtpCode,
    generateOtpCode,
    hashValue,
    normalizePhoneNumber,
    signAuthToken
} = require('./services/authService');
const { startAlertMonitor, stopAlertMonitor } = require('./services/alertMonitor');
const { getSummaryHistoryForSymbols } = require('./services/dailySummaryService');
const { getEntrySignalsForUser } = require('./services/insightService');
const { computeChangePercent, getStockVolume } = require('./services/marketAnalytics');
const { getLiveData, getCacheInfo } = require('./services/liveDataCache');
const {
    markAllNotificationsRead,
    markNotificationRead,
    serializeNotification,
    deleteNotification,
    deleteAllNotifications
} = require('./services/notificationService');
const { sendTelegramText } = require('./services/telegramService');
const { disconnectUserSockets, initializeWebSocketServer } = require('./services/websocketService');

const app = express();
const server = http.createServer(app);

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);
const TELEGRAM_LINK_EXPIRY_MINUTES = Number(process.env.TELEGRAM_LINK_EXPIRY_MINUTES || 15);
const EXPOSE_OTP_IN_RESPONSE = String(process.env.EXPOSE_OTP_IN_RESPONSE || '').toLowerCase() === 'true';

function normalizeOrigin(origin) {
    if (!origin) {
        return null;
    }

    const value = String(origin).trim();
    if (!value) {
        return null;
    }

    return value.replace(/\/+$/, '');
}

const allowedOrigins = [process.env.FRONTEND_URL, process.env.FRONTEND_WEB_URL]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

const corsOptions = {
    origin(origin, callback) {
        if (!origin) {
            return callback(null, true);
        }

        const normalizedOrigin = normalizeOrigin(origin);
        if (allowedOrigins.includes(normalizedOrigin)) {
            return callback(null, true);
        }

        return callback(new Error('CORS blocked: origin not allowed'));
    }
};

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many webhook requests.' }
});

const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later.' }
});

function maskToken(token) {
    if (!token) {
        return null;
    }

    const value = String(token);
    if (value.length <= 8) {
        return '****';
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function resolveTelegramBotUsername() {
    const configured = String(process.env.TELEGRAM_BOT_USERNAME || '').trim();
    if (!configured) {
        return null;
    }

    // Allow users to store @botusername in env but always emit canonical deep-link username.
    const normalized = configured.startsWith('@') ? configured.slice(1) : configured;
    return /^[A-Za-z0-9_]{5,}$/.test(normalized) ? normalized : null;
}

function extractStartToken(messageText) {
    if (typeof messageText !== 'string') {
        return { isStartCommand: false };
    }

    const normalizedText = messageText.trim();
    const startMatch = normalizedText.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i);

    if (!startMatch) {
        return { isStartCommand: false };
    }

    const rawPayload = startMatch[1] ? startMatch[1].trim() : '';
    if (!rawPayload) {
        return { isStartCommand: true, token: null, parseError: null };
    }

    let decodedPayload = rawPayload;
    try {
        decodedPayload = decodeURIComponent(rawPayload);
    } catch (error) {
        decodedPayload = rawPayload;
    }

    const token = decodedPayload.trim();
    const isExpectedHexToken = /^[a-f0-9]{48}$/i.test(token);
    if (!isExpectedHexToken) {
        return { isStartCommand: true, token: null, parseError: 'malformed_token' };
    }

    return { isStartCommand: true, token, parseError: null };
}

function serializeUser(user) {
    return {
        id: String(user._id),
        phoneNumber: user.phoneNumber,
        displayName: user.displayName || null,
        telegramLinked: Boolean(user.telegramChatId),
        telegramUsername: user.telegramUsername || null,
        telegramLinkedAt: user.telegramLinkedAt || null,
        notificationSettings: user.notificationSettings || {}
    };
}

function sanitizeNotificationSettings(body) {
    const nextSettings = {};
    const allowedBooleanKeys = [
        'websocketEnabled',
        'telegramEnabled',
        'portfolioVolumeAlertsEnabled',
        'watchlistVolumeAlertsEnabled'
    ];

    allowedBooleanKeys.forEach((key) => {
        if (typeof body[key] === 'boolean') {
            nextSettings[key] = body[key];
        }
    });

    if (body.fixedVolumeThreshold === null) {
        nextSettings.fixedVolumeThreshold = null;
    } else if (Number.isFinite(Number(body.fixedVolumeThreshold)) && Number(body.fixedVolumeThreshold) >= 0) {
        nextSettings.fixedVolumeThreshold = Number(body.fixedVolumeThreshold);
    }

    if (Number.isFinite(Number(body.relativeVolumeMultiplier)) && Number(body.relativeVolumeMultiplier) > 0) {
        nextSettings.relativeVolumeMultiplier = Number(body.relativeVolumeMultiplier);
    }

    if (Number.isFinite(Number(body.relativeVolumeLookbackDays)) && Number(body.relativeVolumeLookbackDays) >= 2) {
        nextSettings.relativeVolumeLookbackDays = Number(body.relativeVolumeLookbackDays);
    }

    return nextSettings;
}

function getOtpResponsePayload(phoneNumber, otpCode) {
    const payload = {
        message: 'OTP generated successfully',
        phoneNumber,
        expiresInSeconds: OTP_EXPIRY_MINUTES * 60
    };

    if (process.env.NODE_ENV !== 'production' || EXPOSE_OTP_IN_RESPONSE) {
        payload.devOtp = otpCode;
    }

    return payload;
}

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use(apiLogger);

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ MongoDB Atlas connected');
        startAlertMonitor();
    })
    .catch((error) => console.error('❌ MongoDB connection error:', error.message));

app.post('/api/auth/request-otp', async (req, res) => {
    try {
        const normalizedPhoneNumber = normalizePhoneNumber(req.body.phoneNumber);
        if (!normalizedPhoneNumber) {
            return res.status(400).json({ error: 'A valid phone number is required' });
        }

        const otpCode = generateOtpCode();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        await OtpChallenge.findOneAndUpdate(
            { phoneNumber: normalizedPhoneNumber, purpose: 'login' },
            {
                phoneNumber: normalizedPhoneNumber,
                purpose: 'login',
                codeHash: hashValue(otpCode),
                expiresAt,
                attemptsRemaining: 5
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await dispatchOtpCode(normalizedPhoneNumber, otpCode);
        res.json(getOtpResponsePayload(normalizedPhoneNumber, otpCode));
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error requesting OTP:`, error.message);
        res.status(500).json({ error: 'Failed to generate OTP', details: error.message });
    }
});

app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const normalizedPhoneNumber = normalizePhoneNumber(req.body.phoneNumber);
        const otpCode = String(req.body.otp || '').trim();

        if (!normalizedPhoneNumber || !otpCode) {
            return res.status(400).json({ error: 'Phone number and OTP are required' });
        }

        const otpChallenge = await OtpChallenge.findOne({
            phoneNumber: normalizedPhoneNumber,
            purpose: 'login',
            expiresAt: { $gt: new Date() }
        });

        if (!otpChallenge) {
            return res.status(400).json({ error: 'OTP has expired or was not requested' });
        }

        if (otpChallenge.codeHash !== hashValue(otpCode)) {
            otpChallenge.attemptsRemaining = Math.max(0, otpChallenge.attemptsRemaining - 1);

            if (otpChallenge.attemptsRemaining === 0) {
                await otpChallenge.deleteOne();
            } else {
                await otpChallenge.save();
            }

            return res.status(400).json({ error: 'Invalid OTP' });
        }

        const user = await User.findOneAndUpdate(
            { phoneNumber: normalizedPhoneNumber },
            {
                $setOnInsert: { phoneNumber: normalizedPhoneNumber },
                $set: { lastLoginAt: new Date() }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await otpChallenge.deleteOne();

        res.json({
            token: signAuthToken(user),
            user: serializeUser(user),
            websocket: {
                path: '/ws',
                requiresTokenQuery: true
            }
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error verifying OTP:`, error.message);
        res.status(500).json({ error: 'Failed to verify OTP' });
    }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
    const disconnectedSockets = disconnectUserSockets(req.user.phoneNumber, 'logout');
    res.json({
        message: 'Logged out successfully',
        disconnectedSockets
    });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    res.json({
        user: serializeUser(req.user),
        websocket: {
            path: '/ws',
            requiresTokenQuery: true
        }
    });
});

app.patch('/api/me/settings', requireAuth, async (req, res) => {
    try {
        const nextSettings = sanitizeNotificationSettings(req.body);
        req.user.notificationSettings = {
            ...(req.user.notificationSettings || {}),
            ...nextSettings
        };
        await req.user.save();
        res.json({ user: serializeUser(req.user) });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error updating settings:`, error.message);
        res.status(500).json({ error: 'Failed to update user settings' });
    }
});

app.get('/api/live', async (req, res) => {
    try {
        const jsonData = await getLiveData(true);
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const startIndex = (page - 1) * limit;
        const paginatedData = jsonData.slice(startIndex, startIndex + limit);
        const totalPages = Math.ceil(jsonData.length / limit);

        res.json({
            data: paginatedData,
            alerts: [],
            pagination: {
                currentPage: page,
                pageSize: limit,
                totalRecords: jsonData.length,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            },
            cacheInfo: getCacheInfo()
        });
    } catch (error) {
        console.error('❌ /api/live error:', error.message);
        res.status(500).json({ error: 'Failed to fetch live data', details: error.message });
    }
});

app.get('/api/live/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const liveData = await getLiveData();
        const stock = liveData.find((entry) => entry.symbol === symbol);

        if (!stock) {
            return res.status(404).json({ error: `Stock "${symbol}" not found in live data` });
        }

        res.json(stock);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching live data for symbol:`, error.message);
        res.status(500).json({ error: 'Failed to fetch live data', details: error.message });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const query = (req.query.q || '').toUpperCase();
        if (query.length < 1) {
            return res.json([]);
        }

        const liveData = await getLiveData();
        const results = liveData
            .filter((stock) => stock.symbol && stock.symbol.includes(query))
            .slice(0, 20);

        res.json(results);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error searching:`, error.message);
        res.status(500).json({ error: 'Failed to search stocks' });
    }
});

app.get('/api/market/top-movers', async (req, res) => {
    try {
        const limit = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const liveData = await getLiveData();

        const stocksWithPct = liveData
            .map((stock) => ({
                ...stock,
                changePercent: computeChangePercent(stock)
            }))
            .filter((stock) => stock.changePercent != null);

        const gainers = [...stocksWithPct]
            .filter((stock) => stock.changePercent > 0)
            .sort((left, right) => right.changePercent - left.changePercent)
            .slice(0, limit);

        const losers = [...stocksWithPct]
            .filter((stock) => stock.changePercent < 0)
            .sort((left, right) => left.changePercent - right.changePercent)
            .slice(0, limit);

        res.json({ gainers, losers, cacheInfo: getCacheInfo() });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching top movers:`, error.message);
        res.status(500).json({ error: 'Failed to fetch top movers' });
    }
});

app.get('/api/market/advance-decline', async (req, res) => {
    try {
        const liveData = await getLiveData();
        const validStocks = liveData.filter((stock) => computeChangePercent(stock) != null);
        const otherStocks = liveData.length - validStocks.length;

        const advances = validStocks.filter((stock) => stock.ltp > stock.open).length;
        const declines = validStocks.filter((stock) => stock.ltp < stock.open).length;
        const unchanged = validStocks.filter((stock) => stock.ltp === stock.open).length;
        const ratio = declines > 0
            ? (advances / declines).toFixed(2)
            : advances > 0 ? 'N/A (no declines)' : '0.00';
        const sentiment = advances > declines ? 'Bullish' : declines > advances ? 'Bearish' : 'Neutral';

        res.json({
            advances,
            declines,
            unchanged,
            total: liveData.length,
            validTotal: validStocks.length,
            skipped: otherStocks,
            advanceDeclineRatio: ratio,
            marketSentiment: sentiment,
            cacheInfo: getCacheInfo()
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching A/D:`, error.message);
        res.status(500).json({ error: 'Failed to fetch market sentiment' });
    }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const status = req.query.status;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const query = { userPhoneNumber: req.user.phoneNumber };

        if (status && ['unread', 'read', 'archived'].includes(status)) {
            query.status = status;
        }

        const [notifications, totalCount] = await Promise.all([
            Notification.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            Notification.countDocuments(query)
        ]);

        res.json({
            data: notifications.map(serializeNotification),
            pagination: {
                currentPage: page,
                pageSize: limit,
                totalRecords: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching notifications:`, error.message);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
    try {
        const unreadCount = await Notification.countDocuments({
            userPhoneNumber: req.user.phoneNumber,
            status: 'unread'
        });

        res.json({ unreadCount });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching unread count:`, error.message);
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
});

app.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
    try {
        await markAllNotificationsRead(req.user.phoneNumber);
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error marking notifications as read:`, error.message);
        res.status(500).json({ error: 'Failed to update notifications' });
    }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const notification = await markNotificationRead(req.params.id, req.user.phoneNumber);
        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json(notification);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error marking notification as read:`, error.message);
        res.status(500).json({ error: 'Failed to update notification' });
    }
});

app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
    try {
        const deleted = await deleteNotification(req.params.id, req.user.phoneNumber);
        if (!deleted) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ message: 'Notification deleted' });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error deleting notification:`, error.message);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

app.delete('/api/notifications', requireAuth, async (req, res) => {
    try {
        const deletedCount = await deleteAllNotifications(req.user.phoneNumber);
        res.json({
            message: 'All notifications deleted',
            deletedCount
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error deleting all notifications:`, error.message);
        res.status(500).json({ error: 'Failed to delete notifications' });
    }
});

app.post('/api/alerts', requireAuth, async (req, res) => {
    try {
        const { symbol, alertType, threshold, lookbackDays, cooldownSeconds } = req.body;
        if (!symbol || !alertType || threshold === undefined) {
            return res.status(400).json({ error: 'Missing required fields: symbol, alertType, threshold' });
        }

        const alert = await Alert.create({
            symbol: symbol.toUpperCase(),
            alertType,
            threshold,
            lookbackDays,
            cooldownSeconds,
            userPhoneNumber: req.user.phoneNumber
        });

        res.status(201).json(alert);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error creating alert:`, error.message);
        res.status(500).json({ error: 'Failed to create alert', details: error.message });
    }
});

app.get('/api/alerts', requireAuth, async (req, res) => {
    try {
        const alerts = await Alert.find({ userPhoneNumber: req.user.phoneNumber }).sort({ createdAt: -1 });
        res.json(alerts);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching alerts:`, error.message);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

app.get('/api/alerts/symbol/:symbol', requireAuth, async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const alerts = await Alert.find({ userPhoneNumber: req.user.phoneNumber, symbol });
        res.json(alerts);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching alerts by symbol:`, error.message);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

app.put('/api/alerts/:id', requireAuth, async (req, res) => {
    try {
        const update = {};
        ['threshold', 'alertType', 'isActive', 'lookbackDays', 'cooldownSeconds'].forEach((field) => {
            if (req.body[field] !== undefined) {
                update[field] = req.body[field];
            }
        });

        const alert = await Alert.findOneAndUpdate(
            { _id: req.params.id, userPhoneNumber: req.user.phoneNumber },
            update,
            { new: true }
        );

        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json(alert);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error updating alert:`, error.message);
        res.status(500).json({ error: 'Failed to update alert' });
    }
});

app.delete('/api/alerts/:id', requireAuth, async (req, res) => {
    try {
        const alert = await Alert.findOneAndDelete({ _id: req.params.id, userPhoneNumber: req.user.phoneNumber });
        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json({ message: 'Alert deleted successfully', alert });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error deleting alert:`, error.message);
        res.status(500).json({ error: 'Failed to delete alert' });
    }
});

app.post('/api/watchlist', requireAuth, async (req, res) => {
    try {
        const { symbol } = req.body;
        if (!symbol) {
            return res.status(400).json({ error: 'Missing required field: symbol' });
        }

        const normalizedSymbol = symbol.toUpperCase();
        const watchlistItem = await Watchlist.findOneAndUpdate(
            { symbol: normalizedSymbol, userPhoneNumber: req.user.phoneNumber },
            { symbol: normalizedSymbol, userPhoneNumber: req.user.phoneNumber, addedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(201).json(watchlistItem);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error adding to watchlist:`, error.message);
        res.status(500).json({ error: 'Failed to add to watchlist' });
    }
});

app.get('/api/watchlist', requireAuth, async (req, res) => {
    try {
        const watchlist = await Watchlist.find({ userPhoneNumber: req.user.phoneNumber }).sort({ addedAt: -1 });
        res.json(watchlist);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching watchlist:`, error.message);
        res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
});

app.delete('/api/watchlist/:symbol', requireAuth, async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const deletedItem = await Watchlist.findOneAndDelete({ symbol, userPhoneNumber: req.user.phoneNumber });
        if (!deletedItem) {
            return res.status(404).json({ error: 'Stock not found in watchlist' });
        }

        res.json({ message: 'Stock removed from watchlist', symbol });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error removing from watchlist:`, error.message);
        res.status(500).json({ error: 'Failed to remove from watchlist' });
    }
});

app.post('/api/portfolio', requireAuth, async (req, res) => {
    try {
        const { symbol, quantity, buyPrice, notes } = req.body;
        if (!symbol || !quantity || buyPrice === undefined) {
            return res.status(400).json({ error: 'Missing required fields: symbol, quantity, buyPrice' });
        }

        const holding = await Portfolio.create({
            symbol: symbol.toUpperCase(),
            quantity,
            buyPrice,
            notes,
            userPhoneNumber: req.user.phoneNumber
        });

        res.status(201).json(holding);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error adding portfolio holding:`, error.message);
        res.status(500).json({ error: 'Failed to add holding', details: error.message });
    }
});

app.get('/api/portfolio', requireAuth, async (req, res) => {
    try {
        const holdings = await Portfolio.find({ userPhoneNumber: req.user.phoneNumber }).sort({ purchaseDate: -1 });
        res.json(holdings);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching portfolio:`, error.message);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

app.get('/api/portfolio/with-pnl', requireAuth, async (req, res) => {
    try {
        const [holdings, liveData] = await Promise.all([
            Portfolio.find({ userPhoneNumber: req.user.phoneNumber }),
            getLiveData()
        ]);

        const priceMap = {};
        liveData.forEach((stock) => {
            priceMap[stock.symbol] = stock.ltp;
        });

        const holdingsWithPnL = holdings.map((holding) => {
            const currentPrice = priceMap[holding.symbol] ?? holding.buyPrice;
            const costBasis = holding.quantity * holding.buyPrice;
            const currentValue = holding.quantity * currentPrice;
            const unrealizedPnL = currentValue - costBasis;
            const pnlPercentage = costBasis > 0 ? Number(((unrealizedPnL / costBasis) * 100).toFixed(2)) : null;

            return {
                ...holding.toObject(),
                currentPrice,
                costBasis,
                currentValue,
                unrealizedPnL,
                pnlPercentage
            };
        });

        res.json(holdingsWithPnL);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching portfolio with P/L:`, error.message);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

app.put('/api/portfolio/:id', requireAuth, async (req, res) => {
    try {
        const update = {};
        ['quantity', 'buyPrice', 'notes'].forEach((field) => {
            if (req.body[field] !== undefined) {
                update[field] = req.body[field];
            }
        });

        const holding = await Portfolio.findOneAndUpdate(
            { _id: req.params.id, userPhoneNumber: req.user.phoneNumber },
            update,
            { new: true }
        );

        if (!holding) {
            return res.status(404).json({ error: 'Holding not found' });
        }

        res.json(holding);
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error updating portfolio:`, error.message);
        res.status(500).json({ error: 'Failed to update holding' });
    }
});

app.delete('/api/portfolio/:id', requireAuth, async (req, res) => {
    try {
        const holding = await Portfolio.findOneAndDelete({ _id: req.params.id, userPhoneNumber: req.user.phoneNumber });
        if (!holding) {
            return res.status(404).json({ error: 'Holding not found' });
        }

        res.json({ message: 'Holding removed from portfolio', holding });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error deleting portfolio:`, error.message);
        res.status(500).json({ error: 'Failed to delete holding' });
    }
});

app.get('/api/telegram/status', requireAuth, async (req, res) => {
    console.log(
        JSON.stringify({
            event: 'telegram.status.read',
            requestId: req.requestId,
            phoneNumber: req.user.phoneNumber,
            linked: Boolean(req.user.telegramChatId)
        })
    );

    res.json({
        linked: Boolean(req.user.telegramChatId),
        telegramUsername: req.user.telegramUsername || null,
        linkedAt: req.user.telegramLinkedAt || null,
        botUsername: process.env.TELEGRAM_BOT_USERNAME || null
    });
});

app.post('/api/telegram/link-token', requireAuth, async (req, res) => {
    try {
        const botUsername = resolveTelegramBotUsername();
        if (!botUsername) {
            return res.status(503).json({ error: 'Telegram bot username is not configured' });
        }

        const linkToken = createTelegramLinkToken();
        const expiresAt = new Date(Date.now() + TELEGRAM_LINK_EXPIRY_MINUTES * 60 * 1000);

        req.user.telegramLinkTokenHash = hashValue(linkToken);
        req.user.telegramLinkTokenExpiresAt = expiresAt;
        await req.user.save();

        console.log(
            JSON.stringify({
                event: 'telegram.link_token.generated',
                requestId: req.requestId,
                phoneNumber: req.user.phoneNumber,
                tokenMasked: maskToken(linkToken),
                tokenHashPrefix: req.user.telegramLinkTokenHash.slice(0, 8),
                expiresAt: expiresAt.toISOString()
            })
        );

        res.json({
            linkToken,
            expiresAt,
            botUsername,
            deepLinkUrl: `https://t.me/${botUsername}?start=${linkToken}`
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error generating Telegram link token:`, error.message);
        res.status(500).json({ error: 'Failed to generate Telegram link token' });
    }
});

app.delete('/api/telegram/link', requireAuth, async (req, res) => {
    try {
        req.user.telegramChatId = undefined;
        req.user.telegramUsername = undefined;
        req.user.telegramLinkedAt = undefined;
        req.user.telegramLinkTokenHash = undefined;
        req.user.telegramLinkTokenExpiresAt = undefined;
        await req.user.save();

        res.json({ message: 'Telegram account unlinked successfully' });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error unlinking Telegram:`, error.message);
        res.status(500).json({ error: 'Failed to unlink Telegram account' });
    }
});

app.post('/api/telegram/webhook', webhookLimiter, async (req, res) => {
    try {
        const telegramWebhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
        const incomingSecret = String(req.get('x-telegram-bot-api-secret-token') || '').trim();

        console.log(
            JSON.stringify({
                event: 'telegram.webhook.received',
                requestId: req.requestId,
                updateId: req.body?.update_id || null,
                hasSecretHeader: Boolean(incomingSecret),
                hasMessage: Boolean(req.body?.message),
                hasEditedMessage: Boolean(req.body?.edited_message)
            })
        );

        if (!telegramWebhookSecret) {
            return res.status(503).json({ error: 'Webhook is not configured' });
        }

        if (incomingSecret !== telegramWebhookSecret) {
            console.warn(
                JSON.stringify({
                    event: 'telegram.webhook.rejected',
                    requestId: req.requestId,
                    reason: 'secret_mismatch'
                })
            );
            return res.status(401).json({ error: 'Invalid webhook secret' });
        }

        const message = req.body.message || req.body.edited_message;
        if (!message?.text) {
            return res.json({ status: 'ok' });
        }

        const chatId = String(message.chat.id);
        const telegramUsername = message.from?.username || null;

        const startCommand = extractStartToken(message.text);
        if (startCommand.isStartCommand) {
            if (startCommand.parseError === 'malformed_token') {
                console.warn(
                    JSON.stringify({
                        event: 'telegram.link.failed',
                        requestId: req.requestId,
                        reason: 'malformed_token',
                        chatIdSuffix: chatId.slice(-4)
                    })
                );

                await sendTelegramText(chatId, 'Invalid Telegram link token format. Please generate a new link from the app and try again.');
                return res.json({ status: 'ok' });
            }

            if (!startCommand.token) {
                await sendTelegramText(chatId, [
                    'Welcome to DSE Monitor Alerts.',
                    '',
                    'To link Telegram with your app account, open the app and use the Connect Telegram action first.'
                ].join('\n'));
                return res.json({ status: 'ok' });
            }

            const now = new Date();
            const tokenHash = hashValue(startCommand.token);

            console.log(
                JSON.stringify({
                    event: 'telegram.link.token_parsed',
                    requestId: req.requestId,
                    tokenMasked: maskToken(startCommand.token),
                    tokenHashPrefix: tokenHash.slice(0, 8),
                    chatIdSuffix: chatId.slice(-4)
                })
            );

            const user = await User.findOneAndUpdate(
                {
                    telegramLinkTokenHash: tokenHash,
                    telegramLinkTokenExpiresAt: { $gt: now }
                },
                {
                    $set: {
                        telegramChatId: chatId,
                        telegramUsername,
                        telegramLinkedAt: now
                    },
                    $unset: {
                        telegramLinkTokenHash: 1,
                        telegramLinkTokenExpiresAt: 1
                    }
                },
                { new: true }
            );

            if (!user) {
                console.warn(
                    JSON.stringify({
                        event: 'telegram.link.failed',
                        requestId: req.requestId,
                        reason: 'invalid_or_expired_token',
                        tokenHashPrefix: tokenHash.slice(0, 8),
                        chatIdSuffix: chatId.slice(-4)
                    })
                );

                await sendTelegramText(chatId, 'This Telegram link token is invalid or has expired. Please generate a new link from the app.');
                return res.json({ status: 'ok' });
            }

            console.log(
                JSON.stringify({
                    event: 'telegram.link.success',
                    requestId: req.requestId,
                    phoneNumber: user.phoneNumber,
                    chatIdSuffix: chatId.slice(-4),
                    linkedAt: user.telegramLinkedAt?.toISOString?.() || now.toISOString()
                })
            );

            await sendTelegramText(chatId, [
                'Your Telegram account is now linked to DSE Monitor.',
                '',
                `Linked phone: ${user.phoneNumber}`,
                'You will now receive alert notifications here.'
            ].join('\n'));

            return res.json({ status: 'ok' });
        }

        if (message.text === '/help') {
            await sendTelegramText(chatId, [
                'DSE Monitor commands:',
                '/start <token> - Link Telegram from the app-generated secure link',
                '/help - Show this help message'
            ].join('\n'));
            return res.json({ status: 'ok' });
        }

        return res.json({ status: 'ok' });
    } catch (error) {
        console.error('❌ Telegram webhook error:', error.message);
        res.status(500).json({ error: 'Webhook error' });
    }
});

app.get('/api/insights/entry-signals', requireAuth, async (req, res) => {
    try {
        const signals = await getEntrySignalsForUser(req.user.phoneNumber);
        res.json({
            generatedAt: new Date().toISOString(),
            data: signals
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error generating entry signals:`, error.message);
        res.status(500).json({ error: 'Failed to generate entry signals' });
    }
});

app.get('/api/insights/volume-context/:symbol', requireAuth, async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const [liveData, summaryHistory] = await Promise.all([
            getLiveData(),
            getSummaryHistoryForSymbols([symbol], 10)
        ]);

        const stock = liveData.find((entry) => entry.symbol === symbol);
        if (!stock) {
            return res.status(404).json({ error: 'Stock not found in live data' });
        }

        const summaries = summaryHistory[symbol] || [];
        const recentVolumes = summaries.map((summary) => summary.volume).filter((value) => value != null);
        const averageRecentVolume = recentVolumes.length
            ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length
            : null;

        res.json({
            symbol,
            currentVolume: getStockVolume(stock),
            averageRecentVolume: averageRecentVolume != null ? Number(averageRecentVolume.toFixed(2)) : null,
            recentDays: summaries.length
        });
    } catch (error) {
        console.error(`[${req.requestId}] ❌ Error fetching volume context:`, error.message);
        res.status(500).json({ error: 'Failed to fetch volume context' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

process.on('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    stopAlertMonitor();
    server.close(() => process.exit(0));
});

initializeWebSocketServer(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Engine API active on port ${PORT}`));