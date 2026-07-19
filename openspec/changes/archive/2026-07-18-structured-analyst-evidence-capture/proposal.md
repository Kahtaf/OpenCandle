## Why

The structured-analysts spec already requires typed analyst outputs, structured evidence flow, and structured synthesis inputs, but the live comprehensive-analysis workflow still treats every step as free text and returns empty step evidence. This change activates the observe-only evidence and parsing spine needed for compliance while preserving the current prompt templates.

## What Changes

- Capture per-step tool evidence from existing session tool events and store it on `StepOutput.evidence`.
- Parse completed analyst and debate step text with the existing contracts, append `opencandle-analyst-step` entries, and continue on parse failure.
- Re-prompt a failed analyst/debate parse exactly once using the already-present output-format contract, then record `parsed: false` if the retry still fails.
- Update the GUI projector to derive `analystsDone` from `opencandle-analyst-step` custom entries.
- Deliberately defer the existing spec requirement to generate analyst prompts from typed step contracts. This change does not edit `ANALYST_PROMPTS` or other prompt template text.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `structured-analysts`: Add observe-only evidence capture and structured output parsing behavior while documenting generated-prompt compliance as deferred for this slice.

## Impact

- Runtime workflow execution: `src/runtime/prompt-step.ts`, `src/runtime/session-coordinator.ts`, and workflow event payloads if step-linked tool events need richer metadata.
- Analyst orchestration: entry-emission wiring only, with no template literal or prompt text changes.
- GUI dashboard projection: `analystsDone` counting from custom analyst-step entries.
- Tests, changelog, notes, committed runtime evidence, and OpenSpec change artifacts.
