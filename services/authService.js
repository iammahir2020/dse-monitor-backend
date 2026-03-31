const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DEFAULT_JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function normalizePhoneNumber(phoneNumber) {
    if (typeof phoneNumber !== 'string') {
        return null;
    }

    const trimmed = phoneNumber.trim();
    if (!trimmed) {
        return null;
    }

    const digits = trimmed.replace(/\D/g, '');
    if (!digits) {
        return null;
    }

    if (digits.startsWith('880') && digits.length === 13) {
        return `+${digits}`;
    }

    if (digits.startsWith('01') && digits.length === 11) {
        return `+88${digits}`;
    }

    if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
        return `+${digits}`;
    }

    if (digits.length >= 10 && digits.length <= 15) {
        return `+${digits}`;
    }

    return null;
}

function generateOtpCode() {
    return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function hashValue(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createTelegramLinkToken() {
    return crypto.randomBytes(24).toString('hex');
}

function getJwtSecret() {
    return process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
}

function signAuthToken(user) {
    return jwt.sign(
        {
            sub: String(user._id),
            phoneNumber: user.phoneNumber
        },
        getJwtSecret(),
        { expiresIn: DEFAULT_JWT_EXPIRES_IN }
    );
}

function verifyAuthToken(token) {
    return jwt.verify(token, getJwtSecret());
}

async function dispatchOtpCode(phoneNumber, otpCode) {
    const smsProvider = process.env.SMS_PROVIDER || 'console';

    if (smsProvider !== 'console' && process.env.NODE_ENV === 'production') {
        throw new Error('SMS provider integration is not configured yet');
    }

    console.log(`OTP for ${phoneNumber}: ${otpCode}`);

    return {
        provider: smsProvider,
        delivered: true
    };
}

module.exports = {
    normalizePhoneNumber,
    generateOtpCode,
    hashValue,
    createTelegramLinkToken,
    signAuthToken,
    verifyAuthToken,
    dispatchOtpCode
};