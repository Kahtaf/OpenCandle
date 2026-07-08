# Design — Composer Attach + Context Receipts

Decisions are made; do not redesign. File/line references verified 2026-07-05.

## 1. Attach menu (client)

- `gui/web/src/components/chat/chat-composer.jsx`: replace the Plus button's `onOpenCatalog` binding (lines 63-73; re-anchor by `aria-label="Open catalog"` if `cashtag-entity-layer` landed first) with an attach popover (`gui/web/src/features/chat/attach-menu.jsx`). Menu items: "Image…", "Portfolio", "Watchlist…" (submenu/list if multiple), "Latest report". ("Recent analysis" is CUT from v1: `recentResearch` rows carry no stable id and no stored answer text — resolving one means slicing another session's entries, undesigned; revisit after `shareable-answer-artifact`.)
- Composer state gains `pendingAttachments: Array<{kind:"image", data, mimeType, name} | {kind:"portfolio"|"watchlist"|"report"|"analysis", id?, label}>`, rendered as removable chips/thumbnails above the textarea. Cleared on send and on session switch.
- Image intake: `<input type="file" accept="image/png,image/jpeg,image/webp" multiple>`; client-side rejects >5 MB per file and >4 total with a toast; reads as base64.
- The `/`-opens-catalog empty-composer behavior and ⌘K are untouched. Remove only the plus→catalog wiring; keep `onOpenCatalog` prop plumbing intact for the slash/⌘K paths.

## 2. Run request + server

- Chat-run body (both `/api/local-coordinator/chat-run` and `/api/sessions/{id}/runs` in `gui/server/http-routes.ts`) accepts optional `images: [{data, mimeType}]` and `attachments: [{kind, id?}]` alongside `prompt`.
- Server validation (fail 400 with a specific reason): mime in the allowlist, base64 size ≤5 MB decoded, ≤4 images, attachment kinds in the enum, referenced ids exist. Validation lives beside the existing `prompt` parsing (~`http-routes.ts:360`).
- `gui/server/session-actions.ts` (~line 245): thread `images` through to `runSession.prompt(prompt, { images })` (Pi `PromptOptions.images`, `ImageContent` shape). The replay path (~line 285) stays text-only — replays of attachment turns re-send the recorded expanded prompt (see §3) without images; acceptable v1 limitation, note it in code.
- Saved-context resolution — **the "existing per-object builders" do not exist; this change owns creating them by extraction:** the only builder today is `buildSavedMarketStateContext(db)` (`src/runtime/session-coordinator.ts` ~:931) — module-private, monolithic (portfolio + watchlist + alerts + reports in one string), and prefixed with LLM steering instructions ("Use this saved user state to… 'Your positions' section") that MUST NOT appear inside an "Attached by user" block. Extract the per-object line formats into an exported `src/market-state/summaries.ts` (`formatPortfolioSummary`, `formatWatchlistSummary`, `formatLatestReportSummary` — data lines only, no steering text); `buildSavedMarketStateContext` is refactored to compose them (byte-identical output, prompt-snapshot-guarded); the GUI server resolves attachments by calling them through `MarketStateService` (already imported by `gui/server/market-state-api.ts`). Report text is available — report runs persist full text since 0.11.0. Dispatched prompt = typed text + `\n\n[Attached by user — <kind>]\n<summary>` blocks.
- Original-input recording — **decided mechanics (the naive "reuse `opencandle-user-input`" breaks three ways):**
  1. *Shape:* the adapter reads `data.original` only (`originalInputText`, `gui/server/chat-event-adapter.ts` ~:174-179). The server-written marker therefore keeps the `original` key — `{ original: typedText, attachments: [{kind, label}] }` — and the adapter is extended to surface `attachments` beside it.
  2. *Writer:* the server writes the marker via `SessionManager.appendCustomEntry("opencandle-user-input", data)` (the same `type: "custom"` entries the extension produces) before dispatching the run. The extension's own `markOriginalInput` (`src/pi/opencandle-extension.ts` ~:76-78; four call sites) would then append a SECOND marker on workflow-dispatch turns whose `original` is the server-expanded prompt — and the adapter keeps the LAST marker before the user message, so the expanded block would win. Fix: `markOriginalInput` skips writing when an unconsumed marker (no user message after it) already covers the turn. **This is a scoped `src/pi/` (ask-first) touch; this proposal is the authorization.**
  3. *Live path:* the live-stream user bubble uses `createLiveChatEventAdapter({ originalPrompt })` (`http-routes.ts` ~:585-591) and session auto-naming uses `prompt` (~:576-578) — both must receive the **typed text**, not the expanded prompt.
- Cross-process forwarding: `proxyChatRunToCoordinator` already forwards the entire JSON body verbatim (`{ ...body, sessionId }`) — no code change; add a **regression test** that `images`/`attachments` survive the proxy (the 0.11.0 regression class). The chat-run action envelope (`buildChatRunActionEnvelope`, ~:804-816) records only `{ prompt }`; add attachment kind/count metadata (not image bytes) to it for audit.

## 3. Rendering

- User bubbles render in `UserMessage` (`gui/web/src/components/chat/thread-message.jsx`), composed by `gui/web/src/features/chat/ChatPanel.jsx` (there is no `chat-rows.js` component file — the row grouping lives in the chat-events pipeline). Attachment chips come from the original-input entry's `attachments` via the extended adapter; image attachments render as thumbnails from the user message's Pi-native image content parts.
- No changes to assistant rendering.

## 4. Context drawer → "What the agent sees"

- `gui/web/src/features/context-panel/FinancialContextPanel.jsx` (exports `FinancialContextDrawer`): title "What the agent sees"; new `LastTurn` and `Receipts` sections above `MarketStateShortcuts`.
- `chat-composer.jsx:74-84`: icon `BarChart3` → `Eye` (lucide), tooltip/aria "What the agent sees".
- `gui/server/projector.ts`: `DashboardState` gains
  ```ts
  lastTurn?: {
    routeKind: string; workflow?: string; symbols: string[];
    slotSources: Record<string, number>;      // e.g. {user: 2, prior_context: 1, default: 1}
    priorTurnCount: number;
    savedStateIncluded?: boolean;             // render-if-present (from saved-state-personalization)
    attachmentCount?: number;
    validation?: { passed: boolean; mismatchCount: number };
  }
  ```
  folded from the latest `opencandle-route-context` entry (fields: `routeKind`, `workflow`, `entities.symbols`, `priorTurns.length`; `slots` is a `Record<string, RouterSlot>` — `slotSources` counts the `source` values across the record) and the latest `opencandle-validation` entry (`passed`, `mismatches.length`). `attachmentCount` is folded from the turn's `opencandle-user-input` entry's `attachments` array — NOT from route-context, which is extension-built and never sees attachments. Reset `validation` when a newer route-context entry arrives without a following validation entry.
- Every LastTurn/Receipts row renders only when its source field exists — the drawer must be truthful, never defaulted (no "0 mismatches" when no validation ran; show "no validation ran").
- Docs: add a "What the agent sees" subsection to the GUI quickstart page (currently the drawer is undocumented).

## 5. What stays put

- `ToolDrawerInline` unchanged. `CatalogOverlay` unchanged (only the plus binding moves). `MarketStatePage` routes unchanged.
