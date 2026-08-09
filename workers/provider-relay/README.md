# Provider relay operations

This package is the hosted provider relay. It is a bounded transport for committed OpenCandle provider and Pi model code, not an arbitrary HTTP proxy.

## Deployment

```bash
npm run relay:test
npm run relay:types
npm --workspace @opencandle/provider-relay exec wrangler deploy --dry-run
npx --yes wrangler secret put RELAY_RUNTIME_TOKEN_SECRET --config workers/provider-relay/wrangler.jsonc
npm --workspace @opencandle/provider-relay run deploy
```

Generate the HMAC secret from at least 32 random bytes and pipe it directly to `wrangler secret put`; never print or commit it. Rotating it invalidates active runtime tokens, which recover after the PWA reloads.

## Production verification

The Worker routes only the exact HTTPS `web.opencandle.app/v1/provider-fetch`, `web.opencandle.app/v1/model-fetch`, `web.opencandle.app/v1/health`, and `web.opencandle.app/v1/runtime-token` endpoints. `workers.dev` and preview URLs are disabled.

After deployment, exercise relay negotiation from the real hosted runtime at `https://web.opencandle.app`. A localhost preview cannot verify the joined production flow because production uses the exact production route and rate-limit binding.

For a transport smoke check:

```bash
OPENCANDLE_PROVIDER_RELAY_URL=https://web.opencandle.app/v1/provider-fetch \
npm run relay:smoke:browser
```

This checks browser CORS, the production Worker, live provider response shapes, and a streamed OpenAI response without exposing keys in output. The complete Pi turn and session flow still needs PWA verification.

## Rollback

Remove the four production relay routes from `wrangler.jsonc` and redeploy. Hosted builds fail closed when relay negotiation no longer succeeds; the local GUI and TUI are unaffected.
