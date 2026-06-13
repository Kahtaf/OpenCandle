## 1. Acceptance Gate

- [ ] 1.1 Run `npm run eval:router-live` with credentials present.
- [ ] 1.2 Confirm pass-rate, latency, and cost meet the production-router gate.
- [ ] 1.3 Document the release-window evidence in the PR.

## 2. Router Removal

- [ ] 2.1 Make LLM router the unset-env default.
- [ ] 2.2 Remove rules-mode input dispatch as a production path.
- [ ] 2.3 Preserve deterministic post-processing and provider/tool validation safety nets.
- [ ] 2.4 Remove or deprecate `OPENCANDLE_ROUTER_MODE=rules` after the rollback window decision.

## 3. Verification

- [ ] 3.1 Update config, extension, and fixture tests.
- [ ] 3.2 Run `npm test`, `npm run build`, and router evals.
