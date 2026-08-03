## Why

OpenCandle's local GUI and TUI depend on a long-lived Node process, which makes
the product unavailable whenever that process dies. The completed
`spikes/browser-runtime` proof shows that a static browser application can boot
OpenCandle code, run a live provider and model route, and persist SQLite data
locally; this change turns that evidence into an installable, serverless
product surface without weakening the existing local products.

## What Changes

- Add an installable hosted PWA that runs OpenCandle and Pi code on the user's
  device, stores credentials and canonical device-local state in browser
  storage, and requires no OpenCandle application server.
- Establish explicit runtime adapters so hosted web, local web, and local TUI
  share routing, tools, evidence, chat events, and session semantics while
  retaining platform-appropriate persistence and transport.
- Use Pi's provider implementations and canonical OpenCandle model catalog on
  every surface. Hosted web filters that catalog only by proven browser
  execution capability; it does not maintain a separate model list or route.
- Add browser persistence for Pi-compatible session entries and OpenCandle
  market state, including reload recovery, export/import, clear, and schema
  migration behavior.
- Add browser writer/follower coordination so only one tab writes a session
  while other tabs remain usable followers.
- Extend provider metadata with fail-closed browser transport capabilities and
  register only direct-browser or fixed-relay tools in hosted mode. The static
  app has no application server; its separately deployed, auditable relay is
  restricted to exact provider policies and the production web origin.
- Add a service worker, web app manifest, install/update behavior, offline app
  shell, and explicit offline/provider degradation.
- Reuse the existing React GUI and canonical `gui/shared` event/reducer
  contract rather than creating a second hosted UI.
- Preserve the local GUI's trusted loopback server, writer lock, native SQLite,
  and filesystem Pi sessions, and preserve the local TUI's Node/filesystem
  behavior.
- Add a post-live-testing hardening gate before the PWA is described as feature
  parity: writer ownership, bootstrap/reload convergence, credential probes,
  workflow rendering, durable acknowledgements, and real-production tool
  journeys must be proven rather than inferred from unit or build checks.
- **BREAKING** for hosted mode only: tools whose providers require native
  addons, child processes, desktop cookies, or lack a proven direct or fixed
  relay path are absent from the hosted Pi tool set instead of failing after
  selection.

## Capabilities

### New Capabilities

- `browser-hosted-runtime`: Serverless browser runtime, shared surface
  boundaries, real Pi/OpenCandle execution where browser-safe, and hosted
  runtime transport.
- `browser-persistence`: Device-local Pi-compatible sessions, market state,
  secrets, migration, export/import, clear, and recovery.
- `browser-session-coordination`: Single-writer multi-tab behavior using
  browser coordination primitives.
- `installable-pwa`: Manifest, service worker, install/update lifecycle,
  offline shell, and runtime availability UX.

### Modified Capabilities

- `pi-synced-gui`: Define hosted-device canonical Pi session semantics without
  changing the local GUI/TUI filesystem source of truth.
- `provider-registry`: Classify every provider by browser transport and make
  hosted tool registration fail closed.
- `graceful-degradation`: Surface unavailable hosted capabilities and network
  loss without offering tools that cannot execute.

## Impact

- Runtime/session boundaries in `src/runtime/`, `src/pi/`, `src/memory/`, and
  `src/market-state/` gain injected platform adapters while existing native
  adapters remain the local defaults.
- `gui/shared/` remains the canonical event contract; `gui/web/` gains a
  transport abstraction and PWA build/runtime entry while the local server
  transport remains supported.
- `src/onboarding/providers.ts` and tool registration gain hosted-browser
  capability filtering.
- Browser dependencies include a maintained SQLite WASM distribution and PWA
  build support. WebContainer may remain an implementation fallback, but the
  product makes no claim of offline model/provider execution.
- Real-browser tests cover hosted PWA boot, chat/session reload, state
  persistence, provider gating, multi-tab safety, install/offline behavior,
  export/import/clear, and the unchanged local GUI.
- The feasibility measurements and boundaries formerly recorded under
  `plans/` move into this OpenSpec's design and requirements; the ad hoc plan
  directory is removed.
