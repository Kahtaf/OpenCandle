## Context

The hosted PWA runs the real Pi/OpenCandle agent inside WebContainer and keeps
sessions and state on the device. Its tool adapter currently registers only
Polymarket because several production providers reject browser-origin requests
or require request headers that browsers cannot set. Local GUI and TUI provider
calls must remain direct and unchanged.

The relay will be public infrastructure. An `Origin` header is not
authentication, so the design must remain safe even when a non-browser client
spoofs it. The Worker must not become a general-purpose proxy and must not
retain user credentials, bodies, responses, or application logs.

## Goals / Non-Goals

**Goals:**

- Enable every browser-safe, HTTP-backed OpenCandle financial tool through the
  same provider implementations used locally.
- Keep the Worker small enough to audit in one sitting and deploy beside
  `web.opencandle.app`.
- Store no provider credentials, request/response payloads, sessions, or custom
  logs. Disable Cloudflare invocation logs in Wrangler configuration.
- Bound destinations, methods, headers, request bytes, response bytes,
  redirects, time, and per-network request rates.
- Preserve the standard Fetch `Response` contract inside WebContainer so
  provider code does not fork into hosted implementations.

**Non-Goals:**

- X/Twitter or Reddit CLI support, shell tools, dynamic packages, browser
  cookie access, or desktop sessions.
- Closed-tab alerts, scheduled reports, notifications, or background model
  work.
- Anonymous arbitrary URL fetching, HTML browsing, media proxying, cloud
  persistence, accounts, billing, or credential custody.
- A claim that Cloudflare cannot observe transport metadata while processing
  requests.

## Decisions

### 1. Use one versioned fetch envelope with a strict provider policy table

`POST /v1/provider-fetch` accepts a versioned JSON envelope containing
`provider`, `url`, `method`, a small header map, and an optional base64 body.
The Worker parses the URL and requires an exact provider-specific
host/path/method match before any upstream fetch. Redirects are disabled.

The policy table covers only the URLs used by committed OpenCandle provider
code that cannot run directly in hosted Chromium and passed live proof: Yahoo
Finance, FRED, Brave, Exa, TradingView, and Alternative.me. Alpha Vantage,
CoinGecko, and Polymarket remain direct. It
forwards only headers explicitly required by those providers. Host, forwarding,
Cloudflare, authorization, cookie, and browser identity headers are otherwise
stripped. Yahoo cookie/crumb headers are allowed only on Yahoo policies.

SEC EDGAR is omitted from the hosted manifest because live Worker egress probes
received intermittent 403 responses across EFTS, submissions, and ticker-map
endpoints. Local OpenCandle retains SEC support; hosted mode fails closed until
there is a reliable audited transport.

Finnhub and London Strategic Edge are also omitted until live credential-backed
browser proofs pass. Their unauthenticated upstream boundaries were reachable,
but that does not prove successful provider behavior.

An operation-per-provider API was considered. It provides a smaller input
surface but duplicates each provider's query contract in the Worker and would
drift from local provider code. The strict URL policy keeps one transport while
remaining auditable and non-general-purpose.

### 2. Preserve Fetch semantics through a bounded response envelope

The Worker returns JSON containing the upstream status, a small allowlisted
response-header map, and a base64 body. The WebContainer transport reconstructs
a local `Response`, including Yahoo's session cookie header, so existing
providers continue unchanged.

Requests are capped at 256 KiB and responses at 4 MiB. The Worker reads through
a bounded stream reader and cancels once the cap is crossed. Upstream requests
time out after 15 seconds. Errors never include the target URL, request headers,
request body, upstream body, or credential values.

### 3. Install the relay at the hosted runtime boundary

Hosted boot installs a fetch wrapper before constructing the Pi runtime. Model
API destinations and proven direct providers continue directly; destinations
classified `proxy` are serialized to `OPENCANDLE_PROVIDER_RELAY_URL`. Local TUI
and local GUI never install this wrapper.

Provider descriptors retain `direct`, `proxy`, and `blocked`. In hosted mode,
`proxy` becomes executable only when relay health and policy versions match.
Tool registration is capability-based: a tool is included when every required
native capability is browser-safe and at least one required provider path is
direct or relayed.

### 4. Rate-limit with a pseudonymous server-observed identity

The PWA creates a random 128-bit installation identifier and sends it only in
`X-OpenCandle-Client` for protocol diagnostics. It is not trusted for abuse
control because a caller can rotate it. The Worker instead hashes Cloudflare's
server-observed client IP with SHA-256 and sends only that digest to the Workers
Rate Limiting binding. The raw address is request-local, is never logged or
persisted by OpenCandle, and is not exposed in responses.

This binding retains only permissive, eventually consistent counters. No KV,
D1, R2, Durable Object, Analytics Engine, cache, or log sink is configured.

### 5. Disable logs and caching explicitly

Wrangler sets Worker invocation logs off. Production code contains no
`console.*`, Tail Worker, Logpush, analytics, or persistence binding. Responses
carry `Cache-Control: no-store`; provider fetches do not use the Cache API.
Tests fail if logging calls or storage bindings appear in the Worker package.

This means OpenCandle does not retain application request data. Cloudflare
still terminates and processes the HTTP request and may retain platform-level
security/operational metadata under Cloudflare's own policies; documentation
states that boundary.

### 6. Treat parity as an explicit matrix

The relay enables HTTP-backed market, fundamentals, macro, options, crypto,
technical, portfolio-calculation, and web-search tools once bundled and tested.
Hosted sentiment summary uses web/news and Finnhub but omits X and Reddit.
State-edit tools continue locally in browser SQLite. Alerts, notification
delivery, scheduled reports, X, Reddit, shell execution, and dynamic tool
packages remain out of parity.

### 7. Authorize the generated WebContainer origin with a stateless token

The top-level `web.opencandle.app` document obtains a one-time Cloudflare
Turnstile attestation and exchanges it for a one-hour HMAC-signed token before
starting its WebContainer process. The signed token contains only the relay
contract version, random installation client id, and expiry. Only that signed
token and its expiry enter the process environment. They are retained only in
memory, refreshed before expiry, and never stored in browser storage, SQLite,
Pi sessions, or Worker state.

Relay-bound Fetch calls keep using the shared provider and Pi implementations
inside WebContainer. A bounded stdio bridge carries only the four exact relay
paths to the trusted top-level shell, which performs the same-origin browser
fetch and streams status, headers, and body chunks back into a normal
`Response`. Initial issuance requires a server-verified Turnstile action and
hostname; refresh requires the existing client-bound signed token. The Worker
uses wildcard CORS only for candidate preflight or successfully authorized
runtime requests with credentials omitted. Unsigned browser requests receive
no CORS access. Operational secrets remain Cloudflare Worker secrets and are
never shipped to the browser.

## Risks / Trade-offs

- **Public endpoint abuse** -> Exact upstream policy, body/time limits, per-client
  rate limiting, Cloudflare DDoS/WAF controls, and no arbitrary redirects.
- **Provider terms or endpoints change** -> One named policy per provider,
  contract tests generated from known URLs, and fail-closed deployment.
- **Credential leakage in errors or logs** -> No application logging, generic
  errors, no raw upstream error bodies, no credential-bearing response fields,
  and leak-canary tests.
- **Large SEC filings exceed the cap** -> Return a bounded unavailable result;
  increase the cap only with a measured filing test, never remove it.
- **Generic transport policy accidentally widens** -> Tests reject unknown
  hosts, paths, methods, redirect responses, and sensitive headers outside the
  one provider that requires them.
- **Shared networks can share one allowance** -> Keep the allowance high enough
  for normal research, return a generic 429, and retain zone-level abuse controls.
- **Cloudflare metadata contradicts a zero-log claim** -> Claim only that
  OpenCandle configures no application/invocation logs or payload storage.
- **Shared WebContainer domains permit drive-by relay calls** -> Exchange a
  server-verified Turnstile attestation in the trusted top-level shell, issue a
  short-lived client-bound token, and limit the runtime bridge to exact relay
  paths; test issuance, health negotiation, and a real provider fetch as one
  joined flow.

## Migration Plan

1. Land Worker contract and tests without deploying or enabling hosted tools.
2. Install hosted fetch transport and prove one Yahoo quote through local
   Wrangler in a real browser.
3. Enable provider/tool groups incrementally with fixture and live browser
   proofs; keep unproven tools absent.
4. Deploy the Worker to the production route, disable `workers.dev`, and run
   canary requests with application logs disabled.
5. Publish the capability matrix and enable relay-backed tools in the PWA.

Rollback removes the relay URL from the PWA build and reverts proxy-classified
tools to unavailable. The local GUI and TUI remain unchanged throughout.

## Open Questions

- Production uses the same-origin `web.opencandle.app/v1/provider-fetch` route.
  Cross-origin production relay configuration fails closed; loopback remains
  available for transport-level Wrangler development. Joined local attestation
  requires a separate non-production widget and Worker secret for that hostname.
- Yahoo options must pass a live crumb/cookie proof through the envelope before
  hosted options can be called parity-complete.
