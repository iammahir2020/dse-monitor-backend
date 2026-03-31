const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
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
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    buyPrice: {
        type: Number,
        required: true,
        min: 0
    },
    purchaseDate: {
        type: Date,
        default: Date.now
    },
    notes: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Compound index for user holdings
portfolioSchema.index({ userPhoneNumber: 1, symbol: 1 });

module.exports = mongoose.model('Portfolio', portfolioSchema);
