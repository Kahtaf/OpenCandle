## ADDED Requirements

### Requirement: System prompt is assembled from named sections
The `PromptContextBuilder` SHALL assemble the system prompt from discrete named sections: `base-role`, `safety-rules`, `tool-catalog`, `workflow-instructions`, `memory-context`, `provider-status`, and `output-format`. Each section is a typed object with a name, content string, and character budget.

#### Scenario: Sections are assembled in defined order
- **WHEN** the system prompt is built for a new agent turn
- **THEN** sections are assembled in the order: base-role, safety-rules, tool-catalog, workflow-instructions, memory-context, provider-status, output-format

#### Scenario: Section content is generated independently
- **WHEN** the memory-context section is built
- **THEN** it calls the MemoryManager for selective retrieval, independent of other sections

### Requirement: Each section has a character budget
Each prompt section SHALL define a maximum character budget. If a section's content exceeds its budget, it SHALL be truncated with a marker indicating truncation occurred.

#### Scenario: Memory section respects budget
- **WHEN** selective memory retrieval produces 5000 characters but the memory-context budget is 2000 characters
- **THEN** the section is truncated to fit within 2000 characters with a truncation indicator

#### Scenario: Small section uses its full content
- **WHEN** the base-role section produces 500 characters and its budget is 1000 characters
- **THEN** the full 500 characters are included without truncation

### Requirement: Workflow-specific instructions are injected dynamically
When a workflow is active, the `workflow-instructions` section SHALL contain instructions specific to that workflow type. When no workflow is active (general QA), the section SHALL be empty or contain minimal default guidance.

#### Scenario: Portfolio workflow injects portfolio instructions
- **WHEN** a `portfolio_builder` workflow is active
- **THEN** the workflow-instructions section contains portfolio-specific guidance (allocation format, risk review steps, assumption disclosure format)

#### Scenario: General QA has no workflow instructions
- **WHEN** the user asks "what is the P/E ratio"
- **THEN** the workflow-instructions section is empty

### Requirement: Third-party tool descriptions are part of the tool-catalog section
Third-party tool descriptions currently appended in the extension's `before_agent_start` hook SHALL be included in the `tool-catalog` section by the PromptContextBuilder.

#### Scenario: Third-party tools are in the tool-catalog section
- **WHEN** third-party tools are registered
- **THEN** their descriptions appear in the tool-catalog section alongside built-in tool descriptions

### Requirement: Monolithic buildSystemPrompt is replaced
The current `buildSystemPrompt()` function in `system-prompt.ts` SHALL be replaced by the `PromptContextBuilder`. The extension's `before_agent_start` hook SHALL delegate to the builder instead of concatenating strings.

#### Scenario: Extension delegates to PromptContextBuilder
- **WHEN** the `before_agent_start` event fires
- **THEN** the extension calls `PromptContextBuilder.build()` and returns the assembled prompt
- **THEN** no string concatenation happens in the extension
