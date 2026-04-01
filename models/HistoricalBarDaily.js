const mongoose = require('mongoose');

const historicalBarDailySchema = new mongoose.Schema(
    {
        symbol: {
            type: String,
            required: true,
            uppercase: true,
            index: true
        },
        tradeDate: {
            type: Date,
            required: true,
            index: true
        },
        open: Number,
        high: Number,
        low: Number,
        close: Number,
        volume: Number,
        source: {
            type: String,
            default: 'bdshare'
        },
        fetchedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

historicalBarDailySchema.index({ symbol: 1, tradeDate: 1 }, { unique: true });
historicalBarDailySchema.index({ tradeDate: -1 });

module.exports = mongoose.model('HistoricalBarDaily', historicalBarDailySchema);
