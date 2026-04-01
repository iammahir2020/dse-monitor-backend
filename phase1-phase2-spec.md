# DSE Monitor Backend
## Concrete Implementation Spec for Phase 1 and Phase 2

Date: 2026-04-01
Owner: Backend Team
Status: Draft for approval

## 1) Objective
Deliver Phase 1 and Phase 2 together in one release train:
- Phase 1: Data and scraper hardening plus historical baseline infrastructure and technical signal endpoint.
- Phase 2: Order book pressure pipeline and alerts for scoped symbols.

This spec is scoped to the current backend architecture (Node.js + MongoDB + Python scraper + bdshare).

## 2) In Scope
### Phase 1
- Harden Python scraper error handling and output contract.
- Add deterministic scraper metadata to all responses.
- Add historical OHLCV ingestion worker using bdshare historical methods.
- Add technical indicators (RSI 14, EMA 9, EMA 21) service for daily timeframe.
- Add insights API for signal pulse (daily mode).
- Pin Python dependencies for predictable deployments.

### Phase 2
- Add market depth ingestion for a broader symbol set (watchlist and portfolio union per user plus configured global symbol universe).
- Compute buy pressure ratio from top order book rows.
- Add depth pressure API.
- Add pressure-triggered notifications using existing notification delivery channels.
- Add optional websocket live event for pressure updates.

## 3) Out of Scope
- NAV ingestion and NAV discount analytics (separate external NAV source required).
- Full market-wide intraday candle engine at 1-minute resolution.
- Frontend implementation details.

## 4) Current Baseline and Constraints
- Live data currently uses one scraper call for current trades.
- Alert monitor cycles every 2 minutes.
- Daily summary is stored, but no dedicated intraday bars collection exists.
- Notification infrastructure is already in place and supports dedupe plus cooldown.
- bdshare supports historical OHLCV and order book depth.

## 5) Functional Requirements
### FR-1 Scraper output contract hardening
Python scraper response must return a stable JSON shape:
- success payload:
  - ok: true
  - source: bdshare
  - function: get_current_trade_data
  - fetchedAt: ISO timestamp
  - rowCount: integer
  - data: array of rows
  - warnings: array
- failure payload:
  - ok: false
  - source: bdshare
  - function: get_current_trade_data
  - fetchedAt: ISO timestamp
  - errorType: BDShareError or InternalError
  - errorMessage: string

### FR-2 Historical OHLCV ingestion
Add scheduled ingestion for symbol universe:
- Base universe: distinct symbols from all user watchlists and portfolios.
- Broader extension: required configurable static symbol list (global universe) enabled in production.
- Fetch daily OHLCV using bdshare historical API.
- Upsert by symbol plus tradeDate.

### FR-3 Technical signal pulse (daily mode)
For each scoped symbol compute:
- RSI 14 from close prices.
- EMA 9 and EMA 21 from close prices.
- Signal states:
  - oversoldRecovery when RSI crosses from below 30 to above 30.
  - goldenCross when EMA 9 crosses above EMA 21.
  - trendCooling when EMA 9 crosses below EMA 21.

### FR-4 Depth pressure engine
For scoped symbols fetch order book depth and compute:
- totalBids as sum of top bid quantities.
- totalAsks as sum of top ask quantities.
- buyPressureRatio = totalBids / max(totalAsks, 1).
- signal:
  - bullishPressure if ratio >= threshold (default 3.0).
  - bearishPressure if inverse ratio >= threshold (default 3.0).

### FR-5 Alerts and delivery
- Create pressure notifications with existing dedupe and cooldown behavior.
- Support websocket emission and Telegram delivery through existing flow.
- Enable signal pulse and depth pressure alerts by default for newly created users.

## 6) Non-Functional Requirements
- Reliability: worker failures must not crash the API process.
- Idempotency: all ingestion writes use upsert semantics.
- Performance: apply bounded broad-universe fetch with adaptive batching and interval guards.
- Observability: structured logs for each worker cycle.
- Backward compatibility: existing APIs continue to work unchanged.

## 7) Data Model Changes
### 7.1 New collection: HistoricalBarDaily
Fields:
- symbol: string, uppercase, indexed
- tradeDate: date, indexed
- open: number
- high: number
- low: number
- close: number
- volume: number
- source: string default bdshare
- fetchedAt: date
- createdAt, updatedAt

Indexes:
- unique index on symbol + tradeDate
- index on tradeDate descending

### 7.2 New collection: DepthSnapshot
Fields:
- symbol: string, uppercase, indexed
- snapshotAt: date, indexed
- bids: array of objects { price, quantity, orders optional }
- asks: array of objects { price, quantity, orders optional }
- totalBids: number
- totalAsks: number
- buyPressureRatio: number
- source: string default bdshare
- createdAt

Indexes:
- index on symbol + snapshotAt descending
- optional TTL index for retention (for example 7 days)

### 7.3 New collection: SignalStateDaily
Fields:
- symbol: string, uppercase, unique index
- lastDate: date
- rsi14: number
- ema9: number
- ema21: number
- prevRsi14: number
- prevEma9: number
- prevEma21: number
- latestSignals: object
- updatedAt

## 8) Service Layer Design
### 8.1 Python scraper module changes
File target: scraper/get_data.py
- Replace generic exception-first pattern with BDShareError-aware handling.
- Return strict payload contract described in FR-1.
- Keep NaN and inf normalization.

### 8.2 Node service additions
- services/historicalIngestionService.js
  - buildSymbolUniverse()
  - fetchHistorical(symbol, startDate, endDate)
  - upsertDailyBars(symbol, rows)
- services/indicatorService.js
  - computeEma(series, period)
  - computeRsi(series, period=14)
  - detectSignalTransitions(prevState, currState)
- services/depthPressureService.js
  - fetchDepth(symbol)
  - normalizeDepthRows(df)
  - computePressure(snapshot)
  - persistDepthSnapshot(symbol, payload)
- services/phase12Monitor.js
  - orchestrates scheduled cycles for historical sync, signal refresh, depth pressure checks

## 9) API Specification
### 9.1 GET /api/insights/signal-pulse
Auth: required
Query params:
- symbols optional comma-separated
- sourceScope optional values: watchlist, portfolio, both default both
- limit optional default 50 max 200

Response:
- generatedAt: ISO datetime
- timeframe: daily
- data: array of
  - symbol
  - rsi14
  - ema9
  - ema21
  - signals object
    - oversoldRecovery boolean
    - goldenCross boolean
    - trendCooling boolean
  - stateLabel string values momentum_rising, trend_cooling, neutral
  - updatedAt

### 9.2 GET /api/market/depth-pressure
Auth: required
Query params:
- symbols optional comma-separated
- limit optional default 30 max 100

Response:
- generatedAt
- threshold
- data array
  - symbol
  - buyPressureRatio
  - totalBids
  - totalAsks
  - signal bullishPressure, bearishPressure, neutral
  - snapshotAt

### 9.3 GET /api/market/depth-pressure/:symbol
Auth: required
Response:
- symbol
- snapshotAt
- topBids
- topAsks
- totalBids
- totalAsks
- buyPressureRatio
- signal

## 10) Alerting Rules
### 10.1 Pressure notification rule
Condition:
- bullish trigger when buyPressureRatio >= userThreshold
- bearish trigger when buyPressureRatio <= 1 / userThreshold
Defaults:
- userThreshold default 3.0
- cooldown default 15 minutes
Dedupe key:
- pressure:userPhone:symbol:direction
Notification type proposal:
- order_book_pressure
Notification source proposal:
- depth_pressure
Direction policy:
- Both bullish and bearish are enabled in v1.

### 10.2 Signal pulse notification rule optional toggle
Condition:
- oversoldRecovery true OR goldenCross true OR trendCooling true
Defaults:
- cooldown default 4 hours per symbol per signal class

## 11) Settings Contract Changes
Add to user notification settings:
- depthPressureAlertsEnabled boolean default true
- depthPressureThreshold number default 3.0
- signalPulseAlertsEnabled boolean default true
- signalPulseTimeframe string default daily

Validation rules:
- depthPressureThreshold minimum 1.2 maximum 10

## 12) Worker Cadence and Scheduling
- historical ingestion: every 6 hours and on service startup.
- signal refresh daily mode: every 30 minutes during market hours, every 6 hours otherwise.
- depth pressure: every 2 minutes during market window only.

Market window config:
- timezone Asia/Dhaka
- start and end configurable via env
Resolved production defaults:
- start 10:00
- end 14:30

## 13) Environment Variables
New env keys:
- BD_MARKET_TIMEZONE default Asia/Dhaka
- BD_MARKET_OPEN default 10:00
- BD_MARKET_CLOSE default 14:30
- DEPTH_PRESSURE_THRESHOLD default 3.0
- DEPTH_SNAPSHOT_RETENTION_DAYS default 7
- PHASE12_ENABLE_DEPTH_MONITOR default true
- PHASE12_ENABLE_SIGNAL_MONITOR default true
- PHASE12_ENABLE_HIST_SYNC default true

## 14) Observability and Logging
Each worker cycle logs:
- cycleType
- startedAt
- durationMs
- symbolCount
- successCount
- failureCount
- retryCount
- topErrors

Expose health diagnostics extension:
- GET /api/health includes phase12 worker status summary

## 15) Rollout Plan
### Step 1
- Deploy data models and services behind feature flags.
- Keep all new endpoints disabled.

### Step 2
- Enable historical sync plus signal refresh in staging.
- Verify indicator values on 20 sample symbols.

### Step 3
- Enable depth monitor for configured broad-symbol scope in staging.
- Validate pressure ratio and notification cooldown behavior.

### Step 4
- Production canary rollout for 10 percent users.
- Observe error rate and latency for 2 market sessions.

### Step 5
- Full rollout.

## 16) Acceptance Criteria
### AC-1 Scraper contract
- API layer can parse scraper output deterministically for both success and failure paths.

### AC-2 Historical ingestion
- At least 95 percent of scoped symbols have upserted bars for last 30 trade days within first 24 hours.

### AC-3 Signal endpoint
- /api/insights/signal-pulse returns valid values for scoped symbols with no server errors in normal conditions.

### AC-4 Depth pressure endpoint
- /api/market/depth-pressure returns snapshots and pressure signal for monitored symbols during market window.

### AC-5 Notifications
- Pressure notifications are deduplicated and respect cooldown.

### AC-6 Backward compatibility
- Existing live, alerts, notifications, watchlist, portfolio routes remain unchanged.

## 17) Risks and Mitigations
- Risk: bdshare upstream HTML shape changes.
  - Mitigation: strict schema validation and fallback logging.
- Risk: excessive depth fetch load.
  - Mitigation: scoped broader universe list, batch fetch scheduling, market-hours-only execution, and backpressure.
- Risk: stale caches between Python and Node.
  - Mitigation: define cache authority and include fetchedAt in payload.

## 18) Decisions Finalized
- Symbol scope: broader universe enabled (watchlist and portfolio union plus configured global symbol list).
- Alert defaults: signal pulse and depth pressure alerts enabled by default.
- Pressure direction: bullish plus bearish enabled in v1.
- Market window: 10:00 to 14:30 Asia/Dhaka.

## 19) Existing Logic Safety Guardrails
- Keep existing routes and payloads untouched for:
  - live feed
  - alerts CRUD
  - notifications
  - watchlist
  - portfolio
- Run new workers in isolated try/catch boundaries so they cannot interrupt existing alert monitor cycles.
- Use feature flags for each new worker and each new endpoint to allow rapid rollback.
- Use separate notification types and sources for new features to prevent collisions with existing dedupe keys.
- Keep existing alert monitor interval unchanged until Phase 1 and 2 metrics pass in staging.
- Add hard limits:
  - max symbols per cycle
  - max depth fetch retries per cycle
  - cycle timeout with partial-progress commit

## 20) Existing Logic Improvements Using Additional bdshare Methods
1. Historical quality upgrade
- Use historical OHLCV to improve existing relative-volume logic by replacing short lookback-only daily summary averages with longer symbol-specific baselines.

2. Better market context for current endpoints
- Use market summary and top movers methods to enrich market sentiment and mover endpoints with stronger context when available.

3. Depth-informed alert filtering
- Combine volume spikes with order book pressure to reduce false positives in high-volume but weak-demand situations.

4. News-aware confidence scoring
- Use price-sensitive and corporate announcements as an optional confidence modifier for signal pulse and pressure alerts.

5. Symbol universe hygiene
- Use trading code list to validate watchlist and portfolio symbol inputs and avoid stale or invalid symbols.

6. Failure handling consistency
- Standardize scraper errors around BDShareError categories to improve retry policy and operational dashboards.

## 21) Delivery Breakdown
Estimated engineering effort for combined Phase 1 plus 2:
- Data models and migrations: 1 to 2 days
- Services and worker orchestration: 3 to 5 days
- APIs and settings integration: 2 to 3 days
- Testing and stabilization: 2 to 3 days
Total: 8 to 13 engineering days

## 22) Test Plan Summary
- Unit tests:
  - indicator math and cross detection
  - pressure ratio calculation and edge cases
  - scraper payload contract parser
- Integration tests:
  - worker cycles with mocked bdshare responses
  - endpoint responses and auth behavior
  - notification dedupe and cooldown
- Smoke tests:
  - staging market session run with structured logs and no crash loops

## 23) Execution Board Reference
Implementation ticket sequencing, PR slicing, and rollout runbook are documented in:
- phase1-phase2-execution-board.md
