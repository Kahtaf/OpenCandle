# Test Trust Audit — Ledger: "rest" scope

- Date: 2026-09-24
- Auditor: worker subagent (`audit-rest`), read-only audit.
- Branch: `test-trust/audit-rest` (no PR). Commit policy: leave-uncommitted.
- Status: **WORKER EVIDENCE PENDING PARENT REVIEW.** This is not completed human review.
- Constraint compliance: no production/test/config/changelog edits; only this file written. No
  nested agents. No live model/provider calls. No credentials read/printed.
- No gates run for this read-only ledger (baseline previously established by parent).

## Scope and method

Owned files: `tests/unit/pi`, `tests/unit/prompts`, `tests/unit/evals`, `tests/unit/harness`,
`tests/unit/scripts`, `tests/unit/onboarding`, `tests/unit/doctor`, `tests/unit/website`,
`tests/unit/cli*.test.ts`, `tests/unit/e2e-integration.test.ts`, `tests/agent-tools`,
`tests/site`, and `workers/provider-relay/tests`.

Method:
- Read the scoped repo docs (`AGENTS.md`, `tests/AGENTS.md`, `.agents/skills/test-audit/SKILL.md`,
  `vitest.config.ts`, `vitest.projects.ts`, package scripts) and `tests/setup/browser-shims.ts`.
- Enumerated every test file and every **executable** case with Vitest 5.0.1 collection using
  `--staticParse=false` (the default `--staticParse` mode is **not** valid for counting: it
  under/over-counts parameterized and dynamically-registered cases). Raw lists at
  `/tmp/collect-exec.json`, `/tmp/collect-exec-site.json`, `/tmp/collect-exec-agent-tools.json`,
  `/tmp/collect-exec-relay.json`. No tests were executed for counting. Static-mode lists
  (`/tmp/collect.json`, `/tmp/collect-site.json`, `/tmp/collect-at.json`, `/tmp/collect-relay.json`)
  are retained only for the static-vs-executable delta noted below.
- Read each in-scope test file in full. For each family I traced the primary production entry
  points/callers that the suite asserts on; I did not read every callee line of every production
  module in full, so per-file "actual protection" entries reflect the exercised contract, not an
  exhaustive production review.
- Origins use `git log --follow` first/last commit dates and commit counts; `--follow` can undercount
  renames, so treat commit counts as approximate lower bounds.
- Counts below are executable collected-case counts (`--staticParse=false`). Static-mode collection
  understated the scope: e.g. `workers/provider-relay/tests/worker.test.ts` is 44 statically but 73
  executed (`it.each` families), and `tests/unit/routing/router-fixtures.test.ts` (out of scope) is 7
  static vs 74 executed. Static mode can also overcount malformed literals (`e2e-integration.test.ts`
  28 static vs 26 executed). Any future full-scope audit must use `--staticParse=false`, not a static
  list.

### Scope counts (executable, `--staticParse=false`)

| Suite | Files | Executable cases |
| --- | ---: | ---: |
| `tests/unit` in-scope subset | 59 | 728 |
| `tests/site` | 1 | 30 |
| `tests/agent-tools` | 2 | 28 |
| `workers/provider-relay/tests` | 2 | 76 |
| **Total in scope (post-deletion)** | **64** | **862** |
| _Pre-deletion total_ | _64_ | _863_ |

### Legend

- Boundary: `unit` = isolated module logic; `integration` = real filesystem/SQLite/process but no
  live network; `harness` = drives real OpenCandle session/fixtures; `artifact` = inspects on-disk
  files/build output/source text.
- Assertion quality: `behavior` = asserts observable output/state; `source` = asserts source text
  or file contents; `self` = expectation produced by the same code under test; `mock` = mock
  supplies the asserted result.
- Disposition: `keep` | `consolidate` | `replace` | `investigate`.

## Findings by family

## `tests/unit/pi` — 11 files, 106 executable cases

Origin: oldest `opencandle-extension.test.ts` from 2026-03-31 rebrand commit; `session.test.ts` /
`setup.test.ts` / `tool-adapter.test.ts` from 2026-03-29 (Vantage→Pi + first-run onboarding);
`tui-session-coordinator` and `session-action-dedupe` from 2026-07-01/02 (TUI coordinator work);
`hosted-tool-adapter` from 2026-07-31 (hosted PWA).

| File / family | Cases | Boundary | Actual protection (credible defect) | Assertion quality | Overlap | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `opencandle-extension.test.ts` | 41 | integration (fake `ExtensionAPI`, real config/memory, fake timers, temp `OPENCANDLE_HOME`) | Registers finance tool surface + commands; `/analyze` and NL dispatch queue the exact canonical prompt sequence; workflow retired on `session_shutdown`; no follow-up queued into a disposed session; original-input marker dedupe/consume; disclaimer appended as non-LLM `appendEntry` not `sendMessage` (prompt-injection boundary); memory init; router dispatch vs fallback transform semantics; symbol preflight drop/abort; pass-through not recorded; pref-drop observability; soft-degrade accumulator reset/flush; external-tool & credential-required ask-user flows; session auto-title + manual-name respect + error entry | behavior mostly; assertions on real outputs and call ordering | Partially overlaps `onboarding/tool-tags`, `onboarding/prompt-user`, `onboarding/degradation-accumulator`, `pi/session-action-dedupe` | keep | No case for `session_shutdown` reasons other than `"new"`; no assertion that titleCompletion is not re-run after failure; multi-tool-turn disclaimer only covers one tool-use shape |
| `hosted-tool-adapter.test.ts` | 11 | unit (mocks `hasCredential` probe, real tool composition + TypeBox `Value.Check`) | Hosted surface only exposes browser-reachable tools; intraday only with relay; Alpha Vantage/LSE gated on real credential; DCF gated on Yahoo; TradingView market narrowing; web-search provider narrowing; `__hostedAllowedProviders`/`__hostedEvidenceProviders` binding; native local surface unchanged | behavior + parameter-schema `Value.Check` | none material | keep | `hasCredential` is a provider-internal mock supplying the gate truth; real credential resolution untested here (covered by `onboarding/providers.test.ts`). Note as mock-dependent, not useless |
| `model-key-login-guard.test.ts` | 5 | integration (real model runtime + in-memory credential store, fetch mocked) | Rejects bad key before persist; skips double-probe for pre-validated interaction; persists normalized key; fails closed on probe error; cancellation during probe does not persist | behavior; security-relevant | none | keep | No case for provider whose verify endpoint returns 200 but malformed body |
| `model-runtime-migration-guards.test.ts` | 3 | artifact/source text | `runSetup` receives shared `modelRuntime`; `loadEnv()` precedes native provider tools; Codex review advisory (no gate workflow, CONTRIBUTING wording) | source | none | keep | Brittle regex/source slicing; will break on formatting-only refactor. Acceptable as architecture guard but flag as fragile |
| `model-provider-catalog.test.ts` | 2 | unit | Catalog derives only provider-owned ids; generated `firstClassModelCatalog` matches derivation; setup providers fixed to google/openai/anthropic; cross-provider ids rejected | behavior + self-comparison of two derivations | none | keep | Assertion `firstClassModelCatalog).toEqual(catalog)` compares two products of the same generator — catches generated-file drift only, not semantic error |
| `opencandle-extension-router.test.ts` | 2 | unit/integration (`SessionCoordinator.buildRouterContextBase` + real `buildRouterPrompt`) | Case 1 owns populated-branch extraction + ordered prior-turn rendering; case 2 owns the empty-branch `(none)` path | behavior (both remaining cases) | none | deleted one case (parent-approved) | **Deleted:** `exercises a stub RouterLlmClient end-to-end against the assembled prompt` (was case 3) and the now-unused `RouterLlmClient` type-only import. It called `client.complete` on a test-local object that returned the test's own supplied NVDA JSON on the same populated branch as case 1, so it proved nothing beyond cases 1–2. **No production branch lost:** the only production code it touched (`buildRouterContextBase`, `buildRouterPrompt`) is covered by the retained case 1; `RouterLlmClient` is a type-only interface with no runtime branch, guarded by `npm run typecheck`. Remaining owner for router-prompt prior-turn rendering: retained case 1 (`includes prior-turn text from a populated session branch in the rendered router prompt`). Focused run green: 2 passed |
| `session-action-dedupe.test.ts` | 12 | integration (real temp fs sidecar) | Accepted-id persistence; 0600 perms; fingerprint mismatch rejection; prototype-pollution-safe ids; eviction/expiry pruning of fingerprints; snapshot round-trip; fail-closed corrupt sidecar; writer-lock scope migration; clear on failure; durable pending retention; timestamp stability; legacy string ids | behavior; security-relevant | none material | keep | No test for concurrent writers racing the sidecar (two processes) |
| `session.test.ts` | 5 | integration (real `SessionManager`/`SettingsManager`, temp dirs, mocked fetch) | Login guard active for caller-provided and Pi-created model runtimes; finance-only tool surface; env-derived provider availability; saved default model beats resumed session model | behavior | small overlap with `model-key-login-guard` (guard is applied) | keep | Env tests mutate `process.env`; relies on `createTestModelRuntime` helper |
| `setup.test.ts` | 12 | integration (real model runtime + credential store, `open-url` mocked) | Setup requirement states; rejects/does not persist invalid or unverifiable keys; writes key and auto-activates default model with exactly 2 selects; picker fallback; first-run shows no data-provider prompts; configured startup is a no-op; OpenCandle-voiced input (never `LoginDialogComponent`/`ui.custom`); no header/status chrome; decline shuts down | behavior | overlaps `onboarding/validate-model-key`, `onboarding/prompt-user` | keep | Comment at lines 45–48 records removed finance-setup tests and promises future coverage in "Task Group 14/17" that is now present; remove stale note in cleanup |
| `tool-adapter.test.ts` | 3 | unit (case 3 remocks `tools/index`, `tool-defaults`, `tool-defaults-wrapper`) | Pi tool shape passthrough incl. execute args; full tool-surface parity; `__enabled`/defaults stripped before wrap | behavior | case 2 overlaps `pi/session.test.ts` tool-surface count and `hosted-tool-adapter` native assertion | keep | Case 3 mocks provider internals and only asserts the wrapper receives defaults; it does not exercise the real `wrapWithDefaults` |
| `tui-session-coordinator.test.ts` | 10 | integration (real local HTTP server + real `SessionManager`, temp dirs) | 403 unauthorized; 409 `syncing` when writer-lock scope throws; authorized stream + transcript; action-id dedupe + concurrent `session_busy`; failed-before-admission retries; failed-after-admission deduped; streaming busy; `session_starting`; sync-before-prompt ordering; source guard on `recordAcceptedAction` | behavior (9) + source (1) | case 10 (source at line 432) duplicates behavioral case at 392 | keep (source case low-value; consolidate candidate) | No test that the coordinator rejects a mismatched `sessionId` for an existing server |

Notable cross-family overlap: `opencandle-extension.test.ts` re-tests external-tool/credential ask-user
copy that `onboarding/tool-tags.test.ts` and `onboarding/prompt-user.test.ts` own at the unit layer.
The extension cases are wiring-level (handler → helper) so they are not pure duplication, but a
cleanup pass should keep the helper-level unit boundary and leave the extension tests to one
representative wiring path each.

## `tests/unit/prompts` — 7 test files (+1 snapshot), 140 executable cases

Origin: `context-builder` from 2026-04-03 (agent runtime v2), `policy-cards`/`prompt-variants` from
2026-05-24 (policy-card dual-run + truncation gates), `prompt-debt-guard` 2026-05-26,
`prompt-output-snapshots` 2026-06-13, `symbol-preflight` 2026-05-31, `workflow-prompts` 2026-03-29.
`prompt-to-policy-migration-manifest.json` is the manifest driving the debt guard.

| File / family | Cases | Boundary | Actual protection | Assertion quality | Overlap | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `context-builder.test.ts` | 55 | unit (real `PromptContextBuilder`) | Section ordering/empty-skip/budget truncation; provider-tag data-gap guidance present on every route; add-on tools; workflow instructions; tool-catalog gating; per-policy-card rendering for dual-run vs `replacement_active` (ticker, single-asset, macro, portfolio-review, backtest, current-event, concept, sentiment, filing, retail, stateful); fallback playbook size cap; no refusal vocabulary; analyst stance on all workflows | prompt-string `toContain`/`not.toContain` (exercises real builder; literal coupling) | Heavy overlap with `policy-cards.test.ts` (same card content) and `prompt-output-snapshots.test.ts` | keep, consolidate candidates | Case at line 958 (`get_reddit_sentiment description mentions cross-subreddit`) only asserts the prompt contains `get_reddit_sentiment` and never asserts `cross-subreddit` — name/assertion mismatch, so the stated guidance can regress silently. Case at line 950 (`does not reference get_reddit_discussions`) is an absence check on a removed symbol; low value |
| `policy-cards.test.ts` | 23 | unit (real registry/renderer) | Stable `POLICY_CARD_IDS` list; implemented vs placeholder status; `observe_only` renders `""`; `validatePolicyCardRegistry()` returns `[]`; per-card content obligations | prompt-string `toContain`; one real invariant check (`validatePolicyCardRegistry`) | Overlaps `context-builder` card-render cases and snapshot card snapshot | keep, consolidate candidates | Most cases pin literal prose, so they guard accidental edits but not behavioral correctness. Consider a smaller "required obligations" table to reduce duplication |
| `prompt-debt-guard.test.ts` | 1 | artifact (reads manifest + `src/prompts/context-builder.ts`, `policy-cards.ts`) | Benchmark-specific tickers/percentages/dollars/shares must not leak into production prompt guidance | source/manifest scan | none | keep | Detectable literals limited to the manifest prompt set and four regex families; a new benchmark literal absent from the manifest is not caught. Guard is valuable but not exhaustive |
| `prompt-output-snapshots.test.ts` | 3 | unit + snapshot | Pins workflow builders, every policy card (direct + planning-rendered), and three context-builder assemblies | snapshot | Overlaps `workflow-prompts`, `policy-cards`, `context-builder` | keep | Snapshots are broad; a blind `-u` can lock in regressions. No assertion of *why* output changed. Snapshot file: `__snapshots__/prompt-output-snapshots.test.ts.snap` |
| `prompt-variants.test.ts` | 2 | unit (real builder) | Six production variants build non-empty with sections; non-memory active sections never truncate | behavior (coarse) + gate | none | keep | Case 1 asserts only `>0`, not section content; value is the no-truncation gate. Low signal otherwise |
| `symbol-preflight.test.ts` | 5 | unit (resolver search mocked, real preflight) | Exact-match keeps; no-match drops with reason; per-turn cache; fail-open on resolver error; annotation format | behavior | none | keep | No case for duplicate symbols or case-mixing beyond exact resolver match |
| `workflow-prompts.test.ts` | 51 | unit (real builders) | Portfolio/options/compare prompt contracts: user vs default vs saved-preference tagging; ETF vs stock tool paths; crypto tool path; DTE/expiration and date grounding; Greeks; max-premium cap; covered-call vs protective-put framing; covered-call catalyst ticker not substituted as underlying; compare overlap/macro/rate guidance; disclosure block grouping; router slot value rendering (array/scalar/object); no disclaimer directives | prompt-string `toContain`/regex + `not.toContain` | Overlaps snapshots; `buildDisclosureBlock` cases overlap disclosure use in context-builder | keep | All assertions are literal prompt prose; no execution of a model. `buildAssumptionsBlockFromRouter` cases re-import the same module mid-file (lines 649–685) which is unnecessary but harmless |

## `tests/unit/evals` — 10 files, 142 executable cases

Origin: `scorers` from 2026-04-03 (eval framework), `competitive-finance` 2026-05-16 (benchmark loop),
`competitive-finance-planning`/`prompt-policy-assertions` 2026-05-24/25, `eval-suite-registration`
2026-07-04 (vitest-evals upgrade fix), `provider-outage-deterministic` 2026-07-03, `product-evals`
2026-05-17. `tests/evals/**` not in unit scope except their tests here.

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `competitive-finance.test.ts` | 48 | unit + one SQLite integration | Saved-state fixture seeds real `MarketStateService`; prompt-generation/judge prompts; tolerant JSON repair for malformed judge output (missing commas, brackets, object-valued arrays); CLI failure answer extraction vs infra failure; portable PATH strips `node_modules/.bin`; adapter binary resolution (override/global/npx); CODEX_PATH/CLAUDE exec env; frozen panel backed by manifest hard assertions; cache lookup excludes failed answers; report analysis; model selection; retry classifier; timeout env; env-key auth fallback | behavior on real functions; one manifest read | keep | Broad and mostly high value. `competitiveBenchmarkExitCode()` case is a trivial constant assertion (line 975). Model-selection cases pin specific model ids (`gpt-5.6-terra`) that will churn — acceptable as documented baseline contract |
| `product-evals.test.ts` | 27 | unit (scorer + case tables) | Mandatory vs optional dimension scoring; family/dimension aggregation; direct-answer recognition across decision/hold/compare/macro/bull-bear/portfolio-table/DTE-window phrasings; missing-data honesty gated on observed tool gap; risk-framing; E5 ask-vs-guess ambiguous vs resolvable twins; exit-code mapping; template seeding invariants | behavior on real scorer; case-table structural checks | keep | Strong negative cases (e.g. commitment heading alone is not a direct answer). Scorer is regex/keyword driven, so it cannot judge semantic correctness — label accordingly |
| `scorers.test.ts` | 31 | unit | Workflow/tool-selection/tool-args scoring incl. partial and forbidden; financial-number extraction (currency/%/multiplier/abbrev/metric); object extraction; data faithfulness incl. 1% tolerance; risk disclosure built-in + custom patterns + disclaimer custom entry; saved-market-state fidelity pass/fail messages | behavior | keep / investigate | Cross-cutting tension: prompt tests assert production prompts contain no `not financial advice`/disclaimer, while `scoreRiskDisclosure` passes only when disclaimer language or an `opencandle-disclaimer` custom entry is present. The custom-entry case makes it work, but the built-in text check is a legacy path. Flag for parent: confirm built-in disclaimer path is still reachable |
| `prompt-policy-assertions.test.ts` | 13 | unit + manifest artifact | Unregistered hard assertions fail (not silently pass); every manifest hard assertion has a deterministic checker; DTE window, ticker-clarification, structural-portfolio-read variants | behavior on real evaluator; manifest coverage | keep | Good. Manifest-driven, so coverage tracks `prompt-to-policy-migration-manifest.json` |
| `router-live-contract.test.ts` | 7 | unit (real `stripNonContract`) | Share-class identity (GOOG vs GOOGL not deduped); canonical DTE slot wins over horizon prose; empty catalyst list ignored; expected tool bundles retained, extras ignored | behavior | keep | None material |
| `run-evals-table.test.ts` | 8 | unit + artifact (reads `package.json`, `tests/scripts/run-evals.ts`) | Front-door script ownership; `spawnSync` with `shell:false`; suite list; suite→command/env mapping incl. known-fail flags; unknown-suite error; release aggregation; run-index JSONL diff/append | behavior + source contract | keep | Source assertion `shell:false` is a real security contract (no shell injection); keep |
| `provider-outage-deterministic.test.ts` | 3 + 1 skipped | integration (registered tools + fixture fetch, real cache/rate limiter) | Zero-filled quote disclosed as unavailable, not `$0.00`; partial correlation drops 429 symbol with reason; weekend-stale quote timestamp disclosed | behavior | keep | The skipped `KNOWN-FAIL E3` case (line 131) is documented as needing a credentialed harness run; **it is not gating** and must not be counted as exercised coverage |
| `competitive-finance-planning.test.ts` | 2 | unit | Judge prompt carries planning metadata; improvement-idea classification into prompt-to-policy layers | behavior | keep | None material |
| `eval-suite-registration.test.ts` | 2 | unit with `vi.mock` of runner/scorer/baseline | `registerEvalSuite` collection succeeds and runs case through `runEvalCase`/`scoreCase` (guards the vitest-evals 0.14 `define` regression); runtime collection sees 2 tests (the top-level registered case + the explicit assertion), static collection sees only 1 | mock-supplied expectations | keep | Depends on `clearMocks:false` (documented in `vitest.config.ts`); a future `clearMocks` flip silently breaks it. Mock supplies all outputs, so it checks wiring only. Illustrates why static counts must not be used |
| `subprocess-runner.test.ts` | 1 | integration (spawns real node child) | Timeout kills the child and reports `timedOut`, `status:null` | behavior | keep | None |

## `tests/unit/harness` — 9 files, 78 executable cases

Origin: `trace-collector`/`ipc`/`ipc-ask-handler`/`integration` from 2026-04-03 (harness foundation),
`custom-entries` 2026-04-20 (router context + observability), `opencandle-runner` 2026-05-16,
`opencandle-runner-planning` 2026-05-24, `planning-evidence` 2026-05-31, `structured-checks`
2026-07-04 (planning layer move / later consolidated 2026-09-19).

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `structured-checks.test.ts` | 21 | unit (real registries + `runStructuredChecks`) | Full answer-contract registry (16 contracts) obligations; observe-only records failures without activating retry; selected-slice pass; sentiment-specific fields; freshness/source-coverage from metadata not prose; semantic checks on answer text; framework fallback diagnostic until parity | behavior + registry invariants | keep | Contract expectations are duplicated verbatim from production registry values, so they pin data shape rather than derived behavior. Valuable as an anti-drift registry lock |
| `ipc.test.ts` | 12 | integration (real temp fs) | Atomic status/question/answer/trace writes; full ask round-trip; poll timeout; prompt-request move back to running; no `.tmp` residue; pid liveness (live + dead); error file; missing-file nulls | behavior | keep | `pollForAnswer` timeout uses real 200ms; fine |
| `custom-entries.test.ts` | 11 | integration (real `SessionManager.inMemory`) | Drains only `opencandle-*` (prefix-scoped, `opencandleX`/`open-candle` excluded); append order; known emitted types; structured analyst-step payload; spec scenarios | behavior | keep | Line 23 uses literal `"Not financial advice."` as a disclaimer payload — fixture text only, not a prompt; no contradiction by itself |
| `opencandle-runner-planning.test.ts` | 9 | unit (real `toEvalTrace`) | Planning telemetry extraction; evidence records `market_status` + `portfolio_exposure_map`; structured-check failures; retry eligibility; negative case that generic "Findings:" headings do not satisfy sentiment rationale | behavior | keep | Good negative coverage |
| `trace-collector.test.ts` | 7 | integration (real collector, mock session event bus) | Tool-call capture incl. args/result/error/duration; text-delta accumulation; multi-turn; interactions; JSONL streaming + valid JSON per line; empty session | behavior | keep | Mock session supplies events only; collector logic is real. Does not prove a live Pi session emits these shapes (harness README acknowledges) |
| `opencandle-runner.test.ts` | 6 | integration with `vi.mock("src/index.js")` | Auth/model registry passed into isolated session; imported session manager passthrough; single-prompt trace shape; multi-prompt sequential tagging by `promptIndex`; custom-entry drain | orchestration behavior; session factory mock-supplied | keep | `createOpenCandleSession` is mocked, so this does not exercise real session creation. No case drives `timeoutMs` to expiry or verifies `dispose()` on timeout |
| `integration.test.ts` | 5 | integration (collector + IPC + ask handler, synthetic events) | End-to-end harness flow: tool→text→trace write; ask_user round-trip; multi-round Q/A; timeout cancelled; continuous JSONL | behavior | keep | Synthetic events; proves the harness plumbing, not the live agent. Label matches README limit |
| `planning-evidence.test.ts` | 9 | unit (real builders/normalizers) | Evidence-plan registry implemented vs placeholder; market-status open/weekend/holiday/after-close + trading day; tool-call raw-trace capture; ticker-disambiguation slice; portfolio exposure map; soft-degrade/skip tag normalization; unavailable provider gaps | behavior | keep | Timezone/date cases pin `America/New_York`; market-calendar correctness beyond these dates not exhaustively proven |
| `ipc-ask-handler.test.ts` | 2 | integration (real IPC + collector) | Question write → external answer → handler result + interaction recorded; timeout → `{cancelled:true, answer:null}` | behavior | keep | Partial overlap with `integration.test.ts` cases 2 and 4; consolidating is defensible but not required |

## `tests/unit/onboarding` — 11 files, 167 executable cases

Origin: most files from 2026-04-12 ("add conversational provider setup flow"); `state` from
2026-03-29 (first-run onboarding); `provider-status` 2026-06-16 (diagnostics registry);
`validate-model-key` 2026-07-10 (validate before save).

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `providers.test.ts` | 37 | unit + module-load ordering | Registry shape invariants for all 15 providers (kind/category/tier/aliases/uniques); hosted browser transport classification fails closed (direct list fixed to 3; relay resolution); hard/soft fallback rules; lookup helpers; credential source env>file; lazy `loadFileConfig` at module eval | behavior + registry invariant | keep | `getConfig`/`loadFileConfig` are provider-internal mocks; real config resolution is covered by `validation`/`connect`. `PROVIDERS.length` hard-coded to 15 in one place (line 478) |
| `provider-status.test.ts` | 17 | unit + real temp fs + stub command runner | API-key source without network; LSE optional/not-degrading via full doctor report; external-tool `--version` only vs explicit session smoke; uv shim discovery when PATH stale; Reddit/Twitter missing-cookie classification; never-ask skip vs forced; **session error redaction** (asserts cookie/token values never surface); bounded public-HTTP probe with cache + AbortSignal; TradingView/SEC headers | behavior; security-relevant redaction | keep | Redaction case uses synthetic cookie literals in the fixture (not real secrets) and correctly asserts `Cookie: [redacted]`. Good pattern; retain |
| `validate-model-key.test.ts` | 9 | unit (fetch mocked, real `validateModelKey`) | 401 invalid; network error transient (allows save); Anthropic browser-safe header; Google probe; **loopback-only probe-base override** and `redirect:"error"`; non-loopback/unparseable override ignored (exfiltration guard); Google `API_KEY_INVALID` 400 invalid; unrelated 400 transient | behavior; security-relevant SSRF/exfil guard | keep | Strongest security test in the family. No case for a 3xx from the real endpoint |
| `validation.test.ts` | 8 providers × ~2–3 = 20 | unit (fetch mocked) | Per-provider valid/invalid status mapping incl. Alpha Vantage HTTP-200 error body; key transported by query (AV/FRED/Finnhub) or header (Brave/Exa/LSE); asserts key never in URL where header is used | behavior; security-relevant key placement | keep | No timeout/abort case |
| `connect.test.ts` | 11 | integration (real temp `OPENCANDLE_HOME` config.json, validation mocked) | Opens browser; trims + persists key; cancel/empty no-write; env-precedence `blocked_by_env`; merge with existing config; cache refresh; invalid/HTTP-200-invalid/transient all no-persist; passes trimmed key+provider; no validation on env short-circuit | behavior | keep | `validateCredential` is mocked, so the end-to-end "bad key never written" proof is split across `validation.test.ts`; acceptable layering. Uses `process.chdir` + env mutation |
| `state.test.ts` | 20 | integration (real temp fs) | Defaults/version; persistence under `OPENCANDLE_HOME`; unknown-field ignore; corrupt-JSON fallback; partial providers map; pure transition functions; snooze math; `shouldPrompt`/`shouldShowWelcome` matrix; `getProviderEntry` | behavior | keep | None material |
| `tool-tags.test.ts` | 16 | unit | Canonical builder output + roundtrip for all tag kinds; optional fields (`httpStatus`, `silenced`); unknown-field tolerance; tag found anywhere in multi-line block; non-tag returns undefined | behavior | keep | None material |
| `credential-interceptor.test.ts` | 12 | unit | Prompt/skip decision matrix: missing/no-state, session-prompted, never_ask (silenced), active/expired snooze, completed+stale vs missing, per-workflow hard-prompt cap, skip metadata provider/remediation | behavior | keep | None material |
| `degradation-accumulator.test.ts` | 7 | unit | Empty/one/multi provider; dedupe; one skipped line per provider; never_ask `(silenced)` marking incl. mixed set; reset | behavior | keep | None material |
| `prompt-user.test.ts` | 11 | unit (UI stubbed) | select/text/confirm routing incl. trim, cancel, missing-options guard; headless no-UI cancel; injected `askUserHandler` bypasses UI | behavior | keep | `ctx.ui` is stubbed; that is the unit boundary |
| `tool-helpers.test.ts` | 7 | unit (`getConfig` mocked) | `withCredentialCheck` upfront missing short-circuits without calling fn; passthrough when present; catches `ProviderCredentialError` (missing/stale+httpStatus); structured details; re-throws non-credential errors incl. strings | behavior | keep | `getConfig` provider-internal mock; `hasCredential` truth is supplied by the mock, but tag emission/error handling is real |

## `tests/unit/scripts` — 5 files, 28 executable cases

Origin: `check-node-version-lib` 2026-05-23 (auto-rebuild native binding); `release-lib` 2026-03-30
(release workflow); `release-readiness` 2026-06-20 (harden release gates), 11 commits to
2026-09-20; `check-public-doc-links-lib` 2026-07-17; `make-cli-executable` 2026-07-10.

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `release-readiness.test.ts` | 14 | artifact/source (reads `release.mjs`, `package.json`, workflows, `check-package-contents.mjs`, `tsconfig.json`, `prerender.jsx`, CODEOWNERS/dependabot) | Release-eval confirmation required unless `--skip-eval-confirm`; checks before version mutation; tag guards (main, origin sync, duplicate tag) ordering; `release:check` composition incl. GUI smoke/site/pack/link; prepublish uses full check; package denylist machine-readable; no source maps; `isDeniedPackagePath`/`parsePackDryRunJson` behavior; publish tag-only matching; CI matrix + gated scripts; GUI smoke uses production requirement literals; llms-full link rewrite; dependabot + CODEOWNERS | behavior (two imported functions) + source contracts | keep | Largely source-order/`toContain` guards; protects release hygiene well, but breaks on reformat. Reads `tests/e2e/gui-browser.test.ts` (out of this audit's scope) |
| `check-public-doc-links-lib.test.ts` | 10 | unit (fetch injected) | Outcome classification (2xx/3xx/401/403/405/429 ok; 404/500 broken; network error unverified); HEAD→GET fallback on 405; POST-only 405 accepted; definitive 404 no retry; transient retry with bounded attempts/sleep; recovery on retry | behavior | keep | No real-network case (correct for unit) |
| `release-lib.test.ts` | 2 | integration (real temp changelog file) | `[Unreleased]` → versioned heading; re-insert `[Unreleased]` at top | behavior | keep | No case for missing/malformed changelog when invoked from `release.mjs` |
| `check-node-version-lib.test.ts` | 1 | unit (load/rebuild injected) | Rebuilds once and retries load on stale NODE_MODULE_VERSION | behavior | keep | Only the stale-ABI branch; non-ABI load errors and rebuild failure untested |
| `make-cli-executable.test.ts` | 1 | unit (`chmod` injected) | Windows is a no-op | behavior | keep | No POSIX case asserting the mode is set; a regression where nothing is chmodded off-Windows would pass. Flag as a small coverage gap |



## `tests/unit/doctor`, `tests/unit/website` — 3 files, 20 executable cases

Origin: `doctor/report` 2026-06-22 (shared CLI doctor report) with 16 commits; `doctor/cli-command`
2026-08-30 (dependency update); `website/shared-ui-boundary` 2026-07-01 (site design-system
consolidation).

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `doctor/report.test.ts` | 17 | integration (real temp `OPENCANDLE_HOME`, stub command runner/fetch) | LSE byte-budget warn at/above soft threshold, no warn below or without key; `deriveDoctorStatus` core vs optional (unknown core degrades); webhook configured flag without leaking URL; session probes only when requested; ready + unchecked optional sessions summary; state paths pointing at files warn; explicit session probes keep optional failures non-blocking; skipped/never-ask preferences; missing CLI; never-connected keyed providers skip; previously-configured now-missing warns; fresh probes per report; GUI health rejects unverified 200 HTML; invalid config blocks | behavior + status derivation | keep | Strong. The webhook-URL non-leak case (line 175) is a security assertion; keep. `commandRunner`/`fetchImpl` injection is a real seam, not an internal mock |
| `doctor/cli-command.test.ts` | 2 | unit (registry stubbed) | Unauthenticated catalog model → `connect_auth`; authenticated OAuth model outside setup providers is included as `select_model` | behavior | keep | No case for a configured+available current model, but that path is covered in `pi/setup` |
| `website/shared-ui-boundary.test.ts` | 1 | artifact (walks `packages/ui/src`) | Shared UI package never references GUI runtime modules or local runtime endpoints | source boundary guard | keep | Only scans `.js/.jsx/.css` (not `.ts`/`.tsx`); if `packages/ui/src` gains TS source, the guard silently skips it. Flag as a coverage hole worth investigating |

## `tests/unit/cli.test.ts`, `tests/unit/cli-options.test.ts`, `tests/unit/e2e-integration.test.ts` — 47 executable cases

Origin: `cli.test.ts` from 2026-05-17 (21 commits, latest 2026-09-19 "merge: audit D4 test bar");
`cli-options` 2026-07-10 (CLI front door), `e2e-integration` 2026-03-29 (initial orchestration
pipeline).

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `e2e-integration.test.ts` | 26 | integration (real SQLite `:memory:` + real entity/slot/prompt/workflow code) | Portfolio/options/compare orchestration; budget/symbol/DTE/max-premium extraction; SQLite persistence + preference lifecycle; memory context; clarification provenance; local-timezone date grounding; file-backed DB creation | behavior | keep / rename | Executable count is 26; static collection reported 28 because it mis-parsed a multi-line object literal as two extra test names (see method note). Despite the name it never starts the CLI, session, or model — it is an orchestration-layer integration suite. Neither `tests/harness/opencandle-runner.ts` nor a live TUI journey is exercised. Rename or add a real journey to justify "e2e" (outside this read-only audit's scope) |
| `cli.test.ts` | 17 | integration with very heavy `vi.mock` (`node:fs`, `node:child_process`, whole `pi-coding-agent`, config/doctor/session/TUI modules) | `install --local/-l` (`it.each` ×2); monitor spawn (dist vs tsx source); doctor render/JSON/scope-flags/exit codes (`it.each` ×3); `--enable` clears never-ask; TUI writer-lock acquire/rebind/release; follower + non-owner exit 1 with syncing copy; two **source** guards for SSE text handling and fail-closed writer-lock migration | behavior (mostly) + 2 source | keep | Almost every dependency is mocked, so the suite proves CLI dispatch wiring, not real install/session behavior. Two cases read `src/cli-main.ts` source (lines 467, 477); legitimate architecture guards but fragile. No real interactive TUI test in this file (that lives under `tests/e2e`/harness) |
| `cli-options.test.ts` | 4 | integration (spawns real `tsx src/cli.ts`) + artifact | `frontDoorCommand` help/version precedence; help/version print without ANSI and without starting TUI (`it.each` ×2); package description/keywords/`engines.node` semver contract | behavior + artifact contract | keep | Good real-process check. `engines` pins exact boundaries; update when support range changes |

## `tests/agent-tools`, `tests/site` — 3 files, 58 executable cases

Origin: `agent-dx-guardrails` from commits `73090aee` (scaffold) → `a2c0530d` (atomic env copy);
`autoreview-helper` from 2026-07-08 (test-suite noise reduction) with 8 commits; `public-site-build`
2026-09-19 (moved out of `npm test`), 17 commits.

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `autoreview-helper.test.ts` | 16 | integration (real `git` repos, real helper script, fake Codex engine, fake PATH) | Commit/range review scoping; refuses repo-contained engine binary (PATH hijack); skips ancestor `node_modules/.bin` shim; out-of-scope findings advisory vs exit code; scope-policy injection; batch splitting + loud truncation; hunk/file split unit probe; diff signals present/suppressed/off; React Doctor skip for non-checked-out head; dirty-worktree branch failure | behavior, mostly via subprocess | keep | High-value adversarial coverage. Depends on `git`/`python3`/`which` on PATH; the unit probe at line 592 `exec`s the helper with Python and asserts internal function names, which is implementation-coupled |
| `agent-dx-guardrails.test.ts` | 12 | integration (spawns real bootstrap) + artifact source reads | AGENTS.md ≤ 24 KiB injection headroom; canonical command/contract references; package-script composition incl. one-level `npm run` resolution; delegation contract/resume phrases; bootstrap env copy mode 0600, byte-preserving, exclusive (`COPYFILE_EXCL`), unsupported-node guard, missing source warning, dry-run, real-repo readiness | behavior + source guards | keep | `gates` composition is asserted by regex over resolved scripts; good anti-rot. Two source-level guards (lines 182, 191) exist because the races cannot be triggered deterministically; acceptable |
| `public-site-build.test.ts` | 30 | artifact (reads built `website/dist`) + JSDOM DOM/behavior | Build contract (workspaces, no hand-written builder, no markdown published); metadata/social card dimensions; docs assets/images/GFM; related-docs nav; SEO snippet uniqueness/length; no local GUI runtime routes; GUI-primary narrative; hero/FAQ/footer/comparison copy and ordering; no em dashes; keyboard tab switching + copy command behavior by evaluating the built client bundle | behavior + artifact content | keep / label | This is not a real browser: it reads static `dist` files and evaluates the built bundle in JSDOM. It cannot prove CSS layout, real video playback, or cross-browser behavior. Many exact-copy assertions are intentionally brittle marketing contracts. The contract only runs under `npm run test:site` (build first), not default `npm test` |

## `workers/provider-relay/tests` — 2 files, 76 executable cases

Runner: `npm --workspace @opencandle/provider-relay test` (`vitest run --config vitest.config.ts`),
gated by `npm run gates`. Origin: 2026-07-31 (audited provider relay) with later 2026-08-03 fixes.

| File / family | Cases | Boundary | Actual protection | Assertion quality | Disposition | Remaining proof / gap |
| --- | ---: | --- | --- | --- | --- | --- |
| `worker.test.ts` | 73 | integration (real relay handler; `fetchImpl` + rate limiter injected) | Runtime-token issuance/binding/refresh/expiry; WebContainer/StackBlitz origin rules; CORS allowlist + `Vary`; provider allowlist destinations (brave/exa/fear_greed/fred/tradingview/yahoo + Yahoo cookie side channel only); model relay allowlist (openai/anthropic/google) with `set-cookie` stripping; rejects redirect (manual), arbitrary destinations, bad methods/paths, model-key probes via GET; SSE streaming without buffering; request/response size limits; stream timeout/cancel; single pseudonymous rate-limit key across rotated client ids + fail-closed when `cf-connecting-ip` missing; credential non-reflection from errors and upstream bodies; health exposes only version + provider ids | behavior; adversarial security | keep | Count 73 executable (44 static; the rest are `it.each` families). Very strong. Uses synthetic `203.0.113.10`/client ids and canary credential strings (not real). Does not exercise real Cloudflare rate-limiter binding or deployment config |
| `privacy-audit.test.ts` | 3 | artifact (`wrangler.jsonc` + relay source) | No logging/storage/analytics/public route bindings; exactly four production routes; source contains no `console.`, Cache API, error reflection, `request.cf`; hashes rate-limit keys | source guard | keep | Pins config/source text; catches accidental observability/logging additions. Could miss a binding expressed differently, but combined with `worker.test.ts` it is strong |

## Cross-cutting findings (prioritized)

1. **`scoreRiskDisclosure` vs prompt contract (investigate).** Production prompts deliberately contain
   no `not financial advice`/disclaimer vocabulary (`context-builder.test.ts`, `workflow-prompts.test.ts`),
   while `tests/unit/evals/scorers.test.ts` still has a built-in disclaimer check and a passing custom-entry
   case. The disclaimer is now recorded as an `opencandle-disclaimer` custom entry, so risk disclosure is
   satisfied via the custom-entry path. Parent should confirm whether the built-in text check is still
   reachable/needed or is dead legacy logic.
2. **Provider-internal mocks (accepted, documented).** `hasCredential` (hosted adapter), `getConfig`
   (`onboarding/providers`, `tool-helpers`), `loadFileConfig`, and `createOpenCandleSession`
   (`harness/opencandle-runner`) are mocked. Each is an environment seam and the same behavior is
   exercised for real in a sibling suite (noted per file). Not grounds for deletion.
3. **Source-text guards (keep, fragile).** `model-runtime-migration-guards`, `tui-session-coordinator`
   case 10, `cli.test` cases at lines 467/477, `run-evals-table` `shell:false`, `prompt-debt-guard`,
   `website/shared-ui-boundary`, relay `privacy-audit`, and `agent-dx-guardrails`. These protect
   architecture/security/observability contracts that are hard to reach behaviorally; keep, but know
   they break on formatting/renames. `website/shared-ui-boundary` scans only `.js/.jsx/.css` — a real
   skip risk if `packages/ui/src` ever holds `.ts`/`.tsx`.
4. **Low-value / tautological cases (parent-approved deletion applied).** The approved cleanup
   deleted `opencandle-extension-router` case 3 (stub client returns fixed JSON and the test parses
   it); see that file's row. Remaining consolidate candidates: `competitive-finance`
   `competitiveBenchmarkExitCode()` constant assertion;
   `context-builder` line 950 (absence of a removed symbol) and line 958 (name says "cross-subreddit",
   body never checks it); `prompt-variants` case 1 (`>0` only). None are harmful, but they add little.
   No other deletions are proposed in this audit.
5. **Naming accuracy.** `tests/unit/e2e-integration.test.ts` is not end-to-end (no CLI/session/model);
   `eval-suite-registration.test.ts` relies on `clearMocks:false` (documented in `vitest.config.ts`).
6. **Explicit non-gating coverage.** The one `.skip` in scope (`provider-outage-deterministic.test.ts`
   line 131, `KNOWN-FAIL E3`) is not exercised and must not be counted as coverage.

## Pending gaps / missing journeys (explicit)

- **No real-browser journey in scope.** `tests/site` uses JSDOM and static `dist` files only; GUI
  browser journeys live under `tests/e2e/gui-browser.test.ts` (out of scope). Browser-only rendering
  and CSS/layout claims are unproven here.
- **No live-model or live-provider proof in this ledger** (correctly so). Agent quality is covered by
  `npm run eval -- <suite>` and the opt-in live eval scripts outside unit scope.
- **Harness does not prove live Pi session behavior.** `tests/unit/harness` uses synthetic session
  events and a mocked `createOpenCandleSession`; the README acknowledges this limit.
- **`tests/unit/cli.test.ts` does not exercise a real interactive TUI.** All Pi/fs/child_process
  dependencies are mocked; real TUI driving is via `tests/e2e` / `tests/harness`, out of scope.
- **Relay deployment reality unproven.** Rate-limiter binding and CORS are exercised with injected
  mocks; no live Cloudflare run in scope.
- **`provider-outage-deterministic` `opencandle-turn-gap` assertion is skipped** pending a
  credentialed harness run (tracked `KNOWN-FAIL`).
- **Not independently verified by a second reviewer.** This ledger is worker evidence pending parent
  review; no human review has occurred.

## Unreviewed families

None within the stated Owned-task scope: all 64 in-scope test files were read in full, and all 863
pre-deletion / 862 post-deletion executable cases are accounted for by file/family in the tables
above. Files and directories adjacent
to but outside scope (`tests/unit/routing`, `tests/unit/providers`, `tests/unit/memory`,
`tests/unit/tools`, `tests/unit/gui-*`, `tests/e2e`, `tests/evals/cases`, `tests/harness`) were
**not** audited and are not represented here.

## Verification and command log

Counting commands were read-only; the deletion was verified with one focused test run and one
`npm run gates`.

- `npm run bootstrap:agent` → `ready: run npm run gates` (deps installed, `.env` copied).
- `npx vitest list --project unit --staticParse=false --json` → `/tmp/collect-exec.json`
- `npx vitest list --project site --staticParse=false --json` → `/tmp/collect-exec-site.json`
- `npx vitest list --project agent-tools --staticParse=false --json` → `/tmp/collect-exec-agent-tools.json`
- `(cd workers/provider-relay && npx vitest list --staticParse=false --json)` → `/tmp/collect-exec-relay.json`
- Static-mode equivalents (retained only for the delta) → `/tmp/collect.json`, `/tmp/collect-site.json`,
  `/tmp/collect-at.json`, `/tmp/collect-relay.json`
- `git log --follow` per in-scope file → `/tmp/origins.tsv`
- `npx vitest run --project unit tests/unit/pi/opencandle-extension-router.test.ts` → **2 passed** (post-deletion)
- `npm run gates` → **PASS, exit code 0**: `check` clean; unit `350 files / 3740 passed, 1 skipped`;
  relay `2 files / 76 passed`; agent-tools `2 files / 28 passed`. The single skip is the tracked
  `KNOWN-FAIL E3` provider-outage case.

Scope count reconciliation (executable, `--staticParse=false`): unit in-scope 728 + site 30 +
agent-tools 28 + relay 76 = **862 executable cases across 64 files** post-deletion (863 pre-deletion).
Static-mode counts (726/30/28/47 = 831) are **void for scope reporting**. No test pass/fail claim is
made from the counting lists themselves.

## Provenance note

A separate copy of the `test-audit` skill exists at `.agents/skills/test-audit/SKILL.md` as an
untracked file in this worktree (visible in `git status`). It was read for method only and was not
committed or modified by this audit. Case counts and origin hashes are from the current checked-out
`test-trust/audit-rest` at commit `70475315`.

