# Hosted web app operations

This package is the hosted PWA served at `https://web.opencandle.app`. It deploys as the static-assets Worker `opencandle-web` (`wrangler.jsonc`): `./dist` with single-page-application fallback, `workers.dev` and preview URLs disabled, and the custom domain `web.opencandle.app` declared as a route with `custom_domain: true`.

The provider relay (`workers/provider-relay`) owns the more specific `web.opencandle.app/v1/*` routes, which take precedence over the custom-domain Worker. The two Workers deploy separately.

## Prerequisites

- Access to the Cloudflare account that owns the `opencandle.app` zone, and `npm --workspace @opencandle/gui-hosted exec wrangler login` (or a `CLOUDFLARE_API_TOKEN` with Workers deploy rights).
- A clean checkout with `npm ci`. `wrangler` is a devDependency of this package, pinned to the same version as the relay.

## Build environment

| Variable | Production value | Notes |
|----------|------------------|-------|
| `VITE_WEBCONTAINER_API_KEY` | unset | See [WebContainer API key status](#webcontainer-api-key-status). If it is ever set, it is build-time and ships in the public bundle: not a secret, but never commit it. Loopback origins ignore it. |
| `VITE_PROVIDER_RELAY_URL` | unset | Production uses the same-origin relay. Only loopback origins are accepted, for local relay development. |

Provider API keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) are never needed for a build. If they are present, the runtime payload audit fails the build when any of those values leak into the bundle. Prefer a shell without them.

## Deployment

Deploy the relay first when a release includes relay changes (see `workers/provider-relay/README.md`).

```bash
npm run gui:hosted:deploy:dry-run     # build + wrangler deploy --dry-run, no upload
npm --workspace @opencandle/gui-hosted exec wrangler deployments list   # record the current version id
npm run gui:hosted:deploy             # build + wrangler deploy
```

The dry run needs no Cloudflare credentials. It builds `dist` and reports the asset count without uploading. Record the version id marked `(100%)` in the newest entry of `wrangler deployments list` before deploying; that is the rollback target.

## Production verification

1. Bundle hash check: the hashed entry assets served in production must match the build you just deployed.

   ```bash
   grep -oE '/assets/[^"]+\.js' gui/hosted/dist/index.html
   curl -s https://web.opencandle.app/ | grep -oE '/assets/[^"]+\.js'
   ```

   The two lists must be identical.
2. Relay transport smoke, from the repository root:

   ```bash
   OPENCANDLE_PROVIDER_RELAY_URL=https://web.opencandle.app/v1/provider-fetch \
   npm run relay:smoke:browser
   ```

3. Open `https://web.opencandle.app` in a fresh browser profile: no update pill appears and the runtime reaches ready.

## Rollback

```bash
npm --workspace @opencandle/gui-hosted exec wrangler deployments list
npm --workspace @opencandle/gui-hosted exec wrangler rollback <version-id>
```

Use the version id recorded before the deploy. Rollback switches traffic to the earlier Worker version and its assets; it does not rebuild. Re-run the bundle hash check against the build of that earlier commit. Installed PWAs pick up the rolled-back shell through the normal update flow.

## WebContainer API key status

Decision (2026-09-28): `VITE_WEBCONTAINER_API_KEY` stays unset in production builds. Production boots without it.

Findings from StackBlitz's public documentation, checked 2026-09-30:

- "Licensing is required for _production_ usage of the API in a commercial, for-profit setting." The license applies when "using the API to meet the needs of your customers, prospective customers, and/or employees", and non-compliant use "may result in your access being revoked". Prototypes and POCs do not require a license. ([Commercial usage](https://webcontainers.io/enterprise))
- `configureAPIKey` is documented only as "an API key to be used for commercial usage of the WebContainer API", with a pointer back to the commercial usage page. ([API reference](https://webcontainers.io/api))
- StackBlitz states it is "committed to being free for open source use cases and have support & licensing available for enterprise use cases." ([Launch announcement](https://blog.stackblitz.com/posts/webcontainer-api-is-here/))
- No public page documents self-serve keys, pricing, or a per-origin allowlist for a custom production domain. Keys and terms come from StackBlitz's sales contact form.

OpenCandle is MIT-licensed and the hosted app is free, with no accounts, which fits the open-source statement rather than the commercial production requirement. Revisit this before any paid offering, sponsorship tied to the hosted app, or use by a for-profit organization for its customers or employees. At that point, get a written license and key from StackBlitz, confirm it is allowlisted for `web.opencandle.app`, and set it only in the deploy shell.
