# Design — Cashtag Entity Layer

Decisions are made; do not redesign. File references verified 2026-07-05.

## 1. Composer autocomplete

- File: `gui/web/src/components/chat/chat-composer.jsx` (the textarea lives at ~line 29; Enter-submit handling at ~48-51). Add a controlled autocomplete component (`gui/web/src/features/chat/cashtag-autocomplete.jsx`).
- **Trigger detection is a pure function** — `detectCashtagFragment(text, caretIndex): { fragment, start } | null` matching a `\$[A-Za-z]{0,6}$` token ending at the caret — so it is node-testable (see §5). Debounce 200ms, then query the existing instrument-search route: **`GET /api/instruments/search?q=<query>`** (`gui/server/http-routes.ts` ~:212, behind `allowTrustedGuiRequest`; handler `searchInstrumentCandidates(query)` in `gui/server/market-state-api.ts` ~:227, returning `{ query, candidates, error? }` with `InstrumentCandidate = { symbol, name (nullable), quoteType, assetType, exchange (nullable), provider, score }`). Reuse it verbatim; do not add a new route. Empty/failed search → close silently (the handler's catch already returns `candidates: []` + `error` — keep that contract).
- Render up to 8 candidates: symbol, name, exchange. Keyboard: Up/Down, Enter/Tab accept, Esc dismiss; Enter with the list open must NOT submit (guard the existing Enter handler while open — and this guard must compose with `composer-attach-and-context-receipts`' pending-attachments state: Enter-with-list-open never submits regardless of attachments).
- **UI primitive:** the candidate list is its own absolutely-positioned `role="listbox"` element (with `aria-activedescendant`), NOT the local `Popover` primitive — `gui/web/src/components/ui/popover.jsx` is a hand-rolled component (not Radix, not from `@opencandle/ui`) whose `PopoverContent` hardcodes `role="menu"`, wrong for an autocomplete.
- Accept inserts `$SYMBOL ` (uppercase, trailing space) replacing the typed fragment.
- The existing `/`-opens-catalog behavior on empty composer is untouched.
- **Merge-order note:** this change and `composer-attach-and-context-receipts` both edit the composer JSX. Whichever lands second must re-anchor by `aria-label` ("Open catalog"/"Open context"), not line numbers.

## 2. Known-symbols set (server)

- `gui/server/projector.ts`: add `knownSymbols: string[]` to `DashboardState`. Union of:
  - symbols already in the `watchlist` projection (quote activity),
  - `entities.symbols` from each `opencandle-route-context` custom entry (the projector already folds custom entries; add a case for this entry type),
  - saved-state symbols (portfolio lots + watchlist items), injected as a parameter: give `projectDashboard(entries, sessionId)` an optional third argument `savedSymbols: string[]` (the projector stays a pure entry fold — it never reads SQLite). Callers source it from `MarketStateService` the way `gui/server/market-state-api.ts` already does, via a small server-side memo with a 30-second TTL (`buildMarketStateSnapshot` opens a fresh SQLite connection per call; do not add a DB open per broadcast). Update **all four** `projectDashboard` call sites: `gui/server/http-routes.ts` ~:721 (`buildSnapshotPayload`) and ~:754 (`buildSessionBootstrapPayload`), `gui/server/ws-hub.ts` ~:287 and ~:301.
- Uppercase-normalized, deduped, capped at 100.

## 3. Linkification (client)

- File: `gui/web/src/rendering/text.js`, `renderInline`. Two rules, applied outside inline-code spans only:
  - `\$([A-Za-z]{1,6})\b` → always an entity chip (uppercase the symbol).
  - `\b[A-Z]{1,6}\b` → entity chip only when the token is in `knownSymbols` (passed down as a render option; plumb it from the chat panel where dashboard state is available).
- Emit `<button class="entity-chip" data-symbol="NVDA">…</button>` markup from the renderer; the chat panel delegates click events by `data-symbol` (the renderer produces HTML strings today — event delegation, not React elements, is the pattern that fits).
- **User bubbles do not use the rich renderer today** — `UserMessage` in `gui/web/src/components/chat/thread-message.jsx` renders plain React text. To linkify user text, `UserMessage` switches to the same escaped-HTML path (`escapeHtml` already exists in `text.js`; run the linkifier over the escaped text). Assistant messages already flow through `renderRichText`.
- Do not linkify inside `<code>`, headings' anchor links, or the raw-details sections of tool cards.

## 4. Entity chip popover

- New `gui/web/src/features/chat/entity-popover.jsx`: anchored via the **local hand-rolled `Popover` primitive** (`gui/web/src/components/ui/popover.jsx` — the same one `model-selector.jsx` imports; it is NOT Radix and NOT in `@opencandle/ui`; its `role="menu"` is acceptable for this action popover).
- Content:
  - Symbol; company name from `/api/market-state` instrument/watchlist rows or the instrument-search route — **the quote snapshot carries no name field** (`MarketStateQuoteSnapshot` = symbol/status/price/changePercent/fetchedAt/stale/reason).
  - Price + day change from the existing server quote snapshot (client polling already exists: `useMarketState.jsx` ~:73 fetches `/api/market-state/quotes`; server store is `QuoteSnapshotStore`, stale-while-revalidate, 60s). No new fetch path. Note the snapshot covers only saved watchlist/portfolio symbols — most chat-mentioned chips will show the no-cached-quote state by construction; that is accepted v1 behavior. If `freshness` metadata is present on the snapshot (post `freshness-ledger`), render its as-of line small under the price.
  - "Held" badge when the symbol has portfolio lots; "Watchlist" badge when saved in a watchlist (both from the market-state API the GUI already calls).
  - Actions: **Add to watchlist** → the existing `tool.invoke` WS path for `manage_watchlist` (client `useGuiConnection.jsx` ~:88, server `ToolInvokeController.handleToolInvokeMessage`; cross-process via `POST /api/local-coordinator/tool-invoke`), carrying the explicit `sessionId` + `actionId` the pi-synced-gui spec requires. **The action first resolves the symbol through the instrument-search route and is disabled (with "unresolved symbol" hint) when resolution fails** — a chip is minted for any `$XXXX` the user typed, and the market-state-user-experience spec forbids persisting unresolved symbols. **Ask about $SYMBOL** → sets composer text to `$SYMBOL ` and focuses it.
- No cached quote → show name-less chip content: symbol, "no cached quote", and the two actions.

## 5. Tests

- Unit (client): **the repo's GUI unit convention is `environment: "node"` + `renderToStaticMarkup` — there is no jsdom.** Therefore: trigger detection and the linkifier are pure functions tested directly (`detectCashtagFragment(text, caretIndex)` truth table; linkifier string in/out including code-span exclusion); popover render states (quote / no-quote / held badge / disabled unresolved action) via `renderToStaticMarkup`. Keyboard interaction, focus, and click delegation are covered ONLY by the browser e2e — do not introduce jsdom.
- Unit (server): projector `knownSymbols` aggregation from seeded entries + injected saved symbols; the 30s saved-symbols memo.
- Browser (`tests/e2e/gui-browser.test.ts` pattern): type `$AA` → list appears → accept (Enter does not submit) → send → assistant reply renders chips → chip popover opens; screenshot at 1440x960 and 390x844.
