---
title: Provider relay operations
description: Audit, deploy, and roll back the hosted OpenCandle provider relay.
---

# Provider relay operations

The hosted provider relay is the Cloudflare Worker in `workers/provider-relay`. It is a bounded transport for committed OpenCandle provider and Pi model code, not an arbitrary HTTP proxy.

## Privacy boundary

The Worker stores no credentials, request or response bodies, sessions, or user data. It configures no KV, D1, R2, Durable Object, queue, Analytics Engine, cache, Logpush, Tail Worker, or application log. Worker observability and invocation logs are disabled. Relay-generated errors are generic and never include upstream content or credential values; allowlisted model API responses stream only to the requesting browser.

Provider credentials still pass through Cloudflare in transit because the Worker must forward them to the selected provider. Cloudflare terminates and processes those requests and may retain platform-level security or operational metadata under its own policies. OpenCandle does not claim that Cloudflare observes nothing.

The relay is deliberately public infrastructure because a browser-only application cannot hold an unforgeable shared secret. The top-level app obtains a one-time Cloudflare Turnstile attestation and exchanges it for a short-lived token signed by the Worker and bound to the installation client id. Only the signed token and expiry enter the WebContainer process. Tokens stay in memory, expire after one hour, refresh before expiry, and are never written to browser storage, Pi sessions, or SQLite. If a suspended tab wakes after expiry, the top-level shell obtains a fresh attestation before the next relay request.

The WebContainer preserves the normal provider and Pi fetch interfaces but sends relay-bound requests over its private stdio channel to the trusted top-level browser shell. The shell accepts only the four exact same-origin relay paths, streams bounded response frames back into the runtime, propagates cancellation to the upstream fetch, and rejects arbitrary destinations. This avoids relying on the generated WebContainer origin's network behavior without creating a second provider or model implementation.

The handshake does not turn the public relay into user authentication: a non-browser caller can omit or spoof `Origin`. Safety therefore still comes from the fixed provider allowlist, strict request shape, byte and time bounds, and a server-observed per-network rate limit. It must never be described or operated as an authenticated OpenCandle-only endpoint.

## Guardrails

- Exact provider host, path, method, and header policies; HTTPS on port 443 only.
- No redirects, URL credentials, fragments, arbitrary destinations, or arbitrary headers.
- Market-data requests are capped at 256 KiB, upstream responses at 4 MiB, and upstream time at 15 seconds.
- Pi model requests use a separate raw transport capped at 32 MiB in each direction and five minutes to receive upstream headers. Responses stream through unchanged so Pi retains its native streaming, retry, error, and cancellation behavior.
- A 120-request-per-minute Workers Rate Limiting binding keyed by a SHA-256 digest of Cloudflare's server-observed client IP. The raw address is not logged, persisted by OpenCandle, or passed to the binding.
- Browser requests are accepted from `https://web.opencandle.app` or with a valid client-bound short-lived token. Same-origin responses echo the hosted origin; authorized runtime responses and candidate preflights use wildcard CORS with credentials omitted. Unsigned browser requests receive no CORS access. Originless non-browser requests are public and receive the same allowlist and abuse controls.
- `Cache-Control: no-store` on every Worker response.
- A versioned health manifest. Hosted OpenCandle enables relayed tools only when the version matches.

## Verify and deploy

```bash
npm run relay:test
npm run relay:types
npm --workspace @opencandle/provider-relay exec wrangler deploy --dry-run
npx --yes wrangler secret put RELAY_RUNTIME_TOKEN_SECRET --config workers/provider-relay/wrangler.jsonc
npx --yes wrangler secret put TURNSTILE_SECRET_KEY --config workers/provider-relay/wrangler.jsonc
npm --workspace @opencandle/provider-relay run deploy
```

Generate the operational HMAC secret with at least 32 random bytes and pipe it directly to `wrangler secret put`; do not print or commit it. Store the Turnstile widget secret through the same command, and provide its public sitekey to the hosted build as `VITE_TURNSTILE_SITE_KEY`. The production widget is restricted to `web.opencandle.app`; local and automated checks use Cloudflare's documented test keys. Rotating the HMAC secret immediately invalidates active runtime tokens, which recover after reloading the PWA.

`wrangler.jsonc` routes only the exact HTTPS `web.opencandle.app/v1/provider-fetch`, `web.opencandle.app/v1/model-fetch`, `web.opencandle.app/v1/health`, and `web.opencandle.app/v1/runtime-token` endpoints to the Worker. `workers.dev` and preview URLs are disabled. Review the policy table and privacy audit before every deployment.

Production hosted builds accept only the same-origin relay route. Cross-origin relay URLs fail closed so the static production CSP and runtime policy cannot drift. Loopback URLs remain available for transport-level development, but a joined local Turnstile flow requires a separate non-production widget and Worker secret configured for that hostname.

After deployment, exercise relay negotiation from the real hosted runtime at `https://web.opencandle.app` in a browser. The production Turnstile widget is restricted to that hostname, so a localhost preview cannot prove the joined production flow. A staging proof requires its own Worker secrets and widget that explicitly permits the staging hostname.

The transport-only smoke command remains useful after deployment:

```bash
OPENCANDLE_PROVIDER_RELAY_URL=https://web.opencandle.app/v1/provider-fetch \
npm run relay:smoke:browser
```

That command proves browser CORS, the production Worker, live provider response shapes, and a streamed OpenAI response through the fixed model route without exposing keys in output. The complete Pi turn and session path must be verified in the deployed PWA. The WebContainer runs on a separate public preview origin, so it cannot use a loopback Wrangler URL on the developer's machine. Do not claim production parity for a provider until its deployed browser proof passes.

## Rollback

Remove the four production relay routes from the Worker configuration and redeploy it. Hosted builds intentionally default to the same-origin routes, so omitting `VITE_PROVIDER_RELAY_URL` alone does not disable production relay discovery. Once the routes are gone, startup negotiation fails closed and the PWA registers only independently proven direct-browser tools. Model calls also fail closed. The local GUI and TUI are unaffected because they never install the relay fetch transport.
