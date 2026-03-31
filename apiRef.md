## API Reference

This document describes the currently implemented backend contract.

## Architecture Notes

- Live stock data is not persisted to MongoDB.
- Live market data is fetched through the Python scraper and stored in a shared in-memory cache.
- Compact daily summaries are stored in MongoDB for lightweight historical analysis.
- User-owned data is scoped by authenticated phone-number identity.
- Most user workflows now require a JWT bearer token.

## Authentication

### `POST /api/auth/request-otp`

Request a login OTP for a phone number.

- Auth: public
- Body:

```json
{
  "phoneNumber": "+8801XXXXXXXXX"
}
```

- Response:

```json
{
  "message": "OTP generated successfully",
  "phoneNumber": "+8801XXXXXXXXX",
  "expiresInSeconds": 300,
  "devOtp": "123456"
}
```

- Notes:
  - `devOtp` is returned only outside production.
  - OTP delivery currently uses console output unless an SMS provider is added.

### `POST /api/auth/verify-otp`

Verify the OTP and start a session.

- Auth: public
- Body:

```json
{
  "phoneNumber": "+8801XXXXXXXXX",
  "otp": "123456"
}
```

- Response:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "...",
    "phoneNumber": "+8801XXXXXXXXX",
    "displayName": null,
    "telegramLinked": false,
    "telegramUsername": null,
    "telegramLinkedAt": null,
    "notificationSettings": {
      "websocketEnabled": true,
      "telegramEnabled": true,
      "portfolioVolumeAlertsEnabled": true,
      "watchlistVolumeAlertsEnabled": true,
      "fixedVolumeThreshold": null,
      "relativeVolumeMultiplier": 2,
      "relativeVolumeLookbackDays": 5
    }
  },
  "websocket": {
    "path": "/ws",
    "requiresTokenQuery": true
  }
}
```

### `POST /api/auth/logout`

Logout the current user and disconnect active WebSocket sessions.

- Auth: bearer token required
- Response:

```json
{
  "message": "Logged out successfully",
  "disconnectedSockets": 1
}
```

### `GET /api/auth/me`

Return the current authenticated user profile and socket connection hint.

- Auth: bearer token required
- Response:

```json
{
  "user": {
    "id": "...",
    "phoneNumber": "+8801XXXXXXXXX",
    "displayName": null,
    "telegramLinked": true,
    "telegramUsername": "sample_user",
    "telegramLinkedAt": "2026-03-31T07:00:00.000Z",
    "notificationSettings": {}
  },
  "websocket": {
    "path": "/ws",
    "requiresTokenQuery": true
  }
}
```

### `PATCH /api/me/settings`

Update user notification settings.

- Auth: bearer token required
- Body: any subset of

```json
{
  "websocketEnabled": true,
  "telegramEnabled": true,
  "portfolioVolumeAlertsEnabled": true,
  "watchlistVolumeAlertsEnabled": true,
  "fixedVolumeThreshold": 500000,
  "relativeVolumeMultiplier": 2.2,
  "relativeVolumeLookbackDays": 5
}
```

- Response:

```json
{
  "user": {
    "id": "...",
    "phoneNumber": "+8801XXXXXXXXX",
    "notificationSettings": {}
  }
}
```

## Market Data

### `GET /api/live`

Fetch paginated live market data.

- Auth: public
- Query params:
  - `page` default `1`
  - `limit` default `50`, max `100`
- Behavior:
  - forces a fresh scraper fetch
  - updates the in-memory cache
  - does not persist live ticks to MongoDB
  - no longer returns user-specific triggered alerts in this response path
- Response:

```json
{
  "data": [ ...paginatedStocks ],
  "alerts": [],
  "pagination": {
    "currentPage": 1,
    "pageSize": 50,
    "totalRecords": 396,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  },
  "cacheInfo": {
    "recordCount": 396,
    "lastFetched": "2026-03-31T07:21:55.000Z",
    "ageSeconds": 0
  }
}
```

### `GET /api/live/:symbol`

Fetch live data for one stock symbol.

- Auth: public
- URL params:
  - `symbol` case-insensitive stock symbol
- Errors:
  - `404` if symbol is not present in live data

### `GET /api/search`

Search symbols from live cache.

- Auth: public
- Query params:
  - `q` search term
- Behavior:
  - case-insensitive substring search after uppercasing
  - returns up to 20 results

### `GET /api/market/top-movers`

Return top gainers and losers by percentage change from open.

- Auth: public
- Query params:
  - `limit` default `10`, max `10`
- Response:

```json
{
  "gainers": [ ...stocksWithChangePercent ],
  "losers": [ ...stocksWithChangePercent ],
  "cacheInfo": {
    "recordCount": 396,
    "lastFetched": "...",
    "ageSeconds": 45
  }
}
```

### `GET /api/market/advance-decline`

Return market breadth and simple sentiment.

- Auth: public
- Response:

```json
{
  "advances": 210,
  "declines": 150,
  "unchanged": 20,
  "total": 396,
  "validTotal": 380,
  "skipped": 16,
  "advanceDeclineRatio": "1.40",
  "marketSentiment": "Bullish",
  "cacheInfo": {
    "recordCount": 396,
    "lastFetched": "...",
    "ageSeconds": 45
  }
}
```

### `GET /api/history/:symbol`

Removed.

- Historical full tick storage is no longer part of the system.
- The current historical strategy uses lightweight daily summaries internally for analytics.

## Notifications

### `GET /api/notifications`

List notifications for the current user.

- Auth: bearer token required
- Query params:
  - `status` optional: `unread`, `read`, `archived`
  - `page` default `1`
  - `limit` default `25`, max `100`
- Response:

```json
{
  "data": [
    {
      "id": "...",
      "userPhoneNumber": "+8801XXXXXXXXX",
      "type": "alert_triggered",
      "source": "manual_alert",
      "symbol": "BRACBANK",
      "title": "BRACBANK alert triggered",
      "message": "Price moved above your threshold...",
      "status": "unread",
      "payload": {},
      "delivery": {},
      "createdAt": "...",
      "updatedAt": "...",
      "readAt": null
    }
  ],
  "pagination": {
    "currentPage": 1,
    "pageSize": 25,
    "totalRecords": 3,
    "totalPages": 1
  }
}
```

### `GET /api/notifications/unread-count`

Return unread notification count.

- Auth: bearer token required
- Response:

```json
{
  "unreadCount": 3
}
```

### `PATCH /api/notifications/read-all`

Mark all current-user notifications as read.

- Auth: bearer token required
- Response:

```json
{
  "message": "All notifications marked as read"
}
```

### `PATCH /api/notifications/:id/read`

Mark one notification as read.

- Auth: bearer token required
- Errors:
  - `404` if notification does not belong to the user or does not exist

## Alerts

All alert routes are user-scoped and authenticated.

### Supported alert types

- `price_above`
- `price_below`
- `change_percent`
- `volume_above`
- `relative_volume_above`

### `POST /api/alerts`

Create an alert.

- Auth: bearer token required
- Body:

```json
{
  "symbol": "BRACBANK",
  "alertType": "price_above",
  "threshold": 52.5,
  "lookbackDays": 5,
  "cooldownSeconds": 300
}
```

### `GET /api/alerts`

List current-user alerts.

- Auth: bearer token required

### `GET /api/alerts/symbol/:symbol`

List current-user alerts for one symbol.

- Auth: bearer token required

### `PUT /api/alerts/:id`

Update a current-user alert.

- Auth: bearer token required
- Body: any subset of

```json
{
  "threshold": 55,
  "alertType": "relative_volume_above",
  "isActive": false,
  "lookbackDays": 10,
  "cooldownSeconds": 600
}
```

### `DELETE /api/alerts/:id`

Delete a current-user alert.

- Auth: bearer token required

## Watchlist

### `POST /api/watchlist`

Add or upsert a symbol in the current user watchlist.

- Auth: bearer token required
- Body:

```json
{
  "symbol": "BRACBANK"
}
```

### `GET /api/watchlist`

List current-user watchlist items.

- Auth: bearer token required

### `DELETE /api/watchlist/:symbol`

Remove a symbol from current-user watchlist.

- Auth: bearer token required

## Portfolio

### `POST /api/portfolio`

Create a holding.

- Auth: bearer token required
- Body:

```json
{
  "symbol": "BRACBANK",
  "quantity": 100,
  "buyPrice": 48.5,
  "notes": "Swing position"
}
```

### `GET /api/portfolio`

List current-user holdings.

- Auth: bearer token required

### `GET /api/portfolio/with-pnl`

List holdings enriched with live unrealized P and L data.

- Auth: bearer token required
- Response fields include:
  - `currentPrice`
  - `costBasis`
  - `currentValue`
  - `unrealizedPnL`
  - `pnlPercentage`

### `PUT /api/portfolio/:id`

Update a current-user holding.

- Auth: bearer token required
- Body: any subset of

```json
{
  "quantity": 150,
  "buyPrice": 47,
  "notes": "Updated note"
}
```

### `DELETE /api/portfolio/:id`

Delete a current-user holding.

- Auth: bearer token required

## Telegram

### `GET /api/telegram/status`

Return Telegram link status for the current user.

- Auth: bearer token required
- Response:

```json
{
  "linked": true,
  "telegramUsername": "sample_user",
  "linkedAt": "2026-03-31T07:00:00.000Z",
  "botUsername": "your_bot_username"
}
```

### `POST /api/telegram/link-token`

Generate a secure deep-link token for Telegram account linking.

- Auth: bearer token required
- Response:

```json
{
  "linkToken": "...",
  "expiresAt": "2026-03-31T07:15:00.000Z",
  "botUsername": "your_bot_username",
  "deepLinkUrl": "https://t.me/your_bot_username?start=<token>"
}
```

### `DELETE /api/telegram/link`

Unlink the current user's Telegram account.

- Auth: bearer token required
- Response:

```json
{
  "message": "Telegram account unlinked successfully"
}
```

### `POST /api/telegram/webhook`

Telegram bot webhook endpoint.

- Auth: webhook secret via header `x-telegram-bot-api-secret-token`
- Behavior:
  - `/start <token>` links Telegram to a user through a secure app-generated token
  - `/start` without token responds with linking instructions
  - `/help` returns command help
  - other messages return `{ "status": "ok" }`

## Insights

### `GET /api/insights/entry-signals`

Generate entry suggestions for the current user's portfolio and watchlist symbols.

- Auth: bearer token required
- Response:

```json
{
  "generatedAt": "2026-03-31T07:30:00.000Z",
  "data": [
    {
      "symbol": "BRACBANK",
      "sources": ["portfolio", "watchlist"],
      "score": 72,
      "confidence": "high",
      "recommendation": "good_entry",
      "currentPrice": 52.1,
      "entryZone": { "min": 50.8, "max": 51.82 },
      "stopLoss": 50.8,
      "targetPrice": 55.5,
      "riskRewardRatio": 1.9,
      "reasons": [],
      "cautions": [],
      "metrics": {}
    }
  ]
}
```

### `GET /api/insights/volume-context/:symbol`

Return live-versus-recent volume context for one symbol.

- Auth: bearer token required
- Response:

```json
{
  "symbol": "BRACBANK",
  "currentVolume": 550000,
  "averageRecentVolume": 240000,
  "recentDays": 5
}
```

## WebSocket

### `GET /ws?token=<jwt>`

WebSocket endpoint for real-time notifications during an active logged-in session.

- Auth: JWT passed in query string
- Server events:
  - `connection.ready`
  - `notification.created`

Example `connection.ready`:

```json
{
  "event": "connection.ready",
  "data": {
    "phoneNumber": "+8801XXXXXXXXX"
  }
}
```

Example `notification.created`:

```json
{
  "event": "notification.created",
  "data": {
    "id": "...",
    "type": "alert_triggered",
    "symbol": "BRACBANK",
    "title": "BRACBANK alert triggered"
  }
}
```

## Background Services

### Alert Monitor

Internal service, not an HTTP endpoint.

- Starts automatically after MongoDB connection
- Runs every 2 minutes
- Forces fresh live-data fetches
- Records compact daily summaries
- Evaluates manual user alerts
- Evaluates smart volume conditions for portfolio and watchlist symbols
- Creates in-app notifications
- Pushes notifications over WebSocket when sessions are active
- Sends Telegram notifications to linked users when enabled

## Breaking Changes From Older Backend

- User-owned routes are now authenticated and scoped by phone number rather than `userId`
- Telegram linking no longer accepts raw chat IDs from the app
- `/api/live` is no longer an alert-triggering response surface for user notifications
- Historical tick API remains removed in favor of compact daily summaries