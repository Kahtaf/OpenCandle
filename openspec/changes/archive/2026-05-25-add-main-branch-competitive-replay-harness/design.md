## Design

Create a reusable comparison module for competitive finance reports instead of embedding comparison logic in the CLI. The module consumes report JSON already emitted by `tests/scripts/run-competitive-finance-eval.ts` through the existing `analyzeCompetitiveReport()` public helper.

The comparison report should be intentionally close to product replay:

- `status`: `compared` or `unsupported`
- `current` and `base` run summaries
- aggregate OpenCandle win/loss/tie deltas
- per-prompt changes keyed by prompt id
- planning telemetry from each report when present
- cached competitor coverage to prove the same generic-agent answers were reused where available

The first CLI path should support comparing two existing competitive reports. A second path may run fixed prompts against a base ref by reusing the current branch script from the current checkout, but unsupported base execution must be recorded honestly.

## Review Notes

- The spec is general: it compares prompt/report behavior and does not encode ticker-specific expectations.
- The harness is evidence-producing, not an answer prompt expansion.
- Live model calls remain outside unit tests.
