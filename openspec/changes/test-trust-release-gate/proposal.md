# Elevate test trust and release evidence

Status: **Approved on 2026-09-24; implementation in progress.** The maintainer requested ACPX DSH DeepSeek 4.1 Flash implementation workers, with the parent agent orchestrating and reviewing.

## Why

Keep the maintainer's existing release signal: e2e evals and the competitive harness. Add proof that the shipped product works, its critical failure paths are safe, and the tests actually detect regressions.

The [September audit](../../../docs/internal/test-coverage-audit-2026-09-24.md) found 350 unit-project files, valuable integration tests mixed into that project, brittle GUI source assertions, missing coverage tooling, and useful browser tests outside mandatory gates. The release script asks for manual eval confirmation; publish validates `release:check` but does not verify eval reports. These gaps permit green checks without complete release evidence.

## What changes

1. Establish an inventory of all executable tests/evals and their protected contracts, execution boundaries, skips, and gate routing.
2. Repair coverage collection and introduce per-surface coverage baselines, while measuring whether assertions detect deliberate defects.
3. Make deterministic GUI, TUI, provider, and persistence journeys mandatory alongside focused numerical/security tests.
4. Audit all existing tests in bounded batches; retain, consolidate, replace, or remove them with explicit evidence.
5. Validate eval checkers and harness completion semantics, preserving live evals and the frozen competitive panel as release requirements.
6. Require complete, traceable release evidence and validate the actual packaged artifact before publication.

The detailed rollout, gate policy, acceptance criteria, and proposed operating rules are in [plan.md](plan.md).

## Scope and dependencies

Expected changes span test projects, fixtures, browser/process harnesses, coverage dependencies/configuration, eval reporting, release/publish scripts, CI, and testing guidance. Start with existing infrastructure. Do not add a production provider, alter memory schemas, or change system prompts/analyst orchestration under this proposal.

Coordinate with the existing [competitive-panel-hard-assertions proposal](../competitive-panel-hard-assertions/proposal.md): it owns competitive cache freshness, new panel assertions, and judge-noise disclosure. Do not duplicate that work or assume the unchecked proposal is implemented.

## Non-goals

- Replacing live quality evals with mocks or moving costly competitive runs into every PR.
- Moving every mathematical/security combination into a browser.
- Chasing 100% coverage, a deletion quota, or arbitrary competitive win rates.
- Changing production behavior merely to satisfy new assertions; uncovered defects become separate, appropriately scoped fixes.
- Adding a new test framework before demonstrating that existing tools cannot provide the required proof.

## Approval requested

Approve the phased plan and its gate policy. Approval covers implementation in bounded reviewable changes, including proposed test removals only after their remaining protection is documented. Publishing a release is outside this proposal.
