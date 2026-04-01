# Phase 1 + Phase 2 Execution Board

Date: 2026-04-01
Source Spec: phase1-phase2-spec.md
Execution Mode: safety-first, feature-flagged rollout

## 1. Delivery Strategy
- Track A: Foundations and safety rails
- Track B: Data models and ingestion
- Track C: Indicators and signal APIs
- Track D: Depth pressure and alerts
- Track E: rollout hardening and observability

Parallelization rule:
- Tracks B and C can run in parallel after Track A ticket A3 is done.
- Track D starts after B2 and A4.

## 2. Feature Flags and Safe Defaults
- PHASE12_ENABLE_HIST_SYNC=true
- PHASE12_ENABLE_SIGNAL_MONITOR=true
- PHASE12_ENABLE_DEPTH_MONITOR=true
- PHASE12_ENABLE_SIGNAL_API=false in first deploy
- PHASE12_ENABLE_DEPTH_API=false in first deploy
- PHASE12_ENABLE_SIGNAL_NOTIFICATIONS=true
- PHASE12_ENABLE_DEPTH_NOTIFICATIONS=true

Rollback rules:
- Any worker error spike: disable only the affected worker flag.
- Existing APIs and old alert monitor remain active at all times.

## 3. Dependency-Ordered Ticket List

### A. Foundations

1. A1: Pin Python dependencies
- Scope:
  - update scraper/requirements.txt with pinned versions for bdshare and numpy
- Output:
  - deterministic dependency file
- Done when:
  - install step succeeds in a clean environment
- Risk:
  - low

2. A2: Scraper contract v2 with BDShareError handling
- Scope:
  - refactor scraper/get_data.py to return strict success and failure payload contracts
  - preserve NaN/Inf normalization
  - structured stderr logs only
- Output:
  - stable JSON contract with ok flag and metadata
- Done when:
  - Node parser can parse success and failure payload deterministically
- Risk:
  - medium

3. A3: Node-side parser compatibility shim
- Scope:
  - update services/liveDataCache.js to accept both legacy array payload and v2 object payload
  - add contract validation and fallback logic
- Output:
  - backward-compatible parser
- Done when:
  - scraper v1 and v2 payloads both work
- Risk:
  - medium

4. A4: Shared symbol-universe builder
- Scope:
  - create service utility that merges:
    - watchlist symbols
    - portfolio symbols
    - configured global symbol list
  - dedupe and uppercase normalize
- Output:
  - reusable buildSymbolUniverse() function
- Done when:
  - returns stable sorted list and logs counts by source
- Risk:
  - low

### B. Data Models and Ingestion

5. B1: Add HistoricalBarDaily model
- Scope:
  - create models/HistoricalBarDaily.js
  - indexes: unique symbol+tradeDate, tradeDate desc
- Output:
  - production-safe model with indexes
- Done when:
  - model loads and indexes build without conflicts
- Risk:
  - medium

6. B2: Historical ingestion service
- Scope:
  - create services/historicalIngestionService.js
  - fetch daily OHLCV for symbol universe
  - upsert by symbol+tradeDate
- Output:
  - runHistoricalIngestionCycle() function
- Done when:
  - 30-day bars inserted for sampled symbols
- Risk:
  - medium

7. B3: Add DepthSnapshot model
- Scope:
  - create models/DepthSnapshot.js
  - fields for bids, asks, totals, ratio, snapshotAt
  - optional TTL index for retention
- Output:
  - depth snapshot persistence model
- Done when:
  - model stores sample snapshots for test symbols
- Risk:
  - medium

### C. Indicators and Signal APIs

8. C1: Indicator math service
- Scope:
  - create services/indicatorService.js
  - implement EMA and RSI functions
  - transition detection for oversoldRecovery, goldenCross, trendCooling
- Output:
  - pure functions + tests
- Done when:
  - unit tests pass on known fixtures
- Risk:
  - medium

9. C2: Add SignalStateDaily model
- Scope:
  - create models/SignalStateDaily.js
  - store previous and current values and signals
- Output:
  - model with unique symbol index
- Done when:
  - upserts successful for sample symbols
- Risk:
  - low

10. C3: Signal refresh cycle
- Scope:
  - create services/signalPulseService.js
  - compute indicators from HistoricalBarDaily
  - upsert SignalStateDaily
- Output:
  - runSignalRefreshCycle() function
- Done when:
  - signal states generated for 95%+ scoped symbols with enough history
- Risk:
  - medium

11. C4: Signal pulse API endpoint
- Scope:
  - add GET /api/insights/signal-pulse
  - auth required
  - query filtering and limits
- Output:
  - endpoint with contract from spec
- Done when:
  - integration tests pass
- Risk:
  - low

### D. Depth Pressure and Alerts

12. D1: Depth pressure service
- Scope:
  - create services/depthPressureService.js
  - fetch depth per symbol
  - normalize rows and compute ratio
  - persist snapshot
- Output:
  - runDepthPressureCycle() function
- Done when:
  - snapshots generated and ratio computed for sample symbols
- Risk:
  - medium-high

13. D2: Depth pressure APIs
- Scope:
  - add GET /api/market/depth-pressure
  - add GET /api/market/depth-pressure/:symbol
- Output:
  - authenticated API contracts
- Done when:
  - endpoint contract tests pass
- Risk:
  - low

14. D3: Notification schema extension
- Scope:
  - extend models/Notification.js enums with:
    - type: order_book_pressure, signal_pulse
    - source: depth_pressure, signal_pulse
- Output:
  - schema supports new event classes
- Done when:
  - createNotification accepts and stores new values
- Risk:
  - medium

15. D4: User settings extension
- Scope:
  - extend models/User.js notificationSettings:
    - depthPressureAlertsEnabled default true
    - depthPressureThreshold default 3.0
    - signalPulseAlertsEnabled default true
    - signalPulseTimeframe default daily
  - extend server.js sanitizeNotificationSettings
- Output:
  - settings available via existing settings route
- Done when:
  - settings read/write tests pass
- Risk:
  - medium

16. D5: Pressure and signal notification emitters
- Scope:
  - create services/phase12NotificationService.js or extend existing flow
  - add dedupe keys and cooldown rules
  - include bullish and bearish direction
- Output:
  - automated notifications with current channels
- Done when:
  - duplicate suppression verified in tests
- Risk:
  - medium

17. D6: Optional websocket event emission
- Scope:
  - emit depth pressure updates using existing websocket infra
  - event name: depth_pressure.updated
- Output:
  - near-real-time push for active sessions
- Done when:
  - websocket clients receive updates for monitored symbols
- Risk:
  - low

### E. Scheduling, Observability, and Rollout

18. E1: Phase12 monitor orchestrator
- Scope:
  - create services/phase12Monitor.js
  - schedule:
    - historical sync every 6h
    - signal refresh every 30m during market hours, else every 6h
    - depth pressure every 2m during market hours
  - market window: 10:00-14:30 Asia/Dhaka
- Output:
  - start and stop lifecycle hooks
- Done when:
  - monitor starts cleanly and logs cycle summaries
- Risk:
  - medium

19. E2: Health endpoint extension
- Scope:
  - extend /api/health with phase12 status summary
- Output:
  - health payload includes worker states
- Done when:
  - health response shows cycle timestamps and counts
- Risk:
  - low

20. E3: Structured logging and error dashboards
- Scope:
  - add consistent log schema for all cycles
  - include duration, symbolCount, successCount, failureCount
- Output:
  - searchable logs and alertable error patterns
- Done when:
  - staging run produces complete structured logs for one session
- Risk:
  - low

## 4. PR Slicing Plan

PR-1 Foundations
- A1, A2, A3
- Goal: safe scraper contract and parser compatibility

PR-2 Models Core
- B1, B3, C2
- Goal: persistence layer ready

PR-3 Historical + Indicators
- B2, C1, C3
- Goal: data and signal generation ready

PR-4 Signal API + Settings
- C4, D4
- Goal: user-facing signal endpoint and defaults

PR-5 Depth Engine + APIs
- D1, D2
- Goal: depth pressure computation and read APIs

PR-6 Notifications + Websocket
- D3, D5, D6
- Goal: alert delivery complete for phase features

PR-7 Orchestration + Health + Logs
- E1, E2, E3
- Goal: operational readiness and rollout controls

## 5. Test Gates per PR
- PR-1 gate:
  - scraper returns valid success and failure envelopes
  - legacy Node parsing still works
- PR-2 gate:
  - index creation validated locally
- PR-3 gate:
  - indicator fixture tests pass
  - historical upserts idempotent
- PR-4 gate:
  - endpoint auth and payload contract tests pass
- PR-5 gate:
  - depth API responses stable under partial failures
- PR-6 gate:
  - dedupe and cooldown tests pass for bullish and bearish
- PR-7 gate:
  - scheduler behaves correctly around market window boundaries

## 6. Operational Limits
- max symbols per depth cycle: 150 default
- max symbols per historical cycle: 500 default
- per-symbol depth fetch timeout: 4s
- per-cycle hard timeout: 90s depth, 300s historical
- retry policy: max 2 retries on transient failures

## 7. Deployment Runbook
1. Deploy PR-1 and PR-2 first with all new feature flags off.
2. Deploy PR-3 and run one historical backfill cycle in staging.
3. Deploy PR-4 and validate endpoint contracts from staging frontend.
4. Deploy PR-5 and enable depth monitor for broad universe in staging.
5. Deploy PR-6 and verify notification volume plus dedupe behavior.
6. Deploy PR-7 and monitor one full market session.
7. Production canary for 10% user traffic, then full rollout.

## 8. Existing Logic Improvements Using Additional bdshare Methods
1. Improve top movers quality
- Prefer bdshare top movers method as a secondary source to validate calculated movers from live cache.

2. Improve market breadth context
- Pull market summary and sector performance periodically and expose as optional context in existing market endpoints.

3. Improve symbol validation
- Use trading code list refresh daily and reject invalid symbols on watchlist and portfolio writes.

4. Improve signal confidence
- Add optional PSN and corporate-news tag in signal payload when symbol has relevant same-day announcements.

5. Improve alert precision
- Gate volume-based alerts with depth pressure confirmation where available to reduce false positives.

## 9. Ready-to-Start Ticket Queue
Start immediately in this exact order:
1. A1
2. A2
3. A3
4. A4
5. B1
6. B2
7. C1
8. C2
9. C3
10. C4
11. D1
12. D2
13. D3
14. D4
15. D5
16. D6
17. E1
18. E2
19. E3

## 10. Implementation Progress

Completed in current branch:
- A1, A2, A3, A4
- B1, B2, B3
- C1, C2, C3, C4
- D1, D2, D3, D4, D5, D6
- E1, E2, E3

Pending:
- production dashboard and alert rule tuning in deployed observability stack
