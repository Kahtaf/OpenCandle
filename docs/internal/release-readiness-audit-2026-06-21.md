# Release Readiness Audit - 2026-06-21

Audit target: OpenCandle on `main` at `19fba77`.

This report ranks current release-readiness gaps for a public OSS release. It focuses on issues that affect first-run success, package/release correctness, public trust, security posture, docs consistency, website polish, and repository hygiene.

## Method

- Used six subagents for independent coverage:
  - Rawls: docs and README consistency.
  - Singer: packaging, install, and release flow.
  - Euler: security, artifact, and package hygiene.
  - Galileo: TUI and GUI onboarding.
  - Herschel: public website.
  - Russell: OSS/community best practices.
- Queried the repo Graphify index for release-readiness surface areas.
- Ran local release gates and package checks.
- Queried live GitHub repository settings and live public website pages.
- Compared the repo against current GitHub/npm/OSSF guidance for community profile, Dependabot security updates, action pinning, package `files`, and Scorecard-style supply-chain checks.

## Executive Summary

No current P0 blocker was found. The release gate is green, the production package smoke passes, the npm audit is clean, `.env` is ignored/not tracked, the public website is live, and `main` has branch protection.

The remaining risk is mostly first-run trust and release hardening. The highest-priority fixes are:

1. Make GUI startup load `.env` consistently before reading GUI/model/provider env.
2. Disable GUI chat submission until model setup is ready.
3. Prevent the release script from tagging/pushing from the wrong branch or stale checkout.
4. Make all publish paths run the same release gate.
5. Improve security reporting and redaction guidance.
6. Enable Dependabot security update PRs in GitHub settings.
7. Decide whether internal agent artifacts and `AGENTS.md` should be public website/repo surface area.

The repo does not appear to need a standalone install script. The safer path is to keep `npm install -g opencandle` / `npx opencandle` as the documented install path and strengthen the existing packed-install smoke, first-run checklist, and troubleshooting docs. A curl/bash install script would add more supply-chain and cross-platform maintenance surface than it removes right now.

## Validation Evidence

Commands and live checks completed:

- `npm run release:check`: passed.
  - TypeScript no-emit passed.
  - Biome CI passed but reported existing warnings (`530 warnings`, `38 infos`).
  - Vitest passed (`204` test files, `2131` tests).
  - Docs site built (`17` docs pages).
  - `npm pack --dry-run` passed.
  - Packed install smoke passed, including CLI export checks, `opencandle doctor`, and GUI `/health`.
  - Public docs link checker passed for the configured external URL set.
- `npm audit --omit=dev --json`: `0` vulnerabilities.
- `npm audit --json`: `0` vulnerabilities.
- `npm pack --dry-run --json`: package `opencandle@0.7.0`, about `978 KB` packed, about `4.0 MB` unpacked, `700` files.
- `gh api repos/Kahtaf/OpenCandle/branches/main/protection`: `main` is protected with strict required checks, required PR review, stale-review dismissal, last-push approval, conversation resolution, admin enforcement, no force pushes, and no deletions.
- `gh api repos/Kahtaf/OpenCandle/community/profile`: community profile health is `100`.
- `gh api repos/Kahtaf/OpenCandle`: repo is public, homepage is `https://opencandle.app`, secret scanning and push protection are enabled, Dependabot security updates are disabled.
- `git check-ignore -v`: `.env`, `validation-output`, `graphify-out`, `website/dist`, `dist`, `dogfood-output`, and `design-inspo` are ignored.
- Live website checks:
  - `https://opencandle.app/docs/` and `https://opencandle.app/docs/index.html` return the docs index.
  - `https://opencandle.app/llms.txt` advertises `https://opencandle.app/AGENTS.md`.
  - Live docs show `Last updated 2026-06-20`.

## Priority Legend

- P0: Block public release.
- P1: Fix before intentionally marketing or broadly announcing the release.
- P2: Fix soon; credible user/reviewer friction or maintainability risk.
- P3: Nice-to-have, polish, or governance improvement.

## Ranked Findings

| Rank | Priority | Area | Finding |
| --- | --- | --- | --- |
| 1 | P1 | GUI/env | GUI command path does not load `.env` before GUI server env reads. |
| 2 | P1 | GUI onboarding | GUI chat composer still accepts prompts while model setup is not ready. |
| 3 | P1 | Release safety | Release script can tag and push from a clean but wrong or stale branch. |
| 4 | P1 | Publishing | Manual publish paths bypass the full release gate. |
| 5 | P1 | Security process | Security reporting and bug-template redaction guidance are not actionable enough for public users. |
| 6 | P1 | Dependency security | Dependabot security update PRs are disabled in GitHub settings. |
| 7 | P1 | Public surface | Internal agent artifacts and public `AGENTS.md` publishing need an explicit policy. |
| 8 | P2 | Package architecture | Installed runtime still depends on shipped TypeScript source and `tsx` for GUI/monitor paths. |
| 9 | P2 | Package hygiene | CI package-content gate parses human npm output and has an incomplete denylist. |
| 10 | P2 | Contributor docs | Contributor docs and PR template lag the actual release/CI gates. |
| 11 | P2 | Release validation | First-run TUI/GUI live exercise is not represented in the release gate/checklist. |
| 12 | P2 | Onboarding docs | TUI/GUI setup docs blur Pi sign-in support versus GUI API-key setup. |
| 13 | P2 | GUI test fidelity | GUI browser smoke fixture uses a non-production setup requirement value. |
| 14 | P2 | Env precedence | `.env` currently overwrites already-exported env vars. |
| 15 | P2 | Public API | Exported package subpaths lack a stability contract. |
| 16 | P2 | Website artifacts | Website AI/SEO/link artifacts need a release polish pass. |
| 17 | P3 | OSS governance | README/community discoverability can better surface contribution/security/CI/npm status. |
| 18 | P3 | Release notes | GitHub Releases use generated notes instead of the curated changelog. |
| 19 | P3 | CI hardening | GitHub Actions are version-tag pinned, not full-SHA pinned. |
| 20 | P3 | Supply chain | npm provenance is enabled, but there is no SBOM artifact. |
| 21 | P3 | GUI performance | GUI bundle emits a large-chunk warning during release build. |
| 22 | P3 | Local artifacts | Large ignored generated directories remain in local checkout and should be cleaned before packaging demos/screenshots. |

## Detailed Findings

### 1. P1 - GUI command path does not load `.env` before GUI server env reads

Evidence:

- `src/cli-main.ts:202-207` handles `gui` and `monitor` before the default CLI calls `loadEnv()` at `src/cli-main.ts:219`.
- `src/cli-main.ts:167-170` explicitly calls `loadEnv()` for `doctor`, so the inconsistency is visible in adjacent command handling.
- `gui/server/server.ts:49-55` reads `OPENCANDLE_GUI_HOST`, `OPENCANDLE_GUI_PORT`, `OPENCANDLE_AUTOMATION_HEARTBEAT_MS`, and `OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API` at module load.
- `docs/configuration.md:10-18` says `.env` is loaded at startup and copied into `process.env`.

Impact:

`opencandle gui` and `npm run gui` can ignore `.env` values for GUI host/port and any model/provider env that the GUI setup path expects. This is exactly the first-run path a new user is likely to try after copying `.env.example`.

Recommended fix:

- Load `.env` before `handleGuiCommand()` and `handleMonitorCommand()`, or make each command load env before spawning/initializing command-specific code.
- Add a regression test around `handleGuiCommand()` or a CLI integration test that proves `.env` host/port values reach the GUI process.

### 2. P1 - GUI chat composer still accepts prompts while model setup is not ready

Evidence:

- `gui/web/src/features/chat/ChatPanel.jsx:77` computes `needsSetup`.
- `gui/web/src/features/chat/ChatPanel.jsx:78` sets `chatDisabled` only from follower/input state.
- `gui/web/src/features/chat/ChatPanel.jsx:99-100` renders `ModelSetupCard` when setup is needed.
- `gui/web/src/features/chat/ChatPanel.jsx:124-130` still renders `ChatComposer` with `disabled={chatDisabled}` and `canSend={!chatDisabled}`.
- Server-side fallback exists at `gui/server/server.ts:407-418`, which appends a setup message when a prompt arrives before setup is ready.

Impact:

The first browser experience can look like chat is available while the model setup card is telling the user setup is required. Submitting a normal prompt does not run the model; it appends a setup guidance transcript entry. That is avoidable friction in the highest-value onboarding surface.

Recommended fix:

- Include `needsSetup` in the composer disabled/send guard.
- Update placeholder/copy to point users at the visible setup card.
- Add a GUI web unit test and browser smoke that assert the composer cannot submit while `modelSetup.requirement !== "ready"`.

### 3. P1 - Release script can tag and push from a clean but wrong or stale branch

Evidence:

- `scripts/release.mjs:39-46` checks for a clean working directory.
- `scripts/release.mjs:48-50` runs `npm run release:check`.
- `scripts/release.mjs:61-64` commits and tags the release.
- `scripts/release.mjs:76-78` pushes `origin main` and the tag.
- The script does not assert the current branch is `main`, does not fetch, and does not assert local `main` is up to date with `origin/main`.

Impact:

A maintainer on a clean feature branch or stale checkout can produce a valid version commit/tag sequence that is not the intended public release state. The tag push then becomes the publish trigger.

Recommended fix:

- Before any version bump, assert:
  - `git branch --show-current` is `main`.
  - `git fetch origin main --tags` succeeds.
  - `HEAD` equals `origin/main` or is a strict expected fast-forward state.
  - The new tag does not already exist locally or remotely.
- In publish CI, assert the tag commit is reachable from `origin/main`.

### 4. P1 - Manual publish paths bypass the full release gate

Evidence:

- `package.json:119` sets `prepublishOnly` to `npm test`.
- `package.json:120` exposes `publish:dry` as direct `npm publish --access public --dry-run`.
- `package.json:121` defines the stronger `release:check`.
- `.github/workflows/publish.yml:43-47` correctly runs `npm run release:check` before npm publish.

Impact:

The blessed GitHub publish workflow is strong, but a local `npm publish` only runs tests. It skips typecheck, Biome CI, docs build, tarball dry-run, packed-install smoke, and public link check.

Recommended fix:

- Change `prepublishOnly` to `npm run release:check`, or make local publish fail with a message that releases must go through the tag workflow.
- Consider removing or renaming `publish:dry` unless it also runs `release:check`.

### 5. P1 - Security reporting and redaction guidance are not actionable enough

Evidence:

- `SECURITY.md` exists, and GitHub community profile health is `100`.
- `SECURITY.md:15-17` tells users not to open public issues for vulnerabilities and to use GitHub private vulnerability reporting or a private maintainer channel.
- `.github/ISSUE_TEMPLATE/bug-report.yml:63-64` asks for logs, screenshots, and provider setup context, but does not warn users to redact API keys, account identifiers, holdings, local paths, or portfolio screenshots.

Impact:

For a financial tool that encourages logs, provider setup, screenshots, and local portfolio state, public bug reports can accidentally disclose secrets or personal financial context. Vulnerability reporters also need a concrete fallback if GitHub private reporting is not visible to them.

Recommended fix:

- Add a short redaction warning to every issue template that may request logs/screenshots.
- In `SECURITY.md`, add expected response times, supported versions, and a concrete private fallback contact/process.
- Add a first paragraph that explicitly says not to include API keys, portfolio/account identifiers, personal holdings screenshots, or full `~/.opencandle` state in public reports.

### 6. P1 - Dependabot security update PRs are disabled in GitHub settings

Evidence:

- Live GitHub repo API reports `security_and_analysis.dependabot_security_updates.status = disabled`.
- `.github/dependabot.yml` exists and configures dependency updates.
- GitHub documents Dependabot security updates as a separate setting that creates PRs for vulnerable dependencies; `dependabot.yml` customizes behavior but does not by itself enable security update PRs.

Impact:

The repo can receive vulnerability alerts, but known-vulnerable dependency fixes will not automatically appear as PRs. This increases maintainer latency and weakens the public security posture.

Recommended fix:

- Enable Dependabot security updates in repository settings.
- Optionally add grouped security updates if noise becomes an issue.
- Keep the existing weekly version-update config.

### 7. P1 - Internal agent artifacts and public `AGENTS.md` publishing need an explicit policy

Evidence:

- The repo intentionally tracks AI/agent process files such as `.agents/`, `.codex/`, `.claude/`, `plans/`, and `docs/internal/`.
- `.claude/scheduled_tasks.lock` is tracked.
- `plans/README.md` describes generated improvement plans.
- `website/build.mjs:656-657` advertises `AGENTS.md` from `llms.txt`.
- `website/build.mjs:695` copies root `AGENTS.md` into the public website build.
- Live `https://opencandle.app/llms.txt` includes `Project agent instructions`.

Impact:

This is not a secret leak in the current audit, but it is a public-product decision. Internal agent instructions, historical plans, locks, and screenshots can be useful for transparency, but they can also look unpolished, expose maintainer operating details, and create extra surface for outdated or contradictory instructions.

Recommended fix:

- Decide which agent artifacts are part of the public OSS contract.
- Remove tracked lock files and generated local artifacts that are not intentionally public.
- Either keep `AGENTS.md` public as a curated AI-agent contributor guide or stop copying/advertising it from the website.
- Add a small policy note in `CONTRIBUTING.md` if AI-agent artifacts remain intentionally public.

### 8. P2 - Installed runtime still depends on shipped TypeScript source and `tsx` for GUI/monitor paths

Evidence:

- `package.json:73-79` ships `dist`, `gui/server`, `gui/shared`, `gui/web/dist`, and `src`.
- `src/cli-main.ts:122-124` launches the GUI server through `tsx/cli`.
- `src/cli-main.ts:146-148` launches monitor through `tsx/cli`.
- `npm pack --dry-run --json` includes `700` files and source/source-map-heavy package content.

Impact:

The package works today, and the packed-install smoke proves the main install path. But it is easy to accidentally break installed GUI/monitor behavior by changing `files`, removing `src`, changing dev/runtime dependency boundaries, or changing TypeScript module resolution.

Recommended fix:

- Compile GUI server and monitor into `dist` and launch built JS from the installed CLI.
- If keeping source-backed runtime by design, document it and expand packed-install smoke to cover `opencandle monitor --once` or equivalent.
- Track package file count/size in a machine-readable package-content check.

### 9. P2 - CI package-content gate parses human npm output and has an incomplete denylist

Evidence:

- `.github/workflows/ci.yml:47-54` captures `npm pack --dry-run` human output and greps for `(tests/|fixtures/|docs/|\.env|openspec/)`.
- The denylist does not mention `.agents/`, `.codex/`, `.claude/`, `plans/`, `docs/internal/`, `graphify-out/`, screenshots, or local validation directories.
- npm's `files` field is the real package allowlist; if it changes, the current gate can miss unwanted paths.

Impact:

The current package is clean because `package.json` has a tight `files` list, but the CI guard is brittle. A future package allowlist change could leak public-inappropriate files without failing CI.

Recommended fix:

- Replace the grep with a small script that runs `npm pack --dry-run --json`, parses file paths, checks a denylist and required-file allowlist, and prints a clear diff.
- Use the same script in `release:check` and CI.

### 10. P2 - Contributor docs and PR template lag the actual release/CI gates

Evidence:

- `CONTRIBUTING.md:24-31` lists basic development commands but does not explain the CI-equivalent gate.
- `.github/pull_request_template.md:11` only asks for `npm test`.
- `docs/testing-and-evals.md:15-23` frames a healthy checkout around basic tests, GUI build, and docs build.
- `docs/getting-started.md:148-154` also points maintainers at `npm test`.
- `package.json:121` and CI use the stronger `release:check`.

Impact:

Contributors can reasonably believe `npm test` is the expected validation bar and open PRs that fail typecheck, lint, docs build, tarball smoke, or link checks.

Recommended fix:

- Update `CONTRIBUTING.md` with two tiers: quick local loop (`npm test`) and CI-equivalent release check (`npm run release:check`).
- Update the PR template to include typecheck/lint or the release check.
- Add a short note for when to run live e2e/provider checks.

### 11. P2 - First-run TUI/GUI live exercise is not represented in the release gate/checklist

Evidence:

- `package.json:121` `release:check` does not include `test:e2e:credential-*` or `test:gui:browser`.
- `docs/testing-and-evals.md` documents e2e and GUI browser smoke separately.
- The packed-install smoke verifies install/import/doctor/GUI health but not a realistic first-run conversation/setup path with a fresh `OPENCANDLE_HOME`.

Impact:

The public release can pass all automated gates while a fresh-user setup flow regresses in either terminal or browser. For this product, first-run setup is the release-critical path.

Recommended fix:

- Add a release checklist item, separate from default CI if credentials/browser automation make it unsuitable for every PR:
  - fresh `OPENCANDLE_HOME`
  - terminal `opencandle` setup path
  - GUI startup
  - model setup
  - one no-provider and one provider-backed prompt if credentials are available
- Consider a `release:smoke:first-run` script that runs the deterministic pieces and prints manual steps for credentialed flows.

### 12. P2 - TUI/GUI setup docs blur Pi sign-in support versus GUI API-key setup

Evidence:

- `README.md:62-68` says first run supports Pi sign-in or API key, then immediately documents the GUI path.
- `docs/first-run.md` describes sign-in/API-key setup generally.
- GUI copy in `gui/web/src/features/onboarding/ModelSetupCard.jsx` is API-key oriented.
- GUI server fallback copy at `gui/server/server.ts:411-413` says to paste a Gemini/OpenAI/Anthropic API key in the setup panel.

Impact:

Users may infer browser setup supports Pi sign-in when the GUI setup panel is currently API-key based. That mismatch will be most visible to new public users.

Recommended fix:

- Document setup surfaces separately:
  - Terminal/TUI: Pi sign-in when available or API key.
  - GUI: API-key setup panel, or refresh after completing terminal `/setup`.
- Add a cross-link from GUI setup docs to terminal `/setup` for users who prefer sign-in.

### 13. P2 - GUI browser smoke fixture uses a non-production setup requirement value

Evidence:

- `gui/server/model-setup.ts:10` defines setup requirements as `"ready" | "select_model" | "connect_auth"`.
- `tests/e2e/gui-browser.test.ts:92-97` uses `requirement: "needs_api_key"`.

Impact:

The browser smoke test can pass for a setup state the production server never emits. That weakens confidence in the exact onboarding path it is supposed to cover.

Recommended fix:

- Change the fixture to `connect_auth`.
- Add a test using a real `buildModelSetupState()` output rather than a hand-written protocol object.

### 14. P2 - `.env` currently overwrites already-exported env vars

Evidence:

- `src/config.ts:84-100` parses `.env` and assigns values directly to `process.env`.
- `docs/configuration.md:18-24` documents that `.env` overwrites existing shell env values.

Impact:

This is documented, so it is not a hidden bug. But it is surprising compared with common dotenv behavior and can cause a stale local `.env` to override an intentionally exported credential, router mode, GUI bind, or CI setting. In a financial-data tool, wrong-account or stale-key surprises matter.

Recommended fix:

- Prefer not overwriting existing exported env by default.
- If changing behavior is too disruptive for `0.7.x`, add a prominent warning in configuration docs and `doctor` output when both sources define the same key.

### 15. P2 - Exported package subpaths lack a stability contract

Evidence:

- `package.json:22-50` exports `tool-kit`, infra helpers, types, providers, tools, and workflows.
- `README.md:189-199` lists available subpath imports.
- `docs/build-a-tool.md` explains add-on tool development but does not define stable versus experimental public API boundaries.

Impact:

Once public users build on these subpaths, changing provider/tool/workflow internals becomes a semver commitment by implication. The repo needs to say which surfaces are supported.

Recommended fix:

- Mark `opencandle/tool-kit` and selected type exports as stable.
- Mark provider/tool/workflow internals as experimental unless intentionally public.
- Add a generated or hand-written API reference for the stable subset.

### 16. P2 - Website AI/SEO/link artifacts need a release polish pass

Evidence:

- `website/build.mjs:310`, `website/build.mjs:446`, and `website/build.mjs:716-718` use build date as modified date/sitemap `lastmod`, not source page modification dates.
- `website/build.mjs:656-657` and live `llms.txt` advertise `AGENTS.md`.
- `website/build.mjs:661-670` builds `llms-full.txt` from raw markdown bodies; generated output still contains relative links such as `./AGENTS.md`.
- `website/build.mjs:695` copies root `AGENTS.md` into public dist.
- The public docs are accessible at both `/docs/` and `/docs/index.html`; canonical/sitemap choices should be consistent.

Impact:

The website is live and functional, but AI/search artifacts are part of the public face of the release. Stale build dates, raw relative links, and internal instructions in AI context files can undermine polish.

Recommended fix:

- Decide whether `AGENTS.md` belongs in public website output.
- Rewrite relative markdown links in `llms-full.txt` to absolute site URLs.
- Use page source modification dates or a release version date rather than build date where feasible.
- Pick canonical docs URLs consistently.

### 17. P3 - README/community discoverability can better surface contribution/security/CI/npm status

Evidence:

- GitHub community profile reports `100`, so the required files exist.
- README focuses on product/install/docs and does not prominently link `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, CI status, npm version, or license badges.

Impact:

Not a release blocker, but popular GitHub repos usually make contribution, security, license, CI, and package status visible from the top-level README.

Recommended fix:

- Add a compact badge/link row near the top of README.
- Add a short "Contributing and security" section near the end.

### 18. P3 - GitHub Releases use generated notes instead of the curated changelog

Evidence:

- `CHANGELOG.md` contains curated release notes.
- `scripts/release.mjs:57-59` updates `CHANGELOG.md` for the release.
- `.github/workflows/publish.yml:49-52` creates GitHub Releases with `gh release create "${{ github.ref_name }}" --generate-notes`.

Impact:

GitHub Release pages can diverge from the curated changelog and bury the intentional product narrative.

Recommended fix:

- Extract the matching `CHANGELOG.md` section and pass it to `gh release create --notes-file`.
- Keep generated notes as an optional supplement only if useful.

### 19. P3 - GitHub Actions are version-tag pinned, not full-SHA pinned

Evidence:

- Workflows use actions such as `actions/checkout@v6`, `actions/setup-node@v6`, and `actions/upload-pages-artifact@v4`.
- GitHub's secure-use guidance says pinning to a full commit SHA is the only immutable action pinning mode.

Impact:

This is a hardening improvement, especially for public repos, but first-party GitHub actions pinned to major versions are common. Treat as P3 unless the project wants stricter supply-chain posture.

Recommended fix:

- Pin third-party actions to full SHAs immediately if any are added.
- Optionally pin first-party actions to SHAs and document the update process.

### 20. P3 - npm provenance is enabled, but there is no SBOM artifact

Evidence:

- `.github/workflows/publish.yml:47` uses `npm publish --provenance`.
- No release workflow currently generates or attaches an SBOM.
- OSSF Scorecard includes SBOM-related checks for release artifacts.

Impact:

Provenance is the more important baseline and is already present. SBOMs are useful for downstream users and public trust, but this can follow after P1/P2 release hardening.

Recommended fix:

- Generate a CycloneDX or SPDX SBOM in release CI.
- Attach it to GitHub Releases and optionally publish as an npm artifact sidecar.

### 21. P3 - GUI bundle emits a large-chunk warning during release build

Evidence:

- `npm run release:check` Vite build warned that `gui/web/dist/assets/index-*.js` is about `644 KB` minified after build.

Impact:

The local GUI loads from localhost, so this is not currently a blocker. But it affects first paint and perceived quality, especially on older machines.

Recommended fix:

- Lazy-load heavier panels such as catalog, market state, charting, or long overlays.
- Add bundle-size tracking if the GUI becomes a major public entry point.

### 22. P3 - Large ignored generated directories remain in local checkout

Evidence:

- `graphify-out`, `validation-output`, `dogfood-output`, `website/dist`, and `dist` are ignored.
- Subagent disk inspection found `graphify-out` is large locally.
- `git check-ignore -v` confirms the expected generated paths are ignored.

Impact:

These are not currently public package leaks. They can still slow local scans, confuse manual release prep, and accidentally appear in screenshots/demos or ad hoc artifacts.

Recommended fix:

- Add a maintainer cleanup checklist before release demos.
- Keep generated directories ignored.
- Do not add cleanup to release automation unless it is safe and clearly scoped.

## Confirmed Good / Non-Findings

- No P0 public-release blocker was found in the current checkout.
- `npm run release:check` passes on the audited checkout.
- `npm audit` reports zero vulnerabilities for both production and full dependency sets.
- The npm package allowlist currently excludes docs, tests, fixtures, `.env`, OpenSpec, graph output, validation output, internal docs, and agent planning files.
- `.env` is ignored and not tracked in the current checkout.
- Local raw eval run outputs under `tests/evals/runs` are ignored; only the `.gitkeep` placeholder is tracked.
- `main` has active branch protection with required status checks and PR review controls.
- Secret scanning and push protection are enabled in GitHub settings.
- GitHub community profile health is `100`.
- The public docs site is live and builds from `website/build.mjs`.
- The packed-install smoke validates the installed tarball, CLI exports, `doctor`, and GUI `/health`.
- A standalone install script is not recommended for this release; keep npm/npx install paths and strengthen smoke/checklist coverage instead.

## Suggested Execution Order

1. Fix the two GUI onboarding issues together:
   - Load `.env` before GUI/monitor command handling.
   - Disable chat while model setup is incomplete.
   - Add GUI web/server regression tests.
2. Harden release/publish flow:
   - Branch/upstream/tag assertions in `scripts/release.mjs`.
   - `prepublishOnly` uses `release:check` or blocks local publish.
   - Machine-readable package-content validation.
3. Tighten public security posture:
   - Enable Dependabot security update PRs.
   - Add redaction guidance to issue templates.
   - Expand `SECURITY.md` with fallback/private reporting details.
4. Clarify public surface:
   - Decide what to do with `AGENTS.md`, `.agents`, `.codex`, `.claude`, `plans`, and `docs/internal`.
   - Stop tracking locks/generated artifacts that are not intentionally public.
5. Align docs with real gates and setup surfaces:
   - README, Getting Started, First Run, Testing/Evals, Contributing, PR template.
6. Decide package API stability:
   - Stable add-on API versus experimental internals.
7. Polish website AI/SEO artifacts:
   - `llms.txt`, `llms-full.txt`, canonical URLs, last-modified dates.
8. Optional hardening:
   - SHA-pin actions.
   - Generate SBOMs.
   - Reduce GUI bundle size.

## External References Used

- GitHub community profile documentation: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories
- GitHub Dependabot security updates documentation: https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates
- GitHub secure use of Actions, including SHA pinning guidance: https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/security-hardening-for-github-actions
- OSSF Scorecard checks documentation: https://github.com/ossf/scorecard/blob/main/docs/checks.md
- npm `package.json` `files` field documentation: https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files
