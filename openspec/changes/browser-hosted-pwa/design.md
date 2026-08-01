## Context

OpenCandle currently has two local surfaces over one Node runtime. The TUI runs
Pi directly. The local GUI runs the same Pi/OpenCandle session behind a trusted
loopback HTTP, WebSocket, and SSE server, while `gui/web/` renders the canonical
`ChatEvent` stream from `gui/shared/`.

The completed `spikes/browser-runtime` work established the following on
2026-07-30:

- Chromium 145 booted WebContainer Node v22.22.3 and ran a prebuilt OpenCandle
  bundle without installing packages at runtime.
- The real Polymarket provider returned five bounded evidence items.
- A direct OpenAI fetch from the hosted browser was rejected by provider CORS.
  A live OpenAI key completed the real OpenCandle router only after the fixed,
  no-storage relay carried Pi's native streaming request.
- SQLite WASM 3.53.0 persisted through OPFS across reload and reset.
- Credential restoration, clearing, forged-message validation, and secret-leak
  checks passed in a real browser.
- Native `better-sqlite3`, Google auth's `child_process` dependency, X/Reddit
  desktop-cookie CLIs, custom forbidden headers, closed-tab work, and direct
  access to several provider origins did not work.
- Removing Pi's all-provider compatibility registry reduced the initial
  diagnostic runtime bundle from roughly 5.9 MB to 502 KB.
- The first full-turn composition uses Pi's real `Agent` loop and canonical
  `SessionManager` with the production OpenCandle extension lifecycle, while
  excluding Pi's coding-only `AgentSession` shell/TUI/package-discovery layer.
  The production composition now instantiates Pi's concrete `ModelRuntime`,
  not a hosted compatibility object, and filters a generated snapshot of Pi's
  installed catalog to browser-proven providers. Chromium 151 completed
  a live OpenAI router call and assistant turn in WebContainer Node v22.22.3,
  registered the production browser-safe Polymarket tool through the shared
  tool adapter, and returned canonical Pi entries projected into ordered
  `ChatEvent` records.
- The MIT-licensed `sql.js` 1.13.0 synchronous WASM build passed the shared
  `StateDatabase` suite against native `better-sqlite3`, including production
  schema initialization, transactions, constraints, memory, watchlists, and
  portfolios. Its database bytes survive a full WebContainer reload through
  OPFS.
- Canonical Pi JSONL and the default market-state watchlist survive a full page
  and WebContainer restart. The hosted runtime does not use React cache as its
  source of truth.

The hosted product must have no OpenCandle application server. WebContainer is
an external runtime dependency, not an OpenCandle server, and must be disclosed
as such. The PWA remains useful as an offline shell, but model and live-provider
operations require network access.

Pi's session manager writes canonical versioned JSONL through Node filesystem
APIs and does not currently expose a persistence backend. OpenCandle market and
memory state use synchronous `better-sqlite3`. Those constraints prevent the
existing `SessionCoordinator` from running unchanged in a normal browser
Worker.

## Goals / Non-Goals

**Goals:**

- Ship an installable static PWA that boots its runtime on demand and restores
  device-local sessions and market state without an OpenCandle server.
- Execute the real Pi agent loop and canonical Pi session manager inside
  browser-hosted Node for the first production increment.
- Reuse the existing React GUI, `ChatEvent` contract, reducer, routing, tools,
  evidence, workflow, provider, and model code.
- Make hosted web, local web, and local TUI platform adapters over one shared
  domain/runtime layer.
- Preserve byte-compatible Pi session entries so hosted sessions can be
  exported to and continued by local OpenCandle.
- Register only tools whose provider path is executable in hosted mode.
- Persist credentials, Pi session files, and OpenCandle state locally with
  explicit export, import, clear, migration, and recovery behavior.
- Keep one browser tab as writer and other tabs as safe followers.
- Test hosted and local web paths in real desktop and mobile browsers.

**Non-Goals:**

- An OpenCandle-hosted application API, credential storage, general-purpose
  proxy, account system, cloud sync, multi-user collaboration, billing, or
  server database. The separate audited relay has fixed data and model endpoint
  allowlists and receives credentials only when an upstream provider requires
  them.
- Browser support for Yahoo, FRED, SEC, TradingView, Brave, Exa, LSE, X, or
  Reddit until each has a direct browser-safe provider path.
- Closed-tab alerts, automations, reports, or background model execution.
- Pretending the PWA performs model or provider research while offline.
- Replacing the local GUI's trusted loopback server or the local TUI's native
  filesystem and SQLite adapters.
- A new chat/event/session format.

## Decisions

### 1. One core with three platform compositions

Shared OpenCandle code owns routing, planning, analysts, tools, workflows,
evidence, provider normalization, Pi entry semantics, and `ChatEvent`
projection. Each surface supplies platform adapters:

| Surface | Runtime | Session persistence | State database | UI transport |
| --- | --- | --- | --- | --- |
| Local TUI | native Node/Pi | Pi filesystem JSONL | `better-sqlite3` | in-process |
| Local web | native Node/Pi writer | Pi filesystem JSONL | `better-sqlite3` | loopback HTTP/WS/SSE |
| Hosted web | WebContainer Node/Pi writer | hydrated/checkpointed Pi JSONL in OPFS | WASM SQLite compatible adapter, checkpointed to OPFS | epoch-scoped process stdin/stdout RPC and events |

`gui/shared/chat-events.ts`, `gui/shared/event-reducer.ts`, and pure projector
logic remain the presentation contract. The React app receives a
`RuntimeTransport`; local builds inject the existing network transport and the
PWA injects the browser runtime transport.

Alternative considered: duplicate the GUI and runtime under `spikes/`. Rejected
because it would drift from local behavior and invalidate cross-surface parity.

### 2. WebContainer is the first hosted Pi runtime

The first production increment uses WebContainer because it has already booted
Node 22 and real OpenCandle code, and it can run Pi's filesystem-based session
manager without modifying upstream Pi. The runtime bundle imports only
browser-safe Pi providers and OpenCandle modules. Build-time dependency audit
fails on native addons, `child_process`, and external CLIs.

A direct browser Worker remains the preferred long-term simplification, but it
is gated on Pi exposing a pluggable session backend or a separately proven
filesystem virtualization layer. It is not allowed to block the installable
PWA.

Alternative considered: claim a normal Worker can run the current
`SessionCoordinator`. Rejected because Pi session files and OpenCandle native
SQLite are hard dependencies today.

### 3. Host storage is canonical for a hosted device

For hosted mode, OPFS holds canonical device-local data:

- Pi session JSONL retains the upstream schema, entry IDs, parent IDs, custom
  `opencandle-*` entries, and session version.
- OpenCandle state is stored as a SQLite file using the same schema version and
  migration semantics as local mode.
- Secrets use a separate browser secret store and are never written into
  session JSONL, state SQLite, runtime bundles, URLs, command arguments,
  responses, or logs.

At boot, the host mounts OPFS snapshots into WebContainer. The real Pi session
manager reads and appends its normal files. After each committed entry or state
mutation, the runtime emits a checkpoint notification and the host copies the
updated bytes back to OPFS before reporting the action durable.

Export produces validated Pi JSONL plus an OpenCandle state snapshot. Import
validates versions and identities before writing. This provides portability to
local OpenCandle without claiming browser and local files are simultaneously
shared.

Alternative considered: treat React cache or localStorage as session history.
Rejected because derived UI state is not canonical and cannot preserve Pi tree
semantics.

### 4. A narrow database contract preserves synchronous domain code

Introduce an OpenCandle `StateDatabase` contract for the synchronous SQL
operations actually used by memory and market-state services. The existing
`better-sqlite3` database is the default native implementation. Hosted mode
uses the MIT-licensed `sql.js` 1.13.0 synchronous WASM implementation inside
WebContainer and flushes the database file before checkpoint acknowledgement.
The CommonJS distribution is mounted as a runtime sidecar so WebContainer's
Node-compatible filesystem loader can resolve the WASM asset without bundling
native Node shims into the browser host.

The adapter must pass a schema and behavioral conformance suite shared with the
native adapter. Production services do not import browser packages.

Alternative considered: make every state service asynchronous over host Worker
RPC. Rejected for the first increment because it would force a broad
behavior-changing rewrite through memory, market state, workflows, and tools.

### 5. Runtime transport is presentation-neutral

`RuntimeTransport` exposes the operations already required by the React client:

- bootstrap/setup and capability snapshots;
- session list/open/create;
- ordered chat events and run lifecycle;
- chat submission and cancellation;
- explicit tool actions;
- market-state reads and writes;
- export/import/clear and runtime health.

The transport uses the existing shared request/event shapes. The hosted
implementation uses WebContainer's process stdin/stdout pipes with an
allowlisted operation set, runtime epoch, 128-bit request IDs, and bounded
messages. It does not expose a preview iframe or runtime HTTP bridge. Live
events include session and run IDs and pass through the existing reducer
unchanged.

### 6. Provider and tool availability fail closed

`ProviderDescriptor` gains a browser transport classification:

- `direct`: callable from the hosted runtime without an OpenCandle proxy;
- `proxy`: technically requires a proxy and is unavailable in this serverless
  release;
- `blocked`: requires a native process, desktop cookie, forbidden header, or
  otherwise unsupported capability.

Unknown classifications default to blocked. Hosted tool construction receives
a capability manifest and omits tools without a direct provider path. Runtime
checks remain as defense in depth and degradation diagnostics name unavailable
capabilities explicitly.

The initial direct set is proven or individually browser-tested before release.
The known candidates are Polymarket, CoinGecko, Fear and Greed, Alpha Vantage
with a user key, and Finnhub with a user key. Classification is evidence-based,
not inferred from API documentation alone.

### 7. Browser writer/follower mirrors local coordination

Hosted mode uses Web Locks for writer election and BroadcastChannel for
follower state/events and action forwarding. Only the writer owns WebContainer
and OPFS write/checkpoint operations. Followers render the same event stream
and forward writer-only intents. On writer loss, one follower acquires the lock,
rehydrates from the last durable checkpoint, and announces a new runtime epoch.

The runtime epoch prevents late events from a dead writer from being applied.

### 8. The PWA caches only the shell

The service worker precaches versioned static assets, manifest, icons, and an
offline route. It does not cache model responses, provider responses, keys, or
runtime process traffic. Offline mode allows opening and exporting existing
local sessions but disables research actions with explicit reason text.

Updates are user-visible. A new worker waits until the current run is idle and
durable before activation. Database/session migrations complete before the
new runtime accepts writes; failure leaves the prior durable data untouched.

### 9. Security claims remain narrow

Credentials in browser storage are exposed to same-origin script compromise,
browser extensions, physical access, and compromised dependencies. The PWA:

- offers persistent and session-only key modes;
- uses COOP/COEP isolation, no third-party scripts in the product page, pinned
  dependencies, and bundle composition audits. The host communicates with the
  runtime only through spawned-process pipes using an epoch, request ID,
  operation allowlist, and bounded frames;
- configures WebContainer with a public build-time client ID before boot and
  uses `strict-origin-when-cross-origin` so StackBlitz receives only the hosted
  origin required to authorize its iframe, never a path or query;
- never logs or renders raw credentials;
- clears secrets separately and verifies clearing in browser tests;
- discloses the WebContainer/StackBlitz dependency and never calls itself
  fully offline or infrastructure-free.

### 10. Pi model setup is canonical across surfaces

Model discovery, provider labels, default models, credential validation, and
selection semantics come from one OpenCandle model-setup contract backed by
Pi's model registry and provider implementations. Local GUI, local TUI, and
hosted web may supply different credential stores and transport adapters, but
they do not maintain independent model lists or reimplement provider protocols.

Hosted web applies a capability filter after proving a Pi provider in a real
browser. The initial browser-safe first-class set is OpenAI, Anthropic, and
Google. Every model in Pi's installed catalog for those providers is exposed;
there is no literal hosted default such as `gpt-4.1-mini`. Providers that
require OAuth callbacks, native processes, cloud credential chains, or other
unproven browser capabilities remain absent with an explicit reason.

The provider-specific request and stream implementations still come directly
from Pi. A single shared fetch adapter routes only the three proven model API
origins through the Worker's raw streaming endpoint because those origins do
not provide the required browser CORS contract. The Worker validates exact
host, path, method, headers, credential placement, size, time, origin, and rate
limits; it never interprets model payloads or implements a second model client.

The selected Pi model is the single source of truth for both the OpenCandle
router and the Pi agent stream. Credentials are keyed by provider so switching
models does not erase unrelated provider setup. Model setup state and request
shapes are shared where possible; only browser storage, process transport, and
browser capability filtering are hosted adapters.

Alternative considered: keep the spike's OpenAI-only compatibility module and
add model IDs to a hosted array. Rejected because it duplicates Pi routing,
drifts from the local GUI/TUI, and can silently use one model for routing and a
different one for the answer.

### 11. Feature parity is a shared-core requirement, not parallel implementations

The hosted surface applies capability filters to canonical OpenCandle
features. It does not maintain independent tool catalogs, workflows,
market-state commands, ask-user state, action deduplication, live-event
projection, attachment parsing, or transport payloads. Shared headless
session and command cores own those behaviors; hosted adapters are limited to
browser transport, secrets, OPFS checkpoints, SQLite WASM, provider capability
filtering, and unavailable background/native execution.

An unavailable browser capability is omitted with a reason. A capability that
is available in the browser must reuse the local GUI/TUI implementation and
its contract tests rather than a similar hosted implementation.

The production implementation applies that rule at the following concrete
seams:

- `createOpenCandleSessionCore` returns the canonical Pi session and workflow
  coordinator handle used by local and hosted compositions. Hosted mode keeps
  one long-lived Pi session per session ID instead of rebuilding a partial
  extension lifecycle for every turn.
- One live chat-event adapter projects Pi events on both web surfaces. Durable
  JSONL projection remains the recovery fallback, and cancellation or provider
  failure continues sequence numbering after already-streamed events.
- Canonical watchlist, portfolio, alert, report, and notification tool
  factories accept an injected `StateDatabase`. Native local mode and WASM
  hosted mode differ only in the database adapter and browser-safe provider
  capability filter. Exact symbols entered through hosted saved-state forms
  use one explicit factory policy instead of a parallel hosted command
  interpreter; local tools retain provider-backed symbol verification.
- Quote, portfolio valuation, sparkline, and market-index snapshots share one
  browser-safe assembler. Platform code supplies state and provider fetchers;
  it does not recalculate totals independently.
- Accepted and pending action markers use Pi session sidecars with input
  fingerprints. OPFS checkpoints include the sidecars, so writer failover and
  runtime restart preserve exactly-once behavior. A request-scoped stdio
  checkpoint handshake durably admits each streamed action before Pi starts
  paid work. Chat actions become accepted after Pi completes the prompt, or
  after a terminal prompt failure when the canonical session proves that Pi
  already persisted the user message. Accepted transitions are checkpointed
  before the result is returned. A restored admission whose start state is
  ambiguous remains durable and reports that ambiguity instead of silently
  succeeding or replaying paid work.
- Thinking levels are read and changed through Pi's `AgentSession` methods and
  the shared model selector. Provider credentials continue to use the shared
  provider setup UI. Hosted JIT prompts may direct users there, but secret text
  is never collected through `ask_user`, because ask-user answers are durable
  session content.
- Hosted Pi session construction is single-flight per canonical session and the
  reusable session cache is bounded. Only active runs may temporarily exceed
  the cache limit; settled sessions are evicted and disposed least-recently.
- Persistence-only mutation retries record the canonical accepted-action marker
  before acknowledging their checkpoint. Empty sessions retain a previously
  selected Pi thinking level, and clearing model credentials clears the
  browser's projected thinking controls.
- The hosted runtime transport requires Pi's streaming request boundary. It
  does not synthesize live events from a completed response, and HTTP fallback
  command restoration uses the shared GUI protocol metadata.
- Quote refreshes use a shared latest-request gate in the React data hook, so
  overlapping background refreshes cannot overwrite newer saved market state.

The removed spike HTTP server, hosted market-state command interpreter,
hosted action allowlist, and hosted live-event adapter are intentionally not
retained as fallbacks. Stdio transport, OPFS persistence, and browser secret
storage are the only hosted-specific runtime responsibilities.

## Risks / Trade-offs

- **WebContainer availability or licensing changes** -> disclose the dependency,
  isolate it behind `BrowserRuntimeHost`, and retain a direct-Worker migration
  seam.
- **Checkpoint loss between container write and OPFS copy** -> do not report an
  action durable until the matching checkpoint succeeds; replay the last
  durable Pi entries after crash.
- **WASM SQLite incompatibility with native behavior** -> run shared schema,
  transaction, migration, memory, portfolio, watchlist, and alert conformance
  tests before enabling each surface.
- **Provider CORS behavior changes** -> maintain live opt-in browser probes and
  fail closed on missing proof.
- **Reduced hosted tool surface** -> show the exact capability matrix before a
  turn and exclude unavailable tools from Pi rather than failing late.
- **Browser key theft through XSS or dependency compromise** -> strict page
  policy, process-frame validation, dependency/bundle audits, session-only
  option, and honest onboarding copy; browser persistence is not represented
  as a secure vault.
- **Two writers corrupt OPFS or session history** -> Web Locks,
  BroadcastChannel epochs, exclusive checkpoints, and two-tab browser tests.
- **PWA update crosses schema versions** -> backup before migration, atomic
  version marker, and rollback to the prior static shell when migration fails.
- **Hosted/local behavior drifts** -> shared contracts, JSONL and SQLite
  conformance tests, and real-browser regression coverage for both builds.

## Migration Plan

1. Land platform contracts with native adapters and prove local GUI/TUI behavior
   is unchanged.
2. Turn the feasibility spike into browser runtime test fixtures and retain its
   measured failure boundaries in this change.
3. Implement hosted session/state adapters and cross-surface conformance tests.
4. Add hosted capability filtering before enabling the Pi tool loop.
5. Add `BrowserRuntimeTransport` and run one real hosted chat turn through the
   existing React GUI.
6. Add OPFS durability, export/import/clear, multi-tab coordination, and PWA
   lifecycle.
7. Ship behind an explicit hosted build entry and capability warning. Local GUI
   and TUI remain the default rollback path.

Rollback removes the hosted build/deployment entry. Native adapters and shared
contracts remain because they preserve existing behavior and improve
testability.

## Open Questions

- Can WebContainer session files be checkpointed after every Pi append without
  an upstream Pi change, or is a minimal upstream callback required?
- Which direct-provider candidates pass live browser CORS tests consistently
  enough to enter the initial capability manifest?
- Where will the static PWA be hosted, and can that host guarantee required
  COOP/COEP, CSP, service-worker scope, and immutable asset caching?
