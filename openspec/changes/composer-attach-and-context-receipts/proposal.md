# Composer Attach + "What the Agent Sees" Context Drawer

## Why

The two icon buttons beside the composer's model picker don't earn their slots (investigated 2026-07-05):

- The **Plus** button (`chat-composer.jsx:63-73`) opens the Catalog overlay — the *fourth* redundant entry point (⌘K, typing `/` in an empty composer, and the documented top-bar button all do the same), and it violates the universal chat convention that "+" attaches something to the conversation. Meanwhile the GUI has **no attachment affordance at all**, even though the Pi session layer already supports image input (`AgentSession.prompt(text, { images })` with `ImageContent = { type: "image", data, mimeType }`) — the GUI simply never wires it: every chat run body is `{ prompt }` only.
- The **BarChart3** button (`chat-composer.jsx:74-84`) opens the "Context" drawer — undocumented, untested, icon reads as "charts", and its content is a read-only dashboard mirror. Investigation confirmed there is **no persistent right-side research panel** it duplicates: the only right-of-chat element is `ToolDrawerInline` (an on-demand *per-tool-run* step timeline). The drawer is the sole surface for dashboard state, so the right move is to make it meaningful, not remove it.

The distinction going forward: **ToolDrawerInline answers "what did this one tool run do"; the context drawer answers "what shaped this turn — what did the agent see, and what are the receipts".** No overlap.

## What Changes

**Plus → Attach.** The plus button opens an attach menu:
- **Image(s):** file picker (PNG/JPEG/WebP, ≤4 images, ≤5 MB each); pending attachments render as removable thumbnails above the textarea; the chat-run request body gains an `images` array; the server validates (mime allowlist, size, count) and passes them through the session-action layer to `runSession.prompt(prompt, { images })`.
- **Saved context:** attach the portfolio, a watchlist, or the latest daily report ("recent analysis" is cut from v1 — no stable id or stored answer text exists; revisit after `shareable-answer-artifact`). The run body gains `attachments: [{kind, id?}]`; the server resolves each via per-object summary formatters extracted from the monolithic saved-state builder (new exported `src/market-state/summaries.ts` — data lines only, no LLM steering preamble) and appends "Attached by user" blocks to the dispatched prompt; the transcript renders the user's typed words plus attachment chips via a server-written `opencandle-user-input` marker that keeps the adapter's `original` key, with the extension's own marker writer taught to skip covered turns (a scoped ask-first `src/pi/` touch, authorized by this proposal) and the live-stream path fed the typed text.
- The plus button no longer opens the catalog. Catalog remains on ⌘K, `/`, and the top-bar button (the documented entry points).

**BarChart3 → "What the agent sees".** The context drawer is reframed as the turn-transparency panel:
- New top section **Last turn**, projected from the latest `opencandle-route-context` entry: route kind/workflow, resolved symbols, slot-provenance summary, prior-turns count, whether saved market-state context was injected (renders when the field exists — see `saved-state-personalization`), and attachment count.
- New **Receipts** subsection from the latest `opencandle-validation` entry (passed / mismatch count) and analyst-step progress for the active workflow.
- Existing sections (market-state shortcuts, recent quotes, analyses, research, data quality) stay below.
- Icon changes from `BarChart3` to `Eye`; tooltip and sheet title become "What the agent sees". The drawer gets documented in the GUI docs and covered by tests (it currently has neither).

## Non-Goals

- No document/PDF/CSV attachments in v1 (images + saved-state objects only; brokerage CSV import is a separate future change).
- No image persistence beyond what the Pi session already stores; no image editing.
- No removal of the ToolDrawerInline or changes to its behavior.
- No enforcement UI: the Receipts section renders observe-only validation data; claim-level receipt binding is the `answer-receipts` change.
- No TUI equivalent in v1.

## Relationship to Other Changes

- Renders richer data as `saved-state-personalization` (route-context saved-state field) and `answer-receipts` (claim bindings) land — both render-if-present, neither is a dependency.
- Coordinate composer-file merge order with `cashtag-entity-layer` (both touch `chat-composer.jsx`).
