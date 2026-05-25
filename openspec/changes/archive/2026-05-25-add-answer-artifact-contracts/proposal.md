## Summary

Promote artifact placeholders into typed answer artifact contracts.

The planning layer already carries `artifactPlaceholderIds`. This change defines a small contract registry for the kinds of intermediate structures OpenCandle should be able to compare and eventually render: education examples, exposure maps, rebalance action plans, and source coverage tables.

## Motivation

OpenCandle will not become the best financial agent by relying only on prose. The new architecture should make repeatable answer structures visible to tests and evals, while avoiding a premature workspace UI.

Typed artifact contracts give the planner an extensible hook for structured work without implementing persisted artifacts yet.

## Scope

In scope:

- add typed artifact contract IDs and registry metadata
- connect selected planning slices to artifact contract IDs
- keep output as trace metadata only in this change
- update eval reporting/tests to expose artifact contract IDs where planning metadata is already reported

Out of scope:

- persisted workspaces
- user-visible artifact UI
- generated spreadsheets/documents/charts
- semantic validation of artifact contents
- provider additions

## Acceptance

- Planning metadata can expose typed artifact contract IDs separately from untyped placeholders.
- Concept education can request an example-table artifact contract.
- Portfolio rebalance review can request exposure-map and rebalance-action-plan artifact contracts.
- Sentiment/source-heavy tasks can request source-coverage table contracts when already applicable.
- Reports include the contract IDs without requiring rendered artifacts.
