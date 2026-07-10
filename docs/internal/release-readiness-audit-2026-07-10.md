# Release Readiness Audit — 2026-07-10

Pre-public-release audit of OpenCandle at v0.11.1 + unreleased main (`7f4cff7`). This revision is structured for parallel implementation agents: findings carry fix sites and acceptance criteria, decisions are pre-made, and work is partitioned into conflict-free workstreams.

**Method:** five parallel audits — (1) README claim-by-claim verification against CLI/scripts/live URLs, (2) docs freshness cross-checked against source, (3) TUI first-run driven live under a PTY with a throwaway `OPENCANDLE_HOME`, (4) GUI first-run driven live in a real browser from a cold home (screenshots under `/tmp/opencandle-gui-audit/`), (5) release infrastructure (pack contents, CI/publish workflows, security hygiene, build/typecheck).

**Verdict:** release machinery, package hygiene, and docs/README tone are in unusually good shape — `npm run build` and `tsc --noEmit` pass, `npm audit --omit=dev` is clean, pack contents are correct, no secrets tracked, zero TODO/FIXME in `src/`, no doc references removed features. **One blocker:** the GUI silently accepts an invalid model key and dead-ends the first chat with zero feedback.

---

## MANUAL STEPS (owner only — do these while agents implement)

These cannot be done by implementation agents:

1. **[H3] Enable GitHub private vulnerability reporting.** Repo → Settings → Advanced Security (or Security section) → enable "Private vulnerability reporting". Verify with: `gh api repos/Kahtaf/OpenCandle/private-vulnerability-reporting --jq '.enabled'` → must return `true`. (Alternative if you prefer: add a security-contact email to SECURITY.md — that part an agent could do, but the toggle is yours.)
2. **[H4] Sign off on the version decision.** The watchlist-field removal in [Unreleased] is breaking → next release is **0.12.0** via `npm run release:minor`, not a patch. The `**BREAKING**` changelog markers are agent work (WS-F); actually running the release command at ship time is yours.
3. **[L14] Skim `docs/internal/` (21 tracked files, esp. `archive/`)** for tone/paths you don't want public. Judgment call only you can make. No structural change expected.
4. **[L6, optional] Inline demo videos on GitHub.** If you want the README demo to play inline on GitHub, drag-drop the mp4s into a GitHub comment/PR to mint `github.com/user-attachments/...` URLs and hand them to the docs workstream. Otherwise agents will just pin the existing jsdelivr URLs to a release tag.
5. **[L9, semi-manual] Re-capture `docs/images/gui-workbench.png`** after the GUI fixes land — it predates the 2026-07-10 overhaul (7f4cff7). Needs a populated, good-looking session; an agent can attempt it via browser automation, but you'll get a nicer shot by hand.
6. **Not manual (correcting an assumption):** the npm package description is `package.json:4` — a one-line code edit picked up at next publish. Assigned to WS-C.

---

## INSTRUCTIONS FOR IMPLEMENTATION AGENTS

Read this section before touching anything.

- **Repo conventions are binding** (see AGENTS.md): TDD — write the failing test first where the change is testable; `.js` extensions on relative imports; `node:` prefix; strictly typed; run `npm test` after changes; run `graphify update .` after code edits.
- **Changelog:** every fix adds a line under `[Unreleased]` in CHANGELOG.md (Added/Changed/Fixed). CHANGELOG.md is the one shared file across all workstreams — append your line and expect trivial rebase conflicts; do not restructure the file (WS-F owns structural changes).
- **Do not** touch prompt templates, policy cards, or routing prompts for any of these fixes — nothing here requires it.
- **GUI first-run testing gotcha:** `npm run gui` loads the repo-local `.env`, so a naive `OPENCANDLE_HOME=<tmp> npm run gui` inherits developer model keys and skips the first-run panel. A true cold start requires an isolated `HOME` **and** `OPENCANDLE_HOME` (both fresh `mktemp -d`) and launching from a cwd outside the repo. Never touch the real `~/.opencandle` or `~/.pi`.
- **Verification commands by area:** unit `npm test`; GUI browser `npm run test:gui:browser`; release smoke `npm run test:gui:release-smoke` (needs `npx playwright-core install chromium`); docs site `npm run docs:site:build && npm run docs:links:check`; package `npm run package:contents:check`.

### Workstream partition (disjoint file ownership — safe to run in parallel)

| WS | Findings | Owns (no other WS may edit) |
|----|----------|------------------------------|
| **WS-A** GUI/TUI model-key trust | B1, H1, M2, L4 | `gui/server/model-setup.ts`, `src/pi/setup.ts`, `gui/web/src/features/onboarding/*`, chat-run error surfacing files, new shared key-validation module |
| **WS-B** Doctor/Diagnostics tone | M1, M3, M4, L1 | `src/doctor/*` (report.ts, render.ts, cli-command.ts), `gui/web/src/features/diagnostics/*` |
| **WS-C** CLI entry + package.json | H2, H7, M5(engines), M8(build) | `src/cli.ts`, `src/cli-main.ts`, `src/infra/node-version.ts`, `scripts/check-node-version-lib.mjs`, **all of package.json** (description, engines, scripts), `scripts/` build helpers |
| **WS-D** Docs/README/copy sweep | H5, H6, M6, M7, M9, M10, M11, M13, M5(copy), M8(copy), L2, L3(doc), L5, L7, L8, L9(numbering), L10, L11 | `README.md`, `docs/*.md` (public), `.env.example`, `CONTRIBUTING.md`, `PRODUCT.md`, `website/scripts/prerender.jsx` |
| **WS-E** CI/release infra | M12, M14, L12, L13 | `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `scripts/release.mjs`, tsconfig sourceMap config |
| **WS-F** Changelog structure | H4(markers) | CHANGELOG.md structural edits (BREAKING markers); also verify the watchlist-field state migration exists |

Cross-WS coordination points (the only two):
- **M5** spans WS-C (engines/check) and WS-D (README/docs/homepage copy). The decided range is written under M5 — both sides implement the same string.
- **H2** may add usage text that WS-D links from docs; WS-D should not block on it.

---

## Blocker

### B1. GUI accepts an invalid model key silently, then the first chat dead-ends with no feedback
- **Area:** GUI first-run (live repro, twice)
- **Evidence:** Pasting `sk-test-invalid` into the OpenAI field → "Saving model key..." toast → success; composer switches to `gpt-5-mini`, setup panel closes. Sending "What is NVDA trading at?" produces a user bubble and total silence — no spinner, no error card, no assistant reply after 40s; composer resets to "Ask anything" looking ready. Reproduced from a fresh chat (25s; the send didn't even create a sidebar session entry). Server log shows nothing. Screenshots: `03-fake-key-validation.png`, `07-invalid-key-after-40s.png`, `19/20-repro-*.png`.
- **Fix sites:**
  - Key save without validation: `gui/server/model-setup.ts:164-174` (`handleSaveModelApiKey` — trims and calls `session.modelRegistry.authStorage.set(...)` unconditionally). Note `handleSaveProviderApiKey` (`model-setup.ts:195+`) is for *data* provider keys — different concern, leave its behavior alone unless trivially shareable.
  - Setup UI: `gui/web/src/features/onboarding/ModelSetupCard.jsx`, `ModelSetupDialog.jsx` (inline error rendering).
  - Silent chat dead-end: the session-addressed chat-run path (start at `gui/server/http-routes.ts` chat-run routes and the run-card renderer under `gui/web/src/features/chat/` / `components/chat/`) — a model-auth failure during a run must surface as a failed run card. The failed-run card with Retry already exists (see unreleased changelog "Failed GUI tool/workflow runs now show the failure reason… and offer a Retry action") — wire chat-run auth failures into the same pattern, plus a "Fix model key" action that opens the setup dialog (depends on H1).
- **Decision (pre-made):** validate with a cheap authenticated probe at save time — provider list-models endpoint (Anthropic `GET /v1/models`, OpenAI `GET /v1/models`, Google `GET /v1beta/models`) with a ~5s timeout. On HTTP 401/403 → reject inline ("Key was rejected by <provider>"), do not save. On network error/timeout → save the key but show a "Saved — couldn't verify (network)" notice, never a false success. Put the probe in one shared module (e.g. `src/onboarding/validate-model-key.ts` or similar) so the TUI (M2) uses the identical path. Do not add a new provider SDK dependency — plain `fetch` via existing infra.
- **Done when:** (1) unit tests cover 401-reject, network-tolerate, and success paths of the probe; (2) live cold-start check: fake key → inline rejection in the setup card; (3) with a bad key forced into storage, sending a chat message produces a visible failed-run card with the failure reason within the run's normal lifecycle — never silence; (4) `npm run test:gui:release-smoke` still passes (it asserts draft-while-setup behavior — do not regress it).

---

## High

### H1. No in-GUI way to fix or replace a bad model key after first-run
- **Area:** GUI (WS-A)
- **Evidence:** the "Connect an AI model" panel renders only when no key exists; after a (bad) key is saved it never returns. The composer model dropdown (`08-model-dropdown.png`) only picks among models. Only recovery is terminal `/setup`.
- **Fix site:** reuse `ModelSetupDialog.jsx` — add a persistent entry point: a "Manage model keys…" item in the composer's model dropdown menu (preferred; it's where a user looks when the model misbehaves). Key replacement flows through the same validated save path as B1. Server side already exposes save handlers via `gui/server/model-setup.ts`; check `handleSaveModelApiKey` works when a key already exists (it should — it's an unconditional set).
- **Done when:** from a session with a saved key, a user can open model setup from the model dropdown, replace the key, and the probe validates it; browser test covers the entry point's existence.

### H2. `opencandle --help` / `--version` are unhandled and boot the full interactive TUI — resuming the user's last session
- **Area:** CLI (WS-C; live repro)
- **Evidence:** `src/cli-main.ts:180-203` dispatches only `gui`/`monitor`/`doctor`/package subcommands; `npx tsx src/cli.ts --help` rendered the full Pi TUI, replayed a prior session transcript, and ran until killed. No `--help`/`--version` handling in `src/cli.ts`, `src/cli-main.ts`, or `src/doctor/cli-command.ts`.
- **Fix site:** `src/cli.ts` — handle `--help`/`-h` and `--version`/`-v` **before** the better-sqlite3 guard and any TUI/session/lock init (`doctor` is already dispatched first at `src/cli.ts:5-17`; follow that pattern). Usage text lists: (default) interactive TUI, `gui`, `monitor [--once]`, `doctor [--json|--full|--sessions|--enable <provider>]`, and the package subcommands `cli-main.ts` dispatches. Version reads package.json (see how existing code resolves package metadata — do not hardcode).
- **Done when:** `npx tsx src/cli.ts --help` and `--version` print and exit 0 without initializing sessions (test via unit test on the arg-dispatch function + a spawn test asserting exit within a few seconds with no TUI escape codes).

### H3. SECURITY.md's primary reporting channel is disabled on the repo
- **Area:** MANUAL (owner) — see Manual Steps #1.

### H4. Unreleased changelog contains an unmarked breaking change — next release must be 0.12.0
- **Area:** Versioning (WS-F + Manual Steps #2)
- **Evidence:** `[Unreleased] → Changed`: watchlist target/stop/thesis/notes/tags fields removed from state, tools, GUI forms, prompts — same class 0.11.0 flagged `**BREAKING**`. "Published package contents now ship compiled GUI artifacts instead of raw src trees" also changes layout for deep-importers.
- **Agent work:** add `**BREAKING**` markers to (a) the watchlist-field-removal entry and (b) the compiled-artifacts packaging entry in CHANGELOG.md, matching 0.11.0's marker style. Then verify a state migration exists for the watchlist field removal (check the SQLite schema-version migration path in `src/market-state/` / `src/memory/` for the current schema version; the predictions removal used a v8 migration as precedent). If no migration handles pre-existing watchlist rows with the removed fields, report that as a new finding — do not write a migration without flagging it first (schema changes are ask-first per AGENTS.md).
- **Done when:** markers present; migration existence confirmed in writing (file:line) or escalated.

### H5. Two public docs document removed GUI surfaces
- **Area:** Docs (WS-D)
- **Evidence:** `docs/gui-quickstart.md:71` documents the removed "What the agent sees" drawer (confirmed absent in the live GUI); `docs/gui-quickstart.md:34` and `docs/system-architecture.md:118` list `POST /api/chat/run` as "streams one chat run" but it returns HTTP 410 `legacy_route_removed` (`gui/server/http-routes.ts:276-285`).
- **Fix:** delete/rewrite the drawer paragraph (its data-quality warning moved to Diagnostics per the unreleased changelog — say so if mentioning it at all). Replace the endpoint entry in **both** docs with the real session-addressed chat-run route (read the actual route from `gui/server/http-routes.ts` — do not guess the path). Add a comment or note making one doc the canonical endpoint list and the other a pointer, so they can't drift apart again.
- **Done when:** no public doc mentions the drawer or the 410 route; `npm run docs:site:build && npm run docs:links:check` pass.

### H6. README architecture diagram renders broken on npmjs.com
- **Area:** README (WS-D)
- **Evidence:** `README.md:168` uses repo-relative `assets/opencandle-architecture.png`; not in the tarball (`files` ships only `assets/logo.svg`), and npm renders the relative path broken. Demo posters already use absolute jsdelivr URLs.
- **Fix:** `https://cdn.jsdelivr.net/gh/Kahtaf/OpenCandle@main/assets/opencandle-architecture.png` (match the demo-asset pattern exactly as used at README.md:21-29).
- **Done when:** no repo-relative image/asset URLs remain anywhere in README.md; `curl -sI <new url>` returns 200.

### H7. npm package description contradicts the product's core honesty claim
- **Area:** package.json (WS-C)
- **Evidence:** `package.json:4` `"Financial trading & investing agent"` vs README.md:43 "OpenCandle is read-only research software. It does not place trades, route orders, or provide financial advice."
- **Fix (decided):** `"description": "Open source financial investigator: evidence-first market research agent for your terminal and local GUI"`. Owner may tweak wording at review; anything without "trading" is acceptable.
- **Done when:** description updated; `keywords` skimmed for the same problem (drop/replace any order-execution implication if present).

---

## Medium

### M1. A pristine install reads "Degraded" in both `doctor` and GUI Diagnostics
- **Area:** WS-B (live repro on both surfaces)
- **Evidence:** zero-config `doctor`: `Providers - DEGRADED` with `[WARN] ... Credential is missing` ×5 (Alpha Vantage, FRED, Finnhub, Brave, Exa). GUI Diagnostics: amber "Degraded" pill, "usable with 7 degraded or unchecked capabilities" (`09-diagnostics-fresh.png`). Contradicts docs ("every data-provider key is optional") and the unreleased changelog's own claim that "'Degraded' is reserved for real warnings or failures". Machines without `rdt-cli`/`twitter-cli` stack more WARNs.
- **Fix site — one place fixes both surfaces:** `src/doctor/report.ts:429-434` sets `status: configured ? "pass" : "warn"` with "Credential is missing" for API-key providers (nearby: `report.ts:463,479-480` for related provider checks — audit all provider-credential checks in the file). The GUI Diagnostics page fetches this same report via `GET /api/doctor` (`gui/server/http-routes.ts:226` → `buildDoctorReport`), so the status change propagates; then adjust `DiagnosticsPage.jsx` only if it maps statuses to copy/colors independently.
- **Decision (pre-made):** a **never-configured** optional credential reports `skip` with message like "Not connected — optional. Run /connect <alias> to enable <capability>." and does not count toward the degraded summary; a **configured-but-failing** credential stays `warn`/`fail`. Distinguish "never configured" from "was configured, now broken" using onboarding state (`src/onboarding/state.ts` — it already tracks per-provider snooze/never_ask/configured). Section status on a pristine home: READY. Keep the per-key fix lines ("Free, about 30 seconds…") — they're good.
- **Done when:** zero-config `doctor` prints overall `BLOCKED` (model missing) but `Providers - READY` (or neutral) with no WARNs; GUI Diagnostics on a cold home shows no amber "Degraded" pill; unit tests on `buildDoctorReport` with an empty home assert the section status; existing doctor tests updated intentionally, not silenced.

### M2. TUI setup saves pasted model keys with zero validation
- **Area:** WS-A (same class as B1)
- **Evidence:** `src/pi/setup.ts:211-227` stores any non-empty string; `activateDefaultModel` (`setup.ts:235-263`) checks only registry availability → "API key saved... Model selected" then failure at first prompt. Also breaks `docs/first-run.md:74`'s bad-key symptom description ("No models appear after adding a key" — they do appear).
- **Fix:** call the same shared probe as B1 from the TUI paste path; on rejection, show a provider-specific error and loop back to key entry. Update `docs/first-run.md:74`'s symptom row to match the new behavior (coordinate: the doc file belongs to WS-D — hand them the final copy, or make this one-line doc edit the explicit exception).
- **Done when:** TUI paste of a garbage key re-prompts with an error (test via unit test on the setup handler with a mocked probe); success path unchanged.

### M3. GUI Diagnostics remediation tells GUI-only users to run terminal commands
- **Area:** WS-B
- **Evidence:** each missing-provider row says "Run `/connect alpha_vantage`" etc.; a pure-GUI user has no terminal. The ⌘K catalog already has a provider-connect flow (`17-catalog-providers.png`).
- **Fix site:** `DiagnosticsPage.jsx` — per-provider row gets a button/link that opens the existing catalog provider-connect surface for that provider. The CLI `doctor` text (from `src/doctor/render.ts`) keeps `/connect` literals. The doctor report likely carries a fix string shared by both surfaces — if so, add a structured field (e.g. provider id) so the GUI can render an action instead of the CLI string, rather than string-parsing.
- **Done when:** on a cold home, each Diagnostics provider row has a working in-GUI connect affordance; CLI output unchanged.

### M4. "Check sessions" fires a raw native `window.confirm()`
- **Area:** WS-B
- **Evidence/fix site:** `gui/web/src/features/diagnostics/DiagnosticsPage.jsx:34-35` (`confirmSessionCheck(confirmImpl = window.confirm)`) called at line 86. Replace with the app's AlertDialog primitive (already in `gui/web/src/components/ui/` per the unreleased changelog). Keep the warning copy. Native dialogs also freeze agent-driven browsers — this unblocks future GUI smoke automation.
- **Done when:** no `window.confirm` in `gui/web/src` except the pre-existing history-item delete confirm (`components/chat/history-item.jsx:170` — replace that too if trivial, else leave and note it); confirm/cancel both covered by a component test.

### M5. Node 23 support claims are inconsistent across engines, runtime check, and docs
- **Area:** WS-C (engines/check) + WS-D (copy) — found independently by two audits
- **Evidence:** `package.json` engines `>=22.19.0 <27` permits 23.x; `src/infra/node-version.ts:8-9` and `scripts/check-node-version-lib.mjs:10-11` reject it ("Node 22.19+ or 24.x-26.x"); CI matrix (22.19/24/26) matches the script; homepage says "Node.js 22+" with no upper bound (`website/scripts/prerender.jsx:807`).
- **Decision (pre-made):** the runtime check is right; fix everything else to match it. WS-C: engines → `"^22.19.0 || >=24.0.0 <27"`. WS-D: README.md:60, docs/getting-started.md:14, docs/first-run.md:84 → "Node.js 22.19+ or 24–26"; `website/scripts/prerender.jsx:807` → same phrasing.
- **Done when:** `node -e "require('semver')..."` sanity check or unit test asserts engines excludes 23.x and includes 22.19/24/26; grep for `22.19.0 <27` returns nothing; homepage rebuilt copy matches.

### M6. README quickstart audience can't run the doctor commands as written
- **Area:** WS-D. **Evidence:** README.md:100-108 shows `opencandle doctor ...` but the only install shown is `npx opencandle`. **Fix:** `npx opencandle doctor` in the code block (all variants in that section). **Done when:** every command in README is runnable by a user who has only ever run `npx opencandle`.

### M7. "Pi" is never explained in the README
- **Area:** WS-D. **Evidence:** README.md:49,66,129 reference Pi cold; docs/index.md:19 has the right phrasing ("Pi is the bundled agent runtime… No separate Pi install needed"). **Fix:** one sentence at first mention (line ~49), borrowing docs/index.md:19 + link to github.com/earendil-works/pi. **Done when:** first "Pi" occurrence in README is self-explanatory.

### M8. Windows source-build guidance implies support, but the build breaks in cmd.exe
- **Area:** WS-C (build) + WS-D (copy)
- **Evidence:** README.md:158 gives a cmd.exe `copy .env.example .env` note, but `npm install` in a checkout runs `prepare` → `build` → `chmod +x dist/cli.js` (package.json:83-84) which fails in cmd.exe. Homepage claims "macOS, Windows, Linux" (`website/scripts/prerender.jsx:807`). No OS-support statement in README. Native deps: better-sqlite3 (prebuilds exist for Windows), GUI server, browser-session CLIs.
- **Decision (pre-made):** WS-C replaces the raw `chmod` with a small cross-platform Node script (chmod on POSIX, no-op on win32) — lowest-risk step toward the homepage's existing Windows claim. WS-D adds a supported-platforms line to README next to the Node requirement: "macOS and Linux are fully supported; Windows is best-effort (WSL recommended)" — unless the owner wants to defend native Windows, in which case say so in review. Do NOT silently expand or retract the homepage claim; flag the homepage wording in the PR description for owner sign-off.
- **Done when:** `npm install` from a checkout succeeds on a platform without `chmod` semantics (unit-test the script's win32 branch with mocked platform); README states OS support; PR flags the homepage claim.

### M9. Keyless-source lists are inconsistent across docs
- **Area:** WS-D. **Evidence:** docs/getting-started.md:101 and docs/first-run.md:43 omit TradingView scanner and Polymarket Gamma (README + data-sources.md have them); docs/tui.md:61-73's `/connect` table — which first-run.md:55 calls "the full list" — omits the registered `polymarket` (aliases: prediction-markets, event-probabilities) and `tradingview` (aliases: tradingview-scanner, screener) targets (`src/onboarding/providers.ts:205-231`). **Fix:** add both to all three; prefer making data-sources.md the canonical keyless list and having getting-started/first-run link to it. **Done when:** grep for the keyless list across docs shows either one canonical list + links, or identical membership everywhere.

### M10. `release:check` descriptions omit the GUI release smoke and its Chromium requirement
- **Area:** WS-D. **Evidence:** docs/testing-and-evals.md:33 and CONTRIBUTING.md:41 describe `release:check` without `test:gui:release-smoke` (needs Playwright Chromium — the publish workflow had to be patched for this) or `test:scripts:typecheck` (package.json:121 is the source of truth). **Fix:** update both to enumerate the real chain; call out "requires `npx playwright-core install chromium` locally". **Done when:** both descriptions match package.json:121's actual chain.

### M11. `docs/build-a-tool.md` caching example doesn't compile
- **Area:** WS-D. **Evidence:** docs/build-a-tool.md:136 uses a retired generic 15-minute TTL key; real `TTL` keys are domain-named (`QUOTE`, `HISTORY`, `FUNDAMENTALS`, `MACRO`, `SENTIMENT`, `OPTIONS_CHAIN`, `SCREENER`, `CRUMB`, `WEB_SEARCH`, `FINNHUB_NEWS`, `PREDICTION_MARKETS` — `src/infra/cache.ts:101-113`). **Fix:** use `TTL.SENTIMENT` (matches the adjacent correct `STALE_LIMIT.SENTIMENT` example). **Done when:** every code snippet in build-a-tool.md type-checks against current exports (spot-check the others while in the file).

### M12. PR CI never exercises the GUI release smoke or agent-tools tests
- **Area:** WS-E. **Evidence:** `.github/workflows/ci.yml` runs typecheck/biome/docs/`npm test`/package-contents/packed-install/links but not `test:gui:release-smoke` (no Chromium install step) or `test:agent-tools`; the smoke runs only at publish time. **Fix:** add one CI leg (single Node version, 24.x, matching where package-contents already runs) that runs `npx playwright-core install --with-deps chromium` then `npm run test:gui:release-smoke`; add `npm run test:agent-tools` to CI. Copy the Chromium install step from `publish.yml`, which already has a working one. **Done when:** CI workflow lints (actionlint if available, else careful YAML review) and a PR run exercises both.

### M13. `.env.example` documents the removed `OPENCANDLE_DEBATE` flag and stale keyless claims
- **Area:** WS-D (found independently by three audits). **Evidence:** `.env.example:17` `# OPENCANDLE_DEBATE=true` (removed 0.11.0); keyless list omits TradingView/Polymarket and lists Reddit keyless without the `rdt-cli` browser-session caveat; docs/getting-started.md:35 makes `cp .env.example .env` look required. **Fix:** delete the flag line; align the keyless list with data-sources.md; qualify Reddit; mark the copy step "(optional)". **Done when:** every key/flag in `.env.example` exists in `src/config.ts`.

### M14. No eval suite in any release gate, not even as a documented checkpoint
- **Area:** WS-E. **Evidence:** `npm run eval -- release` appears nowhere in `release:check`, `scripts/release.mjs`, or `publish.yml`. Intentional (live model keys) but invisible.
- **Decision (pre-made):** do NOT auto-run evals (keys/cost). `scripts/release.mjs` gains an interactive confirmation checkpoint before tag mutation: print "Release evals: run `npm run eval -- release` and review results. Confirm evals were run and acceptable? [y/N]" and abort on anything but yes. Add a `--skip-eval-confirm` flag for emergencies, which prints a loud warning. Document in CONTRIBUTING/testing-and-evals (coordinate with WS-D's M10 edit — WS-E writes the release.mjs change, WS-D mentions the checkpoint in the same sentence-level edit).
- **Done when:** unit/spawn test on release.mjs asserts abort-without-confirmation; flag works.

---

## Low

### L1. `doctor` exits 0 even when overall health is BLOCKED
- **Area:** WS-B. **Evidence:** live `EXIT=0` with `OpenCandle health: BLOCKED`; `src/doctor/cli-command.ts:47-55` never sets `process.exitCode`. **Decision:** exit 1 on `blocked`; keep 0 for `degraded` and `ready` (don't break loose scripting). Document the contract in docs/configuration.md's doctor section (hand copy to WS-D or make the one-line edit directly). **Done when:** test asserts exit codes for blocked/degraded/ready reports.

### L2. First TUI launch performs undocumented network downloads
- **Area:** WS-D. **Evidence:** first run prints `fd not found. Downloading...` and installs `fd`+`ripgrep` into `~/.pi/agent/bin`. **Fix:** one line in docs/first-run.md requirements/troubleshooting: first launch downloads Pi helper binaries and needs network access. **Done when:** the line exists.

### L3. Plain `opencandle` silently resumes the most recent session for the cwd
- **Area:** WS-D (doc) — behavior change out of scope. **Evidence:** `src/pi/session-storage.ts:3-5` (`SessionManager.continueRecent`); observed live. docs/tui.md:76-81 describes storage but not resume-on-start. **Fix:** document resume behavior and how to start a fresh session in docs/tui.md's Sessions section. **Done when:** documented. (Behavioral change — fresh session on first-launch-after-install — deferred; note it as a possible follow-up in the PR description, don't implement.)

### L4. GUI composer model selector reads "unknown" before setup
- **Area:** WS-A. **Evidence:** `01-first-screen.png` — composer model button labeled "unknown" while no key exists. **Fix site:** grep `gui/web/src` for the composer's model-button label source — "unknown" was not found as a literal in components, so it likely falls out of an unresolved model id from the bootstrap/model-registry state; trace where the composer model button gets its label and substitute "No model connected" when no model is active. **Done when:** cold-start composer shows "No model connected" (or the selector is hidden); component test covers the no-model state.

### L5. README ordering: install command precedes the description and requirements
- **Area:** WS-D. **Evidence:** README.md:3-7 opens with bare `npx opencandle` before the one-liner (line 9) and Node requirement (line 60). **Fix:** move the one-liner above the install block; put "Requires Node 22.19+ or 24–26" (M5 phrasing) adjacent to the first `npx`. **Done when:** a reader hits description → requirement → install in that order.

### L6. README demo videos are click-throughs and jsdelivr `@main` caches up to 12h
- **Area:** WS-D (+ Manual Steps #4 if inline playback wanted). **Evidence:** README.md:21-29 poster-links-to-mp4; `@main` jsdelivr caches stale. **Fix (default):** pin the jsdelivr URLs to the current release tag and add "re-pin on release" to the release checklist. If the owner supplies user-attachment URLs, use those instead for GitHub inline playback. **Done when:** no `@main` jsdelivr URLs in README.

### L7. README `state.db` path is vague
- **Area:** WS-D. **Evidence:** README.md:54. **Fix:** `~/.opencandle/state.db` (mention `$OPENCANDLE_HOME` override). **Done when:** edited.

### L8. `docs/index.md` capability table omits shipped tools
- **Area:** WS-D. **Evidence:** docs/index.md:45,48 — Macro row omits Polymarket event probabilities (`get_event_probabilities`); Market data omits `screen_stocks`. **Fix:** add both examples. **Done when:** edited.

### L9. `docs/gui-quickstart.md` numbering skips step 2; workbench screenshot predates the GUI overhaul
- **Area:** WS-D (numbering) + Manual Steps #5 (screenshot). **Evidence:** steps run 1, 3, 4, 5, 6, 7 (docs/gui-quickstart.md:10-11); `docs/images/gui-workbench.png` committed 2026-07-02 (9db665b), before 7f4cff7. **Fix:** use `1.` throughout for auto-numbering. **Done when:** numbering renders 1-7; screenshot replacement tracked by owner.

### L10. `docs/data-sources.md` gaps and stale CLI links
- **Area:** WS-D. **Evidence:** Fundamentals row (docs/data-sources.md:17) omits shipped Yahoo fallbacks for comparison fundamentals and DCF statements; coverage table omits `analyze_holdings_overlap`, `daily_watchlist_report`, `manage_alerts`, `manage_notifications`; the former `rdt-cli`/`twitter-cli` repository links 301-redirect to `github.com/public-clis/*` (same in getting-started.md:101, first-run.md:43 — six links total). **Fix:** append fallback note; add missing rows or an explicit "representative, not exhaustive" caveat; update all six links to `github.com/public-clis/*`. **Done when:** `npm run docs:links:check` passes and no former repository-owner references remain in the repo.

### L11. PRODUCT.md leaks the internal writer/follower lock
- **Area:** WS-D. **Evidence:** PRODUCT.md:35 "while respecting the writer/follower lock" — 0.11.0 deliberately hid this mechanism from users. **Fix:** "while coordinating which surface applies each action". **Done when:** edited.

### L12. 206 broken source maps ship in the npm tarball
- **Area:** WS-E. **Evidence:** pack dry-run: 627 files, 206 `*.js.map` with `sources: ['../src/...']` and no `sourcesContent` — all dangling (3.6 MB unpacked; no secret leakage). **Decision:** disable source maps for the publish build (`sourceMap: false` in the build tsconfig used by `npm run build` — check whether dev workflows rely on them; if so, split a publish tsconfig). **Done when:** `npm pack --dry-run` shows no `.js.map` under `dist/`; `npm run package:contents:check` and `test:packed-install` pass.

### L13. GitHub Release creation runs after `npm publish` with no failure recovery
- **Area:** WS-E (optional). **Evidence:** `.github/workflows/publish.yml` — `gh release create` is the last step. **Fix:** acceptable as-is; if touching the file anyway (M12 copies its Chromium step), add `continue-on-error: false` review or a draft-first pattern — lowest priority in WS-E. **Done when:** explicitly decided in the WS-E PR description, even if "left as-is".

### L14. `docs/internal/` (21 tracked files) is public-visible
- **Area:** MANUAL (owner) — see Manual Steps #3.

---

## Verified clean (no action needed)

- **Build/typecheck:** `npm run build` and `npx tsc --noEmit` pass; `npm audit --omit=dev` → 0 vulnerabilities (626 prod deps); zero TODO/FIXME/HACK in `src/`.
- **Package:** pack contents correct (only LICENSE, README, assets, dist, gui/web/dist); `check-package-contents.mjs` denylist solid; trusted publishing with `--provenance`; `scripts/release.mjs` enforces clean tree / main / tag discipline / changelog rotation.
- **Secrets:** none tracked; `.gitignore` covers `.env`, `validation-output/`, `docs/internal/pr-evidence/`, `graphify-out/`.
- **Docs negative checks:** no references to removed predictions, `OPENCANDLE_DEBATE` (outside `.env.example` — M13), `OPENCANDLE_ROUTER_MODE=rules`, legacy eval routes, or removed watchlist fields in public docs; all internal doc links and images resolve; website build covers all 12 docs pages + redirect stubs; `docs/configuration.md` verified env-var-by-env-var against `src/config.ts` — fully accurate.
- **README:** all 25+ external links return 200; commands/flags/scripts verified; tone honest and consistent with PRODUCT.md.
- **TUI first-run:** setup wizard copy matches first-run.md exactly (verified live); decline path, fast-default model selection, snooze/never-ask provider declines, `doctor --json` schema, better-sqlite3 auto-rebuild guard all behave as documented.
- **GUI first-run positives:** setup-card copy clear and honest; draft-while-setup works as promised; empty states friendly; ⌘K catalog clean; 390px mobile home has no overflow.

## Suggested sequencing

1. **Owner, now (parallel with agents):** Manual Steps 1–3 (security toggle, version sign-off, docs/internal skim).
2. **Agents, wave 1 (parallel):** WS-A, WS-B, WS-C, WS-D, WS-E, WS-F — file ownership is disjoint per the partition table; only CHANGELOG.md lines overlap (trivial rebases).
3. **After WS-A/WS-B land:** owner re-captures the workbench screenshot (Manual Step 5); one final cold-start GUI + TUI walkthrough to confirm B1/M1/M2 fixes read right to a new user.
4. **Ship:** `npm run release:minor` → 0.12.0.
