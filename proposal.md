# DSE Live Monitor and Investor Alert Platform

This document summarizes the current product state, architectural direction, and the next phases of work for the backend.

## Product Goal

Build a Dhaka Stock Exchange monitoring platform that helps investors act with discipline by combining:

- live market visibility
- user-specific alerts
- real-time web notifications
- Telegram delivery
- portfolio and watchlist intelligence
- simple, explainable entry suggestions

## Current Backend State

The backend has moved from a single-user alert tool into a user-aware investor platform.

### Implemented Foundations

- Phone-number-based identity using OTP login
- JWT-authenticated API access
- WebSocket session support for logged-in users
- User-scoped watchlist, portfolio, alert, and notification data
- Telegram linking through secure deep-link tokens
- Compact daily historical summaries instead of bulky raw tick storage

### Implemented Market Data Features

- Live DSE market data fetched through the Python scraper
- Shared in-memory live cache with forced refresh support
- Symbol search
- Top gainers and losers by percentage change
- Advance-decline market breadth and sentiment
- Live single-symbol lookup

### Implemented Alerting Features

- Manual alerts for:
  - price above
  - price below
  - percentage change
  - fixed volume above threshold
  - relative volume above average multiple
- Background alert monitor running every 2 minutes
- User-specific in-app notifications stored in MongoDB
- WebSocket push to active logged-in frontend sessions
- Telegram push notifications for linked users
- Cooldown handling to reduce duplicate notifications

### Implemented Investor Features

- Portfolio CRUD
- Watchlist CRUD
- Live unrealized profit and loss view
- Smart volume alerts for portfolio and watchlist symbols
- Entry-signal scoring for portfolio and watchlist symbols using:
  - moving-average trend checks
  - support and resistance proximity
  - relative volume confirmation
  - simple risk-reward estimation

## Current Architecture

### Identity and Session Model

- Users are identified by normalized phone number
- OTP is used for login verification
- Verified login returns a JWT
- Frontend opens a WebSocket using the active JWT
- Logout closes active sockets for that user

### Notification Model

Each triggered event can be delivered through three channels:

- persisted in-app notification
- live WebSocket push to the web session
- Telegram message if linked and enabled

### Historical Data Strategy

To avoid unnecessary MongoDB growth, the system does not store raw market ticks. Instead, it stores compact daily summaries per symbol with only the fields needed for analytics:

- open
- high
- low
- close
- volume
- trade value when available
- last snapshot time

This is enough to support volume comparisons and first-pass entry logic while keeping storage lean.

## Product Value for Investors

The current product direction is centered on practical decision support rather than noisy signal spam.

### What the platform already helps with

- tracking personally relevant stocks only
- reacting to price or volume conditions in real time
- getting web and Telegram alerts tied to the actual user
- checking whether a stock is showing healthier entry characteristics
- managing a small portfolio with live mark-to-market visibility

### Why the current approach is useful

- alerts are user-specific instead of global
- volume-based alerts catch activity spikes often missed by price-only rules
- entry signals are rule-based and explainable, which is more suitable than black-box predictions at this stage
- compact daily summaries reduce infrastructure cost and complexity

## Near-Term Roadmap

### Phase 1: Frontend Integration

Goal: expose the newly implemented backend capabilities in the separate frontend repo.

Deliverables:

- phone OTP login flow
- token persistence and logout flow
- WebSocket notification client
- notification center UI
- Telegram connect screen
- portfolio and watchlist management wired to authenticated APIs
- entry-signal dashboard

### Phase 2: Notification Quality Improvements

Goal: make alerts more useful and less noisy.

Planned items:

- user notification preferences by alert category
- daily digest and market-close summary
- severity or confidence labels on alerts
- portfolio-impact notifications, for example large move on a holding

### Phase 3: Investor Intelligence

Goal: improve the quality of entry and monitoring decisions.

Planned items:

- support and resistance history improvements
- breakout and pullback classification
- risk tags such as overextended move or weak volume confirmation
- position concentration and exposure warnings
- personal investment thesis and stop-loss note tracking

### Phase 4: Production Hardening

Goal: make the platform operationally safer.

Planned items:

- real SMS provider for OTP delivery
- token refresh or session lifecycle hardening
- background job observability and error reporting
- environment-specific webhook automation
- test coverage for auth, notifications, and alert evaluation logic

## Known Constraints

- The backend now expects Node 20.
- OTP delivery currently uses console output unless an SMS provider is integrated.
- Telegram messaging requires users to press Start on the bot using the secure deep link.
- Entry signals are intentionally heuristic and should be treated as decision support, not guaranteed trade advice.

## Success Criteria

The backend direction is successful if it provides all of the following reliably:

- one user can log in with phone and receive only their own alerts
- the frontend receives instant notifications over WebSocket while logged in
- Telegram linking works without manual chat ID entry
- investors can track portfolio and watchlist names with meaningful volume-based intelligence
- the system can generate lightweight, explainable entry suggestions without bloating MongoDB

## Related Documents

- `frontend-handoff.md` for frontend integration details
- `README.md` for local run instructions and environment setup