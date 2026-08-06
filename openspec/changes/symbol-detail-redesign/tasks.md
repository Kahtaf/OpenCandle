# Tasks — symbol-detail-redesign

Implementation notes for the delegated agents: TDD throughout — failing test first, then
implement. All decisions are FINAL in `design.md` (D1–D8); if the repo contradicts the
design, STOP and report the contradiction instead of adapting. Proof battery for handoff:
`npm run gates`. Reference images: `tmp/screenshots/08-symbol-detail/` (tailnet index).
Copy rules: zero em dashes, no provider names in UI, copy pinned by tests. Both surfaces
must be verified live (1440px and 390px), including a crypto and an FX symbol.

## 1. View-model derivations (pure functions, fixture-driven)

- [ ] 1.1 `symbol-view-model` horizon returns: 5D/1W, 1M, YTD, 1Y, from-52w-high from
      history bars; omit-when-insufficient semantics; unit tests over fixture histories
      (full year, partial year, sparse, empty).
- [ ] 1.2 Volume vs 30-day average derivation and "N.NM · N.Nx avg" formatting via
      `financial-format.js`; tests for zero/missing-volume instruments.
- [ ] 1.3 Key levels: 52w high/low, 20/50-day MA, signed % distance; per-level
      computability rules; tests.
- [ ] 1.4 Trend summary: price vs 20/50/200-day MA labels + single sentence including the
      mixed-signals and partial-history variants; sentence copy pinned by tests.

## 2. Asset-type descriptor

- [ ] 2.1 Descriptor module keyed stock/etf/crypto/fx/index/commodity/unknown: stat
      vocabulary, section list, labels, availability notes. Resolution from instrument
      metadata with `unknown` fallback; delete the `^`/`-USD` heuristic. Tests cover each
      type plus a misclassification regression (FX pair, index, non-USD crypto pair).
- [ ] 2.2 Wire `use-symbol-data` to expose descriptor + derived view model; ensure hosted
      transport supplies the same metadata fields (verify, do not fork).

## 3. Page recomposition

- [ ] 3.1 Rebuild `SymbolPage` on `DetailRailLayout` per D1; remove the 1120px cap; mobile
      stacking order per spec; skeletons shaped per element with reduced-motion behavior.
- [ ] 3.2 Hero + stat strip component with descriptor vocabulary; extended-hours chip and
      quote flash preserved.
- [ ] 3.3 Key levels card with per-row Create alert prefill into the existing alert sheet
      (threshold + symbol; sheet handles currency and distance hint).
- [ ] 3.4 Trend summary card; position/alerts/membership rail cards reusing market-state
      formatting; not-held single-line state.
- [ ] 3.5 Action chips: prefill-only into composer/alert sheet; follower degradation and
      read-only band preserved.

## 4. Verification and evidence

- [ ] 4.1 Update `tests/unit/gui-web/symbol-page-render.test.ts` and add view-model test
      files; full `npm run gates` green.
- [ ] 4.2 Screenshot harness phases for the new layout (desktop + mobile).
- [ ] 4.3 Live browser click-through both surfaces at 1440px/390px: equity, crypto, FX;
      prove section omission, alert prefill, chip prefill, follower read-only.
- [ ] 4.4 Autoreview (`npm run review:pr` range mode over the change commits); fix findings.
- [ ] 4.5 CHANGELOG entry; `graphify update .`.
