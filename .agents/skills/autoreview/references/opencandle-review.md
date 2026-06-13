# OpenCandle Review Checklist

Focus on concrete regressions, missing validation, and OpenCandle-specific risks. Do not suggest broad rewrites or speculative abstractions.

## Required Review Focus

- Review scope: review only the diff bundle supplied by the helper. For branch mode that is the branch diff, for local mode that is uncommitted local changes, for commit mode that is the selected commit, and for range mode that is the selected base-to-head diff.
- TDD: behavior changes should have tests; unit tests should mirror `src/` and use public interfaces.
- Finance safety: never allow guessed prices, ratios, metrics, filings, or option values. Flag missing source/freshness context and weak downside-risk framing.
- Tools/providers: tools should fetch and format; analysts/LLM synthesize. External calls should use existing cache/rate-limiter infra and fixture-backed tests.
- Unit tests: no live API calls. Mock `globalThis.fetch` with fixture JSON and avoid importing fixtures into production code.
- Prompt/routing changes: avoid overfitting to specific tickers, sectors, rates, dollar amounts, share counts, or benchmark phrases.
- Eval regressions: classify issues at the narrowest durable layer before changing prompts: routing/planning, slot/entity extraction, tool capability, evidence normalization, policy card, workflow prompt, answer contract, structured check, eval assertion, or harness.
- GUI changes: check server/shared/web contracts together. UI changes need browser verification and the relevant GUI tests/builds.
- GUI React quality: for changes under `gui/web/src`, require React Doctor evidence. Treat React Doctor errors as blockers by default, and treat new warnings as actionable unless the change documents why they are pre-existing or consciously deferred. Maintain a high React Doctor score for UI work rather than accepting regressions in state/effects, performance, architecture, security, or accessibility.
- Package/release changes: require package dry-run proof that shipped files match the intended install behavior.
- Changelog: atomic features and bug fixes should update `CHANGELOG.md` under `[Unreleased]`.

## Expected Evidence By Change Type

- General code: `npx tsc --noEmit`, `npm test`, and `git diff --check`.
- Provider/tool changes: focused provider/tool tests with fixtures; live provider tests only when explicitly part of validation.
- Routing/workflow/prompt changes: focused unit tests and, when behavior quality matters, a manual harness or eval report.
- GUI changes: `npm run gui:web:build`; for browser behavior, `npm run test:gui:browser` or documented live browser smoke proof; for React code changes, React Doctor output from autoreview or `npx react-doctor@latest gui/web --changed-files-from <file>`.
- Docs/site changes: docs build or local render proof when applicable.
- Package/release changes: `npm pack --dry-run --json --ignore-scripts`.

## Finding Standard

Report only actionable findings that identify a real behavior, security, test, packaging, or maintainability risk introduced or exposed by the diff. Each finding should point to the smallest relevant line and explain how the issue can fail in practice.
