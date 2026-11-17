# Restore London Strategic Edge compatibility with LSE Data 3.0

Status: approved by maintainer on 2026-11-16; implementation complete, PR validation in progress.

## Why

Live checks on 2026-11-16 found that OC's financial-report endpoint returns HTTP 410. The configured credential also fails both legacy candles and v3 authentication. Replacing the key alone cannot restore financial statements. See [validation.md](./validation.md) for evidence and limitations.

## Proposed change

Restore the existing statements and history capabilities through `https://download.londonstrategicedge.com/v3`, preserving OC's provider order and tool contracts.

- Replace `/vault/ref/financial_reports` with a bounded, per-symbol reference CSV export. Parse native columns and embedded statement data, filter annual periods and report types locally, and join matching fiscal dates. Fetch once per symbol instead of three parallel exports: v3 permits one download per key. Capture authenticated response fixtures before finalizing field mappings.
- Replace legacy candles with bounded candle exports, explicitly requesting split adjustment. Map `time` to OC timestamps, resolve supported market/symbol identities, preserve requested date/order/limit semantics, and validate OHLCV. A ten-row preview must never count as complete deep-range history. Handle export limits and any documented asynchronous response without returning partial success.
- Replace the monthly 50 GiB meter with v3 usage semantics: the free plan currently has 12.5 GiB per week, daily row limits, and 60 calls/minute. Honor server reset times, serialize downloads, acquire the existing rate limiter on retries, and bound request/retry waits. Old monthly exhaustion must not disable a new weekly allowance.
- Read structured `code`/`message` errors. Distinguish unknown credentials from account attachment, subscription, market access, quota, and endpoint retirement. Preserve fallback and stale-data disclosure.
- Update onboarding validation, doctor diagnostics, signup links, and docs. Extend the hosted relay's exact host/path allowlist and needed response headers with security tests; keep API keys in headers and retain proxy transport because v3 disallows cross-site browser calls.
- Document LSE's derived-price provenance and per-user licence. Keep official exchange feeds and organizational/redistribution rights separate from personal free-tier access.

## Non-goals

No new provider, paid subscription, order-book/Level 3 tools, options/macro expansion, system-prompt or analyst changes, or SQLite schema changes. Broader datasets can be considered after compatibility is restored.

## Acceptance

With an account-associated v3 key, statements and intraday/deep daily history work through the actual tools in local and hosted runtimes. Unknown keys, refused plans, retired routes, quotas, malformed files, and insufficient history fail explicitly and preserve available fallbacks. Use failing-first fixture tests, live TUI/browser verification, full gates, and repo autoreview before shipping.
