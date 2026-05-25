## 1. Reproduce and Specify

- [x] 1.1 Reproduce the `unknown-ticker-earnings-risk` strict manifest failure or capture the latest failing report path.
- [x] 1.2 Add a failing unit test that locks the supplied-but-unverified ticker policy obligation.

## 2. Implement Stabilization

- [x] 2.1 Harden ticker-disambiguation policy guidance for supplied-but-unverified earnings/event-risk prompts.
- [x] 2.2 Preserve clarification behavior for genuinely missing-symbol prompts.

## 3. Validation

- [x] 3.1 Run focused ticker-disambiguation policy-card tests.
- [x] 3.2 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_IDS=unknown-ticker-earnings-risk PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [x] 3.3 Run `PROMPT_POLICY_STRICT=1 PROMPT_POLICY_TIMEOUT_MS=300000 npx tsx tests/scripts/run-prompt-policy-manifest.ts`.
- [x] 3.4 Run `npm test`.
- [x] 3.5 Run `graphify update .`.
- [x] 3.6 Update `CHANGELOG.md` and migration evidence docs.
