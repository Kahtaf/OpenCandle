# Implementation tracking

Approved 2026-09-24. Boxes represent verified completion, recorded from milestone logs rather than
live state. Recorded: candidate `70ac0956` RELEASE gate **PASS** (291.2 s); final full-branch autoreview
**clean** (11 batches, 0 findings); package prepare/smoke/verify passed; 2 live provider cases passed.
The first live `eval -- release` attempt (`2026-09-24T21-33-24-234Z-53463-c1yn0w`) **FAILED**: 31/32
router checks, 18 required live cases passed, 15 product cases passed, 4/5 competitive hard cases
passed, and OpenCandle won 3/5 comparisons. That attempt exposed a stale quote `023` fixture and hedge
policy classification/scorer flaws; their corrections are under integration and a fresh candidate
rehearsal is pending. The authoritative final result is generated only to
`validation-output/release-summary` after checks pass, and the review is **not** yet claimed clean.
Inventory counts in `docs/internal/test-inventory.md` are a recorded milestone, not asserted current.

- [x] Record approved architecture and initial spec deltas.
- [x] Phase 1: executable inventory and per-surface coverage baseline/reporting. **Done
  (2026-09-24):** baseline integrated and `coverage:check` passed; the browser lane is informational
  and retains Node hit counts. Child-process and WebContainer lanes remain named, unmeasured
  limitations.
- [x] Phase 2: mandatory isolated deterministic browser/TUI journeys and external traffic separation.
  **Done (2026-09-24):** the deterministic GUI integration lane collects its real cases under
  `OPENCANDLE_GUI_INTEGRATION=1`; the 8-case real-server GUI journey suite passes normal and shuffled,
  covering the fixed attachment cancel-replay, passive navigation, and the second-review admission
  fix (the coordinator rejects distinct chat/tool admissions while a run is active, preserving
  same-action dedupe and the Stop/ask-user bypass; 11 coordinator tests + 8 journeys, 35 s —
  `/tmp/oc-review-admission.md`).
- [x] Phase 3: reviewed disposition of all cases/families; bounded cleanup with remaining protection.
  **Done (2026-09-24):** 18 intentional low-value unit-case removals plus 1 synthetic skipped
  placeholder; `dcf.test.ts` is like-for-like. The four case-family ledgers are **agent case-family
  review, not human approval**; human disposition still requires the parent.
- [x] Phase 4: fault/mutation and scorer/harness failure proof. **Done (2026-09-24):** 8/8 mutations
  killed; the scorer/eval-harness rejection contracts are proven; the unit placeholder is isolated
  from ambient flags with an actual child-process proof; the CLI freshness fixture uses a relative
  clock (no extra helper tests); the hold-counter race is fixed.
- [ ] Phase 5: report schema, trusted candidate evidence, package identity, release/publish
  enforcement. **Partial (2026-09-24):** the enforcement implementation is proven by tests, including
  the release-lib real-default npm runner now going through the safe helper (5 focused tests, 50 with
  readiness); candidate `70ac0956` RELEASE gate passed (291.2 s), package prepare/smoke/verify passed,
  2 live provider cases passed, and full-branch autoreview finished clean (11 batches, 0 findings). The
  candidate `release:check` + live `eval -- release` rehearsal is still pending because the first
  attempt failed.
- [ ] Phase 6: authoring/flake policy, compact release summary, candidate rehearsal. **Partial
  (2026-09-24):** the compact release summary landed with 29 tests; the evidence waiver was **not
  implemented** (strict block is the deviation); the first live candidate rehearsal failed, so the
  fresh rehearsal and final summary are pending. **Superseded (2026-09-25):** the maintainer decided
  every release failure blocks and no waiver will be built, so "not implemented" is now the permanent
  policy rather than a deviation.
- [ ] Integrated release candidate. Candidate `70ac0956` RELEASE gate **PASS** (291.2 s); final
  full-branch autoreview clean (11 batches, 0 findings); package prepare/smoke/verify passed; 2 live
  provider cases passed. The first live `eval -- release` attempt failed (31/32 router checks, 18
  required live cases passed, 15 product, 4/5 competitive hard, OpenCandle won 3/5 comparisons),
  exposing the stale quote `023` fixture and hedge policy classification/scorer flaws; corrections are
  under integration and a fresh candidate rehearsal is pending. The Windows `shell:false`/`npm.cmd`
  path is complete, including the native-dep repair and local release runner. This item and
  review-clean stay unchecked because the authoritative `validation-output/release-summary` is only
  generated after checks pass, and no release approval is implied.

## Work log

- 2026-09-24: approved plan; implementation, fault proof, release enforcement, and audit ledgers
  landed as uncommitted worker branches; documentation consolidated.
- 2026-09-24: baseline integrated and `coverage:check` green; cancellation durability, attachment
  cancel-replay, and passive navigation fixed and verified; release-summary contract hardened.
- 2026-09-24: first advisory review 5 findings and second review 2 findings fixed; Windows shell
  path complete.
- 2026-09-24: candidate `70ac0956` RELEASE gate passed (291.2 s); final full-branch autoreview clean
  (11 batches, 0 findings); package prepare/smoke/verify and 2 live provider cases passed. First live
  candidate rehearsal failed (31/32 router checks; 18 required live cases passed; 15 product; 4/5
  competitive hard; OpenCandle won 3/5 comparisons) due to a stale quote `023` fixture and hedge policy
  classification/scorer flaws; corrections are under integration and a fresh rehearsal is pending.
