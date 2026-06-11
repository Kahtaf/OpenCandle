## Why

The current local GUI proves OpenCandle can run in a browser, but the chat experience is still too cluttered, tool output rendering is inconsistent, and session history/resume is not strong enough across mobile and desktop. We need a Pi-native GUI revamp that keeps TUI and GUI in sync while making financial-agent output feel like a first-class chat product.

## What Changes

- Replace the current GUI shell with a chat-first local web app inspired by llmchat's interaction model and UI primitives at `https://github.com/trendy-design/llmchat/tree/main/packages/ui`, without taking llmchat as a dependency.
- Keep Pi/OpenCandle session primitives as the canonical source of truth for both TUI and GUI; browser state may cache UI preferences but must not own chat history.
- Introduce a normalized run event model for GUI rendering and replay: run lifecycle, message deltas, tool lifecycle, tool output, errors, and session updates.
- Add first-class renderer slots for OpenCandle-specific outputs: quotes, quote comparison, historical prices/charts, fundamentals, options chains, FRED/macro series, news/search results, SEC/company facts, and portfolio/watchlist summaries.
- Add a desktop right-side financial context panel tied to the active chat/session, with mobile drawer/tab equivalents.
- Add first-run onboarding and provider/model setup states that make missing API keys actionable without trapping the user in a vague connecting state.
- Add standard chat affordances: stop streaming, retry/regenerate after failures, copy assistant output, inspect raw tool input/output, keyboard-accessible command palette, and clear empty states.
- Use TanStack Start as the proposed app shell if it can preserve a plain HTTP/SSE/WS runtime boundary to Pi; TanStack Router and Query patterns should guide typed routes, search state, loaders, cache keys, and server-state handling.
- Structure React components around Vercel React performance guidance: avoid data waterfalls, keep route/server boundaries explicit, code-split heavy renderers, minimize client state, and isolate high-frequency streaming updates.
- Preserve TUI behavior and existing agent/tool APIs; the GUI is an additional peer surface, not a replacement runtime.

## Capabilities

### New Capabilities

- `pi-synced-gui`: A chat-first local GUI surface that shares Pi/OpenCandle sessions with the TUI, supports session history/resume, and presents a right-side financial context panel on desktop with mobile equivalents.
- `chat-event-rendering`: A canonical event contract and renderer registry for replayable chat runs, streaming assistant deltas, stable tool lifecycle rendering, and first-class OpenCandle financial tool outputs.

### Modified Capabilities

None. The previous local GUI change has not been archived into `openspec/specs/`, so this proposal captures the revamped GUI behavior as new capabilities while replacing the existing implementation during apply.

## Impact

- **Code (likely new/reworked):**
  - `gui/app/` or replacement of `gui/web/` with a TanStack Start React app.
  - `gui/server/` endpoints for session history, run streaming, tool invocation, and context-panel projections.
  - Shared event and renderer types, kept outside browser-only modules.
  - Renderer modules for OpenCandle financial tool outputs.
- **Code (touched):**
  - Existing GUI server/session bridge to emit normalized events from Pi/OpenCandle session changes.
  - Existing GUI web package and build scripts.
  - GUI tests and manual UI harnesses.
- **Dependencies:**
  - Candidate GUI-only dependencies: TanStack Start, TanStack Router, TanStack Query.
  - Project-local skills installed for implementation guidance:
    - `.agents/skills/tanstack-start-best-practices`
    - `.agents/skills/tanstack-query-best-practices`
    - `.agents/skills/tanstack-router-best-practices`
- **Compatibility:**
  - TUI remains supported and must stay in sync through Pi primitives.
  - Existing OpenCandle tools remain the data source for financial values; the UI must not invent or hardcode financial data.
  - GUI remains local/single-user unless a later change introduces hosted multi-user behavior.
