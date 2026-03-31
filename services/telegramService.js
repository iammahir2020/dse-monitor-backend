const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
function formatNotificationMessage(notification) {
    const symbolLine = notification.symbol ? `📊 Stock: <b>${notification.symbol}</b>\n` : '';
    return `
🔔 <b>${notification.title}</b>

${symbolLine}${notification.message}

🕐 Time: ${new Date(notification.createdAt || Date.now()).toLocaleString()}
    `.trim();
}

async function sendTelegramText(chatId, text) {
    if (!TELEGRAM_BOT_TOKEN) {
        return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
    }

    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
    });

    if (!response.data.ok) {
        return { ok: false, error: response.data.description || 'Telegram API error' };
    }

    return { ok: true };
}

async function sendTelegramNotification(user, notification) {
    try {
        if (!user?.telegramChatId) {
            return { ok: false, error: 'User has no linked Telegram chat' };
        }

        if (user.notificationSettings?.telegramEnabled === false) {
            return { ok: false, error: 'Telegram notifications disabled for user' };
        }

        return await sendTelegramText(user.telegramChatId, formatNotificationMessage(notification));

    } catch (error) {
        console.error('❌ Error sending Telegram notification:', error.message);
        return { ok: false, error: error.message };
    }
}

module.exports = {
    sendTelegramNotification,
    sendTelegramText,
    formatNotificationMessage
};
