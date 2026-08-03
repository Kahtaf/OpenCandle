## ADDED Requirements

### Requirement: Provider registry declares browser transport

Every provider descriptor SHALL declare a hosted-browser transport of
`direct`, `proxy`, or `blocked`, together with a concise reason and the live
browser proof required for `direct`. Unknown or missing classification SHALL be
treated as `blocked`.

#### Scenario: External desktop tool is blocked

- **WHEN** the hosted runtime reads the Reddit or X provider descriptor
- **THEN** its browser transport is `blocked`
- **AND** the reason identifies the native CLI or desktop-session dependency

#### Scenario: Proxy-only provider requires a negotiated relay

- **WHEN** a provider requires forbidden CORS access, custom headers, or a
  credential relay
- **THEN** its browser transport is `proxy`
- **AND** the hosted build enables it only when the fixed relay manifest declares support
- **AND** it remains unavailable when relay negotiation is absent or incompatible

### Requirement: Hosted tool registration is capability filtered

Hosted Pi tool construction SHALL receive the provider capability manifest and
MUST omit a tool when no complete direct-browser or negotiated fixed-relay path
can execute it. Runtime provider checks SHALL remain as defense in depth.

#### Scenario: Unsupported tool is absent from Pi

- **WHEN** hosted mode builds the tool set and a tool depends only on blocked
  providers or proxy providers absent from the negotiated relay manifest
- **THEN** that tool is absent from the model-visible definitions
- **AND** a user-facing capability report explains why it is unavailable

#### Scenario: New provider defaults to blocked

- **WHEN** a provider is added without a browser transport classification
- **THEN** hosted capability tests fail
- **AND** the provider cannot become model-visible in hosted mode

### Requirement: Direct classification requires a real browser proof

A provider SHALL be classified `direct` only after a real-browser test from the
hosted runtime proves its required request shape, authentication, CORS behavior,
bounded response, and secret handling.

#### Scenario: Documentation claim is insufficient

- **WHEN** provider documentation says browser access is supported but the live
  browser proof is absent or failing
- **THEN** the provider remains `proxy` or `blocked`

### Requirement: Hosted capability claims have current production evidence

The hosted capability matrix SHALL distinguish verified production journeys,
configured-but-unverified providers, and intentional unsupported boundaries.
The PWA SHALL not claim local feature parity for a provider, direct tool, or
workflow until its current deployed browser path returns and renders a real
result with the required credentials.

#### Scenario: Configured provider awaits proof

- **WHEN** a supported credential such as Finnhub or LSE is configured but has
  not completed a production browser journey
- **THEN** diagnostics records it as configured but unverified
- **AND** release acceptance does not count it as feature parity
