## ADDED Requirements

### Requirement: Options Strategy Slice Migration

The planning layer SHALL support migrating the `options_strategy` task family into a dedicated policy card and active answer contract after parity passes. The slice SHALL preserve existing options workflow dispatch, owned-underlying selection, catalyst context, contract-selection evidence use, and strategy-specific risk framing.

#### Scenario: Options prompt selects options strategy planning owners

- **WHEN** the user asks for calls, puts, covered calls, protective puts, option chains, or option setups on a specific security
- **THEN** the resolved planning metadata selects task family `options_strategy`
- **AND** it selects policy card `options_strategy`
- **AND** it selects answer contract `options_strategy`
- **AND** it preserves the `options_screener` workflow dispatch when the workflow is selected
- **AND** it preserves core-market, options, sentiment, and clarification tool bundles selected by routing

#### Scenario: Existing-position options preserve underlying and catalyst roles

- **WHEN** the user asks for a covered call or protective put on an owned position while naming a separate catalyst ticker
- **THEN** the policy card requires the owned or held symbol to remain the option-chain underlying
- **AND** catalyst tickers remain catalyst context rather than replacing the underlying
- **AND** cost basis, share quantity, DTE hints, option strategy, and direction remain available to workflow prompt assembly

#### Scenario: Options answer contract preserves strategy-specific risk obligations

- **WHEN** options strategy planning is selected
- **THEN** the answer contract requires risk/downside framing, freshness/data-gap disclosure, and source coverage where available
- **AND** covered-call answers distinguish premium received, assignment/capped-upside risk, share-price downside, IV/event risk, exit liquidity, and return-if-assigned when inputs support it
- **AND** protective-put answers distinguish hedge floor, premium/decay cost, imperfect hedge risk, liquidity, opportunity cost, and Greeks when available

#### Scenario: Options replacement does not remove workflow prompt ownership

- **WHEN** the slice is replacement-active
- **THEN** workflow dispatch context and options workflow prompts remain authoritative for option-chain calls, expiration selection, contract ranking, stale quote caveats, and final contract tables
- **AND** no non-options task-family fallback clause is omitted by this migration
