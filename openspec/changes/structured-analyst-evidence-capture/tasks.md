## 1. Tests First

- [x] 1.1 Add failing tests for per-step tool evidence capture and prior-evidence propagation.
- [x] 1.2 Add failing tests for analyst/debate parse success, single retry, parsed:false continuation, and unchanged skippable-step semantics.
- [x] 1.3 Add failing custom-entry harness coverage for `opencandle-analyst-step`.
- [x] 1.4 Add failing projector coverage for `analystsDone`.

## 2. Implementation

- [x] 2.1 Implement scoped tool-event evidence capture in the workflow executor closure.
- [x] 2.2 Store structured analyst/debate parse results on step outputs and append `opencandle-analyst-step` entries.
- [x] 2.3 Implement bounded one-time re-prompt behavior for parse failures without changing prompt templates.
- [x] 2.4 Update the projector to count analyst-step entries.

## 3. Evidence and Closeout

- [x] 3.1 Update `CHANGELOG.md` and `NOTES.md`.
- [x] 3.2 Run unit/named gates and full static/test gates.
- [x] 3.3 Run the live `analyze NVDA` harness and commit trace evidence.
- [x] 3.4 Run `graphify update .` after code changes.
