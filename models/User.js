const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        phoneNumber: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        displayName: String,
        telegramChatId: String,
        telegramUsername: String,
        telegramLinkedAt: Date,
        telegramLinkTokenHash: String,
        telegramLinkTokenExpiresAt: Date,
        notificationSettings: {
            websocketEnabled: {
                type: Boolean,
                default: true
            },
            telegramEnabled: {
                type: Boolean,
                default: true
            },
            portfolioVolumeAlertsEnabled: {
                type: Boolean,
                default: true
            },
            watchlistVolumeAlertsEnabled: {
                type: Boolean,
                default: true
            },
            fixedVolumeThreshold: {
                type: Number,
                default: null,
                min: 0
            },
            relativeVolumeMultiplier: {
                type: Number,
                default: 2,
                min: 0
            },
            relativeVolumeLookbackDays: {
                type: Number,
                default: 5,
                min: 2
            },
            depthPressureAlertsEnabled: {
                type: Boolean,
                default: true
            },
            depthPressureThreshold: {
                type: Number,
                default: 3,
                min: 1.2,
                max: 10
            },
            signalPulseAlertsEnabled: {
                type: Boolean,
                default: true
            },
            signalPulseTimeframe: {
                type: String,
                default: 'daily',
                enum: ['daily']
            }
        },
        lastLoginAt: Date
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('User', userSchema);