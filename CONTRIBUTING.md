# Contributing to OpenCandle

OpenCandle is a financial data analysis agent built with TypeScript, Vitest, and Pi. Contributions should keep the runtime small, the data flow explicit, and the quality bar high enough for a public npm package.

## Before You Start

- For non-trivial features, start with an issue or discussion before opening a PR.
- Bug fixes should include a clear reproduction in the PR description.
- Behavior-changing work must include tests.
- Keep user-facing claims factual. Do not document or imply package behavior that does not exist yet.

## Local Setup

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

`npm test` is the required baseline validation after changes.

## Contribution Rules

### TDD is mandatory

Write or update the failing test first, then implement the change.

This is not optional for runtime behavior. If a change affects behavior and has no test coverage, it is incomplete.

### Keep tool boundaries clean

- Tools fetch and format data
- Analysts and prompts synthesize
- Do not move analysis logic into tools

### Keep provider tests fixture-based

- Unit tests must mock `globalThis.fetch`
- Do not make live API calls in unit tests
- Add fixture JSON under `tests/fixtures/<provider>/` for new provider responses

### Keep typing strict

- Avoid `any` except for raw provider payloads at the API boundary
- Use `.js` extensions on relative imports
- Use `node:` prefixes for built-in modules

## Pull Requests

Open focused PRs with enough context for review.

Every PR should explain:

- what changed
- why it changed
- user or maintainer impact
- test coverage added or updated
- risks, follow-ups, or known gaps

For non-trivial work, link the issue or design discussion that established scope.

## Release Notes and Changelog Discipline

OpenCandle follows Pi's release style where possible: manual semver bump scripts, a maintained `CHANGELOG.md` with an `Unreleased` section, and explicit release commands.

Prefer clear prefixes such as:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`

Release notes should describe user-visible impact, not just implementation detail.

Release commands:

```bash
npm run version:patch
npm run version:minor
npm run version:major
npm run publish:dry
npm run release:patch
npm run release:minor
npm run release:major
```

The `release:*` scripts are intended for maintainers. They bump the version, update `CHANGELOG.md`, create a release commit and tag, restore the `Unreleased` section for the next cycle, and push both `main` and the release tag.

The actual npm publish step runs in GitHub Actions from the pushed `v*` tag using trusted publishing. That keeps the local release flow minimal while avoiding laptop-based npm publishes.

## Scope Boundaries

Ask first before changing:

- system prompt or analyst orchestration
- Pi shell integration under `src/pi/`
- memory SQLite schema
- provider strategy that needs new rate-limit or fixture policy

Do not:

- guess financial numbers or metrics
- hardcode mock data into tools
- make live API calls in unit tests
- blur the separation between Pi-owned config and OpenCandle-owned state

## Where Things Live

- Providers: `src/providers/`
- Tools: `src/tools/`
- Routing: `src/routing/`
- Workflows: `src/workflows/`
- Memory: `src/memory/`
- Pi integration: `src/pi/`
- Tests and fixtures: `tests/`

The repo-level [AGENTS.md](/Users/kahtaf/.codex/worktrees/dc41/vantage/AGENTS.md) remains the most specific implementation guide for code changes.
