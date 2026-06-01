## Context

OpenCandle's providers follow a consistent shape: a verb-prefixed async function that uses `httpGet` from `src/infra/http-client.ts`, acquires a token from the shared `rateLimiter`, caches results with a TTL and stale-fallback window, and is invoked from tools through `wrapProvider` / `withFallback` (circuit breaker + structured `ProviderResult`). Yahoo is our quote/history/options backbone but is per-symbol, crumb-authenticated, and rate-limit-fragile under continuous polling.

TradingView's scanner backend is a single generic POST grammar (`scan2`) that powers their web screener and quote widgets. It is undocumented but widely reverse-engineered. Research established three load-bearing facts that shape this design: (1) only the anonymous `scan2` *data* path is keyless and stable — the options/greeks and real-time paths require desktop-app cookies or login and are out of scope; (2) the response is column-compressed and the wire field order can drift, so decoding must be position-by-name from the response `fields[]`; (3) the endpoint's strength is request economy (one POST returns hundreds of symbols), so a batch-first usage pattern keeps us well under any rate limit and is the whole reason to prefer it over a Yahoo fan-out.

Provider/tool wiring follows the existing OpenCandle docs and Yahoo reference path: `docs/build-a-tool.md` says to add provider code under `src/providers/`, register new tools in `src/tools/index.ts`, add deterministic fixtures under `tests/fixtures/<provider>/`, and keep unit tests fully mocked. `src/providers/yahoo-finance.ts` is the provider reference for `rateLimiter.acquire(...)`, stable cache keys, `TTL`/`STALE_LIMIT`, stale-cache fallback, typed return values, and `HttpError` propagation.

## Goals / Non-Goals

**Goals:**
- Add a keyless TradingView scanner provider with two entry points: `screenStocks(opts)` (filter/sort/paginate) and `getQuotes(symbols)` (batch snapshot).
- Expose screening to the agent via a new `screen_stocks` tool.
- Make `watchlist check` use a single batch quote with graceful Yahoo fallback.
- Harden against the realistic failure mode (field/symbol drift) via position-based decoding, missing-column tolerance, and a fixture shape-guard test.
- Keep usage batch-first, read-only, conservatively paced, and attributed; surface the delayed/unofficial-data caveat to users.
- Wire `screen_stocks` into the route/tool-bundle/prompt surface so the agent knows when this new capability is available and when Yahoo remains the right tool.

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

**Decision**: `buildScannerBody(opts)` produces the `scan2` body for both modes. `screenStocks` passes `markets`, flat AND `filter` clauses, `sort`, and `range` against `{market}/scan2`. `getQuotes` uses exact `symbols.tickers` only when a symbol is already TradingView-qualified (`EXCH:SYM`); for bare equity watchlist symbols it uses an `america/scan2` exact-name membership lookup plus `is_primary`/type filters to resolve primary US listings in one request:

```json
{
  "markets": ["america"],
  "symbols": { "query": { "types": [] } },
  "columns": ["name", "close", "change", "change_abs", "volume", "exchange", "market", "description", "type", "typespecs"],
  "filter": [
    { "left": "name", "operation": "in_range", "right": ["AAPL", "MSFT", "BRK.A", "SPY"] },
    { "left": "is_primary", "operation": "equal", "right": true },
    { "left": "type", "operation": "in_range", "right": ["stock", "fund", "dr"] }
  ],
  "range": [0, 500],
  "options": { "lang": "en" }
}
```

Row count clamps to `[1, 500]`; values below 1 default to 50 rather than requesting an empty/invalid range.

**Why**: Both are the same POST grammar; one builder + `scannerFetch(endpoint, body)` avoids duplication and matches how `finance-skills` factors it. Clamping to 500 reflects the server's effective page cap and keeps a single batch call sufficient for a 100–500 name watchlist. The explicit split for qualified vs bare symbols is required because live `scan2` returns no rows for `symbols.tickers: ["AAPL"]`, while `symbols.tickers: ["NASDAQ:AAPL"]` works.

**Guard**: Unit tests cover `NASDAQ:AAPL`, bare `AAPL` resolving to `NASDAQ:AAPL`, class tickers such as `BRK.A`, ETFs such as `SPY`, unknown symbols, and mixed watchlists. A bare symbol must never silently map to a non-US CDR/foreign listing before a primary US listing.

**Disambiguation**: If multiple rows match the same requested bare symbol, choose deterministically in this order: exact `name` match, `market === "america"`, `is_primary === true` if present in the response, `type` precedence `stock` → `fund` → `dr`, exchange precedence `NASDAQ` → `NYSE` → `AMEX`, then lexicographic `s`. If more than one row remains equivalent after this ordering, mark the symbol unresolved and let Yahoo fill it rather than guessing.

**Mixed inputs**: `getQuotes(["NASDAQ:AAPL", "MSFT"])` may issue at most two POSTs: one `global/scan2` call for already-qualified `EXCH:SYM` tickers and one `america/scan2` call for bare equity symbols. Each POST acquires its own `tradingview` rate-limit token. Results are merged by original requested symbol and preserve caller order for watchlist rendering.

**Quote columns**: `getQuotes` always requests the minimum watchlist quote columns `name`, `close`, `change`, `change_abs`, `volume`, `exchange`, `market`, `description`, `type`, and `typespecs`. `screenStocks` may use its own `DEFAULT_COLUMNS`, but watchlist parity depends on this concrete quote column set.

### 4. Filter grammar exposed structurally, columns as strings

**Decision**: The `screen_stocks` tool accepts `filter` as an array of `{ field, op, value }` clauses (ops: `greater`, `egreater`, `less`, `eless`, `equal`, `nequal`, `in_range`, `not_in_range`, `crosses`, `crosses_above`, `crosses_below`, `above%`, `below%`, `match`, `nmatch`, `has`, `has_none_of`, `empty`, `nempty`) and `columns`/`sort` as strings with the `field|timeframe` convention (`RSI|60`). V1 supports flat AND filters only; `filter2` boolean-tree support is intentionally deferred unless a later change adds an explicit `{ all: [...] }` / `{ any: [...] }` parameter grammar. A curated `DEFAULT_COLUMNS` set is used when none are given.

**Why**: Mirrors the well-tested grammar from `shner-elmo/TradingView-Screener` and the `finance-skills` screener so we inherit a known-good operation set, while keeping the surface small. We do not enumerate all 3,000 fields as types — callers pass field strings; we ship a reference doc (borrowed from the wrapper catalogs) instead.

### 5. No credentials, no degradation tagging

**Decision**: Unlike Finnhub/Exa, the provider needs no key, so there is no `getConfig()` gating, no `ProviderCredentialError`, and no onboarding/`tool-tags` soft-degraded path.

**Why**: The endpoint is keyless. Adding credential plumbing would be dead code. The only optional config is an internal pacing constant.

### 6. Conservative rate limit + batch-first usage

**Decision**: `rateLimiter.configure("tradingview", 5, 1)` — burst 5, ~1 req/s sustained. The watchlist monitor and screener are batch calls (one POST per refresh), so real volume sits far below this.

**Why**: TradingView publishes no limit; the canonical wrapper warns of "potential bans" at high row counts and `tvscreener` suggests ~1s pacing. ~1 req/s is the community-safe norm and is ~60× the headroom a 1-call-per-minute watchlist needs. The advantage we are buying is request economy, not a high ceiling — so we pace conservatively and lean on `cache`.

### 7. Watchlist uses batch quote with Yahoo fallback

**Decision**: `manage_watchlist` `check` calls `getQuotes(symbols)` through `wrapProvider("tradingview", ...)`, maps returned rows into the existing item rendering, then fills any missing/unresolved symbols with the existing per-symbol Yahoo path. If TradingView is unavailable, returns an empty set, or the batch shape changes enough that no rows are usable, the current Yahoo path runs unchanged for the whole list. The fallback boundary is per missing symbol for partial successes and whole-list for provider failure.

**Why**: Directly removes the per-symbol fan-out (the Yahoo ban trigger) for the common equity-watchlist case while guaranteeing no behavioral regression when TradingView is unavailable or incomplete. Per-symbol fill matters because OpenCandle watchlists can contain crypto/Yahoo-style symbols or ambiguous tickers that TradingView's stock scanner may not resolve.

**Equity-like detection**: V1 sends all non-empty watchlist symbols that are not obvious Yahoo-style crypto or international suffixes through the TradingView batch resolver, because TradingView itself can classify/resolution-fail them cheaply. Symbols matching common non-US/Yahoo suffix patterns such as `-USD`, `.TO`, `.DE`, `.T`, `.L`, or `.HK` are marked unresolved for Yahoo fallback without a TradingView lookup unless the user saved an explicit `EXCH:SYM` value.

**Source attribution**: Each priced watchlist row records `sourceProvider` (`"tradingview"` or `"yahoo"`) and optional `dataCaveat`. The delayed/unofficial caveat applies only to TradingView-sourced rows; the summary may state that some rows came from TradingView, but Yahoo-filled rows must not be mislabeled as delayed/unofficial.

### 8. HTTP helper and provider wiring

**Decision**: Add a POST-capable HTTP helper (`httpPost<T>` or a generic `httpRequest<T>`) in `src/infra/http-client.ts` before implementing `scannerFetch`. The helper preserves the current `httpGet` behavior: default timeout/retries, no retries for 4xx `HttpError`, response-body capture on non-OK responses, and typed JSON return. `scannerFetch` calls this helper after `rateLimiter.acquire("tradingview")` and sends TradingView-compatible headers: `Content-Type: application/json`, `Origin: https://www.tradingview.com`, `Referer: https://www.tradingview.com/`, and a normal browser-like `User-Agent` unless a narrower OpenCandle-specific UA is proven to work in the live harness.

**Why**: TradingView `scan2` is JSON POST-only. OpenCandle's current `httpGet` cannot send a method or body, so using local ad hoc `fetch` in the provider would bypass shared retry/error conventions and make future provider work less consistent. This keeps the new provider aligned with Yahoo and the provider-authoring docs.

### 9. Tool selection and routing

**Decision**: `screen_stocks` is a core market tool, but it has a narrower purpose than Yahoo quote/history tools. Implementation must:
- register `screenStocksTool` in `src/tools/index.ts` and assert the Pi adapter exposes it;
- add `screen_stocks` to `TOOL_BUNDLE_TOOLS.core_market` in `src/routing/route-manifest.ts`;
- update `src/prompts/context-builder.ts` and `src/system-prompt.ts` tool catalog text so the agent chooses `screen_stocks` for breadth/screening prompts ("which large caps...", "find oversold stocks...", "market movers by filter") and continues to choose `get_stock_quote`/`get_stock_history`/`get_option_chain`/fundamental tools for single-security quote, history, options, DCF, and analysis workflows;
- add routing/harness tests for both sides of that boundary.
- add negative bundle tests showing `screen_stocks` is not exposed for macro-only, sentiment-only, or SEC-only active tool lists unless `core_market` is also selected.

**Why**: `getAllTools()` registration alone is not sufficient in OpenCandle: active tools are filtered by route bundles. Without route-bundle and prompt-catalog wiring, the new tool can exist in source but be invisible to the main agent, or the agent can use it where Yahoo remains the higher-quality source.

### 10. Surface the delayed / unofficial-data caveat

**Decision**: `screen_stocks` output and the watchlist batch path annotate results as TradingView-sourced, potentially ~15-min delayed, and unofficial — using the same caveat-surfacing approach as our stale-quote flags, so the LLM reports it in the "Data gaps" / caveats section.

**Why**: Honesty requirement (AGENTS.md: flag what's missing; never overstate). Free-tier scanner data is delayed for most US exchanges and the endpoint is undocumented; users must not treat it as real-time or sanctioned.

## Risks / Trade-offs

- **[Undocumented / ToS-gray endpoint]** → Mitigate with batch-first, read-only, conservative pacing, caching, attribution, and a user-facing "unofficial, possibly delayed" caveat. We do not scrape pages or hammer per-symbol. Document that heavy programmatic use is against TradingView's ToS; this is a research/monitoring convenience, not a sanctioned feed.
- **[Field / symbol drift]** → Position-based decoding + null tolerance + fixture shape-guard test. Pin to `scan2`; budget roughly annual vigilance for a future format rev (the v3.0 `scan2` migration was Jan 2025). Realistic blast radius is "one column reads null," not "tool crashes."
- **[~15-min data delay on free tier]** → Acceptable for screening and swing/EOD watchlist alerts; explicitly surfaced. Not suitable for intraday/real-time triggers — out of scope and called out.
- **[Single-endpoint dependency]** → For quotes, Yahoo fallback exists. For screening there is no Yahoo equivalent, so on failure the tool degrades to a structured "unavailable" via `wrapProvider`, never fabricated data.
- **[Symbol/exchange ambiguity]** → `EXCH:SYM` mapping for known exchanges; bare equity symbols use deterministic `america/scan2` exact-name resolution with primary-listing filters and the disambiguation order above; unresolved or ambiguous symbols fall back to Yahoo at the watchlist layer. Edge tickers may need an explicit exchange arg.
- **[Borrowed-code licensing]** → We reimplement in TypeScript and borrow grammar/catalog/approach, not source. Confirm each upstream license (finance-skills MIT, shner-elmo MIT) before copying any snippet; attribute in code comments where a non-trivial algorithm (e.g. OPRA parsing — not used here) is adapted.
- **[`screen_stocks` field misuse]** → Callers can pass an invalid field/op. The provider surfaces the scanner's error message (status + truncated body) rather than silently returning empty, so misuse is diagnosable.
