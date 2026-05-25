## Design

Add a small artifact contract registry in runtime/planning code.

The registry defines stable IDs, owning task families, and whether the artifact is trace-only or renderable. V1 remains trace-only. This avoids building a UI before the product has proven which structures matter.

Initial contract IDs:

- `concept_example_table`: compact example/comparison table for educational prompts
- `portfolio_exposure_map`: structural exposure map for portfolio review/rebalance prompts
- `rebalance_action_plan`: staged action plan for rebalance prompts
- `source_coverage_table`: source/gap summary for sentiment, filing, and current-event prompts

Planning can include these IDs when a selected task family or policy card benefits from structured intermediate work. V1 exposes the IDs through traces and reports only; this change does not require prompt assembly changes, rendered artifacts, or persisted artifact generation.

## Review Notes

- This ties back to the roadmap by turning future workspace/artifact work into typed contracts rather than free-form prompt wishes.
- It is general because contracts describe structures, not tickers or sectors.
- It is maintainable because trace-only contracts can be validated before UI or persistence exists.

## Validation

- unit tests for artifact registry validation
- planning tests for selected artifact contract IDs
- eval trace/report tests for artifact metadata exposure
- full build/test/graph update
