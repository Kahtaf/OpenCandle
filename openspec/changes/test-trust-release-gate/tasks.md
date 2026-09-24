# Implementation tracking

Approved 2026-09-24. Boxes represent verified completion, recorded from milestone logs rather than
live state. Recorded: root full gate **PASS** (`/tmp/oc-final-gates-full.log`, 263.2 s); first
advisory review **PASS** (`/tmp/oc-final-autoreview.log`, 270 s) with 5 confirmed findings. The
second review cycle and the candidate `release:check` + live `eval -- release` rehearsal are
pending, so the review is **not** claimed clean. Inventory counts in
`docs/internal/test-inventory.md` are a recorded milestone, not asserted current.

- [x] Record approved architecture and initial spec deltas.
- [x] Phase 1: executable inventory and per-surface coverage baseline/reporting. **Done
  (2026-09-24):** baseline integrated and `coverage:check` passed; the browser lane is informational
  and retains Node hit counts. Child-process and WebContainer lanes remain named, unmeasured
  limitations.
- [x] Phase 2: mandatory isolated deterministic browser/TUI journeys and external traffic separation.
  **Done (2026-09-24):** the deterministic GUI integration lane collects its real cases under
  `OPENCANDLE_GUI_INTEGRATION=1`; the 8-case real-server GUI journey suite passes normal and shuffled,
  including the fixed attachment cancel-replay (25 adapter tests + 8 journeys). External browser
  traffic is stubbed/aborted.
- [x] Phase 3: reviewed disposition of all cases/families; bounded cleanup with remaining protection.
  **Done (2026-09-24):** 18 intentional low-value unit-case removals plus 1 synthetic skipped
  placeholder; `dcf.test.ts` is like-for-like. The four case-family ledgers are **agent case-family
  review, not human approval**; human disposition still requires the parent.
- [x] Phase 4: fault/mutation and scorer/harness failure proof. **Done (2026-09-24):** 8/8 mutations
  killed; the scorer/eval-harness rejection contracts are proven; the unit placeholder is isolated
  from ambient flags with an actual child-process proof; the CLI freshness fixture uses a relative
  clock (no extra helper tests); the hold-counter race is fixed.
- [ ] Phase 5: report schema, trusted candidate evidence, package identity, release/publish
  enforcement. **Partial (2026-09-24):** full gate passed; the candidate `release:check` has not run.
- [ ] Phase 6: authoring/flake policy, compact release summary, candidate rehearsal. **Partial
  (2026-09-24):** the compact release summary landed with 29 tests; the evidence waiver was **not
  implemented** (strict block is the deviation); candidate rehearsal is pending.
- [ ] Integrated release candidate. **Full gate PASS**; first advisory review PASS with 5 confirmed
  findings (four resolved, the Windows `shell:false`/`npm.cmd` helper and same-gate consumers in
  progress). The second review cycle and candidate `release:check` + live `eval -- release` are
  pending, so this item and review-clean stay unchecked. Final candidate evidence path:
  `validation-output/release-summary`.

## Work log

- 2026-09-24: approved plan; implementation, fault proof, release enforcement, and audit ledgers
  landed as uncommitted worker branches; documentation consolidated.
- 2026-09-24: baseline integrated and `coverage:check` green; cancellation durability, attachment
  cancel-replay, and passive navigation fixed and verified; release-summary contract hardened.
- 2026-09-24: full gate and first advisory review passed; five review findings triaged; second review
  cycle and candidate rehearsal pending.
