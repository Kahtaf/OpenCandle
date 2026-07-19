# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). React Doctor clean on changed GUI files. GUI mutations keep the trusted-session checks and explicit session/action-id semantics — no new implicit-active-session path. Spec-conflict check DONE 2026-07-05: no `pi-synced-gui`/`local-session-coordination`/`chat-event-rendering` contradictions provided runs stay on the session-addressed routes with `sessionId`+`actionId`; no deltas needed beyond this change's own. The `src/pi/` touch (extension `markOriginalInput` skip) is ask-first, authorized by this proposal, scoped to exactly that.

## 1. Attach menu + image intake (client, TDD)

- [x] 1.1 Failing unit tests: attach menu opens from plus (catalog no longer bound); image validation (size/count/mime) with toasts; pending chips render/remove/clear-on-send and on session switch.
- [x] 1.2 Implement `attach-menu.jsx`, composer pending-attachments state, thumbnails; rebind the plus button; keep `/` and ⌘K catalog paths (add a regression test that `/` on empty composer still opens the catalog).

## 2. Run body + server (TDD)

- [x] 2.0 Extract per-object summary formatters into exported `src/market-state/summaries.ts` and refactor `buildSavedMarketStateContext` to compose them — byte-identical output proven by the existing prompt snapshots (run them before and after).
- [x] 2.1 Failing server unit tests: body validation 400s (bad mime, oversize, >4 images, unknown attachment kind, missing id); valid run threads `images` to `runSession.prompt(prompt, {images})`; saved-context attachment expands via the extracted formatters (no steering preamble in the block); server-written `opencandle-user-input` marker carries `{original: typedText, attachments}`; live adapter `originalPrompt` and session auto-naming receive the typed text.
- [x] 2.2 Implement route parsing + validation in `gui/server/http-routes.ts` (both chat-run routes share the parse site ~:360), threading in `gui/server/session-actions.ts`; marker write via `SessionManager.appendCustomEntry`; extension `markOriginalInput` skips covered turns (ask-first touch — test: workflow-dispatch attachment turn ends with exactly ONE marker whose `original` is the typed text); envelope gains attachment kind/count metadata; note the text-only replay limitation in code.
- [x] 2.3 Cross-process forwarding: NO code change (`proxyChatRunToCoordinator` forwards the body verbatim) — add the regression test that `images`/`attachments` survive the proxy (the 0.11.0 regression class).

## 3. Transcript rendering (TDD)

- [x] 3.1 Failing tests: user bubble shows typed text + chips (not the expanded block) live and after reload — including the workflow-dispatch double-marker case; image thumbnail renders from the stored user message.
- [x] 3.2 Implement: extend `chat-event-adapter.ts` to surface `attachments` beside `originalInputText`; render chips/thumbnails in `UserMessage` (`gui/web/src/components/chat/thread-message.jsx`, composed by `ChatPanel.jsx` — there is no `chat-rows.js` component).

## 4. Context drawer (TDD)

- [x] 4.1 Failing projector unit tests: `lastTurn` folded from seeded `opencandle-route-context` (+ `opencandle-validation`) entries — `slotSources` counted from the `slots` record's `source` values, `attachmentCount` from the turn's `opencandle-user-input` entry; validation reset on a newer route-context without validation; absent fields stay absent.
- [x] 4.2 Implement the `DashboardState.lastTurn` projection.
- [x] 4.3 Failing client tests: LastTurn and Receipts sections render from dashboard state; truthful-absence states ("no validation ran"); existing sections intact below.
- [x] 4.4 Implement drawer sections; swap `BarChart3` → `Eye`, retitle, update tooltip/aria.
- [x] 4.5 Document the drawer in the GUI quickstart docs page.

## 5. Browser e2e + evidence

- [x] 5.1 Extend `tests/e2e/gui-browser.test.ts`: attach portfolio → send → bubble shows chip; open drawer → Last-turn panel reflects the routed turn.
- [x] 5.2 Runtime evidence: screenshots 1440x960 + 390x844 (attach menu open with pending image; drawer with populated Last-turn/Receipts); browser-suite log excerpt in the PR.

## 6. Verification

- [x] 6.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; React Doctor clean.
- [x] 6.2 Live check: real GUI session — image attachment answered by a vision-capable model; portfolio attachment turn routes with the summary present in the dispatched prompt (trace excerpt).
- [x] 6.3 CHANGELOG `[Unreleased]` entries (attach; drawer reframe).
- [x] 6.4 `graphify update .`; `npx openspec validate composer-attach-and-context-receipts --strict`.
