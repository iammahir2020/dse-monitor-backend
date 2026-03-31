const mongoose = require('mongoose');

const dailySummarySchema = new mongoose.Schema(
    {
        symbol: {
            type: String,
            required: true,
            uppercase: true,
            index: true
        },
        summaryDate: {
            type: Date,
            required: true,
            index: true
        },
        open: Number,
        high: Number,
        low: Number,
        close: Number,
        volume: Number,
        tradeValue: Number,
        lastSnapshotAt: Date
    },
    {
        timestamps: true
    }
);

dailySummarySchema.index({ symbol: 1, summaryDate: 1 }, { unique: true });

module.exports = mongoose.model('DailySummary', dailySummarySchema);