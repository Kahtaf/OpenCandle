## 1. Event Contract and Fixtures

- [x] 1.1 Define shared `ChatEvent`, `MessageContent`, `ToolOutput`, and error types in a GUI-safe shared module.
- [x] 1.2 Implement a pure event reducer that builds renderable chat state from ordered events.
- [x] 1.3 Add reducer tests for duplicate `seq`, out-of-order handling, replay reconstruction, tool failure, and message completion authority.
- [x] 1.4 Add recorded fixture traces for quote, comparison, options chain, news/search, SEC/company facts, macro/FRED, and generic fallback outputs.

## 2. Pi Session and Streaming Bridge

- [x] 2.1 Add or update GUI server endpoints for session list, session history windows, session resume, and active writer/follower state.
- [x] 2.2 Normalize Pi/OpenCandle live run output into the canonical `ChatEvent` stream.
- [x] 2.3 Serve chat run streams over SSE with stable sequence numbers and reconnect-safe completion behavior.
- [x] 2.4 Ensure GUI prompt sends and direct tool invocations write through Pi/OpenCandle session primitives.
- [x] 2.5 Add server tests proving TUI-created sessions appear in GUI history and GUI-created sessions remain resumable by the shared session layer.

## 3. TanStack App Shell

- [x] 3.1 Decide whether to replace `gui/web/` in place or introduce `gui/app/`, then update workspace scripts accordingly.
- [x] 3.2 Add TanStack Start, Router, and Query as GUI-only dependencies with pinned versions.
- [x] 3.3 Create typed routes for session list, active session chat, settings/onboarding surfaces, and not-found/error states.
- [x] 3.4 Configure TanStack Query with hierarchical query keys for sessions, session history, run state, and context-panel projections.
- [x] 3.5 Validate route search params and server/API inputs with schema checks.
- [x] 3.6 Document llmchat `packages/ui` as a visual/primitives reference only, including the exact upstream URL.

## 4. Chat UI Structure

- [x] 4.1 Build the chat-first shell with central chat, desktop session/sidebar affordances, and right-side financial context panel.
- [x] 4.2 Implement the composer with send, disabled/follower states, streaming abort affordance, and clear first-run API-key onboarding state.
- [x] 4.3 Implement `use-chat-run` or equivalent hook so high-frequency `message.delta` updates do not re-render sidebars or context panels.
- [x] 4.4 Implement message list grouping, progressive assistant deltas, final message replacement on completion, and readable error states.
- [x] 4.5 Code-split heavy chart/table renderers and avoid broad barrel imports in hot chat paths.
- [x] 4.6 Implement stop, retry/regenerate, copy message, and raw tool inspection controls without cluttering the default transcript.
- [x] 4.7 Implement keyboard-accessible command palette, focus-trapped drawers/dialogs, visible focus states, and labeled icon buttons/tooltips.

## 5. Tool Renderer Registry

- [x] 5.1 Implement the typed renderer registry with generic fallback and raw input/output inspection.
- [x] 5.2 Add stock quote and quote comparison renderers with compact summary and expanded detail states.
- [x] 5.3 Add historical prices/chart renderer with lazy-loaded chart code.
- [x] 5.4 Add fundamentals, options chain, FRED/macro series, news/search, SEC/company facts, and portfolio/watchlist renderers.
- [x] 5.5 Add renderer tests that preserve missing credential, stale data, partial data, and warning metadata.

## 6. Financial Context Panel

- [x] 6.1 Implement a pure projection from session/events to active symbols, recent tool results, watchlist cards, and suggested next actions.
- [x] 6.2 Render the desktop right-side financial context panel from the projection.
- [x] 6.3 Add mobile drawer/tab access to the same context projection.
- [x] 6.4 Add tests proving reconnect/reload rebuilds the context panel from canonical session state.

## 7. Session History and Mobile UX

- [x] 7.1 Implement desktop session history with visible resume controls and writer/follower status.
- [x] 7.2 Implement mobile session history access with the same resume behavior.
- [x] 7.3 Add empty states for first-time users with no API key, no sessions, and no active writer.
- [x] 7.4 Verify text, controls, and tool cards do not overlap across desktop and mobile viewports.
- [x] 7.5 Implement distinct UI states for onboarding, connecting, streaming, follower/read-only, failed, and ready.
- [x] 7.6 Add GUI provider/model setup flow that can test a key and return to the pending prompt.

## 8. Browser Verification

- [x] 8.1 Add Playwright or equivalent GUI tests for loading the app, selecting/resuming sessions, and sending prompts.
- [x] 8.2 Add a browser test for a stock quote prompt that asserts one quote card and one context-panel update.
- [x] 8.3 Add browser tests for options/news/SEC/macro renderer visibility using deterministic fixtures or mocked server streams.
- [x] 8.4 Add mobile viewport tests for session history, context drawer, composer, and tool output rendering.
- [x] 8.5 Add screenshot checks for the chat-first layout and key renderer states.
- [x] 8.6 Add browser tests for missing API-key onboarding, stop streaming, retry failed run, copy message, and keyboard command palette behavior.

## 9. Migration and Cleanup

- [x] 9.1 Keep the old GUI path available until the revamped shell passes parity tests.
- [x] 9.2 Switch `npm run gui` to the revamped shell after parity passes.
- [x] 9.3 Remove or archive replaced GUI components only after browser tests cover their intended behavior.
- [x] 9.4 Update GUI quickstart and developer docs with TUI/GUI sync, Tailscale access, and testing instructions.
- [x] 9.5 Run `npm test`, GUI build, and browser verification before marking the change complete.
