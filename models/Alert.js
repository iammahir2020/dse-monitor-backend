const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    symbol: {
        type: String,
        required: true,
        uppercase: true
    },
    alertType: {
        type: String,
        enum: ['price_above', 'price_below', 'change_percent', 'volume_above', 'relative_volume_above'],
        required: true
    },
    threshold: {
        type: Number,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastTriggered: {
        type: Date,
        default: null
    },
    userPhoneNumber: {
        type: String,
        required: true,
        index: true
    },
    lookbackDays: {
        type: Number,
        default: 5,
        min: 2
    },
    cooldownSeconds: {
        type: Number,
        default: 300,
        min: 0
    },
    source: {
        type: String,
        enum: ['manual'],
        default: 'manual'
    }
});

module.exports = mongoose.model('Alert', alertSchema);
