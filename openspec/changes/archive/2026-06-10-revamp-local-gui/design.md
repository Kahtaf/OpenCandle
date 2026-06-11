## Context

OpenCandle now has a local GUI, but it was built incrementally around the existing Pi web shell and still feels like an exposed agent log rather than a polished financial chat workspace. The user direction is settled:

- llmchat is UI inspiration only, not a dependency. The concrete reference is `https://github.com/trendy-design/llmchat/tree/main/packages/ui`.
- TUI and GUI must remain peer surfaces synchronized through Pi/OpenCandle session primitives.
- Chat is the primary screen.
- Desktop gets a right-side financial context panel; mobile gets equivalent drawer/tab access.
- Tool outputs need OpenCandle-specific renderers rather than generic JSON or repeated cards.

Recent chat UI ecosystems converge on a few useful practices: stream visible text as deltas, give tool calls stable IDs and lifecycle boundaries, represent errors explicitly, and keep replay/history reconstruction deterministic. OpenAI Responses streams use item/message lifecycle and text delta events; Vercel AI SDK's UI stream protocol treats stream parts as typed frontend messages; LangGraph exposes separate projections for messages, tools, lifecycle, checkpoints, and input. OpenCandle should normalize Pi/session events into a compact contract tailored to our UI instead of binding the browser directly to any provider-specific stream.

The llmchat UI package is useful as a visual and primitive reference because it demonstrates a compact Tailwind token system, cva-based component variants, lucide icon buttons with tooltip support, `cmdk` command palette primitives, `vaul` sheet/drawer primitives, Radix-style controls, subtle typography, and mobile-friendly overlays. OpenCandle should borrow those interaction qualities, not the package itself or its persistence/runtime assumptions.

## Goals / Non-Goals

**Goals:**

- Build a Pi-synced, chat-first GUI that can resume prior sessions and stay consistent with TUI history.
- Normalize GUI streaming around stable run/message/tool events with sequence numbers for replay and dedupe.
- Render OpenCandle financial outputs with first-class components.
- Make first-run model/provider setup legible when API keys are missing.
- Provide common chat controls for stop, retry/regenerate, copy, raw inspection, and keyboard command access.
- Use TanStack Start/Router/Query patterns if they preserve a plain adapter boundary to Pi.
- Structure React components to avoid data waterfalls, unnecessary streaming re-renders, oversized bundles, and browser-owned canonical state.
- Keep the GUI local and single-user for this change.

**Non-Goals:**

- Do not make llmchat a dependency or copy its persistence model.
- Do not copy llmchat source files directly into OpenCandle.
- Do not move canonical chat history into IndexedDB, localStorage, or TanStack Query cache.
- Do not replace the TUI or alter core financial tool behavior.
- Do not add hosted multi-user auth, sharing, or cloud sync.
- Do not allow the UI to invent financial values, ratios, prices, or analyst conclusions.

## Decisions

### 1. GUI and TUI are peer surfaces over Pi primitives

The GUI will consume Pi/OpenCandle session history and write new turns through the same session/runtime path used by the TUI. Browser-local state is allowed for layout preferences, selected panels, draft composer text, and transient optimistic display, but the source of truth for threads, messages, tool calls, and resume state remains Pi/OpenCandle storage.

**Alternative considered:** make the GUI app own a separate conversation store and sync opportunistically. This would make mobile history and resume easier in the short term, but it would immediately violate the TUI/GUI sync requirement and create split-brain history.

### 2. Normalize streams into OpenCandle chat events

The GUI server will expose a canonical event stream shaped around runs, messages, tools, and session updates:

```ts
type ChatEvent =
  | { type: "run.started"; runId: string; sessionId: string; seq: number }
  | { type: "message.created"; messageId: string; role: "user" | "assistant" | "system"; seq: number }
  | { type: "message.delta"; messageId: string; text: string; seq: number }
  | { type: "message.completed"; messageId: string; content: MessageContent[]; seq: number }
  | { type: "tool.started"; toolCallId: string; messageId: string; name: string; input: unknown; seq: number }
  | { type: "tool.delta"; toolCallId: string; chunk: unknown; seq: number }
  | { type: "tool.completed"; toolCallId: string; output: ToolOutput; seq: number }
  | { type: "tool.failed"; toolCallId: string; error: ToolError; seq: number }
  | { type: "run.completed"; runId: string; usage?: Usage; seq: number }
  | { type: "run.failed"; runId: string; error: RunError; seq: number }
  | { type: "session.updated"; sessionId: string; title?: string; updatedAt: string; seq: number };
```

Every event must have a monotonic `seq` scoped to the session or run stream. The UI reducer must be idempotent for already-seen `(sessionId, seq)` pairs. Tool cards are keyed by `toolCallId`, not by tool name or output text, which prevents repeated quote cards when a provider/tool emits multiple intermediate updates.

**Alternative considered:** directly render provider/Pi raw events. Raw streams are useful for debugging but too unstable for UI contracts, especially across OpenAI, Gemini, Pi, and direct tool invocation paths.

### 3. Use SSE for chat run streams, REST for history, optional WS for broad app state

SSE is the default transport for a single chat run because it is easy to replay, inspect, and test. REST endpoints provide session lists, history windows, and resume metadata. WebSockets can remain for dashboard-wide live updates if the existing server already benefits from them, but chat rendering should not require bidirectional sockets.

**Alternative considered:** use WebSocket for everything. It would work, but chat streams are naturally ordered server-to-client event logs; SSE matches that shape and simplifies browser tests.

### 4. TanStack Start is a shell candidate, not an agent boundary

TanStack Start may replace the current Vite shell if implementation confirms it can keep server functions/API routes as a thin local adapter over Pi. TanStack Router should own URL state for route/tab/session selection. TanStack Query should own server-state caching with query-key factories and targeted invalidation, but not canonical chat history.

Guidance from the installed TanStack skills applies:

- Validate server function and API-route inputs.
- Keep secrets and provider keys server-side.
- Use file-based/type-safe routes and validated search params.
- Use hierarchical query keys such as `["sessions"]`, `["session", sessionId, "history"]`, `["context", sessionId]`.
- Use route loaders and `ensureQueryData` for initial session lists/context where it improves perceived performance.

### 5. Component structure follows streaming and performance boundaries

React components should be split by update frequency:

```
gui/app/
  routes/
    __root.tsx
    index.tsx
    sessions.$sessionId.tsx
  features/chat/
    ChatShell.tsx
    MessageList.tsx
    MessageRow.tsx
    Composer.tsx
    stream-reducer.ts
    use-chat-run.ts
  features/context-panel/
    FinancialContextPanel.tsx
    ActiveSymbolCard.tsx
    WatchlistStrip.tsx
    RecentToolResults.tsx
  features/renderers/
    registry.ts
    StockQuoteRenderer.tsx
    QuoteComparisonRenderer.tsx
    HistoricalPricesRenderer.tsx
    FundamentalsRenderer.tsx
    OptionsChainRenderer.tsx
    MacroSeriesRenderer.tsx
    NewsResultsRenderer.tsx
    SecFactsRenderer.tsx
    PortfolioSummaryRenderer.tsx
    GenericToolOutputRenderer.tsx
  shared/api/
  shared/types/
```

High-frequency `message.delta` updates should be isolated to the active assistant message and should not re-render the session sidebar or financial context panel. Heavy renderers such as charts/options chains should be dynamically loaded and preloaded on intent where useful. Long histories should use stable item dimensions or virtualization/content-visibility to avoid scroll jank.

This follows the Vercel React guidance: start independent async work early, avoid waterfalls, import directly instead of using broad barrels, split expensive components, subscribe to derived state, use refs for transient stream state, and keep global event listeners deduplicated/passive.

### 6. First-class renderer registry

Tool output rendering is driven by a registry:

```ts
type ToolRenderer<T = unknown> = {
  toolNames: string[];
  canRender(output: unknown): output is T;
  summary(output: T): ToolSummary;
  Component: React.ComponentType<{ output: T; input: unknown; compact?: boolean }>;
};
```

The registry must include renderers for:

- stock quote
- quote comparison
- historical prices/chart data
- company fundamentals
- options chains
- FRED/macro series
- news/search results
- SEC filings/company facts
- portfolio/watchlist summaries
- generic JSON/text fallback

Renderer components must show a concise collapsed summary by default, support inspection of raw input/output, and avoid hiding material warnings, missing-provider notes, or stale-data flags.

### 7. Financial context panel is a projection, not another chat

The right-side panel is derived from the active session and recent events. It shows active symbols, latest quote cards, relevant recent tool results, watchlist state, and suggested next financial actions. It must not duplicate the full transcript or become a second source of truth. On mobile, the same projection appears in a drawer/tab reachable from the chat header.

### 8. Browser testing is part of acceptance

The proposal should be implemented with browser tests that replay representative chat prompts and assert that messages, tool cards, context panel cards, history, mobile drawers, and error states render correctly. The existing CLI-style manual harness should inspire the prompt set, but the GUI needs real DOM assertions and screenshots.

### 9. Onboarding and connection state are product surfaces

The GUI must distinguish "no model/provider API key configured", "provider setup in progress", "agent run connecting", "follower/read-only", and "stream failed". These states need explicit UI, not a single spinner. First-time users should see a compact setup path from the chat surface that can detect configured providers, test a key, and return to the pending prompt.

**Alternative considered:** keep setup as a terminal-only or hidden settings flow. That preserves the current technical boundary but causes the exact failure mode already observed: the role sits on "connecting" and the user cannot tell what action is needed.

### 10. Accessibility and keyboard behavior are required

The llmchat `packages/ui` reference uses accessible primitives such as Radix-style dialogs, command lists, tooltips, and sheets. OpenCandle should preserve that level of interaction quality: keyboard reachable command palette, focus trapping in dialogs/drawers, escape-to-close, visible focus states, semantic buttons, and icon buttons with labels/tooltips. Financial renderers must remain readable without relying only on color.

## Risks / Trade-offs

- **TanStack Start RC/pre-1.0 churn** -> Pin versions during implementation, keep the Pi adapter boundary plain HTTP/SSE/WS, and fall back to Vite if Start creates more complexity than value.
- **Duplicate state between TanStack Query and Pi sessions** -> Treat Query cache as a read-through cache only; all mutation success invalidates or appends from canonical Pi/session responses.
- **Streaming re-renders degrade typing/scroll performance** -> Isolate stream state in `use-chat-run`, use functional updates/refs for transient values, and keep sidebars/context panels subscribed to derived stable snapshots.
- **Tool renderer drift from provider schemas** -> Validate with tool result fixtures and keep a generic fallback visible for unknown shapes.
- **TUI/GUI writer races** -> Preserve the existing writer/follower lock behavior and add tests for takeover/resume paths.
- **Mobile history remains hidden** -> Make mobile session history a required route/drawer with explicit tests, not a responsive afterthought.
- **Onboarding regresses into ambiguous connection states** -> Model/provider setup states are explicit requirements and browser tests must cover missing-key first run.
- **UI primitives become inconsistent during rewrite** -> Use the llmchat `packages/ui` primitives as visual references for button density, command palette, sheets, typography, tokens, and tooltips while implementing OpenCandle-owned components.

## Migration Plan

1. Add the normalized event/types layer and tests against recorded Pi/OpenCandle session traces.
2. Build the new GUI shell in parallel to the current GUI entry point.
3. Implement session list/history/resume through Pi primitives before replacing the chat view.
4. Add the chat reducer and SSE stream handling with replay/dedupe tests.
5. Add first-class renderers and context-panel projection from tool/session events.
6. Add first-run onboarding/provider setup states and stream controls.
7. Add mobile layouts, accessibility coverage, and browser regression tests.
8. Switch `npm run gui` to the revamped shell once parity passes; keep rollback by retaining the previous build path until the change is accepted.
