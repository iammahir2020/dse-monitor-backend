const mongoose = require('mongoose');

const depthLevelSchema = new mongoose.Schema(
    {
        price: Number,
        quantity: Number,
        orders: Number
    },
    { _id: false }
);

const depthSnapshotSchema = new mongoose.Schema(
    {
        symbol: {
            type: String,
            required: true,
            uppercase: true,
            index: true
        },
        snapshotAt: {
            type: Date,
            required: true,
            index: true
        },
        bids: {
            type: [depthLevelSchema],
            default: []
        },
        asks: {
            type: [depthLevelSchema],
            default: []
        },
        totalBids: {
            type: Number,
            default: 0
        },
        totalAsks: {
            type: Number,
            default: 0
        },
        buyPressureRatio: {
            type: Number,
            default: 0
        },
        source: {
            type: String,
            default: 'bdshare'
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false }
    }
);

depthSnapshotSchema.index({ symbol: 1, snapshotAt: -1 });

const retentionDays = Number(process.env.DEPTH_SNAPSHOT_RETENTION_DAYS || 7);
if (Number.isFinite(retentionDays) && retentionDays > 0) {
    depthSnapshotSchema.index(
        { createdAt: 1 },
        { expireAfterSeconds: Math.round(retentionDays * 24 * 60 * 60) }
    );
}

module.exports = mongoose.model('DepthSnapshot', depthSnapshotSchema);
