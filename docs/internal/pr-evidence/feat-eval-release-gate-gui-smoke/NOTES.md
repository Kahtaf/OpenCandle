# feat/eval-release-gate-gui-smoke Evidence

Scope: credential-free release-gate GUI smoke only. No model round-trip, no model mocking, and no E6 parity case.

## Focused Smoke

Command:

```bash
OPENCANDLE_GUI_SMOKE_EVIDENCE_DIR=docs/internal/pr-evidence/feat-eval-release-gate-gui-smoke npm run test:gui:release-smoke
```

Result: passed, 1 file / 2 tests.

Assertions covered:

- GUI server boots and `/health` responds.
- Home route renders in a real Chromium browser.
- First-run model setup uses production requirement values from `gui/server/model-setup.ts` and resolves to `connect_auth` in an isolated credential-free home.
- Chat composer and send button are disabled until model setup is ready.

Artifacts:

- `gui-server.log`
- `first-run-home.png`

## Gate Notes

- `npx tsc --noEmit`: passed.
- `npx biome ci .`: passed with existing warnings.
- `npm test`: passed, 221 files / 2299 tests.
- `npm run test:gui:release-smoke`: passed.
- `npm run release:check`: passed end to end.
