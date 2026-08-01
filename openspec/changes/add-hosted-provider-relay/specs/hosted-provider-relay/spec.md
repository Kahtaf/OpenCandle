## ADDED Requirements

### Requirement: Relay accepts only versioned allowlisted provider requests

The hosted provider relay SHALL accept only `POST /v1/provider-fetch` requests
whose version, provider id, HTTPS URL, method, headers, and body satisfy an
exact committed provider policy. It MUST reject unknown hosts, paths, methods,
headers, ports, credentials in URL user-info, redirects, malformed input, and
oversized input before forwarding.

#### Scenario: Unknown destination is rejected

- **WHEN** a request names an unlisted host or a path outside the named
  provider policy
- **THEN** the relay returns a bounded 4xx response
- **AND** no upstream request is made

#### Scenario: Known provider request is forwarded

- **WHEN** a request names a URL, method, and headers allowed by the matching
  provider policy
- **THEN** the relay performs one non-redirecting bounded upstream request
- **AND** returns the upstream status, allowed response headers, and body in the
  versioned response envelope

### Requirement: Relay retains no user data or application logs

The relay MUST NOT configure KV, D1, R2, Durable Objects, Queues, Analytics
Engine, Cache API usage, Tail Workers, Logpush, custom logs, or invocation logs.
It SHALL keep credentials and payloads only in request-local memory and SHALL
NOT include them in responses or errors except where the upstream response body
is the requested successful provider payload.

#### Scenario: Credential canary is not retained or reflected

- **WHEN** a provider credential canary is included in a relayed request and
  the upstream fails
- **THEN** the relay response and all application output omit the canary
- **AND** a subsequent request has no access to it

#### Scenario: Worker configuration has no persistence or logs

- **WHEN** the Worker package and Wrangler configuration are audited
- **THEN** no persistence or analytics binding is present
- **AND** invocation logs are explicitly disabled
- **AND** production Worker source contains no console logging

### Requirement: Relay bounds resource use and public abuse

The relay SHALL cap request and response bytes, enforce an upstream timeout,
disable redirects, apply a rate-limit binding keyed by a one-way digest of a
server-observed network identifier, return `Cache-Control: no-store`, and avoid
using client-supplied installation ids, provider credentials, prompts, symbols,
or URLs as rate-limit keys. The raw network identifier MUST remain request-local
and MUST NOT be logged, persisted, reflected, or passed to the rate-limit binding.

#### Scenario: Response exceeds the configured bound

- **WHEN** an upstream response exceeds the maximum response bytes
- **THEN** its stream is cancelled
- **AND** the relay returns a bounded error without partial provider data

#### Scenario: Client exceeds the request allowance

- **WHEN** the rate-limit binding rejects the pseudonymous network identifier
- **THEN** the relay returns HTTP 429 without calling the upstream provider

### Requirement: Hosted transport preserves provider Fetch behavior

Hosted OpenCandle SHALL relay proxy-classified provider requests and reconstruct
a standard `Response` for existing provider code. Direct providers and model
APIs SHALL remain direct. Local GUI and TUI fetch behavior MUST NOT change.

#### Scenario: Existing provider consumes a relayed response

- **WHEN** the hosted Yahoo provider performs its normal fetch sequence
- **THEN** the transport relays matching Yahoo requests
- **AND** the provider receives status, body, retry, and cookie headers through
  the same Fetch interface used locally

#### Scenario: Local runtime remains direct

- **WHEN** the local GUI or TUI calls a provider
- **THEN** it does not import, configure, or contact the hosted relay

### Requirement: Relay health gates hosted tool registration

Hosted OpenCandle SHALL register an HTTP-backed tool only when its provider
path is direct or supported by the matching relay policy version. Native CLI
and background-only tools MUST remain absent.

#### Scenario: Relay is unavailable at boot

- **WHEN** relay health or policy-version validation fails
- **THEN** relay-dependent tools are absent from the Pi tool set
- **AND** diagnostics identify relay availability as the cause

#### Scenario: Relay enables HTTP-backed tool group

- **WHEN** relay health succeeds and required credentials are available
- **THEN** the corresponding browser-safe HTTP-backed tools become model-visible
- **AND** they use the same normalized provider and tool contracts as local OC
