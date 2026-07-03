## ADDED Requirements

### Requirement: DCF Refuses To Compute From Fabricated Inputs

The `compute_dcf` tool SHALL only report a per-share intrinsic value when every input to the per-share calculation is real provider data or an explicit user-supplied assumption. It SHALL NOT substitute placeholder values for missing structural inputs.

#### Scenario: Missing market cap refuses per-share output

- **WHEN** the overview provider returns no market cap (or the quote price is not positive) so shares outstanding cannot be derived
- **THEN** the tool returns an explicit cannot-compute result naming the missing input
- **AND** it does not fall back to a shares-outstanding value of 1 or any other placeholder

#### Scenario: Net cash increases equity value

- **WHEN** the latest financials show more cash than debt (negative net debt)
- **THEN** the equity value computation adds the net cash
- **AND** net debt is not clamped to zero

#### Scenario: Invalid terminal spread is rejected before computation

- **WHEN** the effective discount rate is less than or equal to the effective terminal growth rate
- **THEN** the tool returns a validation error explaining the Gordon Growth constraint
- **AND** no terminal value or intrinsic value is computed from the invalid spread

#### Scenario: DCF is reachable end to end from a natural prompt

- **WHEN** a TUI harness session submits a prompt asking to run a DCF on a listed ticker
- **THEN** the trace shows a `compute_dcf` tool call
- **AND** the final answer reports the intrinsic value with its assumptions or an explicit refusal naming missing inputs

### Requirement: Backtest Reports Realistic Fills And Discloses Limits

The `backtest_strategy` tool SHALL avoid same-bar lookahead fills, SHALL apply a stated transaction cost assumption, and SHALL disclose what the simulation ignores.

#### Scenario: Signal fills at the next bar's open

- **WHEN** a strategy generates an entry or exit signal from bar N's close
- **THEN** the simulated fill uses bar N+1's open price
- **AND** a signal on the final bar is reported as a pending unfilled signal rather than a same-close trade

#### Scenario: Transaction costs apply to every fill

- **WHEN** the backtest simulates a buy or sell fill
- **THEN** a flat per-side cost assumption (default basis points, overridable via tool parameter) is deducted
- **AND** the assumed cost rate is stated in the output

#### Scenario: Output discloses simulation limits

- **WHEN** the backtest returns results
- **THEN** the output includes a limitations statement covering excluded dividends, taxes, slippage beyond the flat cost, liquidity, and intrabar behavior
- **AND** performance claims are framed against those limits rather than as achievable returns
