# FX feasibility research — 2026-11-06

## Verdict and scope

Technically viable as a bounded current-market-value feature with existing Yahoo infrastructure; not evidence of production permission, universal coverage, execution quality, historical accounting, or hosted reliability. Proposal is conditional on rights and policy decisions in design.md. No implementation performed. Existing checkout was main at 2cd40b83, not a fresh worktree, so bootstrap was not required. Initial git status was clean.

## Primary sources checked

- [Issue #282](https://github.com/Kahtaf/OpenCandle/issues/282), read through GitHub connector: user reports missing EUR→USD conversion; not a missing configuration identified by this research.
- [Yahoo exchange/data-provider help](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html), retrieved via search: currency series use =X and are listed as real-time from ICE Data Services. This is coverage information, not an API SLA or licensing grant.
- [Yahoo EUR/USD](https://finance.yahoo.com/quote/EURUSD%3DX/) and [history](https://finance.yahoo.com/quote/EURUSD%3DX/history/), indexed primary-source results identify EUR/USD and USD quote units; endpoint probe below independently confirms orientation metadata.
- [Yahoo Terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html), search retrieval: automated collection requires prior express permission; direct open returned HTTP 999. The page result does not establish permission for this app, commercial use, or redistribution. Existing endpoint accessibility and library availability are insufficient. Deployment owner must establish applicable rights, including upstream data rights, before enabling local or hosted FX. This is an unresolved source-access constraint, not a claim of legal clearance.
- [Yahoo Standard Chartered history](https://ca.finance.yahoo.com/quote/STAN.L/history/), search result displays GBp. [LSE Turquoise service description](https://docs.londonstockexchange.com/sites/default/files/documents/turquoise-trading-services-description-v3-43-0-final_0.pdf), search extraction explicitly identifies GBX as GBP in pence. This supports separate price-unit normalization; it does not prove every provider symbol uses the same convention.

Access limitations preserved: web opens of Yahoo GBPUSD=X and EUR=X pages each returned HTTP 429; the legal-page open returned HTTP 999. No bypass or repeated web retries were attempted. Search results and successful application-provider probes are distinct evidence. Market-closed, holiday, deployment-specific egress, and rate-limit behavior were not live-tested.

## Bounded live read-only probe

Executed 2026-11-06 using installed tsx, existing `getQuote()` wrapped by `wrapProvider("yahoo", ...)`, sequentially for exactly three symbols. Existing cache/rate limiter/HTTP behavior was used, including the provider's optional extended-hours enrichment. No portfolios, credentials, or persistent records were read or written; no unit test made a live call. Shell process exited 0. Results below preserve the relevant observed data (not recommended current prices):

```json
[
  {"requestedAt":"2026-11-06T16:39:08.830Z","requested":"EURUSD=X","status":"ok","returned":"EURUSD=X","name":"EUR/USD","price":1.1152,"currency":"USD","asOf":"2026-11-06T16:38:26.000Z","provider":"yahoo","marketState":"REGULAR"},
  {"requestedAt":"2026-11-06T16:39:09.165Z","requested":"USDEUR=X","status":"ok","returned":"EUR=X","name":"USD/EUR","price":0.8967,"currency":"EUR","asOf":"2026-11-06T16:38:26.000Z","provider":"yahoo","marketState":"REGULAR"},
  {"requestedAt":"2026-11-06T16:39:09.245Z","requested":"GBPUSD=X","status":"ok","returned":"GBPUSD=X","name":"GBP/USD","price":1.3364,"currency":"USD","asOf":"2026-11-06T16:38:26.000Z","provider":"yahoo","marketState":"REGULAR"}
]
```

Reproduction command (deliberate live research only, not a unit test):

```sh
npx --no-install tsx -e 'import {getQuote} from "./src/providers/yahoo-finance.ts"; import {wrapProvider} from "./src/providers/wrap-provider.ts"; (async()=>{for(const symbol of ["EURUSD=X","USDEUR=X","GBPUSD=X"]){const start=new Date().toISOString(); const r=await wrapProvider("yahoo",()=>getQuote(symbol)); console.log(JSON.stringify({observedAt:start,requestedSymbol:symbol,result:r}));}})()'
```

Inference: canonical EUR/USD and GBP/USD observations can supply the proposed direct, reciprocal, and derived-cross calculations. No assumption that arbitrary pairs exist follows. USD/EUR alias behavior rules out naive string equality for general pair resolution. Independent inverse quotes need not be exact reciprocals due to rounding/timing/spreads; v1 uses one canonical observation per leg.

## Repository findings

- `src/providers/yahoo-finance.ts`: chart v8 interval=1d/range=1d request is symbol-based; uses regularMarketPrice and regularMarketTime. Retrieval timestamp is not observation timestamp. Cache has 60-second quote TTL and 15-minute stale fallback. Optional yahoo-finance2 enrichment makes an additional rate-limited call and may fail without failing the chart quote. Existing uppercasing destroys GBp/GBP distinction.
- `src/infra/rate-limiter.ts`: Yahoo bucket 5/second; local process policy, no evidence of an official rate allowance. `wrapProvider` exposes stale/cache metadata that a raw price resolver loses.
- `src/tools/portfolio/portfolio-view.ts`: per-lot fetching and arithmetic; requires quote currency equal lot cost currency before row valuation, and cost currency equal base before inclusion. `tracker.ts` resolver reduces quote metadata to price/currency. Repeated symbols need acquisition deduplication.
- `gui/shared/market-quote-snapshot.ts`: deduplicates security symbols, then independently implements lot valuation, cost sums, exclusions, status, and allocations. Foreign exclusions can coexist with an ok subtotal. Its unavailable-snapshot path also needs contract changes.
- Local `gui/server/market-state-api.ts` and hosted `gui/hosted/runtime/hosted-market-data-api.ts` inject quote resolvers into shared snapshot composition. Both use freshness helpers and reject stale data; hosted additionally validates positive finite prices. FX needs its own observation policy instead of blindly reusing equity-session logic.
- `gui/web/src/features/market-state/portfolio-view-model.js`: groups by symbol, assumes all successful lots share cost currency, adds nullable P&L using zero defaults, derives daily move from security changePercent. `PortfolioPage.jsx` and `features/symbol/symbol-sections.jsx` display allocation as portfolio share. Conversion changes these assumptions; updating the backend alone would be misleading.
- `src/market-state/service.ts`, `src/memory/sqlite.ts`: base_currency already exists; lot currency/avgCost and optional openedAt exist; createdAt records persistence, not historical FX. No trustworthy acquisition-rate field exists.
- `src/types/portfolio.ts`: summary cost is non-null and position currency overloaded; contract must separate native and reporting fields. No schema migration needed for read-only valuation.

## Instructions and proof boundary

Read root AGENTS.md, openspec/config.yaml (spec-driven; shipped deltas folded into specs then proposal deleted), existing saved-state-personalization artifacts, existing market-state-user-experience spec, and discovered `.claude/skills/openspec-explore/SKILL.md` and `openspec-propose/SKILL.md`. Followed generated artifact instructions. CLI absent from PATH/local dependencies; used pinned `npx --yes @fission-ai/openspec@1.4.1` without changing package manifests/lockfile. An initial discovery command looked in nonexistent gui/src and gui/server/market-quotes.ts; corrected paths using rg. These were discovery misses, not product failures.

Only proposal files changed. TDD, CHANGELOG, and full/live gates deliberately belong to future implementation/parent, as expressly scoped by the research contract. No implementation tasks are complete. Validation output is recorded in validation.md; OpenSpec structural validation cannot establish runtime correctness or source rights.
