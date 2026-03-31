const mongoose = require('mongoose');

const otpChallengeSchema = new mongoose.Schema(
    {
        phoneNumber: {
            type: String,
            required: true,
            index: true
        },
        purpose: {
            type: String,
            required: true,
            default: 'login'
        },
        codeHash: {
            type: String,
            required: true
        },
        expiresAt: {
            type: Date,
            required: true
        },
        attemptsRemaining: {
            type: Number,
            default: 5,
            min: 0
        }
    },
    {
        timestamps: true
    }
);

otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpChallenge', otpChallengeSchema);