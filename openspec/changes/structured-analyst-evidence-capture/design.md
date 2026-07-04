## Context

The workflow runner already passes accumulated `priorEvidence` to each step executor, and `StepOutput` already carries an `evidence` array. The current prompt-step executor returns an empty array and relies on a comment saying tool hooks will capture evidence later. Structured analyst parsers also exist, but the live workflow does not call them.

The I2 implementation is intentionally observe-only. It must make real runtime state visible to later deterministic validation work without changing analyst prompt text, parser logic, Pi extension hooks, persistence schemas, or run-failure semantics.

## Goals / Non-Goals

**Goals:**

- Capture tool calls/results that occur during each workflow step as scoped evidence records.
- Preserve enough readable tool evidence for traces: serialized args truncated to 500 characters, and a result digest with a 500-character preview plus total serialized length.
- Parse analyst and debate outputs after settlement, append custom entries, and keep the workflow moving even when parsing fails.
- Keep generated analyst prompts explicitly deferred.

**Non-Goals:**

- No prompt-template edits, including `ANALYST_PROMPTS`, debate prompts, synthesis prompts, or validation prompts.
- No parser logic changes in `src/analysts/contracts.ts`.
- No SQLite schema changes.
- No Pi extension hook changes.
- No enforcement, blocking, or final-answer validation changes.

## Decisions

1. Capture evidence from the existing session event stream inside the workflow executor closure. This keeps the implementation scoped to `SessionCoordinator.startWorkflowRun` and avoids `src/pi/` changes.
2. Represent captured tool evidence as existing `EvidenceRecord` values with a `computed` provenance source and a value object containing `{ tool, args, resultDigest, startedAt, completedAt }`. This avoids adding a new persistent schema while preserving the I2 record shape.
3. Parse the final assistant text by reading new session transcript entries produced during the step. This keeps parsing observe-only and independent of model streaming internals.
4. Store parsed structures on the step output as optional fields, and append compact `opencandle-analyst-step` entries for the harness and GUI projector.
5. For parse failure, issue one follow-up re-prompt that points back to the format contract already present in the step prompt. If the retry fails, append `parsed: false` and continue.
6. Leave the generated-prompt requirement in the base spec as future work. This change documents that deferral rather than weakening the requirement.

## Risks / Trade-offs

- Tool events may arrive outside the active step window if a run is cancelled or superseded. The executor unsubscribes per step and checks the active run guard to avoid cross-run leakage.
- Session-entry parsing is less direct than a dedicated Pi hook, but adding a hook would violate the I2 stop condition. Tests cover scoped evidence and parsed entries through mocked events/entries.
- The existing parser can return default-looking structures on malformed text. The implementation treats parsing as successful only when the required labels are present in the text before storing parsed output.
- The re-prompt can add an extra assistant turn. It is bounded to one retry and only for structured analyst/debate steps.
