## Why

The hosted PWA can run the real OpenCandle/Pi runtime, but browser CORS and
credential-header restrictions currently limit it to Polymarket. A small,
stateless, auditable Cloudflare Worker can relay only approved provider
requests without storing credentials, responses, sessions, or application
logs, allowing the hosted product to expose nearly the same HTTP-backed tools
as local OpenCandle.

## What Changes

- Add a public Cloudflare Worker with one bounded provider-fetch endpoint,
  exact upstream host/path/method rules, strict origin handling, response-size
  limits, timeouts, and no arbitrary destination support.
- Forward user-supplied provider credentials only for the lifetime of the
  request. Disable Worker application logging, response caching, and storage
  bindings; never echo credentials, upstream URLs containing secrets, or raw
  upstream error bodies.
- Add a hosted-runtime fetch transport that sends proxy-classified provider
  requests through the relay while preserving the normal `Response` contract
  expected by existing providers.
- Expand hosted tool registration to the browser-safe, HTTP-backed OpenCandle
  tool set. Continue to omit X/Reddit CLI tools and closed-tab/background
  automation capabilities.
- Add local Worker tests, provider-routing contract tests, and a real-browser
  end-to-end proof through the deployed or locally emulated relay.
- Document the honest parity boundary and the fact that Cloudflare still
  processes request metadata even though OpenCandle retains no logs or data.

## Capabilities

### New Capabilities

- `hosted-provider-relay`: Stateless, allowlisted provider transport and its
  browser integration, privacy contract, abuse bounds, and deployment surface.

### Modified Capabilities

- `provider-registry`: Hosted availability distinguishes direct, relayed, and
  native-only providers, with evidence for each enabled transport.
- `graceful-degradation`: Hosted diagnostics distinguish relay unavailability
  from missing credentials and native-only capabilities.

## Impact

- Adds an auditable Worker package under `workers/` with Wrangler configuration
  and no persistent bindings.
- Changes hosted runtime composition, provider capability metadata, CSP/connect
  policy, tool registration, diagnostics, and browser tests.
- Reuses existing provider and tool implementations; local GUI and TUI fetch
  behavior remains unchanged.
- Requires a Cloudflare Worker route such as
  `https://relay.web.opencandle.app` or `/api/provider` beside
  `web.opencandle.app`, plus edge rate limiting outside request payloads.
