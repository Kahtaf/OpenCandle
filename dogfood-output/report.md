# Dogfood Report — OpenCandle market-state pages
Date: 2026-06-12 · Target: http://127.0.0.1:14567 (watchlists, portfolios, alerts, reports, predictions) · Viewports: 390px + 1380px

## Summary
Total issues: 12 — high: 3, medium: 7, low: 2
Console: no errors or warnings across all five pages.
Verified working: background quote polling, watchlist row selection + inspector, autocomplete (mobile), alert Pause/Resume round-trip, report generation, notifications, empty states, focus return on panel close.
Note: repro videos unavailable this session (agent-browser daemon screenshot fault); evidence is step screenshots via Chrome DevTools.

### ISSUE-001: {Short title}

| Field | Value |
|-------|-------|
| **Severity** | critical / high / medium / low |
| **Category** | visual / functional / ux / content / performance / console / accessibility |
| **URL** | {page URL where issue was found} |
| **Repro Video** | {path to video, or N/A for static issues} |

**Description**

{What is wrong, what was expected, and what actually happened.}

**Repro Steps**

<!-- Each step has a screenshot. A reader should be able to follow along visually. -->

1. Navigate to {URL}
   ![Step 1](screenshots/issue-001-step-1.png)

2. {Action -- e.g., click "Settings" in the sidebar}
   ![Step 2](screenshots/issue-001-step-2.png)

3. {Action -- e.g., type "test" in the search field and press Enter}
   ![Step 3](screenshots/issue-001-step-3.png)

4. **Observe:** {what goes wrong -- e.g., the page shows a blank white screen instead of search results}
   ![Result](screenshots/issue-001-result.png)

---

### ISSUE-001: Mobile page overflows horizontally on watchlist (severity: high)
- Page: /watchlists @ 390px
- The master-detail grid (`.split` in WatchlistPage) only sets `grid-cols` at xl; below xl the implicit grid column's min-width is `auto`, so the 560px-min table forces the whole document wider than the viewport. Panel search input and Signals column are clipped; the page pans sideways.
- Evidence: screenshots/mobile-watchlist-initial.png (right edge clipping)
- Repro: open /watchlists at 390px width. Repro Video: N/A (visible on load)
- Expected: no document-level horizontal scroll; the table scrolls inside its own card.

### ISSUE-002: Add/Edit/Create panels render below all page content on mobile (severity: high)
- Page: any market-state page @ mobile, e.g. /watchlists → "Add ticker"
- The ContextPanel occupies a grid column that stacks LAST on small screens. scrollIntoView jumps the user to the bottom of the document; the list/inspector context disappears and closing scrolls back up. Disorienting; forms should present as a sheet/overlay on small screens (the app already ships a Sheet primitive in components/ui/sheet.jsx).
- Evidence: screenshots/mobile-add-ticker-panel.png

### ISSUE-003: Duplicate heading in Add Ticker panel (severity: low)
- Panel chrome says "Add Ticker", form repeats "Add ticker" directly underneath.
- Evidence: screenshots/mobile-add-ticker-panel.png

### ISSUE-004: Thesis/Notes textareas render without borders (severity: medium)
- In the Add/Edit Ticker form, Textarea fields show only floating placeholder text with no field boundary; users cannot tell they are inputs (inputs above them are bordered).
- Evidence: screenshots/mobile-add-ticker-panel.png

### ISSUE-005: Form fields rely on placeholder-as-label (severity: medium)
- Target/Stop/Thesis/Notes/Tags have aria-labels but no visible labels; once filled, the meaning of each value is invisible. Affects Add/Edit Ticker, Holding, Alert, Prediction forms.
- Evidence: screenshots/mobile-add-ticker-panel.png

### ISSUE-006: Internal tool vocabulary in Create Alert copy (severity: medium)
- "Rule builder uses existing manage_alerts inputs and existing alert lifecycle semantics." — tool name and implementation language shown to the user.
- Evidence: screenshots/mobile-create-alert.png

### ISSUE-007: Create Alert period/cooldown fields show bare numbers with no labels (severity: medium)
- Defaults "14" and "3600" render with no visible label; nothing explains they are period (days) and cooldown (seconds). The period input stays visible-but-grayed for price conditions where it does not apply.
- Evidence: screenshots/mobile-create-alert.png

### ISSUE-008: Mobile tables hide key columns behind undiscoverable sideways scroll (severity: medium)
- Watchlist hides Signals; portfolio hides Total return/Weight; predictions hides Expires and the Cancel action (the progress "%" digits clip at the viewport edge). No scroll affordance is shown. A mobile-first layout should fold secondary data into the row (two-line cells) instead of requiring horizontal panning to reach actions.
- Evidence: screenshots/mobile-predictions.png, mobile-portfolio.png, mobile-watchlist-initial.png

### ISSUE-009: Record prediction uses free-text direction and unexplained conviction scale (severity: medium)
- Direction is a text input with placeholder "bullish | bearish | neutral" (typo → tool arg failure); conviction is a bare number with no visible 0-1 scale hint; Days has no unit context. Should be a select + labeled inputs.
- Evidence: screenshots/mobile-record-prediction-bottom.png

### ISSUE-010: Save buttons use a target icon and gray disabled state with no hint (severity: low)
- The form Save button shows a concentric-circles icon (lucide Target) that reads as a recording symbol; disabled state gives no cue that selecting a symbol is the missing step (helper text exists only above the fold).
- Evidence: screenshots/mobile-record-prediction-bottom.png

### ISSUE-011: Edit schedule offers only a hardcoded 08:00 (severity: medium)
- The Configure Report panel has a single "Configure 08:00" action — no time or timezone choice; copy includes implementation framing ("This does not add hosted scheduling"). Needs a time input with the browser timezone shown.
- Evidence: code path PanelContent report-configure; panel renders one button.

### ISSUE-012: Destructive actions execute immediately with no confirmation or undo (severity: high)
- Watchlist inspector "Remove" deleted MSFT (and its saved thesis/notes/tags) on a single click; verified live — no confirm dialog appeared (dialogShown=false) and the row was gone after the mutation ack. Same wiring applies to portfolio lot "Remove" and prediction "Cancel". Saved research context is destroyed by one mis-tap, on mobile especially.
- Repro: /watchlists → select MSFT → click Remove once. Row gone.
- Expected: confirm step (dialog/popover) or an undo toast.

## Fix pass (same session)
- ISSUE-001 fixed: explicit grid-cols-1 + min-w-0 on the watchlist split; doc overflow verified gone (scrollWidth == viewport).
- ISSUE-002 fixed: ContextPanel renders as a bottom sheet with scrim below xl (scrim click closes; sticky sheet header); in-flow sticky column at xl unchanged.
- ISSUE-003 fixed: duplicate form heading removed.
- ISSUE-004 fixed: form textareas now bordered (border-border bg-card at call sites; chat composer untouched).
- ISSUE-005 fixed: visible labels on all form fields (ticker, holding, alert, prediction, schedule); aria-labels retained.
- ISSUE-006 fixed: Create Alert copy now plain English.
- ISSUE-007 fixed: labeled "Period (days)" / "Cooldown between triggers (seconds)"; period only renders for SMA/RSI/volume conditions.
- ISSUE-008 fixed: mobile-first column folding — watchlist (Symbol/Last/Today), portfolio (Symbol/Value/Today + lot details inline with mobile actions), predictions (Call/Progress/Cancel); secondary data on sm/md breakpoints.
- ISSUE-009 fixed: direction is a select (bullish/bearish/neutral); conviction labeled "(0–1)"; days labeled "Days until expiry".
- ISSUE-010 fixed: Save buttons drop the target icon; disabled state reads "Select a ticker to save".
- ISSUE-011 fixed: Edit schedule has a time input (browser timezone shown); plain copy.
- ISSUE-012 fixed: ConfirmButton two-step inline confirm on watchlist Remove, lot Remove, prediction Cancel (verified armed state does not delete; 4s auto-reset).
- Re-verified: no doc overflow at 390px on all five pages, sheet open/scrim close, lot expand + arm-confirm on mobile, 1932 tests + typecheck green.

## Chat ↔ market-state dogfood (same session)

### ISSUE-013: Saved portfolio/watchlist context never reached rules-mode chat turns (severity: high) — FIXED
- Live repro: seeded a 150-share RKLB lot, asked "Thoughts on the SpaceX IPO today? Worth getting exposure?" in GUI chat. The answer analyzed the IPO in depth but never connected to RKLB or the ASTS watchlist thesis. Session JSONL confirmed no "Saved Market State" context and no router/fallback entries for the turn.
- Root causes (three layers):
  1. In default rules mode, prompts that match no workflow fall off the input handler with no pending context, and `before_agent_start` always passes `workflowType=undefined` — so `shouldIncludeSavedMarketStateContext` could never pass for these turns.
  2. The prompt classifies `unclassified` (SpaceX is not a ticker; "IPO" is acronym-dropped), so even a `general_finance_qa`-only fix would have missed it.
  3. The context's bridging instruction was soft ("when relevant"), which the model ignored even with RKLB appearing in its own web-search results.
- Fixes (TDD, 5 new tests):
  - Gate accepts a pending fallback context as a finance signal (`session-coordinator.ts`).
  - New deterministic `hasFinanceSignals()` lexicon (`classify-intent.ts`); rules handler records a fallback run + stashes a fallback context for finance-shaped unmatched turns, with an `opencandle-fallback-context` observability entry. Non-finance prompts (poems, weather) stay excluded — verified by test.
  - Saved-state context now instructs a "Your positions" closing section when a sector/event/competitor touches a saved symbol (prompt-debt guard green).
- Live verification: rerun of the same prompt produced a "Your Positions Impact" section covering RKLB (150 @ $18.40, cost basis $2,760.00) and ASTS (200 @ $51.20) with per-position competitive analysis (Starlink D2C threat vs ASTS, launch-pricing pressure on Neutron). Evidence: screenshots/chat-positions-impact.png; session 019ebd4b-e714 contains the opencandle-fallback-context entry.

## TUI harness experiment

Seven live harness runs against the seeded `~/.opencandle/state.db` (gemini-2.5-flash; full log in `dogfood-output/chat-harness-report.md`). No run raised an `ask_user` question.

| Run | Prompt class | Verdict |
|-----|--------------|---------|
| P1 | Watchlist write (PLTR $35 + thesis) | PASS |
| P2 | Portfolio read with live P&L | PASS |
| P3 | Event→positions bridge (China chip ban) | PASS |
| P4 | Alert create + immediate check | PASS |
| P5 | Prediction record + scoring | PASS* (2 defects) |
| P6 | FED/CPI acronym handling | PASS |
| P7 | Non-finance control (haiku) | PASS |

Key findings:

- **HARNESS-001 (high):** `tests/harness/cli.ts run` unconditionally sandboxes `OPENCANDLE_HOME` into a temp dir and deletes it on exit — the documented manual-harness flow can never see or persist real durable state (first P1 attempt "succeeded" into a throwaway DB). Experiment used a wrapper (`dogfood-output/cli-real-home.ts`) pointing at the real home with cleanup removed. Fix: respect pre-set `OPENCANDLE_HOME` or add `--home`.
- **Prediction conviction scale (medium):** "conviction 0.7" was stored as `7` next to seeded 0–1 rows; `track_prediction` does no range normalization, so weighted hit rate is skewed 10x.
- **Prediction target-hit (medium):** scoring left ASTS (target $80, current $82.41) `open` with no target-hit mention; resolution appears expiry-only.
- **Alert check opacity (low):** "checked now" output lists "NVDA: checked / NVDA: seeded" without observed price vs threshold or the TradingView delay caveat.
- Positives: P3 produced the required "Your positions" closing section with exact DB numbers (NVDA 80 @ $117.80); P6 emitted `opencandle-symbol-dropped` for both FED and CPI and grounded the answer in the real 6-symbol watchlist; P7 showed no Saved Market State leakage and no `opencandle-fallback-context` entry.

## Harness-experiment fix pass (same session)
- HARNESS-001 fixed: cli.ts respects pre-set OPENCANDLE_HOME; only self-created temp homes are deleted. Verified live (run against ~/.opencandle, DB intact afterward).
- Conviction scale fixed: GUI form/displays now use the tool's canonical 1–10 scale ("Conviction (1–10)", "7/10"); seed script corrected; 4 mis-scaled DB rows repaired (0.6–0.8 → 6–8).
- Target-hit fixed: prediction checks flag "target hit: $X reached before expiry; resolve or let it ride" while keeping the call open (consistent with GUI badge). Verified live: ASTS at $82.41 vs $80 target.
- Alert check output fixed: lines now read e.g. "NVDA: checked — observed 205.19 vs above 220.00 (condition false) [tradingview, ~15m delayed]". Verified live across price/RSI rules and both providers.
- Suite: 1938 tests passing, typecheck clean.

## Competitive GUI session (eval-harness audit + 5 prompts)

### ISSUE-014: Workflow turns replace the user's message with the internal prompt expansion (severity: medium, pre-existing)
- Sending "I own 200 ASTS shares... covered calls?" renders the full multi-paragraph workflow prompt ("Current date... Screen and rank options contracts... Assumptions (reproduce this block exactly)...") as the user bubble and the sidebar session title. Users see internal instructions they never wrote.
- Evidence: screenshots/gui-p2-coveredcall-table.png (left transcript), sidebar titles.
- Suggested layer: GUI transcript/session-title rendering should preserve the original user text for display while the transformed prompt drives the agent.

### Eval harness audit (verdict: good core, three gaps fixed)
Strengths confirmed: natural-prompt rules, anti-bias generation, anti-fabrication judge clause, judge sees tool calls + planning metadata, 3-attempt judge JSON repair (fence-slicing + comma/bracket repair), competitor answer cache keyed by prompt text, preflight with skipped-competitor accounting, layer-specific improvement taxonomy.
Gaps fixed (TDD, 4 new unit tests):
- HARNESS-002 (high): judge winner string was never validated; any typo/case variant was silently counted as a competitor win in summaries. parseComparisonJudgment now normalizes case and rejects winners outside the allowed set (triggering the existing retry loop).
- HARNESS-003 (medium): judge scores were unanchored (scale never defined) making cross-run score comparisons meaningless. Judge prompt now anchors 0-10 with rubric points.
- HARNESS-004 (high): the eval could never exercise the branch differentiator — eval homes were seeded with credentials only, never market state. New OPENCANDLE_COMPETITIVE_SEED_STATE=1 seeds a deterministic fixture (lots/watchlist/prediction), steers ~2 generated prompts to reference saved holdings, gives generic agents the same facts inline for fairness, and instructs the judge to verify both sides against the saved state. Report records seededState. Documented in docs/internal/competitive-benchmarking.md.
Smoke run (fixed cached prompt + seeded state): pipeline green end-to-end; judge produced a legitimate OpenCandle LOSS (oc=5 vs gemini=8) on ETF comparison due to holdings/risk provider unavailability — recorded in runs/2026-06-12T22-26-16 analysis as a future improvement loop (tool-capability/evidence layers).

### ISSUE-015: Workflow turns ignored saved market state (severity: high) — FIXED
- P2 ("I own 200 ASTS shares from way lower... covered calls?") dispatched the options workflow but priced the strategy with no cost basis even though the saved lot ($51.20) was on file: rules-mode workflow dispatches never carried workflowType into buildSystemPrompt, so the saved-state gate stayed closed on workflow turns.
- Fix (TDD): SessionCoordinator.getActiveWorkflowType() set on workflow start; before_agent_start passes it to buildSystemPrompt. Live rerun: the screen now ranks strikes "against your 200 shares at a cost basis of $51.20" with return-if-assigned framing.

### 5-prompt GUI validation (desktop + mobile, console clean on all)
- P1 single-asset (AAPL add/hold/trim): PASS — 9 tools, verdict anchored on saved 75-share lot with buy/trim zones; quote + company cards and sources strip render correctly (quote delta uses arrow glyph + magnitude).
- P2 covered calls (ASTS): PASS after ISSUE-015 fix — options workflow, Greeks table renders, per-contract language, assignment framing vs saved basis. Options-chain card with OI split renders.
- P3 macro/rates: PASS — FRED + web evidence; bond shift sized to the user's actual portfolio value.
- P4 AI-exposure theme: PASS — "Your Positions" section quantifies direct (NVDA), adjacent (AAPL/TSLA), and high-beta (ASTS+RKLB $31.8k) exposure from saved state; opencandle-fallback-context present.
- P5 portfolio risk review: PASS — track_portfolio (durable state tool) + analyze_correlation + analyze_risk across all 6 holdings; breakdown table renders on mobile without overflow.
- Open (not fixed this session): ISSUE-014 workflow prompt expansion shown as the user's message.

### ISSUE-014 follow-up — FIXED
- The extension now appends an `opencandle-user-input` marker with the typed text before every workflow transform (7 dispatch sites, rules + LLM modes); the static chat adapter renders the marker's original for the next user message, the live SSE adapter substitutes the original prompt on the first user message of a run, and new sessions are named by the user's words at prompt time.
- Live verification: "Compare MSFT and JPM for me side by side." renders as the user bubble during streaming AND after reload, and is the sidebar title; the only remaining expansion text on the page is in pre-fix sessions' stored titles. 1948 tests passing.

### LLM-summarized session titles — ADDED
- New `src/runtime/session-title.ts` (`generateSessionTitle`): strict 4-8 word title prompt from the first user text + first ~500 chars of the first assistant reply, sanitized output (quotes/markdown/newlines stripped, trailing punctuation dropped, capped ~60 chars at word boundary, empty or >12-word responses rejected → null).
- New `turn_end` handler in `src/pi/opencandle-extension.ts`: on the first final assistant turn, if the session name is still the placeholder (unset, raw first prompt, or the GUI's 77-char+"..." truncation), it titles via `pi.setSessionName`. Prefers the `opencandle-user-input` original over the expanded workflow prompt. Manual renames untouched; one attempt per session per process (flag reset on session_start); failures recorded as `opencandle-title-error` and the placeholder stays. Production completion comes from the same pi-ai router client path; tests inject `OpenCandleExtensionOptions.titleCompletion`.
- Tests: 9 new in tests/unit/runtime/session-title.test.ts, 6 new in tests/unit/pi/opencandle-extension.test.ts. Full suite 1963 passing; tsc clean.
- Live GUI: restarted server, ran a chat; session JSONL gained a second session_info — "Compare MSFT and JPM for me side by side." (placeholder) → "Side by Side Comparison of MSFT and JPM"; sidebar shows the summarized title (screenshots/llm-title-gui.png). Zero opencandle-title-error entries.
- Live TUI: tmux `npx tsx src/cli.ts`, /new session, prompt "what does a covered call actually do" → stored session_info "Understanding the Mechanics of Covered Calls" (screenshots/llm-title-tui.txt).

### Home composer session bug — FIXED
- Bug: sending from "/" (or right after New chat / a hard reload) could append the turn to the PREVIOUS active writer session. Root causes confirmed: (1) `/api/chat/run` took only `{prompt}` and always ran against the server's current session, so any stale client silently appended; (2) the home-reset effect is async and racy (send could fire before `POST /api/session/new` resolved); (3) on fresh page load at "/", entries haven't loaded so `hasSessionContent` is false and the reset effect is skipped entirely.
- Fix: home sends now ALWAYS await `newSession()` and run with `{prompt, sessionId}`; the server rejects mismatched runs with 409 `{error, code:"session_changed"}` (client retries once against another fresh session, then toasts). Route (`/sessions/:id`) sends carry the route session id as the guard. HTTP-fallback mode (no WS) keeps the old unguarded body, preserving the e2e contract.
- Latent bug found while wiring: `writeJson(res, body, 409)` in gui/server/server.ts ignored its third argument (signature had no status param; gui/server is outside tsconfig's `include: ["src/**/*"]` so tsc never flagged it). All GUI server "error" responses — follower-mode 409, prompt-required 400 — actually returned HTTP 200. Fixed by adding the status param.
- Live verification (chrome-devtools, fresh build): (a) back-nav to "/" with active session + immediate send → mango landed in a new JSONL, 0 hits in old session; (b) New chat + immediate send → kiwi in fresh session; (c) hard reload "/" + send at earliest enabled moment (5ms poll) → papaya in fresh session; route send appended to same file (guava); reopened old session send appended to it (lychee); workflow send from home ("quickly compare AAPL and MSFT") ran in a fresh session with the opencandle-user-input marker and was LLM-titled ("Comparing Apple and Micr..."). 1972 unit tests + tsc clean.

### NEW ISSUE — original-words substitution does not reach the browser transcript (pre-existing, not fixed here)
- Reproduction: open or reload `/sessions/<id>` of a workflow-dispatched turn → the user bubble shows the full prompt expansion ("Current date: ... Steps: ..."), not the typed words. `/api/session/events` (static adapter) DOES return the substituted text.
- Cause: ChatPanel renders raw `snapshot.entries` (`UserMessage content={message.content}`); no gui/web code handles the `opencandle-user-input` marker. The adapted `events` are stored in `useGuiConnection` state but consumed by no component. The ISSUE-014 fix (8f6d151) only touched server adapters, so the "after reload" claim in the earlier report entry was wrong — the substitution only ever displayed during live SSE streaming.
- Suggested fix: substitute marker originals when mapping entries in ChatPanel (or pre-process in routeSessionView), mirroring gui/server/chat-event-adapter.ts `isOriginalInputEntry`/`originalInputText`.

### NEW ISSUE follow-up — FIXED
- Fix: converged transcript rendering on `ChatEvent[]` instead of raw Pi `SessionEntry[]`. The GUI now routes persisted `snapshot.events` through `routeSessionView`, merges them with live SSE/optimistic events in `ChatPanel`, derives visible rows from `reduceChatEvents`, and groups tool runs from those event rows. The old `live-entries.js` fake-entry bridge was removed.
- Contract preservation: `custom_message` entries now travel as `custom.message` events so setup/custom badges survive the single render path; raw `entries` remain on snapshots for server/dashboard metadata but no longer drive chat transcript rendering.
- Live verification: sent `quickly compare AAPL and MSFT` from `/`, waited for the workflow run to finish, hard-reloaded `/sessions/019ebf22-021f-7a50-b382-8aa6ad4ee83e`; the visible transcript contained only `quickly compare AAPL and MSFT` for the user bubble, with no visible `Current date` / expansion text. The session JSONL includes the `opencandle-user-input` marker.
- Regression checks: non-workflow prompt `say only the word pineapple` showed the same user bubble live and after reload. Restored persisted tool session `Show options chain for AAPL` rendered a grouped `Market lookup` StepsCard from events and opened the desktop `Tool run timeline` drawer.
- Not fully exercised live: no pending ask-user session was available without fabricating state. `npm run test:gui:browser` reached the server but failed 8/18 on the second run: one live Fear & Greed card timeout, stale market-state expectations for removed/renamed UI, a mobile drawer pointer-events assertion, and mocked home-send cases that still need fresh-session-aware `/api/session/new` mocks. Unit/type/build gates passed separately.
