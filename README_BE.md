# DSE Monitor Backend

Backend service for live DSE market data, phone-number login, investor alerts, notifications, Telegram delivery, and entry-signal insights.

## Stack

- Node.js 20
- Express
- MongoDB with Mongoose
- WebSocket via `ws`
- Python scraper for DSE market data

## Features

- OTP login with phone number
- JWT-authenticated API
- WebSocket notifications during active web sessions
- User-scoped alerts, portfolio, watchlist, and notification center
- Telegram linking through secure deep links
- Smart volume alerts for portfolio and watchlist symbols
- Compact daily summaries for lightweight historical analysis
- Rule-based entry signals for investor decision support

## Prerequisites

- Node.js 20
- npm
- Python 3
- MongoDB connection string
- Python packages required by the scraper

Recommended Python packages:

```bash
pip install numpy bdshare
```

## Node Version

This repo is pinned to Node 20 via `.nvmrc` and `package.json` engines.

If you use `nvm`:

```bash
nvm use
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values.

Required variables:

```env
MONGODB_URI=
FRONTEND_URL=http://localhost:5173
PORT=5000
JWT_SECRET=
JWT_EXPIRES_IN=7d
OTP_EXPIRY_MINUTES=5
SMS_PROVIDER=console
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_LINK_EXPIRY_MINUTES=15
```

Notes:

- `SMS_PROVIDER=console` means OTPs are logged to the backend console in development.
- `FRONTEND_URL` supports comma-separated origins.
- Telegram variables are required if you want Telegram linking and delivery.

## Install Dependencies

```bash
nvm use
npm install
```

## Ways To Run

### 1. Development mode

Uses `nodemon` for auto-restart.

```bash
nvm use
npm run dev
```

### 2. Standard run

```bash
nvm use
npm start
```

### 3. Background run in a server environment

Use your preferred process manager. Example with `nohup`:

```bash
nvm use
nohup npm start > backend.log 2>&1 &
```

For production, a real process manager like `pm2` or systemd is a better choice.

## Local Development Flow

### 1. Start the backend

```bash
nvm use
npm run dev
```

### 2. Request OTP

Call:

```http
POST /api/auth/request-otp
```

Body:

```json
{
  "phoneNumber": "+8801XXXXXXXXX"
}
```

In development, the response includes `devOtp`, and the same OTP is also logged to the backend console.

### 3. Verify OTP

Call:

```http
POST /api/auth/verify-otp
```

Body:

```json
{
  "phoneNumber": "+8801XXXXXXXXX",
  "otp": "123456"
}
```

Store the returned JWT on the frontend and open the WebSocket using the same token.

### 4. Open the WebSocket

Example URL:

```text
ws://localhost:5000/ws?token=<jwt>
```

### 5. Use authenticated APIs

Send:

```text
Authorization: Bearer <jwt>
```

## Telegram Setup

### What you need to do

1. Create a Telegram bot using BotFather.
2. Save the bot token in `TELEGRAM_BOT_TOKEN`.
3. Save the bot username in `TELEGRAM_BOT_USERNAME`.
4. Set `TELEGRAM_WEBHOOK_SECRET`.
5. Expose your backend publicly.
6. Register the webhook to Telegram.

### Development option with ngrok

Start ngrok on your backend port:

```bash
ngrok http 5000
```

Use the public HTTPS URL to register Telegram webhook.

### Register the Telegram webhook

Example request:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-public-host>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

### User linking flow

1. User logs in with phone number.
2. Frontend calls `POST /api/telegram/link-token`.
3. Frontend opens the returned `deepLinkUrl`.
4. User presses Start in Telegram.
5. Telegram webhook links the Telegram chat to the phone-number user.

## Important API Groups

### Auth

- `POST /api/auth/request-otp`
- `POST /api/auth/verify-otp`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Notifications

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`

### Alerts

- `POST /api/alerts`
- `GET /api/alerts`
- `GET /api/alerts/symbol/:symbol`
- `PUT /api/alerts/:id`
- `DELETE /api/alerts/:id`

### Portfolio

- `POST /api/portfolio`
- `GET /api/portfolio`
- `GET /api/portfolio/with-pnl`
- `PUT /api/portfolio/:id`
- `DELETE /api/portfolio/:id`

### Watchlist

- `POST /api/watchlist`
- `GET /api/watchlist`
- `DELETE /api/watchlist/:symbol`

### Insights

- `GET /api/insights/entry-signals`
- `GET /api/insights/volume-context/:symbol`

## Operational Notes

- The alert monitor starts automatically after MongoDB connection.
- It fetches fresh live data every 2 minutes.
- Daily summary storage is intentionally compact to avoid MongoDB bloat.
- OTP is still development-grade until a real SMS provider is integrated.

## Frontend Integration

See `frontend-handoff.md` for the full frontend contract, event model, and UI expectations.
