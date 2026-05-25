## Design

Extend the existing structured-check system rather than creating a new evaluator.

The first semantic checks should be simple and conservative:

- `assumption_disclosed`: looks for explicit assumption language
- `tax_caveat_present`: looks for tax/account/jurisdiction caveat language
- `target_bands_present`: looks for target band/range/rebalance threshold language
- `when_not_ideal_present`: looks for "not ideal", "avoid", "when this fails", or equivalent unsuitability language

`runStructuredChecks()` should accept optional `answerText`. If omitted, semantic checks should pass only when the check is not requested; requested semantic checks should fail with an observed-only reason. This keeps report gaps visible.

Planning selections should add semantic check IDs only for generic task/policy obligations:

- portfolio rebalance review: assumptions and target bands
- options education: tax caveat and when-not-ideal
- inflation/cash education: tax caveat where relevant

## Review Notes

- The checks are intentionally broad and not ticker-specific.
- They are observe-only so they cannot cause output churn yet.
- The design replaces prompt reminders with typed telemetry.
