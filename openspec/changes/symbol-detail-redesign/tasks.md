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

- [ ] 4.1 Update `tests/unit/gui-web/symbol-page-render.test.ts` and add view-model test
      files; full `npm run gates` green.
      2026-08-05: PARTIAL. `symbol-page-render.test.ts` was rewritten for the new
      composition and `symbol-view-model.test.ts` / the descriptor tests landed with
      sections 1-2. `npm run gates` has NOT been run by the section-3 agent; the
      verification agent owns closing this box.
- [x] 4.2 Screenshot harness phases for the new layout (desktop + mobile).
      2026-08-05: `29-symbol-detail-equity`, `30-symbol-detail-scrolled` and
      `31-symbol-detail-crypto` in `tests/screenshots/capture.ts`. A capture may now declare
      a `path` and a `prepare` hook, because the symbol page reads quote, profile, history
      and instrument type over the private HTTP API that the WebSocket mock does not cover.
      The scrolled phase scrolls the app's own container instead of using `fullPage`, which
      cannot see past the shell's scroll region. Captured at 1440px and 390px into
      `tests/screenshots/out/symbol-detail-redesign/`.
- [ ] 4.3 Live browser click-through both surfaces at 1440px/390px: equity, crypto, FX;
      prove section omission, alert prefill, chip prefill, follower read-only.
- [ ] 4.4 Autoreview (`npm run review:pr` range mode over the change commits); fix findings.
- [x] 4.5 CHANGELOG entry; `graphify update .`.
      2026-08-05: sections 1 and 2 landed with no CHANGELOG entry on purpose. The view
      models and the descriptor change nothing a reader can see until section 3 renders
      them, so the one user-facing entry belongs to the page recomposition.
      2026-08-05: one `[Unreleased]` -> `Changed` entry covers the whole redesign, and
      `graphify update .` was run after the code changes.
