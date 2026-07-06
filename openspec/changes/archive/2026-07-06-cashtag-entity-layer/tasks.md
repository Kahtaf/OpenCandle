# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). No `src/routing/` changes. No new server quote-fetch paths. GUI code follows the existing `.jsx` + Radix + Tailwind conventions; React Doctor must stay clean on changed files.

## 1. Server known-symbols

- [x] 1.1 Failing unit test: `projectDashboard(entries, sessionId, savedSymbols?)` includes `knownSymbols` from (a) quote-activity watchlist projection, (b) seeded `opencandle-route-context` entries with `entities.symbols`, (c) the injected saved-symbols argument; normalized, deduped, capped 100. Plus the 30s saved-symbols memo unit test.
- [x] 1.2 Implement: the projector folds (a) and (b) and merges the injected (c) — it never reads SQLite; source saved symbols from `MarketStateService` behind a 30-second TTL memo; update all four `projectDashboard` call sites (design §2: `http-routes.ts` buildSnapshotPayload + buildSessionBootstrapPayload, `ws-hub.ts` ×2).

## 2. Composer autocomplete (TDD)

- [x] 2.1 Reuse `GET /api/instruments/search?q=` (`http-routes.ts` ~:212 → `searchInstrumentCandidates` in `market-state-api.ts`); do not add a new route.
- [x] 2.2 Failing pure-function unit tests for `detectCashtagFragment(text, caretIndex)` (start-of-text `$n`, mid-sentence, `$` inside a word does not trigger, caret mid-fragment) and accept-insertion (`$SYMBOL ` uppercase). Keyboard/Enter-guard behavior is browser-e2e-only (node test env; no jsdom).
- [x] 2.3 Implement `gui/web/src/features/chat/cashtag-autocomplete.jsx` (own `role="listbox"` element, NOT the local Popover primitive) + wire into `chat-composer.jsx` per design.md §1 (200ms debounce, max 8 candidates, keyboard nav, silent close on empty/failed search).

## 3. Linkification (TDD)

- [x] 3.1 Failing unit tests for `renderInline` in `gui/web/src/rendering/text.js`: cashtag → chip markup; bare known token → chip; bare unknown token → plain; inline code span exempt; chip markup carries `data-symbol`.
- [x] 3.2 Implement the two linkify rules with the known-symbols render option; plumb `knownSymbols` from the chat panel; switch `UserMessage` (`thread-message.jsx`) to the escaped-HTML linkifying path per design §3 (user bubbles are plain React text today).
- [x] 3.3 Event delegation for chip clicks in the chat panel (by `data-symbol`).

## 4. Entity popover (TDD)

- [x] 4.1 Failing unit tests (`renderToStaticMarkup`): quote-present render (price/change), freshness line rendered when snapshot carries it, held badge, no-cached-quote state, add-to-watchlist disabled with "unresolved symbol" hint when resolution failed.
- [x] 4.2 Implement `gui/web/src/features/chat/entity-popover.jsx` using the local `components/ui/popover.jsx` primitive (the one `model-selector.jsx` uses — it is hand-rolled, not Radix); "Add to watchlist" resolves via the instrument-search route first, then goes through the `tool.invoke` WS path with explicit `sessionId`+`actionId`; "Ask about $SYMBOL" prefills+focuses the composer; name sourced from market-state rows or the search result.

## 5. Browser e2e + evidence

- [x] 5.1 Extend `tests/e2e/gui-browser.test.ts`: type `$AA` → popover appears → accept → the sent message renders a chip; open the chip popover.
- [x] 5.2 Runtime evidence: screenshots at 1440x960 and 390x844 (composer popover open; chip popover open) + browser-suite log excerpt in the PR (artifacts machine-local per pr-evidence policy).

## 6. Verification

- [x] 6.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; React Doctor clean on changed GUI files.
- [x] 6.2 Live check: one real GUI session where a routed turn (e.g. "compare $NVDA and $AMD") produces chips in the answer and `knownSymbols` picks up router entities.
- [x] 6.3 CHANGELOG `[Unreleased]` entry.
- [x] 6.4 `graphify update .`; `npx openspec validate cashtag-entity-layer --strict`.
