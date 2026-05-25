## Design

The slice follows the established migration pattern:

1. Add a fixed manifest prompt for `current-single-asset-freshness` because the ledger row currently names a future manifest prompt but the manifest does not contain a pure single-asset buy/wait/avoid case.
2. Run baseline ref parity with the shared manifest path so baseline and current both evaluate the new prompt text.
3. Implement the policy card and answer contract in dual-run mode while fallback item 16 remains present.
4. Activate replacement mode by omitting fallback item 16 only for replacement-active `single_asset_decision` turns.

The evidence plan remains a placeholder in this slice. Existing tools continue to provide quote, fundamentals, technicals, sentiment/news, and other raw tool-result evidence through the workflow and harness.

## Validation

- focused manifest and ref parity for the new single-asset prompt
- focused policy-card, answer-contract, planning, and prompt-assembly tests
- full `npm test`
- `graphify update .`
