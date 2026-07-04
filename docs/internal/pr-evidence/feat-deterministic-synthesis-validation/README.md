# Deterministic Synthesis Validation Evidence

Live command:

```bash
npx tsx tests/harness/cli.ts run --prompt "analyze NVDA" --ipc <tmp-ipc-dir>
npx tsx tests/harness/cli.ts answer --ipc <tmp-ipc-dir> --value "Use a 10% stop-loss."
```

Artifacts:

- `trace.json` — redacted live harness trace showing `tally_injected`, the `## Deterministic Analyst Vote Tally` block, and `opencandle-validation`.
- `events.jsonl` — redacted live tool/session event stream from the same run.
- `status` — final IPC status (`done`).

Validation probe:

```json
{
  "hasTallyInjected": true,
  "hasTallyBlock": true,
  "hasValidation": true,
  "hasValidationEvent": true,
  "leakedAlphaKey": false
}
```
