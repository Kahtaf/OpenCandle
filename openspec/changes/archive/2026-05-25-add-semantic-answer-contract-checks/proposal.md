## Summary

Add observe-only semantic answer contract checks for recurring parity obligations such as assumptions, tax caveats, target bands, and "when not ideal" sections.

## Motivation

Main often performs well because the large router prompt embeds many answer-quality reminders. The prompt-to-policy architecture should move those reminders into typed, testable, observable checks that can later graduate into active retries.

This change keeps V1 non-invasive: checks are diagnostic only and operate on answer text plus existing metadata.

## Scope

In scope:

- add generic structured check IDs for assumption disclosure, tax caveats, target bands, and when-not-ideal guidance
- run those checks in observe-only mode from answer text
- attach the checks to relevant policy-card refinements such as options education and portfolio rebalance review
- include check IDs/failures in planning telemetry
- add unit coverage for pass/fail behavior

Out of scope:

- active retries or answer rewriting
- exact financial/tax advice generation
- ticker/sector-specific check logic
- replacing human review of judge rubrics

## Acceptance

- Structured checks can fail/pass on answer text while remaining observe-only.
- Relevant planning selections include semantic check IDs.
- The harness preserves semantic check IDs/failures in eval traces.
- Unit tests cover both passing and failing semantic checks.
