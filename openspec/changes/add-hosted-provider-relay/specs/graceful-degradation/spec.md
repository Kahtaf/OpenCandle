## ADDED Requirements

### Requirement: Hosted relay failures remain distinct from provider failures

Hosted diagnostics and tool errors SHALL distinguish relay unavailable,
unsupported relay policy, relay rate-limited, missing provider credential,
provider authentication failure, provider rate limiting, and provider
unavailable. None of these failures may clear local browser data or silently
fall back to fabricated evidence.

#### Scenario: Relay cannot be reached

- **WHEN** a hosted tool requires a relayed provider and the relay cannot be
  reached
- **THEN** the tool returns an unavailable result identifying the relay path
- **AND** existing local sessions, state, and credentials remain intact

#### Scenario: Provider rejects a relayed credential

- **WHEN** the relay is healthy but the upstream provider rejects the user's
  key
- **THEN** the existing provider credential setup flow is preserved
- **AND** relay diagnostics do not mislabel the failure as relay downtime
