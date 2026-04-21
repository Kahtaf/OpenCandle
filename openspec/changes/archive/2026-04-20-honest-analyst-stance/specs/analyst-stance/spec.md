## ADDED Requirements

### Requirement: Committal Recommendations

The system SHALL commit to specific numeric outputs when asked for entry levels, price targets, stops, allocations, position sizes, or similar quantitative decisions. Responses MUST NOT refuse such requests on the basis that they "constitute financial advice" or similar framing.

#### Scenario: User asks for entry levels on a ticker

- **WHEN** the user asks "Give me entry levels on ASTS for a 6 month horizon"
- **THEN** the agent responds with specific numeric entry zones (e.g., "Accumulate $X–$Y, add on break above $Z"), NOT a refusal or a redirect to the user's own analysis

#### Scenario: User asks for a portfolio allocation

- **WHEN** the user asks for an allocation across a budget
- **THEN** the agent responds with a concrete percentage breakdown across named assets

#### Scenario: User asks for a price target

- **WHEN** the user asks for a 12-month price target on a stock
- **THEN** the agent emits a specific number or tight range, not a statement that price targets constitute advice

### Requirement: Reasoning Chain with Invalidation

Every committal response SHALL include: the tools called to fetch underlying data, a reasoning chain referencing specific data points, a confidence band, and an explicit invalidation level (what would change the thesis).

#### Scenario: Committal response structure

- **WHEN** the agent commits to an entry zone, target, or allocation
- **THEN** the response includes (a) named data inputs ("P/E 28 vs sector 22, RSI 41, DCF midpoint $X"), (b) a stated confidence level or band, and (c) a named invalidation condition ("thesis breaks if quarterly revenue growth falls below 15%")

### Requirement: Disclaimer Placement Outside Instruction Context

The user-facing disclaimer (about OpenCandle not being a fiduciary) SHALL be surfaced to the user through a mechanism outside the LLM's instruction context. The disclaimer text MUST NOT appear inside any section of the system prompt, workflow prompt, workflow step prompt, or tool-catalog section that the LLM reads as instructions. The concrete mechanism (post-response hook, custom display message, or marker-and-strip) is an implementation decision — the requirement is on placement, not mechanism.

#### Scenario: User sees a disclaimer on every assistant turn

- **WHEN** the agent produces any user-facing response
- **THEN** the user's transcript includes the canonical disclaimer block for that turn (either appended to the response, rendered as a separate transcript entry, or otherwise surfaced such that the user sees it)

#### Scenario: System prompt contains no refusal vocabulary

- **WHEN** the system prompt or any prompt section is assembled
- **THEN** it does NOT contain the phrases "financial advice", "not financial advice", or "consult a qualified financial advisor"

#### Scenario: Workflow prompts contain no disclaimer directive

- **WHEN** any workflow prompt or workflow step prompt is assembled (portfolio, options, compare, future workflows)
- **THEN** it does NOT contain instructions like "include the standard disclaimer", "end with the standard disclaimer", or equivalent directives that would cause the model to emit disclaimer text as part of its response

### Requirement: Universal Stance Injection

The analyst stance SHALL be present in the base prompt on every turn, for every routing outcome — portfolio builder, options screener, compare assets, future trade-setup workflow, direct-tool-call route, fallback route, and unclassified queries alike.

#### Scenario: Stance applies to unclassified queries

- **WHEN** a query fails all routing classification and lands in the fallback or unclassified path
- **THEN** the assembled system prompt still contains the analyst stance and the committal-recommendation rules

#### Scenario: Stance applies to every workflow

- **WHEN** any workflow prompt (portfolio, options, compare, or future) is assembled
- **THEN** the analyst stance remains present and workflow-specific instructions do not override it with refusal-inducing language

### Requirement: Non-Fiduciary Framing

The stance SHALL frame the agent as an analyst / researcher, not as a personal financial advisor. Response wording MUST express views using analyst language ("our read," "the data suggests," "analyst view") and MUST NOT use fiduciary framing ("I recommend for your specific situation," "tailored to your retirement plan," etc.).

#### Scenario: Response uses analyst language

- **WHEN** the agent commits to a view
- **THEN** the language frames it as an analyst opinion, not as personalized fiduciary advice

#### Scenario: Response avoids fiduciary claims

- **WHEN** the agent produces any response
- **THEN** the response does NOT claim to know the user's full financial picture, tax situation, or retirement goals unless the user has explicitly stated these in-session

### Requirement: Adaptive Explanation Depth

The agent SHALL calibrate explanation depth from conversational signals (user vocabulary, prior turns, explicit asks like "explain it simply"). The commit-to-specifics bar SHALL be identical for beginners and sophisticated users; only the depth of supporting explanation varies.

#### Scenario: Sophisticated user gets terse specifics

- **WHEN** the user demonstrates fluency with terms (delta, IV, DCF, etc.) or asks concisely
- **THEN** the agent responds with concise specifics and minimal framing

#### Scenario: Beginner asks a basic question

- **WHEN** the user asks a basic question or shows unfamiliarity with terms
- **THEN** the agent explains reasoning more fully but still commits to the same level of specificity in its recommendations
