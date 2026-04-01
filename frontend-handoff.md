# Frontend Handoff

This document describes the backend contract the frontend repo should implement against.

## Overview

The backend now supports all of the following:

- phone-number login using OTP
- JWT-authenticated API access
- real-time WebSocket notifications during an active session
- user-scoped alerts, portfolio, watchlist, and notification center
- Telegram linking through secure deep-link tokens
- smart volume alerts for portfolio and watchlist stocks
- best-entry insight scoring for portfolio and watchlist stocks
- legacy market-data widgets and search APIs

## Phase 1 and 2 Rollout Note

- New signal-pulse and depth-pressure capabilities are being implemented behind backend feature flags.
- Current frontend contract remains valid until the new endpoints are explicitly enabled.
- This document will be updated incrementally as each new endpoint is released.
- Internal backend groundwork completed so far includes symbol-universe expansion and historical/depth persistence scaffolding; no frontend changes are required for these internal updates.
- Gated endpoints now available in backend (if flags are enabled):
  - `GET /api/insights/signal-pulse`
  - `GET /api/market/depth-pressure`
  - `GET /api/market/depth-pressure/:symbol`
- Operational note: `GET /api/health` now includes phase12 worker status details for monitoring.

Frontend QA quick checks when flags are enabled:

- run backend tests with `npm test`
- run backend staging dry-run with `npm run phase12:dry-run`
- trigger one-shot backend cycles if needed using `npm run phase12:run-cycle -- --cycle=all|historical|signal|depth`
- verify `GET /api/insights/signal-pulse` returns `timeframe: daily`
- verify `GET /api/market/depth-pressure` returns `threshold` and `data`
- verify `depth_pressure.updated` websocket events appear for logged-in users when depth updates are emitted

Ops tuning note:

- phase12 logging volume can be tuned using `PHASE12_LOG_SAMPLE_RATE` and `PHASE12_LOG_INCLUDE_PAYLOADS`.
- the backend now exposes a runtime toggle for the 2-minute depth monitor so the frontend can stop the polling worker when needed.

Backend test coverage note:

- `npm test` now includes phase12 notification-flow assertions for depth and signal event paths.

## Integration Assumptions

- backend base URL defaults to `http://localhost:5000` in local development
- WebSocket URL should be derived from the backend base URL and use the same host
- all authenticated REST requests must send the bearer token
- WebSocket connection should exist only while the user is logged in
- the frontend should treat the authenticated phone number as the current user identity and must not send a separate `userId`

Backend implementation note:

- market scraper internals are now envelope-based with backward-compatible parsing in the backend; frontend REST and WebSocket contracts remain unchanged.

## Authentication Flow

### 1. Request OTP

`POST /api/auth/request-otp`

Request body:

```json
{
  "phoneNumber": "+8801XXXXXXXXX"
}
```

Response:

```json
{
  "message": "OTP generated successfully",
  "phoneNumber": "+8801XXXXXXXXX",
  "expiresInSeconds": 300,
  "devOtp": "123456"
}
```

Notes:

- `devOtp` is only returned outside production.
- Production should use a real SMS provider instead of console OTP delivery.

### 2. Verify OTP

`POST /api/auth/verify-otp`

Request body:

```json
{
  "phoneNumber": "+8801XXXXXXXXX",
  "otp": "123456"
}
```

Response:

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
      "relativeVolumeLookbackDays": 5,
      "depthPressureAlertsEnabled": true,
      "depthPressureThreshold": 3,
      "signalPulseAlertsEnabled": true,
      "signalPulseTimeframe": "daily"
    }
  },
  "websocket": {
    "path": "/ws",
    "requiresTokenQuery": true
  }
}
```

### 3. Fetch Current Session

`GET /api/auth/me`

Use this on app bootstrap if a token already exists.

### 4. Logout

`POST /api/auth/logout`

Expected frontend behavior:

- call logout API
- close the WebSocket connection immediately on the client
- clear local auth state

## Phase12 Worker Control

Use these authenticated endpoints to drive a frontend toggle for the 2-minute depth-pressure worker.

### `GET /api/phase12/depth-monitor`

Returns the current runtime state:

```json
{
  "depthMonitor": {
    "configuredEnabled": true,
    "runtimeEnabled": true,
    "effectiveEnabled": true,
    "intervalActive": true,
    "persistedEnabled": true
  },
  "marketWindow": {
    "timezone": "Asia/Dhaka",
    "open": "10:00",
    "close": "14:30",
    "isWithinWindowNow": true
  },
  "lastDepthCycleAt": "2026-04-01T09:14:00.000Z",
  "lastDepthStats": {}
}
```

### `PATCH /api/phase12/depth-monitor`

Request body:

```json
{
  "enabled": false
}
```

Behavior:

- `enabled: false` stops the live 2-minute interval immediately
- `enabled: true` starts the live 2-minute interval again if the backend env flag still allows depth monitoring
- the toggle is persisted in MongoDB and survives backend restarts
- if the backend was deployed with `PHASE12_ENABLE_DEPTH_MONITOR=false`, enabling returns `409`

Frontend implementation note:

- load the current state on settings/admin screen mount
- bind the switch to `depthMonitor.runtimeEnabled`
- optimistic UI is safe, but reconcile with the response payload because `configuredEnabled` can block re-enable

### `GET /api/phase12/alert-monitor`

Returns runtime state for the legacy alert monitor worker (manual alerts + smart volume alerts).

Response includes:

- `alertMonitor.configuredEnabled`
- `alertMonitor.runtimeEnabled`
- `alertMonitor.effectiveEnabled`
- `alertMonitor.intervalActive`
- `alertMonitor.isMonitoring`
- `alertMonitor.persistedEnabled`

### `PATCH /api/phase12/alert-monitor`

Request body:

```json
{
  "enabled": false
}
```

Behavior:

- `enabled: false` stops the legacy 2-minute alert monitor interval immediately
- `enabled: true` restarts it if backend config allows it
- state is persisted and reused after restart
- enabling returns `409` if alert monitor is disabled by server config

## WebSocket Contract

### Connect

Open a socket after successful login:

`ws(s)://<backend-host>/ws?token=<jwt>`

### Server Events

#### `connection.ready`

```json
{
  "event": "connection.ready",
  "data": {
    "phoneNumber": "+8801XXXXXXXXX"
  }
}
```

#### `notification.created`

```json
{
  "event": "notification.created",
  "data": {
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
}
```

#### `depth_pressure.updated` (feature-flagged)

```json
{
  "event": "depth_pressure.updated",
  "data": {
    "symbol": "BRACBANK",
    "buyPressureRatio": 3.42,
    "totalBids": 125000,
    "totalAsks": 36500,
    "signal": "bullishPressure",
    "snapshotAt": "..."
  }
}
```

### Frontend Socket Rules

- connect once after auth success
- reconnect after refresh if token still exists
- disconnect on logout
- display new notifications in real time
- increment unread count optimistically when `notification.created` arrives
- if the socket disconnects unexpectedly, use bounded retry with backoff while the auth token is still valid

## Market Data APIs

These are public and remain available for dashboard and search screens.

### `GET /api/live`

Query params:

- `page`
- `limit`

Response includes:

- `data`
- `alerts` which is currently always an empty array
- `pagination`
- `cacheInfo`

Important note:

- frontend must not depend on `/api/live` for user alert delivery anymore

### `GET /api/live/:symbol`

Returns one live stock object.

### `GET /api/search`

Query param:

- `q`

Returns up to 20 live symbol matches.

### `GET /api/market/top-movers`

Query param:

- `limit`

Returns:

- `gainers`
- `losers`
- `cacheInfo`

### `GET /api/market/advance-decline`

Returns:

- `advances`
- `declines`
- `unchanged`
- `total`
- `validTotal`
- `skipped`
- `advanceDeclineRatio`
- `marketSentiment`
- `cacheInfo`

### `GET /api/market/depth-pressure` (feature-flagged)

Notes:

- requires auth
- available only when backend enables `PHASE12_ENABLE_DEPTH_API=true`
- optional query params:
  - `symbols` comma-separated list
  - `limit` default 30, max 100

### `GET /api/market/depth-pressure/:symbol` (feature-flagged)

Notes:

- requires auth
- returns latest depth pressure snapshot for one symbol

## Notification Center APIs

### List notifications

`GET /api/notifications?status=unread&page=1&limit=25`

### Unread count

`GET /api/notifications/unread-count`

Response:

```json
{
  "unreadCount": 3
}
```

### Mark one notification read

`PATCH /api/notifications/:id/read`

### Mark all notifications read

`PATCH /api/notifications/read-all`

### Delete one notification

`DELETE /api/notifications/:id`

- Returns 404 if notification does not belong to the user
- Returns `{ message: "Notification deleted" }`

### Delete all notifications

`DELETE /api/notifications`

- Returns `{ message: "All notifications deleted", deletedCount: <number> }`

### Notification types currently used

- `alert_triggered`
- `high_volume_trade`
- `relative_volume_trade`
- `entry_signal`
- `order_book_pressure`
- `signal_pulse`
- `system`

### Suggested frontend handling by type

- `alert_triggered`: show stock, condition, and current value
- `high_volume_trade`: emphasize current volume versus fixed threshold
- `relative_volume_trade`: emphasize current multiple versus historical average
- `entry_signal`: present reasons, cautions, and suggested entry zone
- `order_book_pressure`: show buy/sell pressure direction, ratio, and bid/ask totals
- `signal_pulse`: show signal kind (oversold recovery, golden cross, trend cooling) with RSI/EMA context
- `system`: show generic platform-level updates

## User Settings API

### Update settings

`PATCH /api/me/settings`

Supported body fields:

```json
{
  "websocketEnabled": true,
  "telegramEnabled": true,
  "portfolioVolumeAlertsEnabled": true,
  "watchlistVolumeAlertsEnabled": true,
  "fixedVolumeThreshold": 500000,
  "relativeVolumeMultiplier": 2.2,
  "relativeVolumeLookbackDays": 5,
  "depthPressureAlertsEnabled": true,
  "depthPressureThreshold": 3,
  "signalPulseAlertsEnabled": true,
  "signalPulseTimeframe": "daily"
}
```

## Alerts API

All alert routes are authenticated and user-scoped.

### Create alert

`POST /api/alerts`

Request body:

```json
{
  "symbol": "BRACBANK",
  "alertType": "price_above",
  "threshold": 52.5,
  "lookbackDays": 5,
  "cooldownSeconds": 300
}
```

Supported `alertType` values:

- `price_above`
- `price_below`
- `change_percent`
- `volume_above`
- `relative_volume_above`

### Read alerts

- `GET /api/alerts`
- `GET /api/alerts/symbol/:symbol`

### Update alert

`PUT /api/alerts/:id`

### Delete alert

`DELETE /api/alerts/:id`

## Watchlist API

- `POST /api/watchlist`
- `GET /api/watchlist`
- `DELETE /api/watchlist/:symbol`

Request body for create:

```json
{
  "symbol": "BRACBANK"
}
```

## Portfolio API

- `POST /api/portfolio`
- `GET /api/portfolio`
- `GET /api/portfolio/with-pnl`
- `PUT /api/portfolio/:id`
- `DELETE /api/portfolio/:id`

Create body:

```json
{
  "symbol": "BRACBANK",
  "quantity": 100,
  "buyPrice": 48.5,
  "notes": "Swing position"
}
```

## Telegram Linking Flow

### 1. Fetch current status

`GET /api/telegram/status`

### 2. Generate a secure link token

`POST /api/telegram/link-token`

Response:

```json
{
  "linkToken": "...",
  "expiresAt": "...",
  "botUsername": "your_bot_username",
  "deepLinkUrl": "https://t.me/your_bot_username?start=<token>"
}
```

### Frontend UX

- show a `Connect Telegram` button
- call `/api/telegram/link-token`
- open `deepLinkUrl`
- after user presses Start in Telegram, poll `GET /api/telegram/status` or refresh the profile state
- show a short warning that Telegram cannot be linked by phone number alone and the user must press Start in the bot

### Unlink Telegram

`DELETE /api/telegram/link`

## Insights APIs

### Best entry signals

`GET /api/insights/entry-signals`

Response shape:

```json
{
  "generatedAt": "...",
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

### Volume context for one symbol

`GET /api/insights/volume-context/:symbol`

### Signal pulse (feature-flagged)

`GET /api/insights/signal-pulse`

Notes:

- available only when backend enables `PHASE12_ENABLE_SIGNAL_API=true`
- optional query params:
  - `symbols` comma-separated list
  - `limit` default 50, max 200

## Frontend Screens To Build

### 1. Auth

- phone input screen
- OTP verification screen
- token persistence
- session rehydrate using `GET /api/auth/me`

### 2. Live market dashboard

- paginated live ticker view
- symbol search
- single-stock details view
- top movers widget
- advance-decline widget

### 3. Notification center

- unread badge
- notification list with filtering
- mark read and mark all read
- real-time toast or banner on `notification.created`

### 4. Alerts

- alert list
- create alert form
- edit and delete actions
- support for volume-based alert types

### 5. Portfolio and watchlist

- full CRUD flows
- live P and L view for portfolio
- watchlist management

### 6. Telegram settings

- linked or unlinked state
- connect button
- unlink action
- short explanation that the user must press Start in Telegram

### 7. Investor insights

- best-entry cards or ranked table
- reasons and cautions per symbol
- volume context mini panel

### 8. User settings

- enable or disable Telegram notifications
- enable or disable portfolio or watchlist volume alerts
- enable or disable the phase12 2-minute depth monitor using `GET /api/phase12/depth-monitor` and `PATCH /api/phase12/depth-monitor`
- enable or disable the legacy 2-minute alert monitor using `GET /api/phase12/alert-monitor` and `PATCH /api/phase12/alert-monitor`
- set fixed volume threshold
- set relative volume multiplier and lookback days
- show current depth worker status using `depthMonitor.runtimeEnabled`, `depthMonitor.intervalActive`, and `depthMonitor.configuredEnabled`
- show current legacy alert worker status using `alertMonitor.runtimeEnabled`, `alertMonitor.intervalActive`, and `alertMonitor.configuredEnabled`

## Suggested Frontend State Shape

Recommended client-side state domains:

- auth
- websocket connection status
- live market data
- market widgets
- notifications list and unread count
- alerts
- watchlist
- portfolio
- insights
- telegram link status
- user settings
- phase12 worker control

This separation keeps the real-time notification path from leaking into unrelated screens.

## Breaking Changes From Previous Backend

- portfolio, watchlist, alert, and notification routes are now authenticated
- old `userId` query and body ownership flow is replaced by authenticated phone-number identity
- `/api/live` no longer returns cross-user triggered alerts in the response
- Telegram linking is no longer a raw `chatId` form flow; it now uses a secure deep link
- the historical tick endpoint remains removed

## Telegram Setup Checklist

The frontend team does not implement this directly, but the user flow depends on it.

- create a Telegram bot in BotFather
- set `TELEGRAM_BOT_TOKEN`
- set `TELEGRAM_BOT_USERNAME`
- expose the backend webhook publicly
- register the webhook URL with the secret token header
- ensure users tap the deep link and press Start

## Handoff Summary

Frontend should treat this backend as an authenticated, user-scoped API. The biggest behavioral shift is that notifications are now real-time and session-bound: login should establish the socket, logout should close it, and all portfolio, watchlist, alert, and notification operations should be driven from the authenticated phone-number user context rather than sending a separate `userId`.

## Frontend Implementation Checklist

- use `GET /api/auth/me` on app boot to restore session and user settings
- open the websocket only after auth is restored and close it immediately on logout
- consume `notification.created` for real-time notification UI updates
- if enabled in backend, consume `depth_pressure.updated` for live depth-pressure refreshes
- add settings UI for `depthPressureAlertsEnabled`, `depthPressureThreshold`, `signalPulseAlertsEnabled`, and `signalPulseTimeframe`
- add signal pulse UI backed by `GET /api/insights/signal-pulse`
- add depth pressure list and symbol detail UI backed by `GET /api/market/depth-pressure` and `GET /api/market/depth-pressure/:symbol`
- add a runtime toggle UI for the 2-minute depth worker using `GET /api/phase12/depth-monitor` and `PATCH /api/phase12/depth-monitor`
- add a runtime toggle UI for the legacy 2-minute alert worker using `GET /api/phase12/alert-monitor` and `PATCH /api/phase12/alert-monitor`
- when rendering the depth worker toggle, use `depthMonitor.runtimeEnabled` as the switch value and show disabled or blocked state if `depthMonitor.configuredEnabled` is false
- when rendering the legacy alert worker toggle, use `alertMonitor.runtimeEnabled` as the switch value and show disabled or blocked state if `alertMonitor.configuredEnabled` is false
- do not depend on `/api/live` for triggered alerts or notification delivery