---
description: Learn how to contribute tested, reviewable changes to OpenCandle, from local setup and issue discussion through pull request review.
---

# Contributing to OpenCandle

OpenCandle is an open source financial investigator built with [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev), and [Pi](https://github.com/earendil-works/pi). Contributions should keep the runtime small, the data flow explicit, and the quality bar high enough for a public npm package.

## Before You Start

- For non-trivial features, start with an issue or discussion before opening a PR.
- Bug fixes should include a clear reproduction in the PR description.
- Behavior-changing work must include tests.
- Keep user-facing claims factual. Do not document or imply package behavior that does not exist yet.

## Local Setup

Requires Node.js `^22.22.2 || >=24.0.0 <27` (see `engines` in `package.json`). `npm install`, `npm test`, and `npm start` all run a `check:node` guard first, so an unsupported Node version fails fast with a clear message instead of a confusing downstream error.

```bash
npm install
cp .env.example .env
npm start
```

If you need provider keys for manual testing, prefer `.env` for local work. Unit tests must continue to run without live API access.

## Development Commands

```bash
npm start
npm test
npm run test:watch
npm run test:e2e
npm run test:e2e:cli
npm run test:e2e:providers
```

`npm test` is the required quick-loop validation after changes. Before pushing, run what CI gates on:

```bash
npm run lint        # biome check (CI gates on this)
npm run typecheck   # tsc --noEmit
npm run check       # typecheck + eval-script typecheck + relay typecheck + biome ci
npm run gates       # core proof gate (step list: scripts/test-gate-policy.json)
npm run gates:full  # full proof gate (step list: scripts/test-gate-policy.json)
npm run release:check  # release proof gate (full + packed-install + docs links); deterministic
npm run test:coverage  # Node+relay coverage ratchet; browser/combined coverage reported separately
npm run review:pr   # repo autoreview + gates:full (run before opening or updating a PR)
```

Run `npm run gates:full` before opening or updating a PR; `npm run gates` is the faster mid-loop check. Before opening a release-facing PR, also run the CI-equivalent local gate:

```bash
npm run release:check
```

See [Testing and Evals](docs/testing-and-evals.md) for what the gate covers. The GUI smoke and the `agent-tools` coverage-browser fixture require Chromium; install it once with `npx playwright-core install chromium` (Linux: `--with-deps`). Use the focused e2e/provider/GUI browser checks when your change touches those flows or depends on live credentials. The Publish workflow is the release owner and runs its required live checks in GitHub.

## Engineering Conventions

Code style, TDD requirements, tool boundaries, where things live, and what needs sign-off before changing all live in [AGENTS.md](./AGENTS.md), the authoritative engineering guide for human and agent contributors alike. Read it before making non-trivial changes; this file only covers what AGENTS.md doesn't.

## Pull Requests

Open focused PRs with enough context for review.

Every PR should explain:

- what changed
- why it changed
- user or maintainer impact
- test coverage added or updated
- risks, follow-ups, or known gaps

For non-trivial work, link the issue or design discussion that established scope.

Codex reviews are advisory rather than a merge gate. A review may run automatically when a PR is opened, and maintainers can request one at any time by commenting `@codex review`. Address substantive findings, but do not wait for a Codex status check before merging.

## Release Notes and Changelog Discipline

OpenCandle follows Pi's release style where possible: manual semver bump scripts, a maintained `CHANGELOG.md` with an `Unreleased` section, and explicit release commands.

Prefer clear commit-message prefixes such as:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`

Release notes should describe user-visible impact, not just implementation detail.

Prepare the version in a PR from the latest `origin/main`. Choose `release:patch`, `release:minor`, or `release:major`:

```bash
git fetch origin main
git switch -c release/next origin/main
npm run release:patch
```

After merging the version PR, start the Publish workflow from `main` with the merged version. For example:

```bash
gh workflow run publish.yml --ref main -f version=0.16.0 -F publish=true
```

Omit `publish=true` to validate without tagging or publishing. Supply `advisory_comparison=true` to also run the judged comparison on a separate runner. GitHub validates the dispatched commit and publishes the exact tarball that passed the install test using npm trusted publishing with provenance.

Configure the GitHub `release` environment to allow only `main` and set its required reviewers in repository settings. The required live checks use `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). The optional judged comparison also needs `OPENAI_API_KEY`.

## Public Agent Artifacts

OpenCandle intentionally publishes `AGENTS.md` as an AI-agent contributor guide and keeps repo-local skills under version control when they are part of maintainer workflow. Generated local locks, raw agent traces, local plans, and machine-specific outputs are not part of the public contract and should not be committed.

## Code of Conduct and Security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues per [SECURITY.md](SECURITY.md) rather than filing a public issue.
