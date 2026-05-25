## ADDED Requirements

### Requirement: Fixed Prompt Competitive Replay Is Explicit

Competitive benchmark tooling SHALL make same-prompt branch-vs-ref replay an explicit fixed-prompt mode so generic-agent costs and cached-baseline assumptions are visible.

#### Scenario: Competitive replay requires fixed prompts

- **WHEN** a developer compares competitive behavior against a base ref
- **THEN** the harness requires an explicit fixed prompt set or a prior competitive report
- **AND** it records whether competitor answers were live, cached, or unavailable

#### Scenario: OpenCandle self-regression is separated from competitor result

- **WHEN** a branch changes OpenCandle's answer on a fixed prompt
- **THEN** the report compares OpenCandle current-vs-base behavior before interpreting competitor win/loss deltas
- **AND** unsupported base-ref execution is reported as a harness limitation rather than a competitor comparison result
