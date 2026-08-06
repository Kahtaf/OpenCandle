# Tasks: Add GUI Settings Page

Parallelization map (after group 1 lands, lanes are independent):

- **Lane A** (groups 2–3): settings shell + Model section + entry-point repointing
- **Lane B** (group 4): provider builders extraction + Providers section + catalog slimming
- **Lane C** (group 5): preferences backend + Preferences section
- **Lane D** (group 6): Automation + Data & privacy sections + hosted panel slimming
- **Group 7** (Diagnostics relocation) depends on group 2 only; can run parallel to B/C/D.
- **Group 8** (verification/docs) last.

Repo conventions apply to every task: TDD (write the failing test first), `.js` extensions on relative imports, kebab-case files, no em dashes in copy, `npm run lint` + `npm run typecheck` clean, update CHANGELOG at the end (task 8.5). Existing tests that must stay green untouched: onboarding-carousel tests, ui-primitives-render tests.

## 1. Settings shell and routing (blocks everything else)

- [x] 1.1 Add `settingsSectionRoute` (`/settings/$section`) alongside the existing `settingsRoute` in `gui/web/src/router.jsx` and include it in `routeTree`. Keep `validateGuiSearch()`'s `provider` param. Failing test first in `tests/unit/gui-web/` (route-resolution test file): `/settings` → `{page:"settings", section:"model"}`, `/settings/providers` → `{page:"settings", section:"providers"}`, `/settings/bogus` → section `"model"`, `/diagnostics` → `{page:"settings", section:"diagnostics"}`.
- [x] 1.2 Extend `gui/web/src/route-resolution.js` `appPageFromPath()` with the `settings` page + section parsing per 1.1's tests (section slugs: `model`, `providers`, `preferences`, `automation`, `diagnostics`, `data`).
- [x] 1.3 Create `gui/web/src/features/settings/SettingsPage.jsx`: full-page layout with left section rail (order: Model, Data providers, Preferences, Notifications & automation, Diagnostics, Data & privacy), rail items navigate to `/settings/<section>`, active item derived from the resolved section, narrow widths collapse the rail to a horizontally scrollable tab strip above content (no document-level horizontal overflow). Section bodies render placeholder stubs for now (each lane fills its own). Use existing card/row primitives from `gui/web/src/components/ui/`.
- [x] 1.4 Dispatch the page in `gui/web/src/App.jsx`: add the `settings` branch before the chat fallback; `/diagnostics` branch now renders `SettingsPage` with the diagnostics section active and replaces the URL with `/settings/diagnostics` on mount. Verify `/settings` no longer renders `ChatPanel` (unit test on dispatch given resolved page).
- [x] 1.5 Sidebar nav in `gui/web/src/features/sessions/SessionHistory.jsx`: remove Diagnostics from the `MarketStateNav()` array; add a new nav group below Market State containing a Settings entry (gear icon from lucide, `to:"/settings"`, active when path starts with `/settings` or equals `/diagnostics`). Render test: nav shows Settings group, no Diagnostics item under Market State.

## 2. Model section (Lane A)

- [ ] 2.1 Create `features/settings/sections/ModelSection.jsx` rendering the existing `ConnectModelPanel` (from `features/onboarding/ConnectModelPanel.jsx`) inside a section card frame, fed by `useGuiConnection()` model-setup state exactly as the manage dialog feeds it today (see `ModelSetupCard.jsx` manage variant for the prop wiring). Hosted key-retention radio comes along for free inside `ProviderKeyFlow`. Render test: section renders provider list, model select, and refresh without a dialog wrapper.
- [ ] 2.2 Verify save/select/thinking behavior parity: reuse or adapt the existing model-setup interaction tests to run against `ModelSection` (probe-before-save, inline error band, `model.setup.select_model`, `model.setup.set_thinking`). No changes to `gui/server/model-setup.ts` behavior.

## 3. Entry-point repointing (Lane A, after 2)

- [ ] 3.1 Composer: in `gui/web/src/features/chat/model-selector.jsx` (~126), replace the "Manage model keys…" dialog-open action with navigation to `/settings/model`. Remove the now-dead manage-dialog mount from the composer path. Test: activating the item navigates; no `ModelSetupDialog` with `variant="manage"` mounts from the composer.
- [ ] 3.2 Transcript CTA: in `gui/web/src/components/chat/custom-message.jsx` (~20) / `ChatPanel.jsx` (~376), "Fix model key" navigates to `/settings/model`.
- [ ] 3.3 App-level: change `App.jsx` `onOpenModelSetup` to `navigate("/settings/model")`; delete the app-level manage `ModelSetupDialog` mount (~588) if nothing else uses it. First-run auto-open in `ChatPanel.jsx` is untouched (`variant="first-run"` only). Confirm onboarding-carousel tests still pass unmodified.
- [ ] 3.4 First-run guard test: completing or dismissing first-run onboarding does not navigate to `/settings`.

## 4. Providers section and catalog slimming (Lane B)

- [ ] 4.1 Extract provider builders verbatim from `gui/web/src/features/catalog/CatalogOverlay.jsx` into `gui/web/src/features/settings/provider-builders/`: `ApiKeyProviderBuilder` (from ~767), `ExternalToolProviderBuilder` (~899), `PublicHttpProviderBuilder` (~991), plus `providerStatus`/`providerIcon`/`statusLabel` helpers (~1179+). Pure move, no logic edits; `CatalogOverlay.jsx` temporarily imports them from the new location so both surfaces work mid-migration. Render tests for all three builders at the new import path (api-key: save/replace + env-blocked copy; external-tool: install cmd, Check install/session, Re-enable variants when status is `skipped`; public-http: reachability check).
- [ ] 4.2 Create `features/settings/sections/ProvidersSection.jsx`: one status row per provider from the catalog payload (same source the catalog tab used, via `useGuiConnection().catalog`), status line covering configured / env-managed / snoozed-until / never-ask / not configured, row activation expands the matching builder inline. Honor `?provider=<id>` search param: scroll into view + expand. Hosted: rows whose `browserTransport` is blocked state local-only availability with no actions.
- [ ] 4.3 Remove the Providers tab from `CatalogOverlay.jsx` (`TABS`, `ProviderRow`, `ProviderBuilder` dispatcher, provider-tab state); catalog is Workflows + Tools only. Update catalog tests accordingly.
- [ ] 4.4 Legacy deep links: in `App.jsx`'s drawer-handling effect, map `drawer=providers` (and `drawer=catalog` arriving with a `provider` param) to `navigate("/settings/providers", {search:{provider}})`. Keep `providers` in the `drawer` enum in `validateGuiSearch()`. Test: `?drawer=providers&provider=alpha_vantage` lands on the Providers section with the Alpha Vantage row expanded.
- [ ] 4.5 Diagnostics remediation buttons (`features/diagnostics/DiagnosticsPage.jsx` ~336): "Connect"/"Providers" actions navigate to `/settings/providers?provider=<id>`; "Model setup" navigates to `/settings/model`. (Coordinate with group 7; whichever lands second rebases.)

## 5. Preference transparency (Lane C)

- [ ] 5.1 Storage accessors (failing unit tests first, against a temp SQLite db): `listAllPreferences()` and `deletePreference(namespace, key)` in `src/memory/storage.ts`; `deleteDefault(toolName, paramPath)` in `src/memory/tool-defaults.ts` (list already exists as `getAllDefaults`). Plain SQL on existing tables; no schema change.
- [ ] 5.2 Local transport: add `preferences.list`, `preferences.delete`, `tool_defaults.delete` WS commands in `gui/server/ws-hub.ts` beside `provider.status.check`, plus the trusted-session HTTP fallback route(s) following the existing fallback pattern. Payload shape per design D7; payload must never include credential material (assert in test). Deletes follow the acknowledged-mutation/writer rules other mutations use.
- [ ] 5.3 Hosted transport: same three commands in `gui/hosted/src/runtime/browser-runtime-host.js` `handleCommand()` against browser SQLite; deletion persists across a checkpoint (test with the existing hosted runtime test harness patterns; follower tabs forward or disable per existing coordination rules).
- [ ] 5.4 Create `features/settings/sections/PreferencesSection.jsx`: two groups (Preferences, Tool defaults) of rows showing namespace/key, readable value (scalars as-is, objects as compact JSON), source, confidence, timestamps; per-row delete behind an `AlertDialog` confirm; one-line empty state ("OpenCandle saves preferences it learns from your conversations…") with no table chrome when both stores are empty. Refetch list after each acknowledged delete.
- [ ] 5.5 Round-trip tests on both transports: seed a `risk_profile` preference and a tool default, list shows them, delete removes the row durably; deleting then rebuilding prompt context omits the deleted preference (assert via the memory retrieval path used by the system prompt).

## 6. Automation + Data & privacy + hosted panel (Lane D)

- [ ] 6.1 Extract the report schedule form body from `features/market-state/MarketStatePage.jsx` (~549–590) into `features/market-state/report-schedule-form.jsx`; Reports slide-over keeps identical UX; both callers dispatch the same `daily_watchlist_report {action:"configure"}` invocation. Tests: existing reports-config tests keep passing; the shared component renders in both frames.
- [ ] 6.2 Create `features/settings/sections/AutomationSection.jsx`: the shared schedule form, a read-only webhook row (states not-configured vs configured and names `OPENCANDLE_NOTIFICATION_WEBHOOK_URL`; no input), and an automation status line (local: monitor/heartbeat wording; hosted: runs-while-open wording).
- [ ] 6.3 Extract hosted data flows from `gui/hosted/src/HostedRuntimePanel.jsx` into `gui/hosted/src/hosted-data-actions.js` (plain functions over the runtime handle: export download, import file flow + reload, clear secrets, clear all + reload, prepare/activate update). No behavior change; panel imports them.
- [ ] 6.4 Build `TypedConfirmDialog` on the existing `AlertDialog` primitive (explanation list, `Input`, destructive button disabled until input equals `DELETE`); unit render + interaction test.
- [ ] 6.5 Create `features/settings/sections/DataSection.jsx`. Hosted: rows for Export, Import, Install update (only when an update is waiting), Clear secrets (plain AlertDialog confirm), Clear all (TypedConfirmDialog) — destructive rows quiet and last. Local: read-only readout of the OpenCandle home path (surfaced via existing diagnostics/state payloads) and where provider keys live; no destructive controls. Follower/offline: mutating rows disabled with the surface's neutral language.
- [ ] 6.6 Slim `HostedRuntimePanel.jsx` to status strip: status dot, phase message, explanatory line, Install update button, "Manage data" link to `/settings/data`; remove the `<details>` data menu and its native `confirm()`. Update hosted panel tests.

## 7. Diagnostics relocation (after group 1)

- [ ] 7.1 Refactor `features/diagnostics/DiagnosticsPage.jsx` to export `DiagnosticsContent` (report fetch, error/follower/data-quality bands, metric tiles, section tables, `SessionCheckDialog`, TradingView attribution) separate from any page frame; create `features/settings/sections/DiagnosticsSection.jsx` wrapping it. All existing diagnostics tests keep passing against the content export.
- [ ] 7.2 Wire dispatch: `/settings/diagnostics` renders the section; `/diagnostics` redirects per task 1.4. Remove any remaining standalone-page chrome. Verify "Check sessions" (local-only) and hosted `runtime === "hosted-web"` gating unchanged.

## 8. Verification, smoke, docs (last)

- [ ] 8.1 `npm run gates` clean; run `npx vitest run tests/unit/gui-web/` and hosted unit suites.
- [ ] 8.2 GUI release smoke: add a settings-page phase (open Settings from sidebar, switch sections, deep-link `/settings/providers?provider=alpha_vantage`, `/diagnostics` redirect) to the existing Chromium smoke; hosted CI browser smoke covers the slimmed runtime panel link and Data & privacy rows.
- [ ] 8.3 Verify like a user (local): `npm run gui`, click through Settings sections, manage a model key from the composer path, re-check a provider row, delete a seeded preference, confirm Reports page schedule entry still works. Capture screenshots into the screenshot harness settings phases.
- [ ] 8.4 Verify like a user (hosted): built hosted PWA — footer strip links to `/settings/data`, export/import round trip from Settings, Clear all typed confirmation blocks until `DELETE` typed, cleared-keys state reflected in Settings → Model.
- [ ] 8.5 Docs + changelog: update GUI quickstart / configuration / hosted docs references to the catalog Providers tab, Diagnostics nav item, and hosted footer controls; add CHANGELOG entries (changelog-automation skill).
