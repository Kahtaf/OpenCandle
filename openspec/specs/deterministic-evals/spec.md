## ADDED Requirements

### Requirement: Rich trace schema
The test harness SHALL emit a structured trace containing: `prompt`, `classification` (the `ClassificationResult` from the router), `toolCalls` (array of `{ name, args, result }` objects capturing each tool invocation with its arguments and return value), `askUserTranscript` (ordered array of `{ question, answer }` pairs), and `text` (final assistant response). Eval scorers SHALL consume this trace shape.

#### Scenario: Trace captures tool arguments and results
- **WHEN** the agent calls `get_stock_quote` with `{ symbol: "AAPL" }` and receives a result
- **THEN** the trace SHALL contain an entry with `name: "get_stock_quote"`, `args: { symbol: "AAPL" }`, and `result` containing the tool's return value

#### Scenario: Trace captures classification
- **WHEN** the router classifies a prompt as `single_asset_analysis` with confidence 0.95
- **THEN** the trace SHALL contain `classification: { workflow: "single_asset_analysis", confidence: 0.95, ... }`

#### Scenario: Trace captures ask_user exchanges
- **WHEN** the agent asks "What is your risk tolerance?" and receives "conservative"
- **THEN** the trace SHALL contain an `askUserTranscript` entry with `{ question: "What is your risk tolerance?", answer: "conservative" }`

### Requirement: Intent classification scoring (Layer 1)
The eval framework SHALL score whether the agent routes prompts to the correct `WorkflowType`. Scoring SHALL use exact match against an expected workflow type from the set: `single_asset_analysis`, `portfolio_builder`, `options_screener`, `compare_assets`, `watchlist_or_tracking`, `general_finance_qa`. The expected value is sourced from the trace's `classification.workflow` field.

#### Scenario: Correct workflow classification
- **WHEN** an eval case specifies `expectedWorkflow: "single_asset_analysis"` and the trace shows `classification.workflow: "single_asset_analysis"`
- **THEN** the intent classification score SHALL be 1.0

#### Scenario: Incorrect workflow classification
- **WHEN** an eval case specifies `expectedWorkflow: "portfolio_builder"` and the trace shows `classification.workflow: "general_finance_qa"`
- **THEN** the intent classification score SHALL be 0.0

### Requirement: Tool selection scoring (Layer 2)
The eval framework SHALL score whether the agent called the correct tools. Scoring SHALL check that all `requiredTools` appear in the trace (recall) and no `forbiddenTools` appear (precision).

#### Scenario: All required tools called, no forbidden tools
- **WHEN** an eval case specifies `requiredTools: ["get_stock_quote", "get_technicals"]` and the trace contains both tool calls and no forbidden tools
- **THEN** the tool selection score SHALL be 1.0

#### Scenario: Missing required tool
- **WHEN** an eval case specifies `requiredTools: ["get_stock_quote", "get_technicals"]` and the trace only contains `get_stock_quote`
- **THEN** the tool selection score SHALL reflect the missing tool as a partial failure

#### Scenario: Forbidden tool called
- **WHEN** an eval case specifies `forbiddenTools: ["run_backtest"]` and the trace contains a `run_backtest` call
- **THEN** the tool selection score SHALL be penalized

### Requirement: Tool argument scoring (Layer 3)
The eval framework SHALL score whether tool calls include the correct arguments. Scoring SHALL check `requiredArgs` key-value pairs against actual tool call arguments in the trace.

#### Scenario: Correct arguments passed
- **WHEN** an eval case specifies `requiredArgs: { "get_stock_quote": { "symbol": "AAPL" } }` and the trace shows `get_stock_quote` called with `symbol: "AAPL"`
- **THEN** the argument score SHALL be 1.0

#### Scenario: Missing required argument
- **WHEN** an eval case specifies a required argument that does not appear in the trace's tool call
- **THEN** the argument score SHALL reflect the missing argument as a failure

### Requirement: Data faithfulness scoring (Layer 4)
The eval framework SHALL verify that financial numeric claims in the agent's final response are grounded in tool output. The scorer SHALL extract numbers that appear in financial contexts (prices, ratios, percentages, market cap, volume, returns, drawdowns) and check each against the union of all tool result data in the trace. The scorer SHALL exclude non-financial numbers: dates, ordinals, list indices, position counts, and time periods.

#### Scenario: Financial number grounded in tool output
- **WHEN** the agent response contains "AAPL is trading at $185.50" and the `get_stock_quote` tool returned `price: 185.50`
- **THEN** the faithfulness score SHALL be 1.0

#### Scenario: Hallucinated financial number detected
- **WHEN** the agent response cites a P/E ratio of 28.5 but no tool result in the trace contains that value
- **THEN** the faithfulness score SHALL be penalized and the ungrounded number SHALL be flagged in the eval report

#### Scenario: Calculated values within tolerance
- **WHEN** the agent response contains a percentage change derived from tool output and the value is within 1% relative tolerance of the correct calculation
- **THEN** the faithfulness scorer SHALL accept the value as grounded

#### Scenario: Non-financial numbers excluded
- **WHEN** the agent response contains "Here are 5 key metrics" or "over the past 3 years"
- **THEN** the faithfulness scorer SHALL NOT flag these as ungrounded

### Requirement: Risk disclosure scoring (Layer 5)
The eval framework SHALL verify that agent responses include appropriate risk disclosures. The scorer SHALL check for disclaimer text via regex and verify absence of prohibited language ("guaranteed", "risk-free", "can't lose").

#### Scenario: Disclaimer present and no prohibited language
- **WHEN** the agent response contains a disclaimer and does not contain prohibited terms
- **THEN** the risk disclosure score SHALL be 1.0

#### Scenario: Missing disclaimer on buy recommendation
- **WHEN** the agent response contains a buy recommendation but no risk disclaimer
- **THEN** the risk disclosure score SHALL be 0.0

#### Scenario: Prohibited language detected
- **WHEN** the agent response contains "guaranteed returns" or "risk-free"
- **THEN** the risk disclosure score SHALL be 0.0

### Requirement: Eval case format
Each eval case SHALL conform to a typed `EvalCase` interface with fields: `name`, `tier` ("always" | "usually"), `prompt`, optional `answers` (ordered `string[]` for multi-turn ask_user scripting, consumed in sequence), and `assertions` containing layer-specific expected values. Layer 1 assertions SHALL use `expectedWorkflow` (a `WorkflowType` string) instead of a generic intent string.

#### Scenario: Valid always-tier eval case
- **WHEN** an eval case has `tier: "always"` with deterministic assertions (Layers 1–5)
- **THEN** the eval runner SHALL include it in every CI run

#### Scenario: Eval case with ordered ask_user answers
- **WHEN** an eval case specifies `answers: ["conservative", "10 years", "no sector exclusions"]`
- **THEN** the harness SHALL provide the first answer to the first `ask_user` call, the second to the second call, and so on in order

### Requirement: Always-tier CI integration
All eval cases with `tier: "always"` SHALL run as part of the standard `npm test` pipeline. A failure in any always-tier eval SHALL cause the test suite to fail.

#### Scenario: Always-tier eval fails in CI
- **WHEN** a deterministic eval case fails (score below passing threshold)
- **THEN** the Vitest run SHALL report the failure and exit with non-zero status
