# Design: Add GUI Settings Page

## Context

Settings-shaped UI is spread over six disjoint surfaces (2026-08 inventory, verified against source):

1. **Model/API keys** — `gui/web/src/features/onboarding/ModelSetupCard.jsx` (dialog, `first-run` and `manage` variants), `OnboardingCarousel.jsx`, `ConnectModelPanel.jsx`, `ProviderKeyFlow.jsx` (reusable two-step provider→key flow, explicitly written to mount standalone), `setup-dismissal.js`. Entry points: auto first-run open in `ChatPanel.jsx` (~199–220, 427–435), composer chip "Manage model keys…" (`features/chat/model-selector.jsx` ~126), Diagnostics "Model setup" button (`DiagnosticsPage.jsx` ~336 → `App.jsx` `onOpenModelSetup`, dialog mounted at `App.jsx` ~588), transcript "Fix model key" CTA (`components/chat/custom-message.jsx` ~20, wired in `ChatPanel.jsx` ~376).
2. **Data-provider credentials** — the Providers tab of the ⌘K catalog: `features/catalog/CatalogOverlay.jsx` — `TABS` (39), `ProviderRow` (396), `ProviderBuilder` (757), `ApiKeyProviderBuilder` (767), `ExternalToolProviderBuilder` (899), `PublicHttpProviderBuilder` (991), helpers at 1179+. Descriptor source: `src/onboarding/providers.ts` (`PROVIDERS`, 15 entries with `kind`, `tier`, `envVar`/`binary`, `browserTransport`). Deep-link grammar: `?drawer=providers&provider=<id>` validated in `router.jsx` `validateGuiSearch()`.
3. **Diagnostics** — `features/diagnostics/DiagnosticsPage.jsx` at `/diagnostics`, nav item inside the sidebar "Market State" group (`features/sessions/SessionHistory.jsx`, `MarketStateNav()` ~150).
4. **Hosted data controls** — `gui/hosted/src/HostedRuntimePanel.jsx`: a `<details>` footer with Install update / Export / Import / Clear secrets / Clear all (native `confirm()`), commands handled in `gui/hosted/src/runtime/browser-runtime-host.js` (~238–290).
5. **Report schedule** — slide-over on the Reports page (`features/market-state/MarketStatePage.jsx` `PAGE_META.reports`, panel branch ~540, form ~549–590).
6. **Composer model selector + thinking level** — `features/chat/model-selector.jsx` (stays).

Two stores have **no UI**: `user_preferences` (SQLite, `src/memory/storage.ts` — `upsertPreference`, `getPreferencesByNamespace`) and `tool_defaults` (`src/memory/tool-defaults.ts` — `getAllDefaults`). Both are written silently by the agent.

**Freebie**: `router.jsx` already registers a `settingsRoute` at `/settings` in `routeTree`, but `App.jsx` page dispatch and `route-resolution.js` `appPageFromPath()` never match it, so it renders chat. The shell does manual pathname dispatch (`App.jsx` ~497–566), not per-route components.

**Command transport conventions** (both must be served for any new command):
- Local: WS commands in `gui/server/ws-hub.ts` (~141–181: `model.setup.*`, `provider.save_api_key`, `provider.status.check`, `tool.enabled`) with trusted-session HTTP fallback routes.
- Hosted: `gui/hosted/src/runtime/browser-runtime-host.js` `handleCommand()` (137+) handles the same names plus `hosted.*`.
- Client access via `useGuiConnection.jsx` (`gui.send`, `gui.modelSetup`, `gui.catalog`, `gui.role`) and `runtime/runtime-transport.js` / `hosted-runtime-transport.js`.

Design references (screens in `tmp/screenshots/12-settings-diagnostics/`, `llm-01`…`llm-15`): Claude-web full-page settings with sidebar rail (`llm-06`), flat label/description/control rows (`llm-11`, `st-02`), destructive actions as quiet red rows (`llm-03`, `llm-12`), typed confirmation (`llm-04`), kicker-grouped rail (`llm-15`).

## Goals / Non-Goals

**Goals:**

- One Settings page at `/settings/<section>` shared by local and hosted GUI, composed almost entirely of existing components.
- Providers move out of the ⌘K catalog; Diagnostics moves out of the Market State nav group; hosted data controls move out of the footer.
- First UI for `user_preferences` and `tool_defaults` (list + delete only).
- Every legacy entry point keeps working via navigation/redirect.
- Tasks decomposed so independent agents can implement sections in parallel.

**Non-Goals:**

- No theme/appearance switching (follow-up; dark tokens exist but no switcher ships here).
- No editing of preference values (delete only), no tool enable/disable toggles, no webhook URL editing (read-only status row).
- No redesign of `ProviderKeyFlow`, `ConnectModelPanel`, provider builders, or the first-run onboarding dialog — they are reused as-is or with minimal prop additions.
- No TUI changes beyond nothing: TUI slash commands already cover this surface; explicitly out of scope.
- No SQLite schema changes.

## Decisions

### D1. Full page with section rail, not a modal

Claude-web pattern (`llm-06`) over ChatGPT's modal (`llm-01`). OpenCandle is already page-based (watchlists, diagnostics are pages), content is dense (15 provider rows, health tables), and the dead `/settings` route exists. Alternative (extend the ⌘K sheet) rejected: a launcher is the wrong frame for configuration, and it's what we're migrating away from.

### D2. Route shape: `/settings` + `/settings/$section`, dispatched by the shell

Add a `settingsSectionRoute` (`/settings/$section`) beside the existing `settingsRoute` in `router.jsx`; add a `"settings"` branch to `route-resolution.js` `appPageFromPath()` returning `{ page: "settings", section }`; add the corresponding branch in `App.jsx` page dispatch. Section slugs: `model`, `providers`, `preferences`, `automation`, `diagnostics`, `data`. Unknown slug → `model`. `/diagnostics` stays a registered route whose dispatch renders the Settings page with the diagnostics section active (canonical URL migration via redirect to `/settings/diagnostics` on mount). Rationale: matches the shell's manual-dispatch architecture; no TanStack per-route components introduced.

### D3. New feature directory `gui/web/src/features/settings/`

```
features/settings/
  SettingsPage.jsx        // shell: rail + section outlet, narrow-width tab strip
  sections/
    ModelSection.jsx      // wraps ConnectModelPanel (+ model select, thinking default)
    ProvidersSection.jsx  // provider rows + builders moved from CatalogOverlay
    PreferencesSection.jsx// user_preferences + tool_defaults lists
    AutomationSection.jsx // report schedule form + webhook status + automation note
    DiagnosticsSection.jsx// wraps existing DiagnosticsPage content
    DataSection.jsx       // hosted data actions / local paths readout
  provider-builders/      // ApiKeyProviderBuilder, ExternalToolProviderBuilder,
                          // PublicHttpProviderBuilder + helpers EXTRACTED from CatalogOverlay
```

The three provider builders and their helpers (`providerStatus`, `providerIcon`, `statusLabel`) are **moved** out of `CatalogOverlay.jsx` into `features/settings/provider-builders/` as named exports, imported by `ProvidersSection`. `CatalogOverlay.jsx` drops its Providers tab, `ProviderRow`, and builder code. Rationale: physical move (not copy) prevents drift; CatalogOverlay is ~1200 lines and shrinks meaningfully.

### D4. Model section reuses `ConnectModelPanel` unframed

`ModelSection` renders `ConnectModelPanel` (which already contains `ProviderKeyFlow`, hosted retention radio, setup-error band, model select, refresh) inside a section card instead of a dialog. `ModelSetupDialog`'s `manage` variant becomes unused by the composer and transcript CTA (both navigate to `/settings/model`); the dialog component remains solely for the `first-run` variant. `App.jsx`'s `onOpenModelSetup` handler becomes `navigate("/settings/model")` (Diagnostics section's model remediation likewise). Alternative (keep the manage dialog as a parallel surface) rejected: two competing key-management surfaces is the current problem.

### D5. Diagnostics content embeds, page component survives

`DiagnosticsPage.jsx` is refactored to export its report content as `DiagnosticsContent` (report fetch, bands, tiles, section tables, `SessionCheckDialog` untouched); `DiagnosticsSection.jsx` wraps it. The `/diagnostics` dispatch branch in `App.jsx` is replaced by the settings dispatch. Its per-provider "Connect"/"Providers" buttons and "Model setup" button change from `openCatalog(...)`/dialog-open to `navigate` calls (`/settings/providers?provider=<id>`, `/settings/model`).

### D6. Provider focus deep link via search param

`/settings/providers?provider=<id>` focuses/expands the matching row (scroll into view + expanded builder). `validateGuiSearch()` already validates a `provider` param; keep it. Legacy `?drawer=providers[&provider=<id>]` URLs: `App.jsx`'s drawer-opening effect maps `drawer=providers` to `navigate("/settings/providers", { search: { provider } })` instead of opening the catalog sheet. `drawer` enum keeps `providers` as an accepted value (redirect semantics) so old links never 404.

### D7. Preferences backend: four commands, two transports

New commands (names follow existing dot conventions):

- `preferences.list` → `{ preferences: [{namespace, key, value, source, confidence, updatedAt}], toolDefaults: [{toolName, paramPath, value, setAt}] }`
- `preferences.delete` → `{ namespace, key }`
- `tool_defaults.delete` → `{ toolName, paramPath }`
- (no separate tool_defaults.list; one list payload serves the section)

Local: handlers in `gui/server/ws-hub.ts` beside `provider.status.check`, backed by accessors in `src/memory/storage.ts` / `src/memory/tool-defaults.ts` (add `listAllPreferences()` and `deletePreference(namespace, key)` / `deleteDefault(toolName, paramPath)` where missing — plain SQL against existing tables, no schema change). HTTP fallback route added beside the existing trusted-session fallback routes. Hosted: same command names in `browser-runtime-host.js` `handleCommand()` against the browser SQLite. Delete is a mutation → writer-forwarded/disabled for followers per existing coordination rules (same path market-state mutations use). Alternative (expose via a market-state tool) rejected: these are runtime settings reads, not agent actions.

### D8. Typed confirmation dialog for hosted Clear all

New small `TypedConfirmDialog` built on the existing `AlertDialog` primitive: explanation list, an `Input`, destructive button disabled until the input equals a fixed word (`DELETE` — avoid locale-dependent phrases), following `llm-04`. Used only by DataSection's Clear all initially. Clear secrets keeps a plain AlertDialog confirm (destructive but recoverable by re-entering keys). Export/import/install-update reuse the exact `hosted.data.*` / service-worker flows from `HostedRuntimePanel` — that logic is extracted into `gui/hosted/src/hosted-data-actions.js` (plain functions taking the runtime handle) so both the slimmed panel (status + update) and the settings DataSection import it without duplicating flows.

### D9. `HostedRuntimePanel` slims to a status strip

Keeps: status dot, phase message, explanatory line, Install update button (update readiness is a runtime event, natural to surface where status lives), plus a "Manage data" link → `/settings/data`. Loses: export/import/clear controls and the data `<details>` menu. Hosted-only sections/rows are **absent** in local (not disabled): gate on the existing hosted detection (`report.runtime === "hosted-web"` / transport flag via `useGuiConnection`).

### D10. Sidebar nav: Settings gets its own group

In `SessionHistory.jsx`, `MarketStateNav()` drops the Diagnostics item; a second nav group ("App") renders below it containing a single Settings entry (gear icon, `to: "/settings"`, active when `currentPath.startsWith("/settings")` or `/diagnostics`). Alternative (add Settings inside the Market State group) rejected: mislabeling is the current bug.

### D11. Report schedule form extraction

The configure-report form body (~`MarketStatePage.jsx` 549–590) moves to a shared component `features/market-state/report-schedule-form.jsx` used by both the Reports slide-over (unchanged UX) and `AutomationSection`. Both dispatch the same `daily_watchlist_report {action:"configure"}` tool invocation.

## Risks / Trade-offs

- [CatalogOverlay extraction touches a 1200-line file other tabs depend on] → Move builders verbatim (git mv-style, no logic edits) in a dedicated task with unit render tests before/after; the Providers tab removal is a separate commit from the builder move.
- [Two settings surfaces briefly exist if tasks land out of order] → Task order below removes catalog Providers tab only after ProvidersSection lands; every task leaves the app shippable.
- [Follower/offline semantics for new delete commands] → Reuse the exact acknowledged-mutation path market-state mutations use (unwrap acknowledged GUI mutations, writer forwarding); scenario-tested on both transports.
- [`/diagnostics` bookmarks and tests reference the old page] → Route stays registered; dispatch renders the same content; GUI release smoke updated in the same task that flips dispatch.
- [Hosted `PreferencesSection` depends on browser SQLite readiness] → Section renders the same offline/read-only states as market-state pages (existing patterns in hosted transport).
- [First-run dialog regression risk from touching `ModelSetupCard`] → First-run variant is not modified; only the composer/transcript entry points change their target. Existing onboarding-carousel tests must stay green untouched.
- [Deleted preference reappears via preference extractor] → Acceptable and correct: deletion removes the stored row; the extractor may re-learn from future conversation. The section's empty-state copy states that the agent saves what it learns.

## Migration Plan

Pure additive UI reorganization; no data migration. Deploy order = task order (each task shippable). Rollback = revert; no schema or storage format changes. Legacy URLs (`/diagnostics`, `?drawer=providers`) keep resolving throughout.

## Open Questions

- None blocking. Post-ship candidates already scoped out: appearance section, tool enable/disable toggles, TUI `/preferences`, webhook editing.
