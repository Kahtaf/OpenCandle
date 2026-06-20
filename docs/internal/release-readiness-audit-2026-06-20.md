# Release Readiness Audit - 2026-06-20

Audit target: OpenCandle at `0ecce39` on `main`.

Current checkout status at audit start and end: dirty. Modified files were already present in routing, routing tests, changelog, and competitive benchmark history. This report does not change source code.

## Scope

This audit focused on public-release readiness rather than feature quality alone:

- docs consistency, README, npm README behavior, and public website
- artifact cleanup and package contents
- git/security hygiene, `.env` handling, dependency advisories, GitHub Actions hardening
- TUI and GUI onboarding and clean-machine install path
- release workflow, CI, package publishing, and validation gates
- OSS best-practice baseline using GitHub community profile, OpenSSF Scorecard categories, npm package behavior, and mature public repos

Subagents explored six independent slices: public docs/site, security/artifacts, install/DX, GUI/TUI onboarding, CI/release/package metadata, and code/test release risks. Findings below are deduplicated and vetted against the current checkout.

## Executive Summary

OpenCandle is close in product shape but not ready for a public release until the remaining P0/P1 items are addressed.

The biggest remaining release blockers are external trust issues rather than missing features: high-severity runtime dependency advisories, an unsafe manual publish workflow path, no branch protection on `main`, and install/package validation gaps that could let a broken installed package reach npm.

The repo is strong in several public OSS basics: GitHub reports a 100% community profile, the package uses an npm `files` allowlist, `.env` is ignored and not tracked, private vulnerability reporting is enabled, tests/typecheck/docs build pass locally, and the README/demo media are generally current for GitHub readers.

Post-audit update: the dirty-checkout/routing-regression item found during the audit was addressed in the cleanup that commits this report; it remains documented below because it was a real P0 finding at audit time.

Implementation rollout update: the follow-up release-readiness implementation completed the repository-code findings in this report:

- upgraded Pi runtime packages and Vite, clearing production and full npm audit findings
- aligned Node support to `>=22.19.0 <27`, matching the upgraded Pi runtime
- moved the native dependency guard onto the installed `opencandle` entrypoint
- added release preflight, packed-install smoke, docs build, public-link check, and tag-only publish gates
- added CI coverage for the declared Node range, hardened workflow permissions, Dependabot, and CODEOWNERS
- converted npm README links and media to package-safe public URLs
- removed tracked `dogfood-output/` and `design-inspo/` artifacts and ignored them going forward
- added GUI HTTP fallback support for first-run model setup actions, while keeping Pi sign-in terminal-only
- accepted both `GEMINI_API_KEY` and `GOOGLE_API_KEY` in credential e2e setup
- corrected stale docs links, benchmark settle-window docs, package homepage metadata, native install docs, and repo wiki/branch-cleanup settings

`main` branch protection is configured through GitHub repository settings after the implementation commits are pushed, because enabling it first would block the atomic release-readiness push itself.

## Validation Run

Commands run during this audit:

- `npx tsc --noEmit` - passed
- `npm test` - passed, 203 files / 2118 tests
- `npm run docs:site:build` - passed, built landing page plus 17 docs pages
- `npm pack --dry-run --json` - passed, package dry run produced 696 entries, about 976 KB packed / 4.0 MB unpacked
- `npm audit --omit=dev --json` - failed with 4 high production advisories
- `npm audit --json` - failed with 5 high total advisories including dev tooling
- `gh api repos/Kahtaf/OpenCandle/branches/main/protection` - returned `Branch not protected`
- `gh api repos/Kahtaf/OpenCandle/community/profile` - health percentage 100
- external README demo MP4 HEAD checks - both jsDelivr MP4 URLs returned HTTP 200
- stale Pi docs link HEAD check - returned HTTP 404

## Priority Legend

- P0: block release until fixed or explicitly accepted by maintainer
- P1: should fix before public release
- P2: important hardening or polish; acceptable only with explicit release-note/issue tracking
- P3: backlog after release

## Ranked Findings

| Priority | Item | Category | Effort | Confidence | Evidence |
| --- | --- | --- | --- | --- | --- |
| P0 | Upgrade runtime Pi dependency stack and clear production audit highs | Security / deps | M | HIGH | `package.json:127-130`, `package-lock.json` Pi/undici/ws/protobuf locks, `npm audit --omit=dev` |
| P0 | Protect `main` before public release | Git governance | S/M | HIGH | GitHub API returned `Branch not protected` |
| P0 | Gate manual publish dispatch to real version tags | Release | S | HIGH | `.github/workflows/publish.yml:3-40` |
| P0 resolved | Resolve current dirty checkout and routing regression before release | Correctness / process | S | HIGH | `git status`, `src/routing/planning.ts:559-776` |
| P1 | Move native dependency guard onto installed `opencandle` entrypoint | Install / DX | M | HIGH | `package.json:19-20`, `src/cli.ts:1-2`, `scripts/check-node-version.mjs:18-22` |
| P1 | Add packed-install smoke before publish | Release / package | M | HIGH | `.github/workflows/ci.yml:36-54`, `.github/workflows/publish.yml:28-35` |
| P1 | Add local release preflight before tagging/pushing | Release | S/M | HIGH | `scripts/release.mjs:39-74` |
| P1 | Test the full declared Node engine range | CI | S | HIGH | `package.json:123-124`, `.github/workflows/ci.yml:21-31` |
| P1 | Add docs-site build to PR CI | Docs / CI | S | HIGH | `.github/workflows/ci.yml:30-54`, `.github/workflows/pages.yml:3-31` |
| P1 | Make npm-shipped README links resolve outside GitHub | Docs / npm | S | HIGH | `README.md:11-25`, `README.md:241`, `package.json:73-80` |
| P1 | Remove or quarantine tracked dogfood outputs containing local market-state data | Artifacts / privacy | S | HIGH | `dogfood-output/chat-harness-report.md:3-47`, `.gitignore:1-13` |
| P1 | Make GUI HTTP fallback support first-run setup or block it clearly | GUI onboarding | M | HIGH | `gui/web/src/hooks/useGuiConnection.jsx:90-99`, `gui/web/src/hooks/useGuiConnection.jsx:209-218`, `gui/web/src/features/onboarding/ModelSetupCard.jsx:64-72` |
| P1 | Fix GUI-first model setup parity or document API-key-only behavior | Onboarding docs / UX | S/M | MED | `README.md:62-68`, `src/pi/setup.ts`, `gui/server/model-setup.ts:75-99`, `gui/server/model-setup.ts:164-185` |
| P1 | Update Vite to clear high-severity dev-server advisories | Security / dev deps | S | HIGH | `package.json:147-149`, `package-lock.json` Vite lock, `npm audit --json` |
| P2 | Harden GitHub Actions permissions and action pinning | CI security | S/M | MED | `.github/workflows/ci.yml:18-24`, `.github/workflows/pages.yml:21-29`, `.github/workflows/publish.yml:18-24` |
| P2 | Add Dependabot or equivalent dependency update automation | OSS maintenance | S | HIGH | no `.github/dependabot.yml`; GitHub community baseline and OpenSSF dependency-update expectations |
| P2 | Add CODEOWNERS for public review ownership | OSS maintenance | S | MED | no repo `CODEOWNERS`; public repo currently has issue/PR templates but no ownership routing |
| P2 | Add native install troubleshooting to public docs | Install docs | S | MED | `README.md:56`, `docs/getting-started.md:12-16`, `package.json:130`, `scripts/check-node-version-lib.mjs:38-40` |
| P2 | Accept `GEMINI_API_KEY` in credential e2e Google paths | Test coverage | S | HIGH | `.env.example:3`, `docs/configuration.md:35`, `tests/e2e/credential-prompt.test.ts:20-50` |
| P2 | Replace stale Pi documentation link | Docs / website | S | HIGH | `docs/build-a-tool.md:238`, HTTP 404 |
| P2 | Correct benchmark settle-window default | Docs consistency | S | HIGH | `docs/benchmarking.md:85`, `tests/scripts/run-competitive-finance-eval.ts:106` |
| P2 | Decide whether `package.json.homepage` should point to the public website | Package metadata | S | MED | `package.json:6`, GitHub repo homepage is `https://opencandle.app` |
| P2 | Clean or move tracked design/dogfood artifacts before broad public launch | Artifact cleanup | M | HIGH | tracked `design-inspo/` about 31 MB, tracked `dogfood-output/` about 5.8 MB |
| P3 | Add public-doc external link checking | Docs tooling | S/M | MED | stale Pi link was not caught by docs build |
| P3 | Consider branch auto-delete and wiki policy | Repo settings | S | LOW | GitHub repo settings: `deleteBranchOnMerge=false`, `hasWikiEnabled=true` |

## Detailed Findings

### P0. Upgrade Runtime Pi Dependency Stack

Evidence:

- `package.json:127-130` depends on `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `better-sqlite3`.
- `package-lock.json` locks the Pi packages at `0.75.5`; the lockfile also brings vulnerable `undici`, `ws`, and `protobufjs` versions through the runtime tree.
- `npm audit --omit=dev --json` reported 4 high production advisories. The direct runtime issue is `@earendil-works/pi-coding-agent`; npm reports a fix path to `0.79.8`.

Impact:

Public npm users would install a package whose production dependency tree reports high-severity advisories. This is a trust blocker for a finance tool that stores local auth and user market state.

Fix sketch:

Upgrade the Pi package family together, refresh the lockfile, and run the full release gates: `npx tsc --noEmit`, `npm test`, `npm run gui:web:build`, `npm run docs:site:build`, `npm pack --dry-run`, and an installed-package smoke.

### P0. Protect `main`

Evidence:

- `gh api repos/Kahtaf/OpenCandle/branches/main/protection` returned `Branch not protected`.
- GitHub repo metadata confirms the repo is public and `main` is the default branch.

Impact:

For public release, unprotected `main` allows accidental direct pushes or force-push mistakes unless maintainer discipline compensates manually. OpenSSF Scorecard treats branch protection as a core supply-chain signal.

Fix sketch:

Enable branch protection or repository rules for `main`: require PR review for non-trivial changes, require CI, block force pushes, block deletions, and require conversation resolution if desired. Include Pages/Publish rules separately because tag publishing has different constraints.

### P0. Gate Manual Publish Dispatch

Evidence:

- `.github/workflows/publish.yml:3-7` triggers on both `v*` tags and `workflow_dispatch`.
- `.github/workflows/publish.yml:34-40` always runs `npm publish --access public --provenance` and then `gh release create "${{ github.ref_name }}" --generate-notes`.

Impact:

A manual run from `main` can attempt to publish the current package version and create a GitHub release named after the branch/ref instead of a version tag.

Fix sketch:

Remove `workflow_dispatch`, or require an explicit version tag input and fail unless the effective ref is `refs/tags/v*` and `package.json` version matches the tag.

### P0. Resolve Current Dirty Checkout and Routing Regression

Post-audit status: resolved by tightening portfolio-review routing to require explicit portfolio/owned-asset cues, adding positive saved-portfolio exposure tests, and adding negative broad bond-rate mechanics tests.

Evidence:

- `git status --short` shows modified routing files, routing tests, changelog, and competitive benchmark history.
- `scripts/release.mjs:39-45` refuses to run with a dirty tree.
- `src/routing/planning.ts:559-564` checks `isPortfolioRebalancePrompt()` before macro classification.
- `src/routing/planning.ts:768-776` treats terms like `bonds` plus `change` as portfolio rebalance cues.
- The current diff moved portfolio rebalance detection before macro detection and expanded the rebalance trigger.

Impact:

The current checkout cannot be released with the scripted flow. More importantly, prompts such as "How would falling rates change bond prices over the next year?" can be classified as portfolio review instead of macro/education. That can produce irrelevant portfolio-rebalance policy and artifacts for public users.

Fix sketch:

Finish or revert the dirty routing work before release. Tighten portfolio rebalance detection so broad asset-class questions require actual portfolio cues, while preserving explicit saved-portfolio exposure prompts. Add negative tests for rate/bond education prompts.

### P1. Move Native Dependency Guard Onto Installed CLI Path

Evidence:

- `package.json:19-20` exposes `opencandle` as `dist/cli.js`.
- `src/cli.ts:1-2` imports only the TypeScript Node-version guard.
- `scripts/check-node-version.mjs:18-22` performs the `better-sqlite3` native dependency self-healing path, but this is reached through `prestart` / `npm run check:node`, not necessarily through installed `npx opencandle`.

Impact:

Source `npm start` gets native dependency diagnostics and repair attempts. Installed users can still hit a stale `better-sqlite3` binding failure before seeing the intended repair path, especially after changing Node versions or using npx cache.

Fix sketch:

Move the native binding probe/rebuild into a runtime startup module imported before CLI command dispatch, or have `src/infra/node-version.ts` call a shared native-dependency guard. Add a packed install test that exercises the installed bin.

### P1. Add Packed-Install Smoke Before Publish

Evidence:

- `.github/workflows/ci.yml:36-54` validates dry-run package contents and then runs tests against the repo checkout.
- `.github/workflows/publish.yml:28-35` runs `npm ci`, `npm test`, and publishes.
- Existing CLI tests exercise source paths, not a package installed from the tarball.

Impact:

Missing files, export-map drift, bin permissions, GUI static asset omissions, runtime `tsx` resolution problems, or native-dependency startup issues could reach npm despite repo tests passing.

Fix sketch:

Add a CI job that builds, packs, installs the `.tgz` into a temp project, then runs:

- imports for all public exports
- `opencandle doctor` with temp `OPENCANDLE_HOME`
- `opencandle gui` on a test port and `curl /health`
- optional `npx opencandle --help` or equivalent once a non-interactive help path exists

### P1. Add Release Preflight Before Mutation

Evidence:

- `scripts/release.mjs:39-74` checks cleanliness, bumps version, updates changelog, commits, tags, and pushes.
- It does not run typecheck, lint, tests, docs build, package dry-run, or packed-install smoke before creating a tag.

Impact:

A maintainer can create and push a release tag that fails later in GitHub Actions, leaving a bad public tag to clean up.

Fix sketch:

Add `release:check` and have `release.mjs` run it before version mutation. Minimum: `npx tsc --noEmit`, `npx biome ci .`, `npm test`, `npm run docs:site:build`, package dry-run, and eventually packed-install smoke.

### P1. Test Declared Node Range

Evidence:

- `package.json:123-124` declares support for Node `^20.19.0 || ^22.12.0 || >=24.0.0 <27`.
- `.github/workflows/ci.yml:21-31` tests only Node 22.
- `.github/workflows/publish.yml:21-32` publishes using Node 24.

Impact:

Node 20, the minimum supported LTS range, can regress unnoticed. Native dependencies increase that risk.

Fix sketch:

Add a CI matrix for Node 20.19.x, 22.x, and 24.x for install, typecheck, and unit tests. Keep heavier docs/package checks on one runtime if needed.

### P1. Build Public Docs in PR CI

Evidence:

- `.github/workflows/ci.yml:30-54` runs typecheck, lint, package validation, and tests.
- `.github/workflows/pages.yml:3-31` builds the site only on `main` push or manual dispatch.

Impact:

PRs can break the public website build and still pass CI, with failure surfacing only after merge.

Fix sketch:

Add `npm run docs:site:build` to CI. Consider adding public-doc link checks as a separate later step.

### P1. Fix npm README Link Behavior

Evidence:

- `README.md:11` links to relative docs paths.
- `README.md:17-25` references local poster images under `assets/`.
- `README.md:241` links to `tests/harness/README.md`.
- `package.json:73-80` publishes only `assets/logo.svg`, `dist`, GUI runtime files, `gui/web/dist`, and `src`.
- CI intentionally rejects `docs/` and `tests/` in the tarball.

Impact:

The GitHub README works, but the npm package README can contain broken relative links/images because npm receives `README.md` without the linked docs, poster assets, or tests.

Fix sketch:

Keep the package allowlist, but change README links intended for npm readers to absolute `https://opencandle.app/...` or GitHub URLs. Use raw/CDN URLs for README poster images or intentionally package the poster files and update the CI gate.

### P1. Remove or Quarantine Tracked Dogfood Outputs

Evidence:

- `dogfood-output/chat-harness-report.md:3` says the run used the same local `~/.opencandle` state as the GUI server.
- `dogfood-output/chat-harness-report.md:37-47` records portfolio-style output from local state.
- `.gitignore:1-13` ignores many generated paths but not `dogfood-output/`.
- `dogfood-output/` is tracked and about 5.8 MB.

Impact:

The package tarball does not include `dogfood-output/`, but the public repository exposes local financial state snapshots and makes future dogfood artifacts easy to commit accidentally.

Fix sketch:

Move any useful dogfood evidence into curated internal docs with scrubbed data, remove raw generated outputs from public tracked files, and add `dogfood-output/` to `.gitignore`.

### P1. Fix GUI HTTP Fallback First-Run Setup

Evidence:

- `gui/web/src/hooks/useGuiConnection.jsx:90-99` falls back to `/api/bootstrap` and sets `wsRef.current = null`.
- `gui/web/src/hooks/useGuiConnection.jsx:209-218` makes `send(...)` fail when no WebSocket is open.
- `gui/web/src/features/onboarding/ModelSetupCard.jsx:64-72` saves first-run model keys through `send("model.setup.save_api_key", ...)`.
- `tests/e2e/gui-browser.test.ts:648-673` covers HTTP fallback only with `modelSetup: { requirement: "ready" }`, so it does not test first-run setup under fallback.

Impact:

If WebSocket boot fails but HTTP bootstrap succeeds, a fresh GUI user can load the UI but cannot complete model setup from that UI.

Fix sketch:

Either explicitly block setup actions in fallback mode with a clear first-run message, or add trusted HTTP endpoints for model setup/provider setup and test `requirement: "connect_auth"` fallback.

### P1. Align GUI-First Model Setup Expectations

Evidence:

- `README.md:62-68` says first run supports Pi sign-in when available or API keys, then offers GUI startup.
- `src/pi/setup.ts` supports sign-in and API-key paths in the TUI.
- `gui/server/model-setup.ts:75-99` exposes fixed API-key providers only.
- `gui/server/model-setup.ts:164-185` stores `{ type: "api_key" }` and selects a model.

Impact:

A GUI-first user expecting Pi sign-in cannot complete that path in the GUI. They must use API keys or switch to terminal setup.

Fix sketch:

Either add GUI sign-in support, or change README / first-run / GUI quickstart copy to say GUI model setup currently supports API keys and terminal setup is required for sign-in.

### P1. Update Vite

Evidence:

- `package.json:147-149` declares Vite as dev dependency.
- `npm audit --json` reports high-severity Vite advisories in the dev tree.

Impact:

This is not runtime npm package exposure, but it affects contributors running the dev server, especially on Windows paths covered by the advisory.

Fix sketch:

Upgrade Vite to the patched version, refresh lockfile, then run `npm run gui:web:build` and GUI tests.

### P2. Harden GitHub Actions

Evidence:

- `.github/workflows/ci.yml` has no explicit top-level `permissions`; it uses `actions/checkout@v6` and `actions/setup-node@v6`.
- `.github/workflows/pages.yml` and `.github/workflows/publish.yml` set permissions, but all workflows use tag-pinned actions rather than commit SHA-pinned actions.

Impact:

OpenSSF Scorecard and GitHub Actions hardening guidance both call out token permissions and pinned dependencies. The current workflows are typical for small repos but not hardened for a finance-adjacent public package.

Fix sketch:

Add explicit least-privilege permissions to CI (`contents: read`). Consider SHA-pinning third-party actions or using an org policy that enforces allowed actions/SHA pinning.

### P2. Add Dependency Update Automation

Evidence:

- No `.github/dependabot.yml` exists.
- Runtime and dev dependency advisories were found manually in this audit.

Impact:

Security fixes can sit unnoticed until a manual release audit. For a public package, dependency-update automation is expected even if maintainers batch updates.

Fix sketch:

Add Dependabot or Renovate for npm and GitHub Actions. Group Pi family packages together so runtime integration is tested as a unit.

### P2. Add CODEOWNERS

Evidence:

- No repo `CODEOWNERS` file exists.
- `.github/pull_request_template.md` and issue templates exist and are useful, but review ownership is not encoded.

Impact:

As outside contributions start, ownership for sensitive surfaces such as release workflows, `src/pi/`, providers, prompts, and security docs is implicit.

Fix sketch:

Add `CODEOWNERS` with at least release workflows, package metadata, Pi integration, providers, prompts, and GUI/server owners.

### P2. Add Native Install Troubleshooting Docs

Evidence:

- `README.md:56` and `docs/getting-started.md:12-16` list Node requirements.
- `package.json:130` depends on native `better-sqlite3`.
- `scripts/check-node-version-lib.mjs:38-40` has the repair language for ABI mismatches.

Impact:

Most users will get prebuilt binaries, but users without a matching binary or build toolchain can hit npm/native build failures without OpenCandle-specific troubleshooting.

Fix sketch:

Add a short "Native dependency troubleshooting" section to getting-started/first-run docs: use supported Node, retry clean install, run `npm rebuild better-sqlite3`, and install platform build tools if npm falls back to node-gyp.

### P2. Accept `GEMINI_API_KEY` in Credential E2E

Evidence:

- `.env.example:3`, `README.md:124`, `docs/configuration.md:35`, and `gui/server/model-setup.ts:79` document `GEMINI_API_KEY`.
- `tests/e2e/credential-prompt.test.ts:20-50` and related credential e2e tests look for `GOOGLE_API_KEY`.

Impact:

A release environment configured exactly as docs say can skip the Google credential e2e path.

Fix sketch:

Support both `GEMINI_API_KEY` and `GOOGLE_API_KEY` in e2e credential selection, with one canonical skip message.

### P2. Replace Stale Pi Docs Link

Evidence:

- `docs/build-a-tool.md:238` links to `https://github.com/nicobailon/pi-coding-agent`.
- The link returned HTTP 404 during the audit.
- Runtime dependencies use `@earendil-works/*` Pi packages.

Impact:

Add-on authors following public docs land on a dead/stale repo for Pi extension lifecycle details.

Fix sketch:

Replace the link with current Earendil Pi docs or remove the external lifecycle link until a stable public URL exists.

### P2. Correct Benchmark Settle Default

Evidence:

- `docs/benchmarking.md:85` says `OPENCANDLE_MANUAL_RUN_SETTLE_GRACE_MS` defaults to `30000`.
- `tests/scripts/run-competitive-finance-eval.ts:106` defaults it to `90000`.

Impact:

Benchmark operators can misread slower runs or override the runner downward and reintroduce truncation.

Fix sketch:

Update public and internal benchmark docs to `90000`.

### P2. Align Package Homepage Metadata

Evidence:

- `package.json:6` uses `https://github.com/Kahtaf/OpenCandle#readme`.
- GitHub repo metadata homepage is `https://opencandle.app`.

Impact:

npm users may be sent to GitHub instead of the public website. This is not a blocker, but public launch polish should make the website the canonical product/docs destination.

Fix sketch:

Set `homepage` to `https://opencandle.app` and keep `repository`/`bugs` pointing to GitHub.

### P2. Clean Tracked Design and Dogfood Artifacts

Evidence:

- `design-inspo/` is tracked and about 31 MB.
- `dogfood-output/` is tracked and about 5.8 MB.
- The largest tracked files are mostly screenshots and MP4 demo assets.

Impact:

Large internal/reference artifacts make the public repository feel less curated. Commercial app screenshots in `design-inspo/commercial/` may also create provenance/licensing questions for a public launch.

Fix sketch:

Keep intentional brand/demo assets under `assets/`. Move internal design references and raw dogfood output to untracked local storage, an internal docs branch, or a separate design archive. Leave curated public screenshots only where they directly support docs.

## OSS Baseline Notes

Checked sources and public examples:

- GitHub community profile guidance: README, license, code of conduct, contributing, security, issue/PR templates.
- OpenSSF Scorecard categories: branch protection, token permissions, pinned dependencies, dependency updates, dangerous workflows.
- npm package behavior: `files` controls package inclusion; dry-run package checks are the right verification surface.
- GitHub Actions secure-use guidance: least-privilege token permissions and pinned actions are preferred.
- Spot checks via GitHub community profile API: `vercel/next.js`, `vitejs/vite`, `supabase/supabase`, `nodejs/node`, and `ghostfolio/ghostfolio`.

OpenCandle already has:

- README, license, code of conduct, contributing, security policy
- bug and feature issue forms plus PR template
- public website configured as GitHub repo homepage
- private vulnerability reporting enabled
- npm provenance in the publish workflow
- package `files` allowlist
- `.env.example`, `.node-version`, `.nvmrc`

OpenCandle is missing or should harden:

- branch protection on `main`
- Dependabot/Renovate
- CODEOWNERS
- explicit least-privilege permissions in CI
- publish workflow dispatch guard
- packed-install smoke
- public-doc external link check

## Non-Findings / Confirmed Good

- GitHub community profile API reports health percentage 100.
- `.env` exists locally but is ignored and not tracked. The audit did not expose or copy its contents.
- `git ls-files` found no tracked `.env` file; tracked secret-pattern hits were code/test placeholders, not raw credentials.
- `npm pack --dry-run --json` did not include `.env`, `node_modules`, `graphify-out`, `dogfood-output`, `validation-output`, `plans`, `docs/internal`, `website/dist`, `design-inspo`, `.agents`, `.claude`, `.codex`, `openspec`, or `tests`.
- `graphify-out/`, `website/dist/`, `validation-output/`, `node_modules/`, and `.claude/worktrees/` are ignored.
- README local Markdown links resolve in the checkout.
- Website source pages in `website/build.mjs` exist and `npm run docs:site:build` passes.
- README Node engine requirement matches `package.json`.
- README demo MP4 CDN links returned HTTP 200.
- TUI model setup blocks chat until a model is available and has unit coverage.
- Data-provider `/connect` validates before persisting and blocks environment-variable override ambiguity.
- GUI server records setup guidance instead of invoking a model when no model is configured.
- A standalone install script does not appear necessary right now. The better release path is npm/npx plus packed-install smoke, installed-entrypoint native guard, and clearer troubleshooting docs.

## Suggested Execution Order

1. Resolve the dirty routing work and current classification regression.
2. Upgrade Pi runtime packages and Vite; rerun full validation.
3. Protect `main` and harden publish workflow dispatch.
4. Add release preflight and packed-install smoke.
5. Add Node matrix and docs-site build to PR CI.
6. Fix npm README links and stale docs.
7. Clean dogfood/design artifacts and ignore future raw dogfood output.
8. Fix GUI first-run fallback/parity docs.
9. Add Dependabot/Renovate and CODEOWNERS.
10. Add external link checking and remaining polish.

## External References

- GitHub community profiles: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories
- OpenSSF Scorecard checks: https://github.com/ossf/scorecard/blob/main/docs/checks.md
- GitHub Actions secure use: https://docs.github.com/en/actions/reference/security/secure-use
- npm package.json and `files`: https://docs.npmjs.com/files/package.json/
