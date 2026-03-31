const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    userPhoneNumber: {
        type: String,
        required: true,
        index: true
    },
    symbol: {
        type: String,
        required: true,
        uppercase: true
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
});

// Compound index to prevent duplicates
watchlistSchema.index({ userPhoneNumber: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model('Watchlist', watchlistSchema);
