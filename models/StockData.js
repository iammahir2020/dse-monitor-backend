const mongoose = require('mongoose');

// Flexible schema to handle any fields from DSE data
const stockDataSchema = new mongoose.Schema(
    {},
    { 
        strict: false,
        timestamps: false
    }
);

// Index for efficient querying
stockDataSchema.index({ symbol: 1, timestamp: -1 });

module.exports = mongoose.models.StockData || mongoose.model('StockData', stockDataSchema);