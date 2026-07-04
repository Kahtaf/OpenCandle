## Why

OpenCandle's new market-state pages are functional, but their current UI is form-first: creation and update forms sit above the user's saved state, page actions are uneven, and the pages do not yet feel like the same product surface as the chat-first local GUI.

The design direction is now clearer:

1. **llmchat is the primary interaction reference.** OpenCandle should feel like a chat/research workspace with a left session/navigation rail, a central answer or page canvas, and contextual detail/evidence surfaces where useful.
2. **Efferd is a pattern catalog, not a dependency.** Efferd app-shell and dashboard blocks are useful references for sidebar density, page headers, command search placement, grouped navigation, and management-page rhythm. OpenCandle should translate those patterns into OC-owned components.
3. **Consistency matters more than importing blocks.** The GUI already has local primitives and tokens. Adding Efferd/shadcn registry code now would create two competing component systems.
4. **The market-state pages should become durable workspaces.** Watchlists, portfolios, alerts, reports, and predictions should prioritize saved state, row-level context, and clear actions rather than permanent stacked forms.

This proposal captures a UI-only overhaul for those surfaces.

## What Changes

- Preserve OpenCandle's existing component system as the implementation source of truth.
- Use llmchat-inspired app information architecture for the overall GUI shell: left navigation/session rail, central work surface, optional right-side context/details panel, and mobile drawer equivalents.
- Use Efferd-inspired layout patterns as references for page headers, grouped navigation, compact toolbar placement, management-page tables, status rows, and empty states.
- Refactor the new market-state pages conceptually from "forms above tables" into state-first management pages.
- Move create/update flows into contextual sheets, drawers, inline detail panels, or row actions instead of permanent first-viewport forms.
- Define high-level layouts and UX expectations for Watchlists, Portfolios, Alerts, Reports, and Predictions/Thesis Tracker.
- Add restrained product-motion guidance using the transitions.dev catalog where it improves state comprehension.
- Formalize React Doctor evidence as a UI-review requirement so GUI React work maintains quality across state/effects, performance, architecture, security, and accessibility.
- Require browser verification across the affected GUI routes on desktop and mobile.

## Capabilities

### New Capabilities

- **`gui-market-state-ux`**: UI-only shell, page-layout, responsive, affordance, and motion requirements for the market-state GUI surfaces.

### Related Existing Capabilities

- **`market-state-user-experience`**: Existing behavior-level requirements for watchlists, portfolios, alerts, reports, predictions, and chat/page synchronization.
- **`pi-synced-gui` / previous local GUI changes**: Existing chat-first GUI direction and Pi session synchronization model.
- **`visual-identity`**: Existing product tone and visual identity constraints.

## Impact

- **GUI UI only:** This proposal affects layout, component composition, page hierarchy, empty states, responsive behavior, and browser verification expectations.
- **No data model changes:** No SQLite schema changes, migrations, persistence changes, or provider changes.
- **No alert semantics changes:** Existing manual/heartbeat/external-runner semantics remain owned by the market-state and automation specs.
- **No Efferd dependency:** Do not add `components.json`, shadcn registry config, copied Efferd block files, or Efferd runtime dependencies solely for this work.
- **No llmchat dependency:** Do not copy llmchat source or adopt its persistence/runtime model.
- **Review tooling:** Repo-local autoreview should run React Doctor for changed GUI React files and include the output as review evidence.
- **No TUI behavior changes:** TUI feature parity remains a product requirement, but this proposal only scopes GUI layout and interaction changes.

## Non-Goals

- Do not implement imports, multi-watchlist management, broker sync, trading, or hosted scheduling.
- Do not redesign the storage layer or tool contracts.
- Do not turn the Today page into a broker dashboard.
- Do not add decorative motion, page-load choreography, animated finance theater, or unsupported dark/crypto/fintech visual language.
- Do not replace OC primitives with Efferd/shadcn primitives.

## Superseded

- Symbol-centric market-state redesign, mobile-first layouts, bottom-sheet create/edit: shipped (CHANGELOG 0.6.0-era "GUI market-state pages were redesigned around symbol-centric layouts...").
- Predictions / "Thesis Tracker": feature removed entirely in 0.11.0 (tool, GUI page, `prediction_records` table dropped by v8 migration). Requirements targeting it are void.
- "Refresh prices" button requirements: manual refresh buttons were removed in favor of background quote snapshots and an "Updated Xm ago" freshness line. Void.
- Follower/read-only mode requirements: superseded by `transparent-local-session-coordinator` neutral-language requirement ("SHALL NOT show 'writer', 'follower', 'read-only follower', or 'take over' as the primary user-facing state").
- React Doctor gating: shipped via the autoreview pipeline changes (React Doctor pinned, diff-scoped scanning, error-level blocking).
