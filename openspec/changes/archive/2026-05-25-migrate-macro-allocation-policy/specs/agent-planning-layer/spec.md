## ADDED Requirements

### Requirement: Macro Allocation Review Slice Migration

The planning layer SHALL support migrating the `macro_allocation_review` task family from fallback macro portfolio prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve current macro evidence use, provider-gap continuation, structural portfolio review shape, and actionable adjustment obligations.

#### Scenario: Macro portfolio prompt selects macro allocation planning owners

- **WHEN** the user asks about macro outlook, inflation, rates, Fed policy, recession risk, or a balanced portfolio under current macro conditions
- **THEN** the resolved planning metadata selects task family `macro_allocation_review`
- **AND** it selects a macro allocation policy card
- **AND** it selects a macro allocation answer contract
- **AND** it preserves the macro, sentiment, and core-market tool bundles selected by routing

#### Scenario: Macro policy preserves portfolio review answer shape

- **WHEN** macro allocation review is selected
- **THEN** the answer contract requires data-gap disclosure and risk/downside framing
- **AND** the policy card requires current macro evidence when available
- **AND** it requires named unavailable macro or sentiment facts when providers are missing
- **AND** it preserves structural portfolio read, sleeve-by-sleeve implications, key risks/opportunities, actionable adjustment, what the adjustment does not fix, and watchlist/invalidation

#### Scenario: Macro replacement removes only matching macro fallback clauses

- **WHEN** the slice is replacement-active
- **THEN** only fallback playbook items 5 and 10-13 may be omitted for macro allocation turns
- **AND** provider-degradation remediation semantics remain preserved
- **AND** generic portfolio review and non-macro fallback clauses remain governed by their own ledger rows
