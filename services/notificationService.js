const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitToUser } = require('./websocketService');
const { sendTelegramNotification } = require('./telegramService');

function serializeNotification(notification) {
    return {
        id: String(notification._id),
        userPhoneNumber: notification.userPhoneNumber,
        type: notification.type,
        source: notification.source,
        symbol: notification.symbol,
        title: notification.title,
        message: notification.message,
        status: notification.status,
        payload: notification.payload,
        delivery: notification.delivery,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
        readAt: notification.readAt
    };
}

async function createNotification(options) {
    const {
        userPhoneNumber,
        type,
        source,
        symbol = null,
        title,
        message,
        payload = {},
        dedupeKey = null,
        cooldownMs = 0,
        sendTelegram = true
    } = options;

    if (dedupeKey && cooldownMs > 0) {
        const existingNotification = await Notification.findOne({
            userPhoneNumber,
            dedupeKey,
            createdAt: { $gte: new Date(Date.now() - cooldownMs) }
        });

        if (existingNotification) {
            return {
                notification: serializeNotification(existingNotification),
                deduplicated: true
            };
        }
    }

    const notification = await Notification.create({
        userPhoneNumber,
        type,
        source,
        symbol,
        title,
        message,
        payload,
        dedupeKey
    });

    const deliveredSockets = emitToUser(userPhoneNumber, 'notification.created', serializeNotification(notification));

    if (deliveredSockets > 0) {
        notification.delivery = {
            ...notification.delivery,
            websocketDeliveredAt: new Date()
        };
    }

    if (sendTelegram) {
        const user = await User.findOne({ phoneNumber: userPhoneNumber });
        const telegramResult = await sendTelegramNotification(user, notification);

        notification.delivery = {
            ...notification.delivery,
            ...(telegramResult.ok
                ? { telegramDeliveredAt: new Date(), telegramError: undefined }
                : { telegramError: telegramResult.error })
        };
    }

    await notification.save();

    return {
        notification: serializeNotification(notification),
        deduplicated: false
    };
}

async function markNotificationRead(notificationId, userPhoneNumber) {
    const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, userPhoneNumber },
        { status: 'read', readAt: new Date() },
        { new: true }
    );

    return notification ? serializeNotification(notification) : null;
}

async function markAllNotificationsRead(userPhoneNumber) {
    await Notification.updateMany(
        { userPhoneNumber, status: 'unread' },
        { status: 'read', readAt: new Date() }
    );
}

module.exports = {
    createNotification,
    serializeNotification,
    markNotificationRead,
    markAllNotificationsRead
};