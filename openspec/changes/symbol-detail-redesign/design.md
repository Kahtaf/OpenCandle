# Design — symbol-detail-redesign

Decisions below are FINAL for the implementation pass. DESIGN.md remains fixed law (Research
Ink actions, Inter, tabular numerals, signed color rule, light neutral surfaces). Hard copy
rules carry over from the market-pages redesign: zero em dashes in user-facing strings, no
internal vocabulary or provider names in the UI, copy pinned by tests.

## Evidence

Live structural review of Obside (app.obside.com) on 2026-08-05, ASTS (stock) and BTC
(crypto), plus curated references gathered via Mobbin. Reference library:
`tmp/screenshots/08-symbol-detail/` (machine-local, indexed and served over the tailnet;
not committed). Key references: Obside captures (sy-18..22), Perplexity Finance NVDA rail
anatomy (sy-10), Fey TSLA KPI strip (sy-08), Quicken NVDA position-beside-market panels
(sy-13), Origin NVDA light-theme composition (sy-11), OKX BTC / Uniswap ETH crypto
vocabulary (sy-12/14), Revolut/Origin analyst zones (sy-15..17, deferred scope).

What the references agree on: the hero answers "how is it doing" before the chart; numbers
are translated, not printed; page = full-width primary column + fixed detail rail; one shell
serves all asset types with vocabulary swaps and clean section drop-out.

## D1. Layout

`DetailRailLayout` (already shipped for watchlist) becomes the page frame. Primary column:
hero, chart, key stats, about. Rail: key levels, your position, alerts on this symbol,
watchlist membership, analyze actions. Below the rail breakpoint the page stacks: hero,
chart, position, key levels, stats, about, remaining rail cards. The 1120px centered cap is
removed; the page fills the desktop canvas like the other market pages.

## D2. Hero anatomy

Price block (price, signed change, currency, session label with existing extended-hours chip
vocabulary) over one stat strip. Equity strip: 5D, 1M, YTD, 1Y, from 52w high, day range,
volume vs 30-day average. Crypto swaps 5D for 1W and day range for 24h range; FX and indices
drop volume. Every stat renders a shaped skeleton while loading. All horizon returns are
computed from already-fetched history; if history is too short for a horizon, that stat is
omitted (never shown as 0 or a dash).

## D3. Translated numbers

Where the inputs already exist, print the interpretation next to the value: volume as
"12.4M · 0.8x avg" (30-day average from history), key levels with signed % distance from the
current price. Rules: derived only from fetched data, never guessed (repo rule); rounding
follows existing `financial-format.js`; currency follows the quote's own currency (non-USD
honesty rules from the market-pages pass carry over).

## D4. Key levels and trend summary are deterministic view-model math

Key levels card: 52-week high, 52-week low, 20-day MA, 50-day MA, each with value and %
distance, captioned "Calculated from recent price action." Trend summary: price vs 20/50/200
day MA per horizon, labeled Above/Below in plain English with one summary sentence (e.g.
"Price is below its 20, 50 and 200 day averages."). No LLM involvement, no new tools; pure
functions with unit tests. Horizons without enough history are omitted honestly. We
deliberately do not claim "support" and "resistance" beyond the 52-week range and MAs; no
invented technical levels.

## D5. Per-asset-type descriptor replaces the string heuristic

A descriptor keyed by instrument type (stock, etf, crypto, fx, index, commodity, unknown)
declares: stat-strip vocabulary, which sections exist, and section labels. Resolution uses
the instrument metadata the app already has (search/quote metadata), falling back to
`unknown` which shows quote + chart + membership only. Sections absent from a descriptor are
omitted entirely; nothing renders as an empty shell. The current `^`/`-USD` heuristic is
deleted. The existing "limited stats" notice becomes the descriptor's explicit availability
note for types without fundamentals.

## D6. Page connects to actions, not just data

- Key levels rows carry Create alert prefilled at that level (existing alert-sheet threshold
  prefill and currency rules).
- Your position card shows saved lots (value, gain, allocation within its portfolio) when
  held, using portfolio view-model formatting and its FX/unknown-currency honesty rules;
  a quiet single line when not held.
- Action chips prefill the chat composer ("Alert me if X drops 10% in a week", "/analyze X",
  "Compare X with ...") — prefill only, never auto-send. Writer-only actions keep the
  existing follower degradation and read-only band.

## D7. Deferred, with reasons (do not partially implement)

- Analyst consensus / price targets / EPS beats: no ratings provider. Faking or scraping is
  out; revisit if a keyless source lands.
- Peers table: no peers provider; a sector-screener approximation is a separate proposal.
- Auto-generated "what's happening" prose (Obside-style): rejected; OpenCandle's equivalent
  is the evidence-backed `/analyze` flow the page already links to.
- News and upcoming-earnings sections: only if served by already-negotiated providers on
  each surface; hosted omission follows D5 rules. If data is not already reachable, the
  section is out of scope for this change.
- Trade impact / buy-sell simulation: permanently out of scope (research-only product).

## D8. Parity and verification

One React app serves both surfaces; hosted differences are limited to capability-gated
section omission. Verification: unit tests for every derivation and descriptor; screenshot
harness phases for the new layout; live browser click-through on local GUI and hosted PWA at
desktop (1440px) and mobile (390px) widths, including a crypto and an FX symbol to prove
degradation.
