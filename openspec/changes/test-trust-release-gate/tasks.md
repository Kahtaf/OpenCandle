# Implementation tracking

Approved 2026-09-24. Boxes represent verified completion. Final measured state on the integrated
tree: Node **363 files / 3913 passed / 0 skipped** plus relay **76**; the gated Node+relay coverage
baseline is integrated and ROOT `coverage:check` passes with final branches **15175/22745** (clock
fix). The full gate is not complete (`/tmp/oc-final-gates-full.log` still running), so that item
stays unchecked; unverified work stays unchecked with a dated note.

- [x] Record approved architecture and initial spec deltas.
- [x] Phase 1: executable inventory and per-surface coverage baseline/reporting. **Done
  (2026-09-24):** runtime inventory, per-surface Node baseline, browser lane, and relay merge landed;
  the integrated baseline `--check` passed on ROOT (`/tmp/oc-final-baseline-check.log`). The browser
  lane is informational and retains Node hit counts; child-process and WebContainer lanes remain
  named, unmeasured limitations.
- [x] Phase 2: mandatory isolated deterministic browser/TUI journeys and external traffic separation.
  **Done (2026-09-24):** the deterministic GUI integration lane collects its real cases under
  `OPENCANDLE_GUI_INTEGRATION=1` (a stale flag name had produced a false zero), and the 8-case
  real-server GUI journey suite passes in normal and shuffled order; the deterministic TUI journey
  and hosted keyless smoke pass, with external browser traffic stubbed/aborted. Early Stop persists
  the cancelled turn, and passive navigation no longer aborts an active run.
- [x] Phase 3: reviewed disposition of all cases/families; bounded cleanup with remaining protection.
  **Done (2026-09-24):** 18 intentional low-value unit-case removals (9 original table + 9 routing
  default literals consolidated onto the real resolver path) plus 1 synthetic skipped placeholder;
  `dcf.test.ts` is a like-for-like replacement (34 → 34). The four case-family ledgers remain the
  human-review record.
- [x] Phase 4: fault/mutation and scorer/harness failure proof. **Done (2026-09-24):** 8/8 targeted
  mutations killed with no survivors, and the scorer/eval-harness rejection contracts are proven by
  `tests/unit/evals/release-eval-evidence.test.ts` (child crash/signal, timeout, zero-exit with no
  report, first missing report blocked and preserved across a green rerun, stale report window,
  candidate fingerprint change, partial case selection, malformed competitor metadata),
  `tests/unit/evals/competitive-metadata.test.ts` (bounded id/reason round-trip and strict malformed
  rejection), `tests/agent-tools/live-canary-results.test.ts` (nonzero core pass required, skips
  block, unique summaries, credential redaction), and the 29 release-summary tests.
- [ ] Phase 5: report schema, trusted candidate evidence, package identity, release/publish
  enforcement. **Partial (2026-09-24):** the gate runner/policy, candidate-evidence validation,
  exact-tarball package proof, no-bypass design, and the integrated core gate have landed; the
  integrated `gates:full` / `release:check` runs are not complete.
- [ ] Phase 6: authoring/flake policy, compact release summary, candidate rehearsal. **Partial
  (2026-09-24):** the compact release summary landed as a new feature with 29 tests. The proposed
  evidence **waiver was NOT implemented**; strict blocking is the recorded deviation, and candidate
  rehearsal has not started.
- [ ] Integrated `gates:full`, autoreview, and live-product proof with limitations recorded.
  **Pending (2026-09-24):** the full gate is still running (`/tmp/oc-final-gates-full.log`); GitHub
  returned 404 for the required-reviewer environment read, so that protection is **unverified, not
  proven absent**.

## Work log

- 2026-09-24: approved plan and isolated worker worktrees.
- 2026-09-24: implementation, fault proof, release enforcement, and audit ledgers landed as
  uncommitted worker branches; documentation consolidated.
- 2026-09-24: baseline integrated and `coverage:check` green; cancellation durability and passive
  navigation fixed and verified; release-summary contract hardened. Full gate pending.
