const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

function formatBangladeshTime(value) {
    const date = value ? new Date(value) : new Date();

    return new Intl.DateTimeFormat('en-BD', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).format(date);
}

async function callTelegramApi(method, payload = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
    }

    try {
        const response = await axios.post(`${TELEGRAM_API_URL}/${method}`, payload, {
            timeout: 15000
        });

        if (!response.data?.ok) {
            return { ok: false, error: response.data?.description || 'Telegram API error' };
        }

        return { ok: true, data: response.data.result };
    } catch (error) {
        return {
            ok: false,
            error: error.response?.data?.description || error.message || 'Telegram request failed'
        };
    }
}

function formatNotificationMessage(notification) {
    const symbolLine = notification.symbol ? `📊 Stock: <b>${notification.symbol}</b>\n` : '';
    return `
🔔 <b>${notification.title}</b>

${symbolLine}${notification.message}

🕐 Time (BDT): ${formatBangladeshTime(notification.createdAt)}
    `.trim();
}

async function sendTelegramText(chatId, text) {
    return callTelegramApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
    });
}

async function getTelegramBotProfile() {
    return callTelegramApi('getMe');
}

async function getTelegramWebhookInfo() {
    return callTelegramApi('getWebhookInfo');
}

async function registerTelegramWebhook(options) {
    const { webhookUrl, secretToken } = options;

    if (!webhookUrl) {
        return { ok: false, error: 'Webhook URL is required' };
    }

    return callTelegramApi('setWebhook', {
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message', 'edited_message']
    });
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
    getTelegramBotProfile,
    getTelegramWebhookInfo,
    registerTelegramWebhook,
    sendTelegramNotification,
    sendTelegramText,
    formatNotificationMessage
};
