const mongoose = require('mongoose');

const signalStateDailySchema = new mongoose.Schema(
    {
        symbol: {
            type: String,
            required: true,
            uppercase: true,
            unique: true,
            index: true
        },
        lastDate: Date,
        rsi14: Number,
        ema9: Number,
        ema21: Number,
        prevRsi14: Number,
        prevEma9: Number,
        prevEma21: Number,
        latestSignals: {
            oversoldRecovery: {
                type: Boolean,
                default: false
            },
            goldenCross: {
                type: Boolean,
                default: false
            },
            trendCooling: {
                type: Boolean,
                default: false
            },
            stateLabel: {
                type: String,
                enum: ['momentum_rising', 'trend_cooling', 'neutral'],
                default: 'neutral'
            }
        },
        updatedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false }
    }
);

module.exports = mongoose.model('SignalStateDaily', signalStateDailySchema);
