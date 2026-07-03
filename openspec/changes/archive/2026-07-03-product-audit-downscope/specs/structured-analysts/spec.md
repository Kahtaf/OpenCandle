## ADDED Requirements

### Requirement: Comprehensive Analysis Always Includes Adversarial Debate

The comprehensive analysis workflow SHALL always include the bull case, bear case, rebuttal, and debate-resolving synthesis steps. No configuration flag SHALL gate the debate.

#### Scenario: Debate steps run unconditionally

- **WHEN** a comprehensive analysis workflow is built for a symbol
- **THEN** the workflow includes the bull, bear, and rebuttal debate steps and the debate-aware synthesis and validation prompts
- **AND** no environment variable or file-config setting can select a no-debate variant

#### Scenario: Legacy debate flag is inert

- **WHEN** a user environment still sets `OPENCANDLE_DEBATE`
- **THEN** the value is ignored without failing startup
- **AND** the removal is documented as a breaking configuration change
