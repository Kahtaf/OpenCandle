## ADDED Requirements

### Requirement: Prompt Policy Manifest Stability

The prompt-to-policy manifest SHALL be stable enough to gate future prompt-clause migrations without unrelated replacement-active slices failing nondeterministically.

#### Scenario: Supplied but unverified ticker does not block event-risk answer

- **WHEN** the user supplies a ticker-like symbol and asks for earnings or event-risk action
- **AND** ticker lookup cannot verify the symbol as the intended security or returns only ambiguous/irrelevant matches
- **THEN** the ticker-disambiguation policy requires unresolved-ticker disclosure
- **AND** the final answer provides an event-risk framework covering trim, hedge, hold, position size, gap risk, and facts that would change the answer
- **AND** it does not stop with only a request for a corrected ticker

#### Scenario: Missing-symbol clarification remains available

- **WHEN** the user asks for financial analysis without supplying any symbol or identifiable asset
- **THEN** clarification through `ask_user` remains allowed
- **AND** the stabilization does not remove clarification behavior from genuinely missing-symbol routes
