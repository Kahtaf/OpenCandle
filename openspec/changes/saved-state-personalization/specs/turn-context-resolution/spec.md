## ADDED Requirements

### Requirement: Router input includes gated saved-state data

For turns that pass a **deterministic pre-router finance-context gate** — a finance signal in the current text or prior turns, the same pattern the conversational risk-preference recovery guard uses (the existing `shouldIncludeSavedMarketStateContext` cannot gate router input: it reads `routeKind`, the router's own output) — the router input context SHALL include a compact saved-state data block: portfolio symbols with share counts and watchlist symbols, capped at 8 entries each. The router prompt SHALL render this block as data in the same manner as prior turns; router prompt instruction text SHALL NOT change. Turns with no finance context in the current text or prior turns SHALL receive no saved-state data in the router input.

#### Scenario: Holding reference resolves from saved state

- **WHEN** a session's saved portfolio contains an AMD lot and turn 3 asks "and compare it to the one I hold" after two NVDA turns
- **THEN** the turn's `opencandle-router` entry carries both `NVDA` and `AMD` in `entities.symbols`
- **AND** neither symbol appears as a `user`-sourced slot

#### Scenario: Pass-through turns stay clean

- **WHEN** the user says "I'm feeling more aggressive on the tennis court lately" with a saved portfolio present
- **THEN** the router input contains no saved-state block
- **AND** the turn routes as pass-through exactly as before this change

### Requirement: Deterministic held-symbol backstop from saved state

When the current turn's text contains a holding-coreference phrase (at minimum: "the one I hold", "my position", "my holding", "my shares") and the router output resolved no saved-holding symbol, router post-processing SHALL add the saved portfolio symbol to `entities.symbols` with a `held_symbol_saved_state` diagnostic — only when exactly one saved holding is a plausible referent. This is new sibling logic in `postProcessRouterOutput` beside the existing options-screener held-symbol correction (which is workflow-specific and reads current-text extraction only); `postProcessRouterOutput`'s context parameter widens to carry the saved-state block. With multiple plausible holdings and no disambiguating signal, the backstop SHALL NOT guess; the turn proceeds without a forced symbol so clarification behavior can engage. The backstop SHALL NOT fire when the text names explicit tickers that satisfy the reference.

Additionally, router post-processing SHALL downgrade slot provenance for saved-state leakage: a `user`-sourced symbols slot containing a symbol absent from the current text and prior turns but present in the saved-state block is downgraded to source `memory` with a `symbols_slot_provenance_saved_state` diagnostic (mirroring the existing prior-turn provenance downgrade).

#### Scenario: Single holding is backstopped

- **WHEN** the saved portfolio holds only AMD, the text says "the one I hold", and the router output's entities lack AMD
- **THEN** post-processing adds `AMD` to `entities.symbols` with the `held_symbol_saved_state` diagnostic

#### Scenario: Multiple holdings do not force a guess

- **WHEN** the saved portfolio holds AMD and SPY and the text says "my position" with no other signal
- **THEN** post-processing adds no symbol

#### Scenario: Explicit tickers suppress the backstop

- **WHEN** the text is "compare NVDA to TSLA" and the portfolio holds AMD
- **THEN** post-processing adds nothing

#### Scenario: Saved-state symbol cannot claim user provenance

- **WHEN** the router emits a `user`-sourced symbols slot containing AMD, AMD is absent from the current text and prior turns, and AMD is in the saved-state block
- **THEN** post-processing downgrades that slot symbol's source to `memory` with the `symbols_slot_provenance_saved_state` diagnostic

### Requirement: Route-context entry carries the saved-state summary

`ResolvedTurnContext` SHALL include `savedMarketState: { included: boolean, summary?: string }`, where `summary` is byte-identical to the saved-market-state text injected into the system prompt for the same turn (one serialization function, computed once per turn by a public coordinator accessor and passed into `buildResolvedTurnContext` via a new options field) and `included` reflects the routeKind-time gating branch (`output.routeKind !== "pass_through"` — the gating's other inputs do not exist at entry time). The `opencandle-route-context` session entry therefore carries the summary for routed finance turns and `included: false` with no summary for pass-through turns. Non-router turns (`/analyze` dispatch, rules paths) have no `ResolvedTurnContext`; they keep the existing direct system-prompt injection and carry no `savedMarketState` entry field.

#### Scenario: E2 fixture values appear in route context

- **WHEN** the competitive seed fixture is loaded and the user asks "is my current portfolio too exposed if rates stay high?"
- **THEN** the turn's `opencandle-route-context` entry contains the fixture's symbols and values (SPY/AAPL/XLE, share counts, cost bases) inside `savedMarketState.summary`
- **AND** the turn routes to portfolio review, not `portfolio_builder`

#### Scenario: Promotion of the known-fail evals

- **WHEN** this change is complete
- **THEN** the E2 eval no longer requires `OPENCANDLE_EVAL_KNOWN_FAIL_E2` and the E1 eval no longer requires `OPENCANDLE_RUN_KNOWN_FAIL_EVALS`
- **AND** both pass as usually-tier live evals
