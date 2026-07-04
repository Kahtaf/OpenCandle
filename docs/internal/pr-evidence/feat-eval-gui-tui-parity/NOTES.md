# GUI/TUI Parity Eval Evidence

## Scope

- Branch: `feat/eval-gui-tui-parity`
- Prompt: `analyze NVDA`
- TUI path: `runOpenCandleSession()`
- GUI path: `POST /api/sessions/{sessionId}/runs` through the live GUI server at `127.0.0.1:14667`

## Result

The new parity eval is intentionally marked `it.fails(...)` because current behavior is not in parity:

- TUI emits the expected `opencandle-*` sequence, including eight `opencandle-analyst-step` entries.
- GUI chat-run API starts the same prompt, emits an initial `get_stock_quote` tool start, then ends the SSE stream with `run.failed`.
- The GUI snapshot after the failed run has no `opencandle-*` custom entries and no projector active analysis, so the dashboard `analystsDone` invariant cannot be satisfied yet.

This follows the eval-author rule: the test records the finding instead of changing production prompts or runtime behavior in the eval PR.

## Evidence

- `gui-tui-parity-preassert.json`: final expected-fail run diagnostics from the eval.
- `gui-tui-parity-preassert.png`: screenshot captured by the eval before the known-failing assertion.
- `latest-gui-session-summary.json`: persisted GUI session summary showing the run stopped after the first assistant tool call and left the action pending.
- `live-gui-agent-browser.png`: real browser screenshot captured with `npx agent-browser`.

## Commands

```bash
OPENCANDLE_GUI_BROWSER=1 \
OPENCANDLE_GUI_URL=http://127.0.0.1:14667 \
OPENCANDLE_GUI_TUI_PARITY_EVIDENCE_DIR=docs/internal/pr-evidence/feat-eval-gui-tui-parity \
npx vitest run --config vitest.config.gui.ts \
  -t "keeps opencandle trace and dashboard projection in parity with the TUI path"
```

Result: `1 expected fail | 24 skipped`.
