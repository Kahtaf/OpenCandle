## Context

OpenCandle's providers follow a consistent shape: a verb-prefixed async function that uses `httpGet` from `src/infra/http-client.ts`, acquires a token from the shared `rateLimiter`, caches results with a TTL and stale-fallback window, and is invoked from tools through `wrapProvider` / `withFallback` (circuit breaker + structured `ProviderResult`). Yahoo is our quote/history/options backbone but is per-symbol, crumb-authenticated, and rate-limit-fragile under continuous polling.

TradingView's scanner backend is a single generic POST grammar (`scan2`) that powers their web screener and quote widgets. It is undocumented but widely reverse-engineered. Research established three load-bearing facts that shape this design: (1) only the anonymous `scan2` *data* path is keyless and stable — the options/greeks and real-time paths require desktop-app cookies or login and are out of scope; (2) the response is column-compressed and the wire field order can drift, so decoding must be position-by-name from the response `fields[]`; (3) the endpoint's strength is request economy (one POST returns hundreds of symbols), so a batch-first usage pattern keeps us well under any rate limit and is the whole reason to prefer it over a Yahoo fan-out.

## Goals / Non-Goals

**Goals:**
- Add a keyless TradingView scanner provider with two entry points: `screenStocks(opts)` (filter/sort/paginate) and `getQuotes(symbols)` (batch snapshot).
- Expose screening to the agent via a new `screen_stocks` tool.
- Make `watchlist check` use a single batch quote with graceful Yahoo fallback.
- Harden against the realistic failure mode (field/symbol drift) via position-based decoding, missing-column tolerance, and a fixture shape-guard test.
- Keep usage batch-first, read-only, conservatively paced, and attributed; surface the delayed/unofficial-data caveat to users.

**Non-Goals:**
- Options chains with greeks/IV (the `finance-skills` path needs TradingView **desktop-app** cookies via CDP — heavyweight, fragile, untestable our way).
- Real-time/streaming data or the login websocket (CAPTCHA / account-flagging prone).
- Historical OHLC candles — `scan2` is a current snapshot; Yahoo `getHistory` remains the time-series source.
- Replacing Yahoo for single-symbol quotes, history, or options.
- Any login, cookie harvesting, browser automation, or API key.
- A full typed mirror of all ~3,000 fields — we expose `columns` as caller-supplied strings with a curated default set and a documented reference, not an exhaustive enum.

## Decisions

### 1. Keyless `scan2` data path only — no desktop CDP, no login

**Decision**: The provider issues a plain JSON `POST` to `scanner.tradingview.com/{market}/scan2` with no auth, cookies, or browser. The options-greeks and real-time paths are explicitly excluded.

**Why**: The anonymous data endpoint is the only part that is both keyless and stable. The `himself65/finance-skills` options-chain adapter only works by harvesting cookies from the TradingView desktop app over CDP (port 9222) — that is a heavyweight runtime dependency, can't be unit-tested with fixtures, and contradicts our "no live API in unit tests / providers fetch+format" conventions. Excluding it keeps the provider a clean HTTP client.

### 2. Position-based decoding from response `fields[]`, never hard-coded indices

**Decision**: `decodeScannerRows(payload, requestedColumns)` builds row objects by zipping `payload.fields[i] → row.f[i]`. Because TradingView drops a requested column from the response `fields[]` when it has no value, the decoder takes the requested column list and backfills any column missing from `fields[]` as `null` on every row — so a pure zip can't leave `undefined` keys. (Pattern borrowed from `finance-skills`'s `scanner.js`, extended with the requested-column backfill.)

**Why**: Research showed the dominant TradingView break mode is field reordering / renaming, not endpoint death. Reading by name-from-response survives reordering, and backfilling missing requested columns survives a column being dropped or renamed — turning a hard crash (or silent `undefined`) into a degraded-but-functional `null`. This is the single most important resilience decision. The decoder must receive `requestedColumns` precisely because a value-less column is absent from the response, so the response alone cannot reveal that the caller asked for it.

**Guard**: A unit test feeds a fixture with shuffled `fields` order and a requested column omitted from the response, asserting correct mapping and an explicit `null` (not `undefined`) for the absent field.

### 3. `screenStocks` and `getQuotes` share one body builder and one fetch

**Decision**: `buildScannerBody(opts)` produces the `scan2` body for both modes — `getQuotes` passes `symbols.tickers: [...]` (explicit list, bypasses filter) against `global/scan2`; `screenStocks` passes `markets`, `filter`/`filter2`, `sort`, and `range` against `{market}/scan2`. Row count clamps to `[1, 500]`.

**Why**: Both are the same POST grammar; one builder + `scannerFetch(endpoint, body)` avoids duplication and matches how `finance-skills` factors it. Clamping to 500 reflects the server's effective page cap and keeps a single batch call sufficient for a 100–500 name watchlist.

### 4. Filter grammar exposed structurally, columns as strings

**Decision**: The `screen_stocks` tool accepts `filter` as an array of `{ field, op, value }` clauses (ops: `greater`, `egreater`, `less`, `eless`, `equal`, `nequal`, `in_range`, `crosses_above`, `crosses_below`, `above%`, `below%`, `match`) and `columns`/`sort` as strings with the `field|timeframe` convention (`RSI|60`). A curated `DEFAULT_COLUMNS` set is used when none are given.

**Why**: Mirrors the well-tested grammar from `shner-elmo/TradingView-Screener` and the `finance-skills` screener so we inherit a known-good operation set, while keeping the surface small. We do not enumerate all 3,000 fields as types — callers pass field strings; we ship a reference doc (borrowed from the wrapper catalogs) instead.

### 5. No credentials, no degradation tagging

**Decision**: Unlike Finnhub/Exa, the provider needs no key, so there is no `getConfig()` gating, no `ProviderCredentialError`, and no onboarding/`tool-tags` soft-degraded path.

**Why**: The endpoint is keyless. Adding credential plumbing would be dead code. The only optional config is an internal pacing constant.

### 6. Conservative rate limit + batch-first usage

**Decision**: `rateLimiter.configure("tradingview", 5, 1)` — burst 5, ~1 req/s sustained. The watchlist monitor and screener are batch calls (one POST per refresh), so real volume sits far below this.

**Why**: TradingView publishes no limit; the canonical wrapper warns of "potential bans" at high row counts and `tvscreener` suggests ~1s pacing. ~1 req/s is the community-safe norm and is ~60× the headroom a 1-call-per-minute watchlist needs. The advantage we are buying is request economy, not a high ceiling — so we pace conservatively and lean on `cache`.

### 7. Watchlist uses batch quote with Yahoo fallback

**Decision**: `watchlist check` calls `getQuotes(symbols)` once via TradingView, mapped into the existing item rendering, wrapped in `withFallback([{ provider: "tradingview", ... }, { provider: "yahoo", fn: per-symbol getQuote loop }])`. If TradingView returns empty/changes shape, the current Yahoo path runs unchanged.

**Why**: Directly removes the per-symbol fan-out (the Yahoo ban trigger) for the common case while guaranteeing no behavioral regression when TradingView is unavailable. Symbol→exchange resolution uses `buildTvSymbol`; watchlist symbols without a known exchange default to a `global/scan2` ticker query (TradingView resolves the primary listing).

### 8. Surface the delayed / unofficial-data caveat

**Decision**: `screen_stocks` output and the watchlist batch path annotate results as TradingView-sourced, potentially ~15-min delayed, and unofficial — using the same caveat-surfacing approach as our stale-quote flags, so the LLM reports it in the "Data gaps" / caveats section.

**Why**: Honesty requirement (AGENTS.md: flag what's missing; never overstate). Free-tier scanner data is delayed for most US exchanges and the endpoint is undocumented; users must not treat it as real-time or sanctioned.

## Risks / Trade-offs

- **[Undocumented / ToS-gray endpoint]** → Mitigate with batch-first, read-only, conservative pacing, caching, attribution, and a user-facing "unofficial, possibly delayed" caveat. We do not scrape pages or hammer per-symbol. Document that heavy programmatic use is against TradingView's ToS; this is a research/monitoring convenience, not a sanctioned feed.
- **[Field / symbol drift]** → Position-based decoding + null tolerance + fixture shape-guard test. Pin to `scan2`; budget roughly annual vigilance for a future format rev (the v3.0 `scan2` migration was Jan 2025). Realistic blast radius is "one column reads null," not "tool crashes."
- **[~15-min data delay on free tier]** → Acceptable for screening and swing/EOD watchlist alerts; explicitly surfaced. Not suitable for intraday/real-time triggers — out of scope and called out.
- **[Single-endpoint dependency]** → For quotes, Yahoo fallback exists. For screening there is no Yahoo equivalent, so on failure the tool degrades to a structured "unavailable" via `wrapProvider`, never fabricated data.
- **[Symbol/exchange ambiguity]** → `EXCH:SYM` mapping for known exchanges; unknown symbols fall back to a `global/scan2` ticker query that lets TradingView resolve the primary listing. Edge tickers may need an explicit exchange arg.
- **[Borrowed-code licensing]** → We reimplement in TypeScript and borrow grammar/catalog/approach, not source. Confirm each upstream license (finance-skills MIT, shner-elmo MIT) before copying any snippet; attribute in code comments where a non-trivial algorithm (e.g. OPRA parsing — not used here) is adapted.
- **[`screen_stocks` field misuse]** → Callers can pass an invalid field/op. The provider surfaces the scanner's error message (status + truncated body) rather than silently returning empty, so misuse is diagnosable.
