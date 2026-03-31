const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        userPhoneNumber: {
            type: String,
            required: true,
            index: true
        },
        type: {
            type: String,
            required: true,
            enum: [
                'alert_triggered',
                'high_volume_trade',
                'relative_volume_trade',
                'entry_signal',
                'system'
            ]
        },
        source: {
            type: String,
            required: true,
            enum: ['manual_alert', 'smart_volume', 'entry_signal', 'auth', 'system']
        },
        symbol: {
            type: String,
            uppercase: true,
            default: null
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        message: {
            type: String,
            required: true,
            trim: true
        },
        status: {
            type: String,
            enum: ['unread', 'read', 'archived'],
            default: 'unread',
            index: true
        },
        dedupeKey: {
            type: String,
            default: null,
            index: true
        },
        payload: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        delivery: {
            websocketDeliveredAt: Date,
            telegramDeliveredAt: Date,
            telegramError: String
        },
        readAt: Date
    },
    {
        timestamps: true
    }
);

notificationSchema.index({ userPhoneNumber: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);