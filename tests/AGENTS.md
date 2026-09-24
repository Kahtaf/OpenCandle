# TESTS

Unit + e2e tests for all OpenCandle modules.

## COMMANDS
```bash
npm test                       # vitest run --project unit (default unit coverage)
npm run check                  # typecheck + test-scripts typecheck + relay typecheck + biome ci
npm run gates                  # core proof gate (steps in scripts/test-gate-policy.json)
npm run gates:full             # full gate (step list: scripts/test-gate-policy.json)
npm run release:check          # release gate (full + packed-install + docs links); deterministic, no secrets
npm run test:site              # public docs site build + site project tests
npm run test:watch             # vitest watch mode
npm run test:agent-tools       # maintainer/agent helper tests
npm run test:scripts:typecheck # type-check opt-in eval/front-door scripts
npm run test:e2e               # e2e tool tests
npm run test:e2e:cli           # e2e CLI tests
npm run test:e2e:providers     # e2e provider tests (hits live APIs)
npm run test:providers:release # strict live provider release smoke (two core checks)
npm run test:coverage          # Node+relay ratchet + browser (gui-integration+gui-journey) report
npm run coverage:baseline      # explicit, reviewed baseline update (scripts/coverage-baseline.json)
npm run test:inventory         # collection-only test inventory (docs/internal/test-inventory.md)
npm run review:pr              # repo autoreview + gates:full, before opening/updating a PR
```

Local prerequisite: several gate steps need a browser (the `tests/agent-tools/coverage-browser`
fixture launches real Chromium, and the GUI integration/journey/release-smoke lanes drive one).
Install it once with `npx playwright-core install chromium` (Linux: `--with-deps`).
`npm run bootstrap:agent` does not install a browser; CI's canonical Node 24 job does.

## STRUCTURE
```
tests/
├── unit/         # Mirrors src/ (tests/unit/<module>/ ↔ src/<module>/), plus gui-server/, gui-web/
├── site/         # Public docs site build contract tests (npm run test:site), not default unit coverage
├── agent-tools/  # Repo-maintainer/agent helper tests, not default unit coverage
├── harness/      # Agent test harness (file-based IPC) → see tests/harness/README.md
├── evals/        # Agent/session eval cases, scoring, and report helpers
├── scripts/      # Eval front door and long-running opt-in eval runners
├── e2e/          # End-to-end workflow, CLI, and GUI browser tests
├── screenshots/  # GUI screenshot capture harness (npx tsx tests/screenshots/capture.ts)
└── fixtures/     # Mock JSON responses, one directory per provider (yahoo/, alphavantage/, lse/, polymarket/, …)
```

## TEST PATTERN
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";

const originalFetch = globalThis.fetch;
beforeEach(() => { cache.clear(); });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

globalThis.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve(quoteFixture),
});
```

## CONVENTIONS
- **TDD mandatory.** Write the failing test first.
- Unit tests mirror `src/` structure: `tests/unit/<module>/` maps to `src/<module>/`.
- Keep repo-maintainer helper tests under `tests/agent-tools/`; they should run explicitly instead of bloating public `npm test`.
- Mock fetch at `globalThis.fetch` level. Never stub provider internals.
- Use `:memory:` SQLite for memory/storage tests.

## TEST TRUST POLICY
The authoritative policy is `docs/internal/test-trust-policy.md`. In short:
- Every test has a **named user contract**, a **credible defect**, the **correct boundary**, and an
  **independent expectation** (no assertion satisfied by the code or mock under test).
- **Boundary:** prefer real e2e/integration journeys for application wiring; keep useful unit tests
  for financial math, security decisions, parser edges, and failure combinatorics. Do not add unit
  tests only to move a coverage metric.
- **Gates:** the step list is `scripts/test-gate-policy.json`, run by `scripts/test-gate.mjs`
  (`gates` = core, `gates:full` = full, `release:check` = release). Do not copy step lists into docs.
- **Coverage:** the hard ratchet is Node+relay, per-file and per-surface across all metrics
  (lines/functions/branches/statements) against `scripts/coverage-baseline.json`. Browser coverage is
  mandatory and runs both the `gui-integration` and `gui-journey` projects over the same built
  assets; browser/combined ratios are reported separately (informational) and are not ratio-compared
  across instrumentation maps. Node child-process and WebContainer coverage are unavailable; relay
  and browser are measured.
- **Failures:** no retry-until-green; one human diagnostic rerun at most, attempts preserved. No
  waiver or bypass is implemented.
- **Quarantine** of a required check needs a written record (owner, issue, expiry, lost contract,
  alternative proof); there is no automated registry or silent skip.

## EVALS AND SCRIPTS
- Use `npm run eval -- <suite>` as the eval front door. It prints the delegated command/env flags and appends run metadata to `tests/evals/runs/index.jsonl`.
- Keep suite logic in the existing runner or scorer files; `tests/scripts/run-evals.ts` only dispatches and maps CLI options onto existing env flags.
- `cases` uses `EVAL_TIER`; `--known-fail e1` and `--known-fail e2` are opt-in usually-tier paths for tracked failures, not default CI coverage. They are **explicitly optional and are not release proof**; never present them as live release evidence.
- Product eval opt-in cases stay behind `--include-opt-in`. Do not promote a case by editing runner filters; change the case tier intentionally.
- Use `// PROMOTE:` comments near known-fail or opt-in eval cases when the intended promotion condition is important for future cleanup.
- Do not commit raw files from `tests/evals/runs/`; `.gitkeep` is the only tracked file there.

## TEST AUDIT
Use the `test-audit` skill (`.agents/skills/test-audit/SKILL.md`) when asked to audit test value,
coverage, or duplication, or to perform a bounded test cleanup. It is **evidence gathering first**:
- Establish the baseline from an actual run; distinguish full reads from samples honestly, and never
  present an unread file as reviewed.
- Record findings at case-family granularity: file, describe family, case count, actual protection,
  owner entry point + real callers, overlap/remaining proof, origin, decision
  (`keep`/`consolidate`/`replace`/`investigate`), risk, and a deeper-investigation flag.
- Delete only inside an explicitly authorized cleanup scope, and only after replacement proof
  exists. Never weaken or delete a required check to make a run green.
- The written ledger is the deliverable; the parent reviewer owns the dispositions. See
  `docs/internal/test-audit-core-ledger.md` for a worked example and
  `docs/internal/test-trust-policy.md` §9 for the policy.

## ANTI-PATTERNS
- Never write implementation before a failing test.
- Never make live API calls in unit tests (use `tests/fixtures/`).
- Never import test fixtures into production code.
