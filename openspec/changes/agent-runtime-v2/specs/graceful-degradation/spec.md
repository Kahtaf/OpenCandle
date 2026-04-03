## ADDED Requirements

### Requirement: Provider results use a structured result union
All provider functions SHALL return a `ProviderResult<T>` union type: either `{ status: "ok"; data: T; timestamp: string }` or `{ status: "unavailable"; reason: string; provider: string }`. Raw exceptions from providers SHALL be caught and converted to the unavailable variant.

#### Scenario: Successful provider call returns ok result
- **WHEN** `getQuote("AAPL")` succeeds
- **THEN** it returns `{ status: "ok", data: { price: 185.5, ... }, timestamp: "2026-04-02T14:30:00Z" }`

#### Scenario: Failed provider call returns unavailable result
- **WHEN** `getCompanyOverview("AAPL")` fails due to API rate limiting
- **THEN** it returns `{ status: "unavailable", reason: "rate_limited", provider: "alpha-vantage" }`

#### Scenario: Network error is caught and wrapped
- **WHEN** a provider call throws a network error
- **THEN** the wrapper catches it and returns `{ status: "unavailable", reason: "network_error", provider: "..." }`

### Requirement: Non-critical workflow steps continue on partial data
The WorkflowRunner SHALL distinguish between critical and non-critical steps. When a non-critical step receives `unavailable` data for some inputs, it SHALL continue execution with the available data and mark unavailable fields in its output.

#### Scenario: Options analysis continues without sentiment
- **WHEN** the options analyst step needs both option chain data and sentiment data
- **AND** sentiment data is unavailable but option chain data is available
- **THEN** the step executes with available data and marks sentiment metrics as unavailable in its evidence records

#### Scenario: Critical step fails the step on missing data
- **WHEN** a step marked as critical (e.g., fetch core quote) receives unavailable data for its primary input
- **THEN** the step transitions to `failed` status

### Requirement: Repeated retries on the same failing provider are blocked
The runtime SHALL track provider failures within a workflow run. If the same provider has failed N times (configurable, default 2) within a run, subsequent tool calls to that provider SHALL be short-circuited with an `unavailable` result without making the actual API call.

#### Scenario: Third call to failing provider is short-circuited
- **WHEN** Alpha Vantage has failed twice in the current workflow run
- **AND** a third tool call to Alpha Vantage is attempted
- **THEN** the call is short-circuited and returns `{ status: "unavailable", reason: "provider_circuit_open", provider: "alpha-vantage" }`

#### Scenario: Different provider is not affected
- **WHEN** Alpha Vantage has failed twice in the current run
- **AND** a call to Yahoo Finance is attempted
- **THEN** the Yahoo Finance call proceeds normally

### Requirement: Unavailable fields are surfaced in final output
When the synthesis step produces the final response, any evidence records with `source: "unavailable"` SHALL be listed in a "Data Gaps" section so the user knows what information was not available.

#### Scenario: Missing fundamentals are disclosed
- **WHEN** synthesis receives evidence records where free cash flow and debt-to-equity are unavailable
- **THEN** the final output includes a "Data Gaps" section listing those metrics and their unavailability reasons
