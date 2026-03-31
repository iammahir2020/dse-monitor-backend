const User = require('../models/User');
const { verifyAuthToken } = require('../services/authService');

function getBearerToken(req) {
    const authorization = req.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
        return null;
    }

    return authorization.slice('Bearer '.length).trim();
}

async function requireAuth(req, res, next) {
    try {
        const token = getBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: 'Missing bearer token' });
        }

        const payload = verifyAuthToken(token);
        const user = await User.findOne({ phoneNumber: payload.phoneNumber });

        if (!user) {
            return res.status(401).json({ error: 'User session is no longer valid' });
        }

        req.authToken = token;
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

module.exports = {
    requireAuth,
    getBearerToken
};