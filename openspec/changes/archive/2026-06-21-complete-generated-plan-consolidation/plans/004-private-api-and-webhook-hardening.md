# Plan 004: Enforce loopback on the private GUI API and validate webhook URLs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- gui/server/private-api-access.ts gui/server/server.ts src/market-state/notification-delivery.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

Two defense-in-depth gaps for users who opt the GUI onto the network
(`OPENCANDLE_GUI_HOST=0.0.0.0`, advertised for LAN/Tailscale use in the listen
log message):

1. The private market-state API trusts a session cookie plus origin headers
   but never checks that the peer is loopback. On a `0.0.0.0` bind, a leaked
   cookie works from any network peer. An `isLoopbackAddress` helper already
   exists in the same file but is not used by the trust check. IMPORTANT
   product constraint: LAN/Tailscale GUI access is documented, intentional
   behavior (`docs/gui-quickstart.md:15`, `docs/configuration.md:45` —
   "set `OPENCANDLE_GUI_HOST=0.0.0.0` only when you intentionally want
   LAN or Tailscale access"), so this plan does NOT make the private API
   loopback-only unconditionally. Design: loopback required **by default**,
   with an explicit env opt-in (`OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API=1`)
   that restores cookie-gated remote access for users who deliberately bound
   to the network. Cookie + origin checks always still apply.
2. Alert webhook notifications POST to a user/env-configured URL with no
   scheme or address validation (`file:`-style schemes are rejected by fetch,
   but `http://169.254.169.254/` or internal services are not).

Both are LOW severity on the default `127.0.0.1` bind; they matter exactly when
the documented network modes are used.

## Current state

```ts
// gui/server/private-api-access.ts:15-35
export function isTrustedPrivateApiRequest(
  headers: IncomingHttpHeaders,
  sessionToken: string,
): boolean {
  if (cookieValue(headers.cookie, PRIVATE_API_COOKIE) !== sessionToken) return false;
  const fetchSite = headerValue(headers["sec-fetch-site"]);
  if (fetchSite != null && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = headerValue(headers.origin);
  const host = headerValue(headers.host);
  if (origin != null && host != null) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch { return false; }
  }
  return true;
}
```

`isLoopbackAddress(remoteAddress)` exists at lines 5–13 of the same file.

```ts
// gui/server/server.ts:779-781
function allowPrivateMarketStateApi(req: IncomingMessage, res: ServerResponse): boolean {
  if (isTrustedPrivateApiRequest(req.headers, privateApiSessionToken)) return true;
  // ...(presumably 403 path below — read before editing)
```

`req.socket.remoteAddress` is available at this call site. Bind host:
`server.ts:54` `const host = process.env.OPENCANDLE_GUI_HOST ?? "127.0.0.1";`.

```ts
// src/market-state/notification-delivery.ts:21-22, 67
const webhookUrl = options.webhookUrl ?? process.env.OPENCANDLE_NOTIFICATION_WEBHOOK_URL ?? null;
if (!webhookUrl) return { attempted: 0, succeeded: 0, failed: 0 };
// ...
const response = await fetchImpl(webhookUrl, { method: "POST", ... });
```

Tests: `tests/unit/gui-server/` has 21 files (look for an existing
`private-api-access` test to extend); `tests/unit/market-state/notification-delivery.test.ts` exists.

## Commands you will need

| Purpose   | Command                                                                | Expected on success |
|-----------|------------------------------------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                                                      | exit 0              |
| Targeted  | `npx vitest run tests/unit/gui-server tests/unit/market-state/notification-delivery.test.ts` | all pass |
| All tests | `npx vitest run`                                                        | all pass            |

## Scope

**In scope**:
- `gui/server/private-api-access.ts`
- `gui/server/server.ts` (only the `allowPrivateMarketStateApi` call site and any other `isTrustedPrivateApiRequest` callers — find them: `grep -rn "isTrustedPrivateApiRequest" gui/`)
- `src/market-state/notification-delivery.ts`
- `docs/configuration.md` (one env-table row)
- Tests for both

**Out of scope**:
- The cookie scheme, token generation, or WebSocket upgrade path.
- Adding authentication for the remote-bind mode (a real remote-auth story is
  a separate design decision — do not invent one here).
- DNS-resolution-based SSRF checks (re-resolving hostnames) — out of
  proportion for a local tool; scheme + literal-IP checks only.

## Git workflow

- Branch: `advisor/004-private-api-webhook-hardening`.
- Commit style: short imperative subject, e.g. `Require loopback for private GUI API`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add remoteAddress to the trust check, with explicit remote opt-in

Change `isTrustedPrivateApiRequest` to accept the peer address and an
options flag:

```ts
export function isTrustedPrivateApiRequest(
  headers: IncomingHttpHeaders,
  sessionToken: string,
  remoteAddress: string | undefined,
  options: { allowRemote?: boolean } = {},
): boolean {
  if (!options.allowRemote && !isLoopbackAddress(remoteAddress)) return false;
  // ...existing cookie / sec-fetch-site / origin checks unchanged — they
  // apply in BOTH modes
```

Update every caller (`grep -rn "isTrustedPrivateApiRequest" gui/ tests/`) to
pass `req.socket.remoteAddress` and
`{ allowRemote: process.env.OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API === "1" }`
— resolve the env var once at server startup next to the existing `host`
resolution (`server.ts:54`), not per-request. When the server starts with the
flag set, log one line alongside the existing `0.0.0.0` LAN/Tailscale notice
so the posture is visible.

**Verify**: `npx tsc --noEmit` → exit 0 (the signature change must surface all call sites).

### Step 1b: Document the new flag

Add a row to the env table in `docs/configuration.md` (near the
`OPENCANDLE_GUI_HOST` row at line ~45):
`OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API` | unset | Allow the GUI's private
market-state API to accept cookie-authenticated requests from non-loopback
peers. Set `1` only together with an intentional `OPENCANDLE_GUI_HOST`
network bind.

**Verify**: row present; table formatting intact.

### Step 2: Validate webhook URLs

In `notification-delivery.ts`, after resolving `webhookUrl`, validate before
any attempt; on failure return early with all-failed accounting rather than
throwing (matching the module's no-throw style):

```ts
function isAllowedWebhookUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname;
  if (host === "169.254.169.254" || host.startsWith("169.254.")) return false;
  return true;
}
```

Deliberately allow localhost/private-range hosts: a local-first tool POSTing
to a local webhook receiver (e.g. a local ntfy/Matrix bridge) is a primary use
case. Only block non-http(s) schemes and the link-local metadata range. Log a
single `console.warn` naming the rejected URL's host (not the full URL — it
may embed tokens).

**Verify**: `npx vitest run tests/unit/market-state/notification-delivery.test.ts` → all pass.

### Step 3: Tests

See Test plan.

**Verify**: `npx vitest run` → all pass.

## Test plan

- Private API (extend the existing gui-server test that covers
  `isTrustedPrivateApiRequest`; if none, create
  `tests/unit/gui-server/private-api-access.test.ts`):
  - valid cookie + loopback `127.0.0.1` → trusted
  - valid cookie + `::ffff:127.0.0.1` → trusted
  - valid cookie + `192.168.1.50` → NOT trusted (default)
  - valid cookie + undefined remoteAddress → NOT trusted (default)
  - valid cookie + `192.168.1.50` + `allowRemote: true` → trusted
  - INVALID cookie + `192.168.1.50` + `allowRemote: true` → NOT trusted
    (opt-in must not weaken the cookie gate)
- Webhook validation (in `notification-delivery.test.ts`, following its
  existing fetch-mock pattern):
  - `ftp://example.com` and `http://169.254.169.254/hook` → zero fetch calls,
    result counts attempts as failed (or zero-attempted — match the early-return
    accounting you implement, and assert it explicitly)
  - `http://127.0.0.1:9999/hook` → fetch IS called (local receivers allowed)
- Verification: `npx vitest run` → all pass.

## Done criteria

- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` exits 0, including the new tests
- [x] `grep -n "isLoopbackAddress" gui/server/private-api-access.ts` shows it used inside `isTrustedPrivateApiRequest`
- [x] `grep -rn "OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API" gui/server/ docs/configuration.md` matches in both
- [x] `grep -n "isAllowedWebhookUrl" src/market-state/notification-delivery.ts` matches
- [x] No files outside the in-scope list modified (`git status`)
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Tests exist that assert non-loopback access succeeds WITHOUT any opt-in —
  that would mean remote private-API access is already a relied-upon default;
  report before flipping it.
- `isTrustedPrivateApiRequest` has callers outside `gui/` you can't update.

## Maintenance notes

- `OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API` is the single sanctioned escape
  hatch; future remote features must layer onto it, never silently relax the
  default loopback requirement.
- Reviewer: confirm the webhook rejection accounting (attempted/failed counts)
  is consistent with how `listNotificationDeliveryAttempts` consumers
  interpret repeated failures (retry scheduling).
