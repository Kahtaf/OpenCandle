## Design

This is an owner-promotion migration, not a workflow rewrite.

States:

1. `observe_only`: options planning metadata records `options_strategy`, but no options policy card renders.
2. `dual_run`: the options policy card renders alongside existing options workflow prompt guidance.
3. `replacement_active`: the options policy card and answer contract own cross-cutting options obligations; workflow prompts still own concrete option-chain workflow instructions.

No fallback playbook clause is removed in this change because options behavior is primarily workflow-owned today. The acceptance gate is parity plus prompt-assembly isolation: options policy injection must not alter non-options agent-task prompts or compare/portfolio workflow context.

## Review Loop

Before implementation:

1. Validate the OpenSpec change strictly.
2. Review this change against `docs/internal/prompt-to-policy-parity-ledger.md#options-existing-position`.
3. Confirm the manifest prompts `covered-call-routing` and `protective-put-routing` cover the protected behavior.
4. Only then apply the tasks.

After implementation:

1. Review focused unit-test failures before code changes.
2. Run dual-run parity before replacement-active.
3. Run replacement-active parity and strict manifest before archive.
