# Local GUI cancellation — design note

Status: implemented in the `test-trust/fault-proof` worktree (uncommitted); parent
integrates into `test-trust-release-gate`.
Owner boundary: local GUI (`gui/server/`), browser transport/hook (`gui/web/`), and the
Pi session input-hook boundary (`src/pi/`).

## Problem

The browser Stop button only aborted the local `fetch` stream. The owning server kept
running the model/workflow, so a "stopped" turn could still write transcript entries and
side effects, and its busy lock stayed held. Two specific gaps:

1. **Stop did not reach the server.** `useChatRun.stopRun` called `AbortController.abort()`
   only; no `run.cancel` was ever sent. `run.cancel` existed in the coordinator action
   vocabulary but had no route or handler.
2. **`AgentSession.abort()` cannot cover input-hook routing.** Pi calls the extension's
   `input` hook before an agent run exists (`_isAgentRunActive === false`), and the router
   LLM await happens there. A Stop during that await aborted nothing, then the router's
   result still wrote preferences, recorded workflow runs, stashed route context, and
   dispatched workflows.

## Design

### 1. Per-session cancellation token (`src/pi/session-cancellation.ts`)

- `SessionCancellationState` owns `current: SessionCancellationToken | null`.
- Each run calls `startSessionRun(state)` to make a fresh token current; the extension
  captures it when the user turn begins and checks it after the router await.
- The state is attached to the `AgentSession` via a `WeakMap` (`attachSessionCancellationState`),
  so a GUI request holding the session can reach its token with no global registry and no
  method monkey-patching. `session-core.ts` creates the state, passes it to the extension,
  and attaches it after `createAgentSession`.
- `getSessionCoordinator(session)` (also a `WeakMap` in `session-core.ts`) lets the GUI
  retire the active workflow without owning the coordinator reference.

### 2. Extension guard (`src/pi/opencandle-extension-core.ts`)

- `OpenCandleExtensionOptions.cancellation?: SessionCancellationState`.
- The `input` hook captures `options.cancellation?.current` at entry and abandons an
  already-cancelled turn; `handleLlmRouterTurn` re-checks immediately after
  `await routeLlm(...)`, before any preference write, workflow record, route-context
  stash, or workflow dispatch.
- An abandoned turn appends an `opencandle-run-cancelled` entry (terminal, never a
  completed success) and returns `{ action: "handled" }` — no agent run, no dispatch.
- No prompt changes.

### 3. Explicit, authenticated, target-scoped cancellation (`gui/server/`)

- `run-cancellation.ts` holds a `GuiRunRegistry` keyed by session id. A run registers its
  original `actionId` before any await/session creation. `cancel(sessionId, targetActionId)`:
  matches only the currently registered run's action id (a stale Stop naming an older run
  is acknowledged `stale_target` and changes nothing), is idempotent for a repeated Stop,
  and applies a cancellation callback as soon as the session exists (covering an early
  Stop that lands before session creation).
- `applyGuiRunCancellation` retires a run: cancels the input token, calls
  `coordinator.cancelActiveWorkflow()`, and `AgentSession.abort()` for an already-active
  model/tool run.
- HTTP routes:
  - `POST /api/sessions/:id/run-cancel` — trusted-GUI cookie required; `actionId` and
    `targetActionId` required; unknown session → 404; safe `{ ok: true, cancelled: false }`
    when there is no matching active run.
  - `POST /api/local-coordinator/run-cancel` — `x-opencandle-coordinator-secret` required;
    `actionType` must be `run.cancel`. The browser route forwards to a live coordinator
    owned by another process with the authenticated secret (same owner-forwarding path as
    chat runs; the coordinator endpoint does not re-proxy).
  - The cancel action also passes through `localSessionCoordinator.runSessionAction`
    (`actionType: "run.cancel"`), giving duplicate-Stop idempotency keyed by the cancel
    action id. `run.cancel` is deliberately not a run-admission action, so it is never
    queued behind or blocked by the run it cancels.
- `streamAcceptedSseChatRun`: registers the run handle before its first await, wires the
  cancellation callback once the `AgentSession` exists, and on a cancelled run clears the
  pending action, does **not** record the action as accepted, and emits a terminal
  `run.failed` ("Run stopped.") instead of `run.completed`. The busy lock is retained
  until the deferred session disposal settles, as before.

### 4. Browser (`gui/web/`)

- `runtime-transport.js` gains `cancelChatRun(sessionId, body)` →
  `POST /api/sessions/:id/run-cancel`.
- `useChatRun.stopRun` builds `{ sessionId, actionId, targetActionId }` from the run's
  original chat action id, calls `transport.cancelChatRun` when present, then aborts the
  local stream. Helpers `chatRunCancelEndpoint` and `buildRunCancelRequestBody` are exported
  and unit tested.
- **Hosted transport (existing path, unchanged):** the hosted transport has no
  `cancelChatRun` method; `useChatRun.stopRun` aborts the caller signal passed to
  `startChatRun`. `host.streamRequest` in `gui/hosted/src/runtime/browser-runtime-host.js`
  turns that abort into a `{ type: "cancel", requestId }` process frame, and
  `gui/hosted/runtime/server.ts` aborts the active stream (which aborts
  `runAbortController` and the Pi prompt). So hosted cancellation is already server-side;
  the transport intentionally gains no new stub method. The hook only shows the
  unconfirmed-stop toast for an actual explicit `cancelChatRun` failure (the local
  loopback transport).

## Security / isolation

- Cancels are session-addressed: the registry is keyed by session id, so a Stop in one
  session never touches another.
- Trusted-GUI cookie (or coordinator secret) is required; unauthorized calls are rejected
  before the registry is consulted.
- Stale/unknown targets cannot cancel a newer or unrelated run.
- No secrets are logged or returned.

## Tests

- `tests/unit/pi/session-cancellation.test.ts` — token/state/WeakMap.
- `tests/unit/pi/opencandle-extension.test.ts` › `router cancellation` — cancelled routing
  writes no preferences, records no router/workflow entries, returns terminal; includes a
  held-router test where Stop lands while the router HTTP is still open.
- `tests/unit/pi/opencandle-extension-router-failure.test.ts` — a cancelled router that
  *rejects* never falls through to the agent.
- `tests/unit/gui-server/chat-event-adapter.test.ts` — the durable `opencandle-run-cancelled`
  custom entry is mapped to an understood terminal `custom.message` (previously dropped).
- `tests/unit/runtime/session-coordinator.test.ts` — `cancelActiveWorkflow` still records
  the durable `workflow_cancelled` closure and appends the failed terminal marker.
- `tests/unit/gui-server/run-cancellation.test.ts` — stale, duplicate, cross-session,
  no-active-run, early/start-race, queued-prompt clearing, and the
  token+workflow+abort applier.
- `tests/unit/gui-server/run-cancel-route.test.ts` — auth, required fields, unknown session,
  idle no-op, stale target, matching cancel.
- `tests/unit/gui-server/server-route-guards.test.ts` — cancellation only happens on an
  explicit run-cancel request, never on a passive request/response disconnect.
- `tests/unit/gui-web/use-chat-run.test.ts`, `runtime-transport.test.ts`,
  `hosted-runtime-transport.test.ts` — cancel body/endpoint, loopback POST, and the hosted
  signal-abort path (no separate cancel method).

Boundary: these are unit/in-process tests. The rendered `stopRun` wiring and the live
GUI Stop behavior are proven by the journey worker's browser journey, not by these unit
tests.

## Review invariants (2026-09-24)

Parent early review raised five points; all are now covered:

1. **Both router routes guarded.** `handleLlmRouterTurn`'s catch checks the run token
   before returning `false`, the post-await success check remains, and the `input` hook
   has a final post-`await` safety net. A cancelled rejection cannot fall through to the
   agent. `route()`'s internal fallback means client failures normally resolve rather than
   reject, so this is defence-in-depth; the mock-based test exercises the catch directly.
2. **Held router + lock lifetime.** Stop while the router HTTP is held leaves the run
   registered and the busy/writer lock held: `streamAcceptedSseChatRun` only releases run
   ownership after `promptAndSettle` (which awaits the input hook) returns, and after the
   deferred disposal for created sessions. The turn is suppressed when the held router is
   released. The strict held-router journey (hold response → Stop → release → assert no
   answer/tool call) is the journey worker's browser proof.
3. **Terminal + durable entry.** The extension records a durable `opencandle-run-cancelled`
   entry and the SSE emits the existing terminal `run.failed` with a cancellation message;
   the chat adapter now maps the entry to `custom.message` instead of dropping it.
4. **Cancelled workflow closure + queued prompts.** `cancelActiveWorkflow` now marks the
   run interrupted (keeping the ref) so `finishWorkflowRun` still records the failed
   terminal marker; `runner.cancel()` keeps writing the durable `workflow_cancelled` event.
   `applyGuiRunCancellation` additionally calls `AgentSession.clearQueue()` to drop queued
   workflow follow-up prompts.
5. **No disconnect-implies-cancel.** The only `activeGuiRuns.cancel(` calls live in the
   explicit `handleRunCancel`; no `close`/`aborted`/`error` listener triggers cancellation,
   locked by a source guard test.

## AbortSignal transport propagation (2026-09-24)

The token was bool-only, so a Stop during the router await left the real HTTP request in
flight (holding the run lock and provider cost) until the provider answered. The token now
carries a real `AbortSignal`:

- `SessionCancellationToken.signal` is backed by an `AbortController`; `cancel()` aborts
  it, `isCancelled()` reads `signal.aborted` (bool semantics preserved).
- `RouterLlmClient.complete(prompt, signal?)` accepts an optional per-call signal;
  `createPiAiRouterClient` forwards it into the pi-ai completion options
  (`SimpleStreamOptions.signal`), which the provider transport uses to close the request.
  Callers that pass no signal keep the previous behavior.
- `route(input, client, signal?)` forwards the signal to every `client.complete` call and
  never opens a retry for an already-aborted signal: it throws before the first request,
  and after an abort-like failure (or `signal.aborted`) it rethrows instead of retrying the
  validation pass or falling back.
- The extension wraps the injected/real client so the captured token's signal is always
  forwarded, and passes it to `route`. The existing post-await/catch token checks still
  suppress dispatch even if an upstream client ignores the signal.
- Tests: `tests/unit/routing/router-llm-client.test.ts` (signal forwarded into the Pi
  completion options), `tests/unit/routing/router.test.ts` (forward, already-aborted → no
  request, held request closes on abort with no retry, abort-like failure → no retry),
  `tests/unit/pi/session-cancellation.test.ts` (signal aborts on cancel), and
  `tests/unit/pi/opencandle-extension.test.ts` (Stop closes a held router request).

Honest boundary: the unit tests prove the signal reaches the Pi completion boundary; the
actual socket close is pi-ai/provider behavior and is covered by the journey worker's live
held-router proof, not claimed here.

## Queued corrections (2026-09-24, second review pass)

Concrete review points, all confirmed real and fixed with focused failing tests:

1. **Dispatch could still start a workflow after Stop during ticker preflight.**
   `dispatchRouterWorkflow` awaits `preflightCompareResolution` (which awaits
   `preflightSymbols`) for `compare_assets`; the outer post-await guard had already run, so
   a Stop during preflight still started the workflow. The captured token is now passed
   into `dispatchRouterWorkflow` and `preflightCompareResolution`; the token is checked at
   dispatch entry, immediately after the preflight await (before the fallback record/stash
   or `transformWorkflowInput`), and inside preflight before its drop/abort entries. The
   `isAnalysisRequest` comprehensive-analysis path has no await, so the entry guard plus
   the input hook's post-`await` guard cover it. Test:
   `opencandle-extension.test.ts` › "does not dispatch a compare workflow when Stop lands
   during ticker preflight" (failed with `compare_assets` still active, then passed).
2. **Stop swallowed cancel-transport errors and looked idle.** For transports that expose
   an explicit `cancelChatRun` (the local loopback transport), `stopRun` now surfaces a
   concise `setToast` on rejection and on `ok:false` (`RUN_CANCEL_UNCONFIRMED_MESSAGE`),
   while `ok:true, cancelled:false` (no active run / stale target) stays silent. The hosted
   transport has no `cancelChatRun` and cancels via its existing stream abort, so the hook
   shows no toast there. Passive disconnect semantics are unchanged: only an explicit Stop
   aborts the stream. Test:
   `use-chat-run.test.ts` › "reports an unconfirmed server stop only when cancellation is
   rejected or refused".
3. **Registry admission race before the busy set was populated.** A second concurrent
   `streamAcceptedSseChatRun` could pass `activeRunSessionIds.has` (not yet set) and
   overwrite the first run's record. `GuiRunRegistry.start` now returns `null` when the
   session already has an active run, and `streamAcceptedSseChatRun` answers `409
   session_busy`. Test: `run-cancellation.test.ts` › "refuses a second concurrent start
   instead of overwriting the original run" (verified failing against the pre-fix guard).


## Follower forwarding (same-owner release blocker, 2026-09-24)

The browser body is `{ sessionId, actionId, targetActionId }`, but the owner endpoint
`POST /api/local-coordinator/run-cancel` requires `actionType === "run.cancel"`.
`proxyRunCancelToCoordinator` forwarded `{...body, sessionId}` with no action type, so a
follower's cross-process Stop reached the owner and was rejected 400 — follower
cancellation was silently broken. The proxy now sets `actionType: "run.cancel"` after the
spread (a caller-supplied value can never override it).

Test: `tests/unit/gui-server/run-cancel-forwarding.test.ts` runs two real HTTP handlers
(follower + authenticated owner) with a real writer lock whose `pid` is a live child
process distinct from the test process. It POSTs the browser run-cancel route on the
follower, asserts the owner's registry cancellation fired with the original target action
id, and asserts a caller-supplied `actionType: "evil.override"` is ignored. Observed
failing with `400` before the fix and `200` after.
## Rendered cancelled message (fifth review pass, 2026-09-24)

The chat adapter maps the durable `opencandle-run-cancelled` entry to a `custom.message`,
which reaches `gui/web/src/components/chat/custom-message.jsx`. The generic fallback
rendered the internal custom type as a warning badge, so users would see a raw
`opencandle-run-cancelled` label. A minimal explicit case now renders a neutral
`<Badge variant="secondary">Stopped</Badge>` with the existing terminal content, and none of
the model-failure retry/fix-key controls. No styling redesign or new dependency; the file is
owned under this change.

Test: `tests/unit/gui-web/run-cancelled-message-render.test.ts` renders the real component
with `react-dom/server` and asserts the visible `Stopped` label, the content, the absence of
the internal custom type, and the absence of recovery buttons. Observed failing (raw badge)
before the fix and passing after. The journey worker verifies the visible label and reload
behavior.
