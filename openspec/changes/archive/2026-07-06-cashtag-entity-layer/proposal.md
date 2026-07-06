# Cashtag Entity Layer (GUI)

## Why

Tickers are OpenCandle's central object, but in the GUI they are inert text. The composer has no ticker autocomplete, so users type bare tokens the router must disambiguate (the acronym/lowercase-verb minting bugs of the last two releases are all downstream of ambiguous input). Assistant answers render `$NVDA` as plain text with no path to the quote, the watchlist, or the portfolio pages, so chat and market-state feel like two products. The router already treats `$SYMBOL` cashtags as the strongest ticker signal (`extractSymbols` marks them `explicitTicker: true`, and cashtag presence is the disambiguator's positive signal) — meaning input-time cashtags remove a whole class of routing ambiguity with zero routing changes.

## What Changes

- **Composer `$` autocomplete:** typing `$` plus 1+ characters in the chat composer opens an instrument-candidate popover backed by the GUI server's existing instrument-search route (the same resolver-backed search the market-state forms use). Selecting a candidate inserts the canonical `$SYMBOL` cashtag into the text. Nothing extra travels in the run body — the cashtag itself is the router signal.
- **Entity linkification in chat:** the GUI rich-text renderer turns (a) explicit `$SYMBOL` cashtags in user and assistant text, and (b) bare uppercase tokens that exactly match the session's known-symbols set, into inline entity chips.
- **Known-symbols set:** the server dashboard projector gains a `knownSymbols` field aggregating symbols from quote activity (existing `watchlist` projection), resolved router entities (`opencandle-route-context` entries), and saved portfolio/watchlist state.
- **Entity chip popover:** clicking a chip shows the symbol's cached quote from the existing server quote snapshot (with its freshness line when the `freshness-ledger` change has landed), a "held" badge when the symbol is in the saved portfolio, and two actions: "Add to watchlist" (via the existing GUI tool-invoke path for `manage_watchlist`) and "Ask about SYMBOL" (prefills the composer with `$SYMBOL `).

## Non-Goals

- No new backend entity service, no theses/knowledge-graph accumulation (future direction, separate change).
- No routing/`src/routing/` changes — the router already prefers cashtags; this change only makes users produce them.
- No new quote-fetch path: chips render only cached snapshot data; a symbol with no cached quote shows the actions without price data.
- No TUI changes.
- No linkification inside code spans or table cells that are part of tool-result raw details.

## Relationship to Other Changes

- Composes with `freshness-ledger` (chip quote line shows the as-of/staleness wording when available) but does not depend on it.
- Independent of `composer-attach-and-context-receipts` (different composer affordances; coordinate only on composer file merge order).
