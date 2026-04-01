const mongoose = require('mongoose');

const phase12ControlSchema = new mongoose.Schema(
    {
        singletonKey: {
            type: String,
            required: true,
            unique: true,
            default: 'primary'
        },
        depthMonitorEnabled: {
            type: Boolean,
            default: true
        },
        alertMonitorEnabled: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('Phase12Control', phase12ControlSchema);