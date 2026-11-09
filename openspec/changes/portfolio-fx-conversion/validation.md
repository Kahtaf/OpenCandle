# Validation evidence — 2026-11-06

Executed from the existing shared checkout:

```text
OPENSPEC_TELEMETRY=0 npx --yes @fission-ai/openspec@1.4.1 validate portfolio-fx-conversion --strict
Change 'portfolio-fx-conversion' is valid
(exit 0)

OPENSPEC_TELEMETRY=0 npx --yes @fission-ai/openspec@1.4.1 status --change portfolio-fx-conversion
Schema: spec-driven
Progress: 4/4 artifacts complete
[x] proposal
[x] design
[x] specs
[x] tasks
All artifacts complete!
(exit 0)
```

Artifact completion means documents exist, not that implementation tasks ran. All tasks.md checkboxes remain unchecked. Three bounded existing-provider probes succeeded; exact observations and failed web access attempts are in research.md.

No code, tests, CHANGELOG, manifests, or other proposals were changed by this research task. Final shared-checkout status also showed parallel currency-selection edits to CHANGELOG, GUI, service, tracker, tests, and portfolio-base-currency; these belong to the implementation track and were not modified or reverted here.

Not run: implementation tests, TDD red/green, npm run gates, gates:full, review:pr, browser/TUI product flows, hosted egress probes, market-closed probes. The parent explicitly centralizes full/live gates. This proposal's focused proof is strict OpenSpec validation plus source-backed feasibility checks. No commits, branch switches, push, GitHub messages, or PR actions occurred. No bootstrap was necessary in this existing checkout.

Remaining release blockers: source access/display rights, approval of scope/freshness semantics, quote-subunit preservation/legacy audit, implementation and full/live verification. No financial rates are inferred from timestamps or substituted for missing evidence.

## Implementation inspection — 2026-11-06

Confirmed existing shared branch `feat/portfolio-fx-valuation-282` at merged foundation
`ab6f08f6046ecb594616c68fbf1372266e45244e`. Initial status contained only this untracked
proposal. No bootstrap was needed for this existing checkout. The current task authorizes
implementation and the proposed freshness policy; earlier research-only wording is historical.
Source access/display clearance remains a release question, not an implementation permission request.
OpenSpec status/apply returned repo-local, ready, 0/12 implementation tasks complete.

Partial implementation: added a standalone case-sensitive currency-unit normalizer and
12 focused cases. The initial run failed because the module did not exist; the subsequent
run passed all 12 cases. Logs: `validation-output/portfolio-fx-conversion/currency-unit-{red,green}.log`.
It is not connected to production valuation and does not enable FX. No task is checked complete.

### Storage-policy conflict escalated under the subagent contract

Design says: "Reporting cost is known only for lots whose explicit normalized cost currency
is the reporting currency." It also says: "Ambiguous old records must stay unavailable rather
than be migrated heuristically."

Repository evidence: `MarketStateService.addPortfolioLot` uppercases cost currency (service.ts
line 762), `updatePortfolioLot` also uppercases it (line 844), and instrument persistence
uppercases its currency (lines 1805 and 1830). Tracker uppercases resolved cost currency at
tracker.ts line 195. Consequently an explicit `GBp` cost of 100 and explicit `GBP` cost of 100
produce indistinguishable monetary fields. Re-fetching a security quote cannot recover the
unit of its acquisition cost. This affects persisted cost provenance, not just Yahoo quote
metadata. It is a pre-existing product defect revealed by the required legacy audit.

Reproducer: `npx tsx validation-output/portfolio-fx-conversion/lot-unit-collision.ts` uses an
in-memory database only, no live provider. It exits 1 with the assertion "Explicit pence and
pound acquisition units must remain distinguishable"; sanitized output is retained in
`lot-unit-collision-red.log`. These are synthetic test amounts, not market observations.

Implementation stopped for parent disposition under the explicit stop-on-plan/repository-
contradiction clause. The conservative interpretation would mark all unverified persisted GBP
costs/P&L unavailable, including legitimately pound-denominated lots; distinguishing verified
GBP requires a provenance strategy absent from the current valuation input. Parent should
confirm this blanket legacy behavior or specify an existing source of trustworthy cost-unit
provenance before the coordinated consumer change. No schema migration or lot rewrite was made.
Future write paths also need case preservation or explicit rejection before uppercasing.

Not completed: Yahoo repair/fixtures, FX acquisition, shared valuation, adapters, UI, CHANGELOG
(user-visible feature not implemented), live provider comparison, desktop/mobile screenshots,
TUI and hosted harness proofs, gates:full, local autoreview. This is not a completed feature or
release-ready handoff. Existing base-currency evidence and all proposal artifacts are preserved.

Handoff gate was started once: `npm run gates > validation-output/portfolio-fx-conversion/gates.log 2>&1`.
Its `npm run check` step passed (typechecks and Biome; 60 warnings). At the inspection handoff,
`npm test` remained active; the gate has not been claimed green. Exec session 48487 owns the
run (gate PID 504054); inspect the retained log/process before starting another run. No retry,
check weakening, or suppression was performed. Full gates/review remain unrun.

### Completed core gate — 2026-11-06

The previously pending run completed successfully (exit 0): core gate passed in 495.8s.
`npm run check` passed; unit tests: 407 files / 5,003 tests; relay: 2 files / 76 tests;
agent-tools: 17 files / 358 tests. Report:
`validation-output/gates/2026-11-06T18-09-57-792Z-504054.json`.
This supersedes the pending-process status above. The assertion failure printed in the
background-command notification was the preserved collision reproducer log, not a gate
failure. The collision remains unresolved; core-gate success does not establish completion
of FX implementation. Full gates, autoreview, and live product proof remain unrun.

### Independent USD/EUR implementation — 2026-11-06

Resumed in the existing shared checkout without bootstrap. Parent explicitly authorizes
independent USD/EUR implementation while the legacy GBP decision remains unanswered.
No persistence, schema, branch, commit, PR, deployment, or GBP rollout changes were made.

Added:
- `src/portfolio/fx.ts`: runtime-neutral identity/direct/inverse validation, conservative
  freshness bounds, explicit last-session label, and retained observation provenance.
- `src/providers/yahoo-fx.ts`: bounded canonical EURUSD=X acquisition using existing Yahoo
  limiter, HTTP client, cache and wrapProvider; no enrichment or alternate-ticker retry.
  Per-process single-flight, subscriber cancellation isolation, and snapshot failure memoization.
- `src/portfolio/valuation.ts`: runtime-neutral lot valuation with explicit snapshot clock,
  separate native/reporting money and cost currencies, no historical FX inference, per-currency
  costs, null-safe P&L, completeness/exclusion/allocation semantics, and overflow rejection.
  It revalidates resolved FX at the snapshot clock. Security eligibility is supplied by the
  future adapter; unifying existing security freshness policy remains integration work.
- `tests/unit/portfolio/{fx,valuation}.test.ts` and a **synthetic**, sanitized chart-shaped
  `tests/fixtures/yahoo/EURUSD-fx.json`. Fixture values are test inputs, not market evidence.
- One CHANGELOG entry explicitly marked integration pending.

TDD evidence in `validation-output/portfolio-fx-conversion/`:
- `valuation-red.log`: missing module failure; `valuation-green.log`: 6 passed.
- `fx-red.log`: missing module failure; `fx-green.log`: 18 passed.
- `edge-red.log`: 3 credible product failures (malformed observation TTL retention,
  missing FX provenance/revalidation, complete status on aggregate overflow).
- `edge-green.log`: 40 passed across 3 files, including 12 inherited currency-unit cases,
  20 FX cases, and 8 valuation cases. Subscriber cancellation is exercised through fetch.
- `typecheck.log`: tsc passed; `format-final.log`: Biome passed without warnings.
- A new core gate after the changes is recorded in `gates-resumed.log`; its final status
  is recorded separately below rather than inferred from the inherited passing run.

Partialness: no OpenSpec feature checkbox is newly checked. No adapter consumes these new
modules yet. Therefore GUI/TUI behavior is unchanged and the CHANGELOG entry is not a shipped
feature claim. Coordinated tracker/local/hosted contract migration, renderer null handling,
native daily-change labels, raw Yahoo security-unit repair, source-rights release clearance,
full/live gates, screenshots and dirty autoreview remain pending. There is no fresh live
accuracy claim. Existing primary-source probes establish availability only.

GBP-dependent work remains: user policy disposition for ambiguous saved costs, raw quote-unit
repair and its consumer audit, GBP canonical leg/cross validation with time/state compatibility,
and any saved-lot adapter handling under the chosen policy. The pure arithmetic accepts explicit
currency units; it must not be connected to ambiguous legacy saved costs by assuming provenance.
The implementation scope is temporarily USD/EUR, not a permanent proposal scope amendment.

Bounded live acquisition probe (outside unit tests): at 2026-11-06T18:22:38.711Z, one
canonical EURUSD=X request served concurrent direct/inverse resolutions. Both returned
eligible results with the same observedAt/fetchedAt and fresh-cache provenance; chart
marketState was absent, so the conservative unknown-state policy applied. Output:
`validation-output/portfolio-fx-conversion/fx-live-availability.log` (exit 0).
This is availability/metadata evidence only, not independent accuracy certification,
weekend eligibility proof, permission, deployed testing, or GUI/TUI integration evidence.

Final resumed core gate: **passed, exit 0, 492.6 seconds**.
Report: `validation-output/gates/2026-11-06T18-20-43-189Z-511608.json`.
Check/typechecks passed; unit 409 files / 5,031 tests; relay 2 files / 76 tests;
agent-tools 17 files / 358 tests. Full log: `gates-resumed.log`.
No duplicate inherited gate was started; its completion was established before this run.
This green core gate does not complete adapter/UI integration or substitute for the pending
centralized full/live gates and dirty autoreview. Final `git diff --check` passed.

### Independent adapter preparation — 2026-11-06

Resumed existing checkout; no bootstrap required. No git mutation, PR, comments, deployment,
lot/schema change, GBP disposition, rollout flag, or consumer wiring occurred. Existing
CHANGELOG integration-pending entry retained unchanged; this is continuation of that feature.

Changed this run:
- `src/portfolio/acquisition.ts` (new): injectable security/FX acquisition, deduplicated symbols
  and currency pairs, provider-result and GUI-snapshot structural mappings, one explicit clock,
  identity without resolver/network calls, and securities plus pure valuation output.
- `src/portfolio/valuation.ts`: retains matching unavailable FX results and security rejection
  reasons; missing security timestamps are explicitly null rather than invented fetch times.
- `src/portfolio/fx.ts` and `src/providers/yahoo-fx.ts`: unavailable FX now carries source/target;
  Yahoo acquisition failures retain provider identity and original provider reason.
- `tests/unit/portfolio/acquisition.test.ts` (new), `valuation.test.ts`, `fx.test.ts`:
  adapter contract and provider-to-valuation failure tests.

Confirmed product defect: pure engine discarded unavailable FX results and replaced a
provider failure with missing_fx. `adapter-red.log` records the independent assertion
(expected provider_rate_limited, received missing_fx), alongside the missing acquisition
module failure. `adapter-green.log` records the first 49 passing tests. A second credible
red (`source-provenance-red.log`) demonstrates Yahoo provider identity lost on unavailable
FX; fix is at the acquisition result boundary, not in rendering or assertions. Final focused
run `adapter-green-final.log`: **4 files / 51 tests passed**. Includes all 40 inherited cases.
`adapter-typecheck.log` is the earlier passing typecheck; final typechecks are in the core gate.
No live API calls occurred in these tests: the Yahoo 429 integration case mocks global fetch.

Security eligibility reuses `src/infra/freshness.ts` / buildFreshnessStamp, matching existing
GUI equity-session date policy (including Friday-close eligibility on Monday premarket).
Stale-cache data is rejected independently; invalid/nonpositive prices and missing observation
metadata remain unavailable. This does not introduce FX's 15-minute window for securities.
Raw security observations, original observation/fetch times, freshness stamp, rejection reason,
and supplied unavailable provider identity survive the adapter. No unit is inferred from a lot.
The provider mapper is for use before tracker getCurrentPrice discards quote timestamps;
the GUI mapper uses dataAsOf, never fetchedAt, for observation time. Missing provider timestamp
fails closed as required by the valuation contract even if the generic freshness helper alone
would admit it. Unexpected resolver exceptions/cancellation propagate rather than becoming
misleading market-data failures; expected source failures must use typed unavailable results.

Tested contract: same provider-shaped and snapshot-shaped USD/EUR observations at the same
clock produce equal security/valuation outputs; current value 35 USD can be complete with
null reporting cost/P&L; failure of EUR conversion produces a 10 USD valued subtotal, null
full total, and explicit excluded lot with preserved source reason. Security rejection never
triggers FX. Repeated lots share security and FX resolutions. Friday security remains eligible
while similarly old unknown/REGULAR FX is rejected. The real Yahoo resolver's mocked 429 travels
through acquisition and pure valuation with source/target/provider/reason intact.

Remaining integration points (not claimed tested as live products):
1. Tracker getCurrentPrice must expose full provider observation to securityFromProvider before
   losing asOf/cached/stale metadata; buildPortfolioView must consume valuation output.
2. Local fetchQuoteSnapshot and hosted fetchHostedQuoteSnapshot must converge on assessment at
   the same supplied clock, retaining failed raw observations where available. Existing rejected
   snapshots have already discarded timestamps; the mapper cannot reconstruct them.
3. gui/shared/market-quote-snapshot.ts successful AND unavailable constructors must adopt the
   new contract together with renderers, symbol grouping, summary attachments and allocation/
   day-change semantics. Map numeric saved lot IDs explicitly to the prepared string lot IDs.
4. Saved-cost GBP policy, raw Yahoo GBp quote repair (all affected price fields), GBP/cross FX
   and coordinated saved-lot handling remain decision-dependent. No assumption was made here.
5. Source-rights release clearance, full gates, autoreview, local/hosted browser and TUI proof
   remain pending/parent-centralized. No new OpenSpec task checkbox is complete, and no live
   accuracy certification or product integration success is claimed.

Core gate started once after final code/test edits, log `gates-adapter.log`. Final result follows.

Final adapter core gate: **passed, exit 0, 494.2 seconds**. Report:
`validation-output/gates/2026-11-06T18-33-49-902Z-519206.json`.
Check/typechecks passed (Biome 61 warnings, including one guarded currency-normalization
non-null assertion in the new adapter); unit 410 files / 5,042 tests; relay 2 files / 76 tests;
agent-tools 17 files / 358 tests. No source changes occurred during the gate. Final
`git diff --check` passed. Full/live gates and autoreview remain pending as stated above.

### Resolved GBP policy and resumed boundary work — 2026-11-06

User disposition is final: "no users, no gbp repair flow necessary". Earlier policy pauses
in this ledger are historical, not current blockers. Stored GBP costs mean pounds; no
migration, uncertainty flags, blanket suppression, data deletion, or historical rewrite.
Proposal/design/specs now reflect authorized three-currency implementation.

This resume extends the pure resolver and Yahoo acquisition to GBPUSD=X plus reciprocal
and USD-cross rates, retaining both legs and rejecting cross-session/time inconsistencies.
Snapshot memoization and process single-flight now key by canonical leg. Pure valuation
revalidates all legs instead of discarding the second leg. Removed stale pending-policy
comments from the prepared valuation/acquisition modules.

New writes canonicalize explicit GBp/GBX costs to GBP with scaled amounts in service add
and update. Tracker preserves acquisition input units and displays stored normalized cost;
Yahoo instrument resolution retains raw provider units for implicit acquisition input.
Yahoo quotes expose rawCurrency, normalize price-valued fields (including extended values)
to major units, and normalize history OHLC to the same units; volumes and market cap are
not price-scaled. Unsupported quote subunits fail explicitly.

TDD evidence retained in validation-output/portfolio-fx-conversion/:
- gbp-cross-red.log / gbp-cross-green.log: pure direct/inverse/cross and skew/session cases.
- gbp-provider-red.log / gbp-provider-green.log: canonical acquisition and two-leg dedup.
- provider-unit-red.log / provider-unit-green.log: provider field normalization and explicit/
  implicit tracker acquisition. The latter was NOT green: it exposed a storage test fixture bug.
- cost-write-red.log and cost-write-green.log both failed because the new test omitted the
  required instrument provider. The shell's subsequent typecheck exit had masked the earlier
  test exit. Corrected the fixture; cost-write-corrected-red.log reproduces the actual product
  defect (150 GBP instead of 1.5 GBP) with the old write expressions, then restored the fix.
- history-unit-red.log: history remained in pence after quote normalization; fixed at provider.
- resume-focused-green.log: 7 files / 121 tests passed, including all inherited portfolio tests.

Bounded live probe gbp-live-availability.log succeeded at 2026-11-06T20:05:57.188Z for
EUR→GBP, GBP→USD, and USD→EUR using two canonical Yahoo observations. Both observation
legs were timestamped 2026-11-06T20:05:25.000Z; marketState was absent and conservative
unknown-state policy applied. This establishes availability/metadata only, not independently
verified accuracy, source rights, deployed behavior, or portfolio integration.

Full gate started once in resume-gates-full.log. Final outcome recorded separately below.
No bootstrap was needed in the preserved existing checkout. No commits, branch switches,
pushes, PR actions, deployment, schema changes, or prompt changes occurred.

Still incomplete: shared engine wiring into tracker/local/hosted snapshots and unavailable
constructors, coordinated UI/summary/attachment/null/allocation/day-move changes, complete
input-unit consumer audit, independent primary-reference comparison, product desktop/mobile
GUI screenshots, TUI and hosted harness portfolio proof. No feature task is marked complete.
Skills for Impeccable/Vercel were read in preparation; no UI work or skill verification pass
was performed. The feature changelog remains integration-pending, not a completion claim.

Independent reference observation: ECB daily XML dated 2026-11-06 was retrieved once by
bounded curl after the web tool rejected XML with `400 Unsupported content-type: text/xml`.
Saved ecb-reference.xml and reference-comparison.json. Both sources are expressed in the
same source/target units and date, but ECB daily reference versus later Yahoo intraday timing
is not aligned. Relative differences were +0.0398% EUR→GBP, -0.2457% GBP→USD, +0.2064%
USD→EUR. These are contextual comparisons, not accuracy/execution certification; no new
provider was integrated. Source: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml.

Current full-gate progress (not final success): check passed; unit 410 files / 5,053 tests;
relay 76; agent-tools 358; site 30; GUI integration 29; GUI journey 29; release smoke 9;
hosted and package contents passed. Coverage remains running under gate PID 529734
(exec session 84593), output resume-gates-full.log. Do not start a duplicate gate before
checking this process/log. Core gate components are green; full gate is not yet green.
Codex version precheck passed; local autoreview has NOT been run. No FX UI screenshots or
feature-specific TUI/hosted harness proof exist. This remains an incomplete implementation,
not a release-ready handoff. No new policy blocker is asserted.

### Runtime and GUI integration resume — 2026-11-06

Concrete wiring is implemented, uncommitted. No bootstrap was required in this preserved
checkout; no branch/commit/push/PR/deploy actions or duplicate full/core gates were started.
The parent's explicit centralized-gate instruction supersedes the normal subagent gate run.

Chosen contract:
- Tracker and shared GUI use acquirePortfolioValuation/valuePortfolio, mapped through
  presentPortfolioValuation; local and hosted adapters accept injectable FX and clock.
- Row nativeValue/nativeCost/nativePnl and reportingValue/reportingCost/reportingPnl are
  explicit money objects. Compatibility marketValue/totalCost/pnl numbers mean reporting
  currency; currentPrice and quoteCurrency describe native normalized price; currency remains
  acquisition-cost currency. Missing accounting stays null. Numeric saved lot IDs survive.
- Summary status (tracker totalsStatus) is empty/complete/partial/unavailable. Partial full
  totalValue is null, valuedSubtotal is separate, exclusions retain lot IDs and reasons,
  and allocationPercent versus valuedAllocationPercent have distinct denominators.
- FX result retains source legs, timestamps, method and last-session state. Security observation
  timestamps survive rejected-source mapping; missing observation time is never replaced with
  fetch time. GUI retains native quote metadata and rawCurrency. Expanded lots and TUI show
  separate native/reporting values and security/FX provenance.
- Reporting daily movement is unavailable for converted quotes; native security percentage
  remains separate. Mixed-cost same-symbol groups never blend costs or coerce null P&L to zero.
  Cross-portfolio groups never add reporting amounts in different currencies. Refresh failures
  cannot restore previous portfolio valuations or recompute totals from retained stale rows.
- Attachment summaries were inspected: they already print per-lot acquisition amounts and
  currencies, without aggregated current values. No attachment code change was necessary.

Files changed in THIS resume (prior provider/storage work was preserved):
- src/portfolio/acquisition.ts
- src/tools/portfolio/portfolio-view.ts
- src/tools/portfolio/stateful-tool-options.ts
- src/tools/portfolio/tracker.ts
- src/types/portfolio.ts
- gui/shared/market-quote-snapshot.ts
- gui/server/market-state-api.ts
- gui/hosted/runtime/hosted-market-data-api.ts
- gui/hosted/runtime/hosted-tool-composition.ts
- gui/hosted/runtime/browser-hosted-gui-runtime.ts
- gui/web/src/features/market-state/portfolio-view-model.js
- gui/web/src/features/market-state/PortfolioPage.jsx
- gui/web/src/features/market-state/MarketStatePage.jsx
- gui/web/src/features/home/PortfolioSummaryStrip.jsx
- gui/web/src/features/symbol/symbol-sections.jsx
- gui/web/src/features/renderers/cards/portfolio.jsx
- gui/web/src/hooks/useMarketState.jsx
- tests/unit/portfolio/runtime-integration.test.ts (new)
- tests/unit/gui-web/portfolio-fx-view-model.test.ts (new)
- tests/unit/tools/portfolio-tracker.test.ts
- tests/unit/gui-server/market-state-api.test.ts
- tests/unit/gui-hosted/hosted-market-data-api.test.ts
- tests/unit/gui-hosted/hosted-stateful-tool-composition.test.ts
- tests/unit/gui-web/portfolio-view-model.test.ts
- tests/unit/gui-web/portfolio-card-render.test.ts
- tests/unit/gui-web/use-market-state.test.ts
- CHANGELOG.md (updated the existing pending feature entry)
- this validation.md and tasks.md

Evidence under validation-output/portfolio-fx-conversion/:
- runtime-red.log: real integration defect, EUR value was null instead of 25 USD. runtime-green.log
  establishes first wiring green. ui-red.log reproduces zero-filled P&L/mixed cost blending and
  incomplete daily totals; ui-green.log proves their corrections.
- rejected-metadata-red.log reproduces discarded security observation time. The narrow fix is
  in acquisition/unavailable adapter metadata; rejected security still never requests FX.
- consumer-first.log/consumer-second.log, adapters-first.log, focused-third.log and integration-final.log
  retain all failed attempts. Old assertions expected no FX, partial totals as full totals, or
  retained stale valuations. Quote fixtures lacked asOf and now supply observation metadata.
  Revised assertions protect the newly authorized contract, rather than bypassing checks.
- parity-first.log failed from a test fixture passing a numeric ID to a name-based service API;
  fixed the fixture. focused-third.log also caught exact floating-point equality for 1.2/1.5
  (now close-to 16 at ten decimal places) and an incorrect 406 subtotal expectation for one
  203-priced share (corrected to 203). These were assertion/fixture defects, not product changes.
- integration-green-final.log: **13 files / 152 tests passed**. Includes prior engine/provider
  module tests, tracker, real local/hosted composition with injected observations, GBP cross,
  EUR/USD, partial/unavailable paths, row aggregation, refresh behavior and card static rendering.
- snapshot-final.log: focused verification after final single-clock/empty-summary consistency edit.
- runtime-typecheck-closeout.log: **passed**.
- runtime-lint-closeout.log: **passed, 66 warnings, no errors**. Initial formatting errors remain
  recorded in runtime-lint-first.log; owned files were formatted, no checks suppressed.
- ui-build-final.log: **passed**, upstream module-directive warnings retained.

Impeccable context/floor loaded and incumbent visual language retained. Static UX pass checked
currency labels, independent nulls, partial allocation labels, per-lot evidence and mobile/desktop
paths. Vercel pass kept derived data in existing memoized flows and added no effects or network
waterfalls. These are code reviews, NOT live visual audits or screenshots.

Pending parent closeout: full/core final gates, dirty autoreview, desktop/mobile GUI visual
verification/screenshots, headless TUI and hosted live feature proof, and any outstanding
source-rights release decision. No new policy blocker exists. The inherited resume-gates-full.log
now includes failures from overlap with integration edits; it is not final integrated-code proof.
No failed evidence was deleted or represented as green, and no live/mock equivalence is claimed.

### Full-gate failure follow-up — 2026-11-06

The pending gate finished **exit 1** in test:coverage. Report:
validation-output/gates/2026-11-06T20-05-19-372Z-529734.json.
Coverage's unit pass had 11 failures across hosted/local market-data and page rendering.
The shared checkout changed during the run: failure output contains an earlier adapter shape,
while the current portfolio-view implementation uses the new shared engine. Thus this is not
stable-snapshot final verification, and prior stage passes do not certify current parallel edits.

One focused diagnostic run of the three failing files (gate-failure-focused-current.log) passed
both API suites and reproduced two render failures. Classified stale copy and monetary-contract
fixtures as inaccurate assertions: updated market-state-page-render.test.ts to expect supported
FX copy and to supply explicit native EUR money plus null unavailable USD money/partial totals.
Kept the assertion forbidding EUR value being labeled USD.

The updated fixture exposed a real product defect: aggregate daily movement still summed an
excluded native-currency holding. gate-failure-focused-fixed.log preserves that red. Added
eligibility guards in derivePortfolioDayMove for excluded holdings and FX-dependent values;
native row-level calculation remains available. The first broader run exposed an over-broad
raw-lot exclusion guard (gate-failure-focused-green.log, despite filename, FAILED); narrowed
that guard without changing its existing regression assertion. Final evidence:
gate-failure-focused-final.log — **5 files / 101 tests passed**, exit 0. Biome and diff-check
passed; mechanical Impeccable detector output in gate-failure-design-detect.json.

Only the page-render fixture/copy assertions and shared daily-move helper were edited in this
follow-up; other parallel integration edits were preserved. Full/core gates were not restarted
against the moving checkout. Browser desktop/mobile verification and autoreview remain pending;
no screenshot or live product completion claim is made by this diagnostic follow-up.

### Coverage closeout and fresh final review — 2026-11-06

Evidence: validation-output/portfolio-fx-conversion/coverage-closeout/summary.md,
ledger.md, ratios.md, baseline.diff and all original failed attempts. Existing prepared checkout;
no bootstrap or Git/PR/deploy operations. User model-switch interruption resumed this same
assignment as gpt-6.1-sol/high/priority; inherited core gate interrupted, never counted green.

Added four meaningful test cases: two desktop/mobile FX-provenance session variants, one
first-valuation failure preserving authoritative unavailable money, and one empty online/offline
snapshot contract. Three targeted mutation reds observed, production bytes restored. Final
focused run: 9 files/93 tests passed. Fresh Node+relay coverage: 5,071 unit/76 relay passed.
Measured baseline explicitly reconciled intentional shared-valuation code removal and includes
all new FX modules. PortfolioPage all ratios improve; snapshot/hook branch ratios improve.
Two pure-deletion hook line/statement fractions remain slightly lower with exactly unchanged
uncovered counts (1 line/4 statements); precise code/coverage rationale returned for parent
disposition in ledger.md. No gate logic, exclusions, thresholds or production edits.

Frozen gates:full EXIT 1: all stages through package contents passed (unit 5,071, relay 76,
agent-tools 358, site 30, GUI integration 29, journey 29, release smoke 9, hosted and 532 package
files). Coverage-stage unit run: 5,070 passed/one failed, notifications.test.ts timed out at
5,000ms; single instrumented diagnostic passed. Timing/environment cause indicated, not a fix
or waiver. Browser coverage did not run because Node coverage failed; full gate remains blocked.
Report: validation-output/gates/2026-11-06T21-37-10-054Z-599861.json.

Fresh local gpt-6.1-sol autoreview EXIT 0: two batches, zero actionable findings; React Doctor
zero errors/zero warnings across 8 React files. Per authorized failure-path deviation, standalone
review omitted duplicate parallel gates:full after its recorded failure. Exact command and
75.38-second result in coverage-closeout/autoreview.result.json. This is a fresh completed review,
not another product patch cycle. No third review-triggered product patch was made.

Source/test/baseline and other repository hashes identical before/after gates and before/after
review. This validation.md append is the only subsequent documentation drift. All owned
processes exited before handoff. Pending stable full gate and mandatory browser coverage are
not checked off. Prior live evidence retains its stated limits, including hosted preview missing
/v1/runtime-token and no deployed relay proof. No new live product claim.

### Parent final disposition — 2026-11-06

Implementation validation is now PASS. The earlier failed/interrupted runs above remain preserved; the notification timing failure was addressed by reducing Vitest worker concurrency on this shared two-CPU host, without changing source, tests, assertions, timeouts, exclusions or thresholds.

Final evidence: `validation-output/portfolio-fx-conversion/single-worker-final/summary.md`. Both `VITEST_MAX_WORKERS=1 npm run gates:full` and the exact authorized local review equivalent passed (the helper also ran a second complete full gate). Each gate passed 5,071 unit, 76 relay, 358 agent-tools, 30 site, 29 GUI integration, 29 GUI journey and 9 release-smoke tests, hosted checks and 532 package files. Instrumented coverage separately passed 5,071 unit + 76 relay, the baseline ratchet and 58 browser tests/captures. Browser reports mapped 139 scripts with zero skipped scripts across 172 production files. Node/relay/browser reports retain their distinct instrumentation limits.

Fresh local gpt-6.1-sol autoreview: zero findings; React Doctor zero errors/warnings. Review command retained all package flags, substituting only explicitly authorized local mode for dirty-worktree branch mode. All 1,406 hashed repository files were unchanged throughout both required commands. No final-code drift, active validation process, or technical implementation blocker remains. The parent accepted the measured baseline changes, including deletion-only hook fractions with unchanged uncovered counts; see coverage-closeout/parent-disposition.md and ledger.md.

Final user proof: live-final/summary.md and live-fixes/summary.md. Actual Yahoo security and FX observations support USD/EUR/GBP valuation; isolated acquisition costs are synthetic and labeled. Lot immutability, native/reporting provenance, unsupported CHF partial coverage, desktop/mobile rendering and actual TUI canonical GBP 0.80 response were verified. Final screenshots are final-desktop-provenance.png, final-mobile-390.png, final-mobile-320.png and final-mobile-provenance.png under live-fixes/. Real mobile geometry passed at 320, 360 and 390 pixels. Earlier provider probe/ECB comparisons establish availability and contextual plausibility, not accuracy certification or execution prices.

Implementation is ready for PR review. Deployment remains outside this task: hosted provider-backed live proof needs a configured /v1/runtime-token relay, and Yahoo access/display scope remains an external release question. Automated hosted checks and adapter parity passed; no deployed-relay success is claimed. Sparkline provider failures and preexisting wrong-portfolio model omission remain scoped follow-ups. The OpenSpec proposal remains active until the change ships and deltas are folded into canonical specs under repository policy.
