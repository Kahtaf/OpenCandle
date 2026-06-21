# Plan 009: Extract services from gui/server/server.ts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2a508ed..HEAD -- gui/server/`
> If `gui/server/server.ts` changed since this plan was written, re-derive the
> function inventory (`grep -n "^function \|^async function " gui/server/server.ts`)
> and compare against "Current state"; on a structural mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (writer-lock and broadcast semantics must not change)
- **Depends on**: none (but coordinate with plan 008's formatting commit)
- **Category**: tech-debt
- **Planned at**: commit `2a508ed`, 2026-06-11

## Why this matters

`gui/server/server.ts` is 826 lines owning HTTP routing, WebSocket dispatch,
session lifecycle, model/provider key setup, tool invocation, SSE chat runs,
quote polling, and the automation heartbeat — ~35 top-level functions sharing
module-level mutable state (`clients`, `poller`, `quotePollInFlight`,
`privateApiSessionToken`, heartbeat handles). It is a churn hotspot (22
commits since April), and the CHANGELOG shows repeated subtle bugs in exactly
the cross-cutting concerns this structure makes hard to isolate (shutdown
ordering, poller lifecycle, heartbeat guarding). Extracting cohesive modules
with explicit dependencies makes the next automation/GUI feature land in a
file with one job.

## Current state

Function inventory of `gui/server/server.ts` (line: name), grouped by the
target module that should own it:

- **HTTP layer (stays in server.ts)**: 111 `createServer`, 115 `handleHttpRequest`,
  215 `server.listen`, 546 `handleSseChatRun`, 774 `writeJson`, 794 `writeSse`,
  798 `readJsonBody`, 807 `contentType`, 779 `allowPrivateMarketStateApi`,
  786 `privateGuiHeaders`
- **WS hub → `ws-hub.ts`**: 248 `handleClientMessage`, 517 `sendBoot`,
  697 `broadcast`, 535 `broadcastModelSetup`, 539 `broadcastState`,
  689 `broadcastSessions`, 682 `currentChatEvents`, 671 `buildStateSnapshot`,
  701 `subscribeToSessionEvents`, plus the `clients` set
- **Session actions → extend existing `session-actions.ts`**: 322 `handlePrompt`,
  349 `handleAskUserAnswer`, 356 `handleAskUserCancel`, 361 `handleNewSession`,
  378 `handleOpenSession`, 386 `handleRenameSession`, 396 `handleDeleteSession`,
  637 `promptAndSettle`, 652 `replayObservedWorkflowPromptIfNeeded`
- **Model/key setup → extend existing `model-setup.ts`**: 407 `handleSaveModelApiKey`,
  435 `handleSaveProviderApiKey`, 475 `handleSelectModel`, 693 `buildCurrentModelSetupState`
- **Tool invocation → extend existing `invoke-tool.ts` / `tool-invoke-ack.ts`**:
  484 `handleToolInvoke`, 493 `handleToolInvokeMessage`
- **Quote polling → extend existing `background-quotes.ts`**: 732 `updatePoller`,
  742 `pollVisibleQuotes`, plus `poller`/`quotePollInFlight` state
- **Automation heartbeat → extend existing `automation-heartbeat.ts`**:
  708 `startLocalAutomationHeartbeat`, 716 `executeGuiAutomationHeartbeat`
- 366 `buildBootstrapPayload` → wherever `bootstrap` data assembly best fits
  (likely ws-hub or a small `bootstrap.ts`)

Note: sibling modules (`session-actions.ts`, `model-setup.ts`,
`background-quotes.ts`, `automation-heartbeat.ts`, `invoke-tool.ts`) ALREADY
EXIST — read each first; several of these handlers may be thin wrappers over
them already. The job is moving the remaining orchestration + state, not
creating parallel modules.

Tests: `tests/unit/gui-server/` has 21 files. Conventions: TS ESM, `.js`
import extensions, kebab-case files. Writer-lock rules (gui/AGENTS.md +
AGENTS.md "RUNTIME STATE"): one process holds `writer.lock`; followers are
read-only.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`                          | exit 0              |
| Targeted  | `npx vitest run tests/unit/gui-server`      | all pass            |
| All tests | `npx vitest run`                            | all pass            |
| Live run  | `npm run gui` then open `http://127.0.0.1:14567` | chat loads, send a prompt, market-state page renders, Ctrl+C exits cleanly on first press |

## Scope

**In scope**:
- `gui/server/server.ts` and new/extended sibling modules under `gui/server/`
- `tests/unit/gui-server/` additions/moves

**Out of scope**:
- Any behavior change: message protocol, broadcast payloads, lock semantics,
  endpoint paths, header behavior — this is a pure structural refactor.
- `gui/web/` (the React app).
- `src/` (agent core).
- Changing the heartbeat/poller intervals or shutdown ordering (recently
  fixed per CHANGELOG — preserve exactly).

## Git workflow

- Branch: `advisor/009-decompose-gui-server`.
- One commit per extracted module (6–7 commits), each leaving the server
  fully working; e.g. `Extract WS hub from gui server`.
- Do NOT push or open a PR unless instructed.

## Steps

For EACH group, in this order (smallest/safest first):

1. Quote polling → `background-quotes.ts`
2. Automation heartbeat → `automation-heartbeat.ts`
3. Model/key setup → `model-setup.ts`
4. Tool invocation → `invoke-tool.ts`
5. Session actions → `session-actions.ts`
6. WS hub → new `ws-hub.ts`

### Step pattern (repeat per group)

1. Read the target sibling module; if the handler is already a thin wrapper,
   move only the remaining glue.
2. Move the functions verbatim; convert shared module-level state into a
   small class or closure factory that server.ts instantiates once and passes
   dependencies into explicitly (e.g.
   `createQuotePoller({ sessionManager, broadcast })`). No logic edits.
3. Keep server.ts as the composition root: it constructs the services and
   wires them.

**Verify after EACH group**: `npx tsc --noEmit` → exit 0;
`npx vitest run tests/unit/gui-server` → all pass; commit.

### Final step: live smoke test

Run `npm run gui`, exercise in a browser: load chat, send a prompt, open the
market-state page, confirm quote refresh still occurs (watch server log),
Ctrl+C once → clean exit (this exact behavior was a recent fix; regression
here is a hard fail).

**Verify**: all of the above observed; `npx vitest run` → all pass.

## Test plan

- Move existing gui-server tests alongside extracted modules where naming
  makes sense (no assertion changes).
- Add one lifecycle test per extracted service with module-level state:
  - quote poller: starts when first client connects, stops at zero clients
    (`updatePoller` semantics), no overlapping polls (`quotePollInFlight`).
  - heartbeat: errors from `runLocalAutomationHeartbeat` are caught and warn,
    db handle closed in `finally` (mock `initDefaultDatabase`).
- Model on existing tests in `tests/unit/gui-server/`.
- Verification: `npx vitest run` → all pass.

## Done criteria

- [x] `npx tsc --noEmit` exits 0; `npx vitest run` exits 0
- [x] `wc -l gui/server/server.ts` ≤ ~350 lines
- [x] server.ts contains no `setInterval` except writer-lock heartbeat (or
      none, if that also moved with its owner)
- [x] Live smoke test performed and described in the final commit message
- [x] No behavior/protocol change (no test assertion edits beyond file moves)
- [x] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- A "move" can't be done without changing logic (hidden coupling through
  module state you can't cleanly inject) — report the coupling.
- Any existing gui-server test needs its ASSERTIONS changed (not just imports).
- The live smoke test shows regressions in: single-Ctrl+C shutdown, follower
  read-only mode, or mobile session refresh (all recently-fixed areas per
  CHANGELOG).
- Plan 008's formatting pass is mid-flight on `gui/server/` (diff churn).

## Maintenance notes

- server.ts is now the composition root; new GUI features should land as a
  service module + one wiring line, not as new top-level functions in
  server.ts — reviewers should reject additions that break this.
- The WS hub's `broadcast` is the chokepoint for follower/writer divergence;
  any future writer-lock change must re-run the live smoke test matrix above.
