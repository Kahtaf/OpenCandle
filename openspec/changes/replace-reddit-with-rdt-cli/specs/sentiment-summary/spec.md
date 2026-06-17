## MODIFIED Requirements

### Requirement: get_sentiment_summary tool (cross-source aggregate)

The system SHALL expose a `get_sentiment_summary` AgentTool that runs the full sentiment pipeline across all available sources (Twitter, Reddit, web) and returns a cross-source comparison with divergence detection. When one or more sentiment sources are unavailable, the tool SHALL return results from available sources with explicit source-gap notes. After the Reddit `rdt-cli` migration, Reddit unavailability SHALL distinguish at least missing `rdt-cli`, missing/stale Reddit browser session, skipped Reddit source, and provider execution error when that information is available from typed external-tool failures.

#### Scenario: Reddit external tool missing

- **WHEN** Twitter and web sentiment succeed
- **AND** Reddit sentiment fails because `rdt` is not installed
- **THEN** the summary returns Twitter and web results
- **AND** the warning says Reddit requires `rdt-cli` with install command `uv tool install rdt-cli`

#### Scenario: Reddit session missing

- **WHEN** Twitter and web sentiment succeed
- **AND** Reddit sentiment fails because `rdt-cli` has no usable Reddit browser session
- **THEN** the summary returns Twitter and web results
- **AND** the warning says Reddit needs `rdt login` or a refreshed Reddit browser login

#### Scenario: User skips Reddit once

- **WHEN** the user chooses to skip Reddit for the current query
- **THEN** the summary omits Reddit
- **AND** source coverage/caveats state that Reddit was skipped by user choice

### Requirement: Output format

The tool SHALL return per-source breakdown, aggregate score, divergence analysis, trend context with sample counts if historical data exists, source coverage/caveats, and representative top records. When Reddit is available through `rdt-cli`, Reddit source output SHALL be generated from normalized `rdt-cli` post and comment records. Representative evidence SHALL distinguish scored sample size from displayed representative items.

#### Scenario: Reddit contributes rdt-cli post and comment evidence

- **WHEN** `rdt-cli` returns Reddit posts and top comments for a ticker query
- **THEN** sentiment summary source coverage includes Reddit
- **AND** Reddit drivers may cite post-level and comment-level evidence
- **AND** representative evidence distinguishes scored sample size from displayed representative items

#### Scenario: Reddit unavailable does not block summary

- **WHEN** Reddit setup is incomplete but Twitter or web/news sources return usable data
- **THEN** the sentiment summary still reports available source findings
- **AND** confidence/caveats identify the missing Reddit source
