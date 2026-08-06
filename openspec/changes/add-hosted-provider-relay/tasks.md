## 1. Worker contract and privacy guardrails

- [x] 1.1 Add failing Worker contract tests for method/path validation, exact provider destination rules, header filtering, redirects, and bounded input.
- [x] 1.2 Implement the versioned `/v1/provider-fetch` Worker and provider policy table until the contract tests pass.
- [x] 1.3 Add failing tests for bounded upstream response streaming, generic errors, credential non-reflection, no-store responses, and rate-limit rejection; implement the bounds.
- [x] 1.4 Add Wrangler configuration with current compatibility date, generated Worker types, rate-limit binding, production route, disabled workers.dev, disabled invocation logs, and no persistence/analytics bindings.
- [x] 1.5 Add a static audit test that rejects console logging, Cache API use, persistence bindings, observability logs, and credential-bearing diagnostics in the Worker package.
- [x] 1.6 Add a Turnstile-attested stateless HMAC runtime-token endpoint and joined integration tests covering runtime issuance, browser health, provider forwarding, refresh, expiry, tampering, and client binding.

## 2. Hosted fetch transport

- [x] 2.1 Add failing tests for proxy classification, request envelope serialization, response reconstruction, abort propagation, and direct/model URL bypass.
- [x] 2.2 Implement the hosted relay fetch transport and install it only inside the browser-hosted runtime before provider construction.
- [x] 2.3 Add installation identity and relay URL host configuration without writing either value into Pi sessions, SQLite, provider requests, or logs.
- [x] 2.4 Add health/policy-version negotiation and fail closed when the relay is missing, outdated, or unreachable.
- [x] 2.5 Exchange the one-time Turnstile attestation in the top-level shell, pass only signed authorization through the WebContainer process environment, refresh it in memory, and keep hosted boot available in degraded mode when issuance fails.
- [x] 2.6 Preserve shared provider and Pi Fetch behavior through a bounded exact-path stdio bridge that streams relay responses through the trusted browser shell.

## 3. Provider and tool parity

- [x] 3.1 Extend provider capability reporting to resolve direct, relayed, and blocked providers against the relay manifest.
- [x] 3.2 Expand hosted tool registration to browser-safe HTTP-backed market, crypto, fundamentals, macro, options, technical, portfolio-calculation, and web-search tools.
- [x] 3.3 Add a hosted sentiment-summary composition using web/news and Finnhub while omitting X and Reddit native adapters.
- [x] 3.4 Keep alerts, notification delivery, scheduled reports, X, Reddit, shell, and dynamic package tools absent, with exact diagnostics.

## 4. End-to-end provider proofs

- [ ] 4.1 Run fixture-backed end-to-end tests through local Wrangler for each provider policy and every enabled hosted tool group.
- [x] 4.2 Run a real browser Yahoo quote and model-backed turn through the production relay, proving cashtag autocomplete, Pi tool calls, streamed model output, evidence, session persistence, and no credential reflection.
- [x] 4.3 Run live-key browser proofs for Alpha Vantage, FRED, Finnhub, Brave, Exa, and LSE when their keys are present; keep any unproven provider disabled.
- [x] 4.4 Prove Yahoo options crumb/cookie behavior before enabling hosted options parity.

Live Chromium proof on 2026-07-31 passed Alpha Vantage, FRED, Brave, and Exa with configured keys. Finnhub and LSE had no configured keys, so their policies remain absent from the production manifest. SEC EDGAR is also absent after intermittent HTTP 403 responses from Cloudflare Worker egress.

## 5. Documentation and release verification

- [x] 5.1 Document relay deployment, privacy boundary, Cloudflare metadata caveat, abuse controls, supported providers/tools, and rollback.
- [x] 5.2 Update the hosted PWA design, capability UI, and changelog with the final measured parity matrix.
- [ ] 5.3 Run Worker tests, hosted unit/browser tests, local GUI browser smoke, TUI harness, `npm run gates`, and `graphify update .`.

Worker tests, the deployed Chromium relay smoke, `npm run gates`, and `graphify update .` pass. The complete hosted Pi browser run remains pending because the WebContainer service rejects localhost preview referrers, while the currently deployed static PWA does not yet contain this branch.
