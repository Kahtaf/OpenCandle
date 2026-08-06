# Tasks — symbol-detail-redesign

Implementation notes for the delegated agents: TDD throughout — failing test first, then
implement. All decisions are FINAL in `design.md` (D1–D8); if the repo contradicts the
design, STOP and report the contradiction instead of adapting. Proof battery for handoff:
`npm run gates`. Reference images: `tmp/screenshots/08-symbol-detail/` (tailnet index).
Copy rules: zero em dashes, no provider names in UI, copy pinned by tests. Both surfaces
must be verified live (1440px and 390px), including a crypto and an FX symbol.

## 1. View-model derivations (pure functions, fixture-driven)

- [x] 1.1 `symbol-view-model` horizon returns: 5D/1W, 1M, YTD, 1Y, from-52w-high from
      history bars; omit-when-insufficient semantics; unit tests over fixture histories
      (full year, partial year, sparse, empty).
      2026-08-05: `deriveHorizonReturns` in `gui/web/src/features/symbol/symbol-view-model.js`.
      One `week` key labelled 5D or 1W by the descriptor. Coverage tolerance is a fifth of
      each horizon's own window capped at 7 days, so a real 1Y fetch counts as a year while
      a 3-day history never passes as a week. YTD needs a bar in the previous calendar year
      with no tolerance. Intraday bar series are refused outright.
- [x] 1.2 Volume vs 30-day average derivation and "N.NM · N.Nx avg" formatting via
      `financial-format.js`; tests for zero/missing-volume instruments.
      2026-08-05: `deriveVolumeContext` / `formatVolumeContext`. Renders "12.4M · 0.8× avg"
      with the `×` the alert vocabulary already uses. Average excludes the current session
      and needs 30 prior daily bars; an instrument reporting no volume returns null.
- [x] 1.3 Key levels: 52w high/low, 20/50-day MA, signed % distance; per-level
      computability rules; tests.
      2026-08-05: `deriveKeyLevels`. Distance uses the alert sheet's own convention
      (`level / price - 1`). The 52-week rows need a covered 52-week window; the averages
      need 20 and 50 daily bars.
- [x] 1.4 Trend summary: price vs 20/50/200-day MA labels + single sentence including the
      mixed-signals and partial-history variants; sentence copy pinned by tests.
      2026-08-05: `deriveTrendSummary`. Sentences pinned in
      `tests/unit/gui-web/symbol-view-model.test.ts`, including an em-dash assertion.

## 2. Asset-type descriptor

- [x] 2.1 Descriptor module keyed stock/etf/crypto/fx/index/commodity/unknown: stat
      vocabulary, section list, labels, availability notes. Resolution from instrument
      metadata with `unknown` fallback; delete the `^`/`-USD` heuristic. Tests cover each
      type plus a misclassification regression (FX pair, index, non-USD crypto pair).
      2026-08-05: `gui/web/src/features/symbol/asset-descriptor.js`. Resolution order is
      the exactly matching instrument-search candidate's provider quote type, then the
      saved instrument record's asset type, then a populated company profile, then
      `unknown`. The shared candidate `assetType` is deliberately not used: it collapses
      currency pairs into `equity`. Position, alerts and watchlist membership stay in every
      descriptor so saved data is never hidden.
      DEVIATION / HANDOFF: `isNonEquitySymbol` is NOT deleted. `SymbolPage.jsx` is still its
      only consumer and section 3 owns that file. The descriptor replaces it; the section-3
      agent removes the last consumer and then the export.
- [x] 2.2 Wire `use-symbol-data` to expose descriptor + derived view model; ensure hosted
      transport supplies the same metadata fields (verify, do not fork).
      2026-08-05: `useSymbolData` now also reads a fixed `1Y` daily history for the
      derivations and the shared instrument search for the type, and returns `descriptor`,
      `viewModel`, `derivedHistory`, `viewModelLoading`, `assetTypeLoading` and
      `instrument`. Existing returned fields are unchanged, and `loading` deliberately does
      not wait on the derived stats. Parity verified, not forked: both
      `gui/server/market-state-api.ts` (`searchInstrumentCandidates`) and
      `gui/hosted/runtime/hosted-market-data-api.ts` (`searchHostedInstrumentCandidates`)
      return `searchYahooInstruments` candidates carrying `quoteType`, and both history
      routes return the same `{ time, open, high, low, close, volume }` bars. When the
      hosted relay has not negotiated Yahoo, search throws and the descriptor degrades to
      `unknown` instead of guessing.

## 3. Page recomposition

- [x] 3.1 Rebuild `SymbolPage` on `DetailRailLayout` per D1; remove the 1120px cap; mobile
      stacking order per spec; skeletons shaped per element with reduced-motion behavior.
      2026-08-05: `DetailRailLayout` hides its rail slot below `xl`, and the proposal keeps
      that primitive unchanged, so the rail cards are rendered a second time inside the
      primary column in `xl:hidden` containers to produce the stacked order. Exactly one
      copy is ever displayed, so assistive technology and the a11y tree see each card once;
      any DOM query for a rail card must filter for the visible copy. The page now uses the
      same `max-w-[1240px]` canvas as the other market pages rather than no cap at all.
      Skeletons come from the shared `Skeleton`, which already carries
      `motion-reduce:animate-none`.
      2026-08-05: `vercel-react-best-practices` and `impeccable` passes ran after
      implementation. Addressed: the chart series is memoized so a quote poll no longer
      reloads it and refits its time scale; the 52-week range is stated once, in key levels,
      instead of contradicting the provider figures the profile card used to print; key
      levels names its columns so its distance is not read as disagreeing with the trend
      card, and both share one number gutter; the hero placeholder keeps the real hero's
      panel header and the trend card reserves its space, so nothing shifts as data lands;
      the stat strip is a grid at every width; a declared section whose data is unavailable
      says so instead of leaving a gap; a page-level failure is stated above the cards; the
      position card leads with market value, states its share of a single portfolio only,
      and keeps unknown valuations and exclusions explicit; read-only copy is one sentence
      everywhere. Not addressed, with reasons: the key-levels and trend distance conventions
      differ because 1.3 and 1.4 fixed them (mitigated with column names rather than by
      changing settled view models); merging those two cards would contradict D4; the
      not-found heuristic, the `value !== 0` key-stat filter, the add-to-watchlist disabled
      state and the chart's own attribution are pre-existing and outside this change; the
      `fieldset` grouping wrapper is kept because the repo's lint rule steers `role="group"`
      back to `fieldset`.
- [x] 3.2 Hero + stat strip component with descriptor vocabulary; extended-hours chip and
      quote flash preserved.
      2026-08-05: `SymbolHero` in `symbol-sections.jsx`. The strip is built from
      `descriptor.stats` in order, reading `viewModel.horizonReturns`, `dayRange` and
      `volumeLabel`; a key with no value is skipped. The heading meta line is
      `TICKER · type · exchange`, and a descriptor with `continuousTrading` shows its own
      session label instead of a market state it does not have.
- [x] 3.3 Key levels card with per-row Create alert prefill into the existing alert sheet
      (threshold + symbol; sheet handles currency and distance hint).
      2026-08-05: `levelAlertHref` in `symbol-actions.js` writes
      `/alerts?alertSymbol=SYM&alertThreshold=LEVEL` using the sheet's own
      `alertThresholdPrefill`, so a sub-cent level keeps its precision. New `alertThreshold`
      search param: `router.jsx` -> `App.jsx` -> `MarketStatePage` (validated by
      `alertThresholdFromLink`, which drops anything the sheet could not save) ->
      `AlertCreateForm` -> `initialAlertDraft`. A level handed over this way is not recorded
      as a quote prefill, so the quote arriving moments later leaves it alone.
- [x] 3.4 Trend summary card; position/alerts/membership rail cards reusing market-state
      formatting; not-held single-line state.
      2026-08-05: `TrendCard` plus the existing position/alerts/membership cards. Not held
      now reads "SYM is not held." on one line.
- [x] 3.5 Action chips: prefill-only into composer/alert sheet; follower degradation and
      read-only band preserved.
      2026-08-05: chips call `fillComposer`, reusing the catalog's `fillComposer` in
      `App.jsx` behind `prefillComposerFromPage`, which opens chat first because the symbol
      page has no composer of its own. `startChatRun` is no longer passed to the page, so no
      chip can send. Per D6 all three chip examples are chat prompts, so the alert-sheet
      prefill is the key-levels row action from 3.3 rather than a chip.

## 4. Verification and evidence

- [x] 4.1 Update `tests/unit/gui-web/symbol-page-render.test.ts` and add view-model test
      files; full `npm run gates` green.
      2026-08-05: PARTIAL. `symbol-page-render.test.ts` was rewritten for the new
      composition and `symbol-view-model.test.ts` / the descriptor tests landed with
      sections 1-2. `npm run gates` has NOT been run by the section-3 agent; the
      verification agent owns closing this box.
      2026-08-06: `npm run gates` green, `exit=0`, at 2db3669e (this change's tip; all
      live verification below ran against that same tree).
      That run is `typecheck` + `relay:typecheck` + `biome ci .` + `gui:hosted:build` +
      `vitest run` (326 files, 3539 passed, 1 skipped) + `relay:test` (76) +
      `test:agent-tools` (27); biome reported 0 errors with 8 pre-existing CSS
      descending-specificity warnings. No test was weakened or edited to get there.
      NOTE for whoever wrote the handoff brief: `gates` builds the hosted PWA but does not
      run the hosted browser smoke. `npm run test:gui:hosted` is a separate CI step
      (`.github/workflows/ci.yml`), and it needs real model keys, StackBlitz WebContainer
      boot and the production relay, so it was deliberately not run from this machine. See
      the hosted note under 4.3 for what was proved instead.
- [x] 4.2 Screenshot harness phases for the new layout (desktop + mobile).
      2026-08-05: `29-symbol-detail-equity`, `30-symbol-detail-scrolled` and
      `31-symbol-detail-crypto` in `tests/screenshots/capture.ts`. A capture may now declare
      a `path` and a `prepare` hook, because the symbol page reads quote, profile, history
      and instrument type over the private HTTP API that the WebSocket mock does not cover.
      The scrolled phase scrolls the app's own container instead of using `fullPage`, which
      cannot see past the shell's scroll region. Captured at 1440px and 390px into
      `tests/screenshots/out/symbol-detail-redesign/`.
- [x] 4.3 Live browser click-through both surfaces at 1440px/390px: equity, crypto, FX;
      prove section omission, alert prefill, chip prefill, follower read-only.
      2026-08-06: driven with Playwright against a real GUI server on an isolated port and
      an isolated `HOME`, with live keyless Yahoo data and no model key configured. Scripts
      and screenshots are machine-local under `tmp/symbol-verify/` (`tmp/` is gitignored).
      LOCAL, 80/80 checks at 1440x900 and 390x844 (`verify-local.mjs`): every section
      visible exactly once at both widths (the doubled rail markup never shows twice);
      AAPL strip renders 5D/1M/YTD/1Y/from-52-week-high as signed percents plus day range
      and "44.3M · 0.7× avg"; key levels shows all four rows with signed distances under
      "Calculated from recent price action."; trend shows three rows and the mixed-signals
      sentence; key stats and about render; not-held is one line; chips render; at 1440 the
      rail (360px) sits right of a 760px primary column, at 390 the rail slot is hidden and
      the order is hero, chart, position, key levels, stats, about, trend, alerts,
      membership, analyze; `documentElement.scrollWidth <= innerWidth` at both widths and
      additionally at 768/1024/1279/1280/1281/1400 with no duplicated card at any of them.
      BTC-USD uses 1W and 24h range, says "Trades 24/7", omits key stats and about entirely
      and keeps position/alerts/membership. EURUSD=X resolves to the fx descriptor from
      instrument metadata, drops volume and fundamentals. First load renders
      `symbol-hero-skeleton`, `symbol-stats-strip-skeleton`, `symbol-chart-skeleton`,
      `symbol-stats-skeleton`, `symbol-levels-skeleton` and `symbol-trend-skeleton`, all
      carrying `motion-reduce:animate-none`. The after-hours chip rendered live on AAPL.
      ACTIONS, live: the 50-day row's create-alert opens `/alerts` with the sheet prefilled
      to AAPL and 309.65 and the preview reading "Price crosses above $309.65"; saving from
      that sheet puts the alert on the symbol page's Alerts card ("Alerts 1 ... Armed").
      A seeded lot renders "Market value 10 shares @ $180.50 $3,110.00", "+$1,305.00
      (+72.3%)", "Share of portfolio 100.0%", identical at 390px, and Add to watchlist
      disables once the symbol is a member. The Options chain chip fills the composer with
      "Show options chain for AAPL" and focuses `TEXTAREA#chat-composer` with no run started.
      FOLLOWER, 6/6 (`verify-follower.mjs`): read-only band plus disabled create-alert,
      chips, Create alert and Add to watchlist, each with "Available in the writer window.",
      while the data sections still render. DEVIATION: two local GUI processes each create
      their own Pi session and each take that session's writer lock, so a second process
      cannot be made a follower from outside (tried: second and third servers on the same
      `HOME` both booted as writer, and selecting the first server's session in the second
      server's browser does not move the server's session). What a follower window actually
      differs by is the boot payload, so the `role`/`supportsSessionActions` fields were
      rewritten on the socket and the app's own follower path then ran for real in the
      browser. SSR coverage of the same states already exists in
      `tests/unit/gui-web/symbol-page-render.test.ts`.
      HOSTED, 24/24 (`verify-hosted.mjs`): `npm run gui:hosted:build` green, served with
      `vite preview` over `gui/hosted/dist` the same way `gui/hosted/tests/hosted-pwa.e2e.mjs`
      serves it, AAPL and BTC-USD at both widths. With no relay negotiated the page states
      "Instrument quotes requires the audited provider relay, which is unavailable or
      incompatible." and "Further detail is not available for this instrument.", renders
      quote, chart, position, alerts and membership, and omits key stats, about, key levels
      and trend entirely rather than rendering them broken or empty. No uncaught page
      errors, no horizontal overflow at 390px. DEVIATION: same-data hosted parity was not
      re-measured live, because hosted market data only reaches the page through the
      WebContainer runtime and the production relay (model keys plus Turnstile), which this
      run deliberately did not touch. Parity rests on `gui/hosted/src/main.jsx` mounting
      `gui/web/src/router.jsx`, so both surfaces render the same `SymbolPage` module, plus
      the shared render tests.
      OBSERVED, not defects of this change: a bogus ticker reaches the page as quote reason
      "HTTP 404 Not Found" and a transient Yahoo crumb 429 on the profile, neither of which
      matches the pre-existing `INVALID_SYMBOL_REASON` heuristic, so the page falls through
      to the unknown descriptor. That is honest and satisfies the "unknown type stays
      minimal and honest" scenario, and the not-found panel itself still renders when the
      reasons do match (proved by stubbing both endpoints). `/favicon.ico` 404s on every
      route of the app, unrelated to this page. FX prices print at
      `financial-format.js`'s fixed two decimals ("$1.16"), which is the rounding rule D3
      pins and what the watchlist already does.
- [x] 4.4 Autoreview (`npm run review:pr` range mode over the change commits); fix findings.
      2026-08-06: VERDICT "patch is correct" (0.86), zero findings, over
      `8120b6e5..a0e07895`. Five passes with the repo autoreview
      (`--mode range --base <sha> --head <sha> --prompt-file
      .agents/skills/autoreview/references/opencandle-review.md`, codex engine, React
      Doctor scoped to the ten changed React files). Passing resolved SHAs matters: the
      React Doctor integration rejects a `^`-suffixed base ref. Seven findings in total,
      six fixed and one recorded below. Each fix was written test first, and `npm run
      gates` was rerun green (`exit=0`) after every one.
      PASS 1 (`..53aa33fe`), 2 findings, "patch is incorrect".
      P1 stale history, FIXED in `a7b40f57`: the horizon returns, the volume multiple,
      the key levels and the trend summary all read one daily series that the history
      endpoint can serve `stale: true` from a retained copy, and the page printed them
      with no sign of it under "Calculated from recent price action.". The view model now
      carries that flag and the date the series stops at, and the three derived surfaces
      each state it. The figures stay visible: a degraded provider is disclosed, not
      blanked. Live at 1440 and 390 with the 1Y response rewritten to stale: exactly
      three visible notes, all reading "Price history as of Aug 1", key levels still
      populated, no page errors, and nothing shown when the history is current
      (`tmp/symbol-verify/verify-stale-history.mjs`, 9/9).
      P2 React Doctor `rerender-memo-with-default-value` on `levels = []`, FIXED in the
      same commit with a module-level constant. React Doctor now reports one new warning
      for the whole range, the `jsx-no-jsx-as-prop` on the rail slot that 3.1 accepted in
      a code comment for the same reason the watchlist accepts it.
      PASS 2 (`..a7b40f57`), 3 findings, "patch is incorrect".
      P2 linked alert level, FIXED in `36395c9c`: a level handed over by a key-levels
      link was deliberately not recorded as a quote prefill so the arriving quote would
      leave it alone, which also left it behind when the reader replaced the symbol in
      the sheet. One instrument's 50-day average could be saved as a rule on another,
      contradicting the shipped "a prefilled level leaves when the symbol it was read
      from is replaced" rule. The level now travels with its symbol and leaves with it.
      Live: the sheet still opens on 309.65 from the link and empties when the symbol is
      replaced (`tmp/symbol-verify/verify-linked-level-clears.mjs`, 2/2), and the
      prefill-to-saved-alert flow still passes (`verify-alert-save.mjs`).
      P2 52-week high excluded the live price, FIXED in `36395c9c`: the hero strip
      counted the current price in its 52-week window and the key levels card did not, so
      the strip could report a new high at zero percent while the card offered an alert at
      a level the price had already passed.
      P2 `baselineClose` on a discontinuous series, NOT FIXED, recorded as a follow-up.
      The coverage check compares the target with the earliest bar only, so a daily series
      with a months-long hole could hand a far older close to the 5D or 1M horizon. The
      guard the finding asks for cannot be added at the horizon's own tolerance: the week
      horizon tolerates 1.4 days, and a Sunday target legitimately resolves to the
      previous Friday, so the naive guard would drop 5D on ordinary weeks. Discontinuous
      history equally corrupts the moving averages, so rejecting it belongs in one place
      with its own fixtures rather than in a closeout patch, and 1.1's tolerance rules are
      settled. No provider in the fallback chain is known to return such a payload.
      PASS 3 (`..36395c9c`), 1 finding, "patch is incorrect".
      P1 session high and low, FIXED in `f3e88397`: with the live price inside the
      52-week window, the session's own range had to join it too, because the daily
      history is fetched separately and can still end at the previous session. A high set
      today and given back since now reads as the high it was.
      PASS 4 (`..f3e88397`), 2 findings, "patch is incorrect".
      P1 saved-state quote field names, FIXED in `a0e07895`: for a saved symbol the page
      prefers the market-state snapshot, which names the session bounds `dayHigh` and
      `dayLow` (`gui/shared/market-quote-snapshot.ts`), so the day range stat vanished for
      exactly the symbols a reader has saved and the 52-week window lost today's extreme
      with it. The view model reads either shape.
      P1 assumed USD, FIXED in `a0e07895`: the page denominated everything in dollars
      whenever the quote carried no currency, including levels derived from history that
      outlives a failed quote, which contradicts D3's "currency follows the quote's own
      currency". An unknown currency now prints the number alone through the repo's own
      `formatPrice`, and the hero drops the currency label rather than guessing one.
      PASS 5 (`..a0e07895`): clean, both review batches reporting no findings.
      DETERMINISTIC ADVISORIES: the helper reported no diff signals in any pass. Confirmed
      by hand: the `[Unreleased]` CHANGELOG entry exists and gained a sentence for the
      stale-history disclosure, the range touches no SQLite schema or migration, and it
      changes no router or prompt fixtures (only `gui/web/src`, `tests/unit/gui-web`,
      `tests/screenshots`, `openspec` and `CHANGELOG.md`).
      NOTE: `a5185a15` (cashtag analyze prompts) landed on the branch from another agent
      while this review was running and is inside the final clean pass. The machine-local
      `tmp/symbol-verify/verify-local.mjs` still expects the pre-cashtag chip text, so its
      chip assertion now reads as a failure against that older expectation; the other 79
      checks pass. Its alert count assertion also assumes a home with no saved alerts.
- [x] 4.5 CHANGELOG entry; `graphify update .`.
      2026-08-05: sections 1 and 2 landed with no CHANGELOG entry on purpose. The view
      models and the descriptor change nothing a reader can see until section 3 renders
      them, so the one user-facing entry belongs to the page recomposition.
      2026-08-05: one `[Unreleased]` -> `Changed` entry covers the whole redesign, and
      `graphify update .` was run after the code changes.
