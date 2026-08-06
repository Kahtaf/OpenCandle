# Add GUI Settings Page

## Why

Settings-shaped UI is scattered across six disjoint surfaces in the browser GUI: model keys live in a modal reached from the composer chip, data-provider credentials hide in a tab of the ⌘K catalog launcher, Diagnostics sits mislabeled inside the sidebar's "Market State" group, hosted data controls (export/import/clear secrets/clear all) live in an unlabeled `<details>` footer strip with native `confirm()` for the most destructive action in the product, and two settings stores (`user_preferences`, `tool_defaults`) have no UI at all — the agent writes them silently and users cannot see or delete them. A `/settings` route is already registered in `gui/web/src/router.jsx` but dead: `App.jsx` never dispatches it, so it silently renders chat.

## What Changes

- Add a full-page Settings surface at `/settings` (Claude-web-style page with a left section rail, not a modal), shared by the local and hosted GUI, with sections: Model, Data providers, Preferences, Notifications & automation, Diagnostics, and Data & privacy.
- Move data-provider configuration (api-key, external-tool, public-http builders) out of the ⌘K catalog's Providers tab into Settings → Data providers. The catalog keeps its Workflows and Tools tabs; existing `?drawer=providers&provider=<id>` deep links redirect into Settings.
- Relocate Diagnostics under Settings (nav entry leaves the "Market State" group; `/diagnostics` keeps working as a redirect into `/settings/diagnostics`).
- Move hosted data controls (export, import, install update, clear secrets, clear all) from `HostedRuntimePanel` into Settings → Data & privacy; the footer panel shrinks to a status-only strip. "Clear all" gains a typed-confirmation dialog replacing native `confirm()`.
- Add a Preferences section exposing agent-extracted `user_preferences` (risk profile etc.) and `tool_defaults` as viewable, deletable lists, backed by new read/delete commands on both the local WS/HTTP path and the hosted runtime path.
- Re-point existing entry points at Settings: composer model chip "Manage model keys…" and the transcript "Fix model key" CTA navigate to Settings → Model; Diagnostics per-provider "Connect" buttons navigate to Settings → Data providers. The first-run onboarding dialog is unchanged (same `ProviderKeyFlow` components, different frame).
- Report schedule configuration becomes reachable from Settings → Notifications & automation while remaining reachable from the Reports page (same form component).

Out of scope (follow-ups, not in this change): theme/appearance switching, a TUI `/preferences` command (dovetails with the existing `/forget` proposal), webhook URL editing (stays env-only; Settings shows a read-only status row), tool enable/disable toggles.

## Capabilities

### New Capabilities

- `gui-settings-page`: the Settings page itself — route resolution, sidebar nav entry, section rail and layout, Model section, Data providers section, Notifications & automation section, Data & privacy section, Diagnostics relocation, and redirects from legacy entry points.
- `preference-transparency`: visibility and deletion of agent-persisted `user_preferences` and `tool_defaults` from the GUI, with matching commands on local and hosted runtime transports.

### Modified Capabilities

- `doctor-health-diagnostics`: the "GUI Diagnostics Surface" requirement changes — Diagnostics is reached via Settings instead of a top-level Market State nav item, and `/diagnostics` becomes a redirect.
- `pi-synced-gui`: the catalog no longer carries a Providers tab (provider mirroring/degradation state moves to Settings → Data providers); "Manage model keys…" navigates to Settings instead of opening the standalone manage dialog.
- `browser-persistence`: the export/import/clear/recover user surface relocates from the hosted footer panel to Settings → Data & privacy, and destructive clearing requires typed confirmation.

## Impact

- **GUI web (shared)**: `gui/web/src/router.jsx` (live `/settings/$section?` route), `gui/web/src/App.jsx` + `gui/web/src/route-resolution.js` (page dispatch), `gui/web/src/features/sessions/SessionHistory.jsx` (nav groups), new `gui/web/src/features/settings/` feature directory, `gui/web/src/features/catalog/CatalogOverlay.jsx` (Providers tab removal, builders move), `gui/web/src/features/chat/model-selector.jsx`, `gui/web/src/components/chat/custom-message.jsx`, `gui/web/src/features/diagnostics/DiagnosticsPage.jsx` (reframed inside Settings), `gui/web/src/features/onboarding/*` (components reused, not redesigned).
- **GUI server (local)**: `gui/server/ws-hub.ts` + HTTP fallback routes for new `preferences.*` / `tool_defaults.*` commands; `gui/server/model-setup.ts` untouched in behavior.
- **Hosted runtime**: `gui/hosted/src/HostedRuntimePanel.jsx` (slims to status strip), `gui/hosted/src/runtime/browser-runtime-host.js` (same new commands; existing `hosted.data.*` handlers re-used by the Settings page).
- **Core**: `src/memory/storage.ts` / `src/memory/tool-defaults.ts` gain list/delete accessors if missing (SQLite schema unchanged).
- **Tests**: unit coverage for route resolution, nav rendering, settings sections, preference list/delete round trips; GUI release smoke gains a settings-page phase; screenshot harness gains settings capture phases.
- **Docs**: GUI quickstart and configuration docs sections referencing the catalog Providers tab, Diagnostics nav item, and hosted footer controls need updating.
