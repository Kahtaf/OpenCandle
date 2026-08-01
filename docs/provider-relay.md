---
title: Provider relay operations
description: Audit, deploy, and roll back the hosted OpenCandle provider relay.
---

# Provider relay operations

The hosted provider relay is the Cloudflare Worker in `workers/provider-relay`. It is a bounded transport for committed OpenCandle provider code, not an arbitrary HTTP proxy.

## Privacy boundary

The Worker stores no credentials, request or response bodies, sessions, or user data. It configures no KV, D1, R2, Durable Object, queue, Analytics Engine, cache, Logpush, Tail Worker, or application log. Worker observability and invocation logs are disabled. Generic error codes never include upstream content or credential values.

Provider credentials still pass through Cloudflare in transit because the Worker must forward them to the selected provider. Cloudflare terminates and processes those requests and may retain platform-level security or operational metadata under its own policies. OpenCandle does not claim that Cloudflare observes nothing.

## Guardrails

- Exact provider host, path, method, and header policies; HTTPS on port 443 only.
- No redirects, URL credentials, fragments, arbitrary destinations, or arbitrary headers.
- Requests capped at 256 KiB, upstream responses at 4 MiB, and upstream time at 15 seconds.
- A 120-request-per-minute Workers Rate Limiting binding keyed by a SHA-256 digest of Cloudflare's server-observed client IP. The raw address is not logged, persisted by OpenCandle, or passed to the binding.
- `Cache-Control: no-store` on every Worker response.
- A versioned health manifest. Hosted OpenCandle enables relayed tools only when the version matches.

## Verify and deploy

```bash
npm run relay:test
npm run relay:types
npm --workspace @opencandle/provider-relay exec wrangler deploy --dry-run
npm --workspace @opencandle/provider-relay run deploy
```

`wrangler.jsonc` routes only the exact `web.opencandle.app/v1/provider-fetch` and `web.opencandle.app/v1/health` endpoints to the Worker. `workers.dev` and preview URLs are disabled. Review the policy table and privacy audit before every deployment.

Production hosted builds accept only the same-origin relay route. Cross-origin relay URLs fail closed so the static production CSP and runtime policy cannot drift. Loopback cross-origin URLs remain available for local Wrangler development.

After deployment, exercise relay negotiation from the real hosted runtime rather than a localhost proxy:

```bash
OPENCANDLE_PROVIDER_RELAY_URL=https://web.opencandle.app/v1/provider-fetch \
npm run relay:smoke:browser

VITE_PROVIDER_RELAY_URL=https://web.opencandle.app/v1/provider-fetch \
OPENCANDLE_PROVIDER_RELAY_E2E=1 \
npm run test:gui:hosted
```

The first command proves browser CORS, the production Worker, and live provider response shapes without exposing keys in output. The second proves the complete Pi turn and session path. The WebContainer runs on a separate public preview origin, so it cannot use a loopback Wrangler URL on the developer's machine. Do not claim production parity for a provider until its deployed browser proof passes.

## Rollback

Remove the two production relay routes from the Worker configuration and redeploy it. Hosted builds intentionally default to the same-origin routes, so omitting `VITE_PROVIDER_RELAY_URL` alone does not disable production relay discovery. Once the routes are gone, startup negotiation fails closed and the PWA registers only independently proven direct-browser tools. The local GUI and TUI are unaffected because they never install the relay fetch transport.
