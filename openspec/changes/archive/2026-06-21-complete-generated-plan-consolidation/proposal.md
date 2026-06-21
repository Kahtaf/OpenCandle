## Why

The generated `plans/` backlog was used as an implementation queue for audit follow-up work. Its tasks have now been implemented, including the remaining GUI server decomposition and prompt-layer consolidation work. Keeping the completed backlog at the repository root creates a stale parallel planning system next to OpenSpec.

## What Changes

- Move the completed generated plan records under this OpenSpec change as archived source evidence.
- Mark all generated plans complete, including GUI server decomposition and prompt consolidation Phase B.
- Keep this as a consolidation-only change; it does not introduce new product requirements or modify base specs.
- Archive this change with `--skip-specs` after validation so OpenSpec remains the single home for completed implementation records.

## Impact

- Root `plans/` folder is removed.
- Historical plan content remains available under the archived OpenSpec change.
- No runtime behavior changes are introduced by the migration itself.
