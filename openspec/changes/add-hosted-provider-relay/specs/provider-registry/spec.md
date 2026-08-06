## ADDED Requirements

### Requirement: Hosted provider report resolves relay capability separately

The provider registry SHALL preserve each provider's `direct`, `proxy`, or
`blocked` browser transport classification and SHALL resolve a hosted report
against a relay capability manifest. A `proxy` provider is executable only
when its named relay policy is present at the required version. A `blocked`
provider remains unavailable even when the relay is healthy.

#### Scenario: Proxy provider becomes relayed

- **WHEN** Yahoo is classified `proxy` and the relay manifest includes the
  compatible Yahoo policy
- **THEN** the hosted report lists Yahoo as `relayed`
- **AND** tools with a complete Yahoo path may be registered

#### Scenario: Native provider remains blocked

- **WHEN** the relay is healthy and the registry evaluates X or Reddit
- **THEN** the provider remains blocked because it requires a native CLI and
  desktop browser session

### Requirement: Relay capability claims require contract and live proofs

A provider policy SHALL NOT be enabled in the production hosted manifest until
fixture tests prove its request allowlist and a real-browser test proves the
provider's complete relayed request sequence, authentication behavior, bounded
response, and credential non-reflection.

#### Scenario: Policy exists without live proof

- **WHEN** a provider has an allowlist policy but lacks a passing live-browser
  proof
- **THEN** production hosted capability remains unavailable for that provider
