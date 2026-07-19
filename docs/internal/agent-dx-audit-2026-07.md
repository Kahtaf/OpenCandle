# Agent DX Audit — 2026-07-19

Source: analysis of all agent session history in this repo — 19 Claude Code sessions (276 user messages, 2026-07-01 → 07-19), 38 interactive Codex sessions (462 messages), and 34 `codex exec` delegation runs (162 prompts, mostly authored by the Claude orchestrator via codex-first). Goal: find what the maintainer constantly re-teaches agents, which workflows are hand-driven, and which guardrails/loops would make agent development faster — especially for onboarding new engineers.

## A. What gets re-taught constantly (frequency-ranked)

| # | Pattern | Evidence |
|---|---------|----------|
| 1 | **"Verify like a user"** — live browser check (desktop 1440x960 + mobile 390x844, screenshots, response correctness) plus TUI harness runs exercising the touched code paths; failure modes, not just happy path | ~17+ separate demands across both corpora; worktree subagents structurally defer browser checks ("screenshots: deferred-to-review — no browser tooling"), so it falls through to the orchestrator/user every time |
| 2 | **Proof-stack boilerplate** — TDD failing-test-first, `npx tsc --noEmit`, `npx biome ci .`, `npm test`, targeted vitest | Restated in ~28–30 of 34 codex exec prompts; invocation details are inconsistent between prompts (whole-repo vs changed-file biome, full vs scoped tests) because there is no single named command |
| 3 | **Scope fences** — "implement exactly tasks X, nothing else", do-not-touch lists, "do not rewrite prior parallel work" | ~30 of 34 exec prompts |
| 4 | **PR merge protocol** — resolve review threads before merge, atomic commits, pull main first, switch back to main after merge | ~15 occurrences; PR #128 merged with unaddressed comments ("How did this happen?") |
| 5 | **Worktree bootstrap** — copy `.env` into worktrees, `npm ci` when node_modules missing, browser-tool availability | Blocked ~6 parallel subagents on 2026-07-04 ("No API key found for google"); recurred verbatim on 07-16 ("blocked-on-LSE_API_KEY" when the key existed) and 07-19 |
| 6 | **Token/delegation discipline** — "orchestrate only, let Codex/Sonnet do the lifting" | ~7 occurrences; five subagents killed mid-flight by the monthly spend limit on 07-16 |
| 7 | **Decision-complete specs** — "will agents be able to carry this out without making design decisions?" | ~7 occurrences; a spec-polish round is manually inserted into every orchestration cycle |
| 8 | **The 6-point subagent contract** — stop-and-report on contradiction, gates green before PR, truthful checkboxes, no mocking live evidence, no live evals without credentials, don't modify prod code to make evals pass | Hand-pasted verbatim into ~10 orchestration prompts; it is a hand-maintained guardrail spec that lives nowhere in the repo |
| 9 | **AGENTS.md conventions re-typed into Codex prompts** (`.js` extensions, `node:` prefix, no `any`, CHANGELOG entry) | ~10 exec prompts carry a "Binding repo conventions" block — apparently because Codex's auto-injected AGENTS.md is truncated at ~2KB, mid-STRUCTURE, before CODE STYLE/CONVENTIONS ever appears |
| 10 | **Commit policy flip-flops** — "do NOT git commit" (parallel spec slices) vs "commit here only" (ui-polish) | Restated per-prompt because it's a per-orchestration variable with no template |
| 11 | **Don't commit evidence/logs** | One ~70k-line diff with 26MB of traces/screenshots had to be caught manually; `docs/internal/pr-evidence/` is now git-ignored but nothing blocks the next class of junk |
| 12 | **Codex CLI gotchas** — `exec resume` ignores `-C`, model-id preflight silently skips baselines, Pi auth doesn't fall back to env keys | Relearned enough times to live in the maintainer's personal memory file, invisible to other engineers |

## B. Recurring hand-driven workflows

1. **Spec → fan-out → integrate** (run 3+ times): plan doc with FINAL decisions → integration branch + draft PR → per-item worktree + codex exec with pasted contract → waves per dependency table → autoreview → fix rounds → resolve threads → merge with explicit approval → cleanup (worktrees, branches, archive OpenSpec) with a cheap agent.
2. **PR lifecycle ritual**: atomic commits → push → `/yeet` → `npm run review:pr` → address CI + PR comments → merge → switch to main and pull.
3. **Dependency-update cadence** (4 times, roughly weekly): pull main → update deps → merge dependabot PRs → TUI harness live prompt → browser page audit.
4. **Docs refresh after feature merges**: feature lands → docs pass → separate "read as a new user" editorial agent → Codex applies fixes.
5. **UI audit → rubric → implement → dogfood → P1 fixes**, with screenshots posted to PR comments.
6. **Timeout resume**: 6 of 34 codex exec sessions needed a hand-written "your run was killed at 10 minutes, continue from the working tree, re-run the proof" prompt — resumption is a first-class workflow with no template.
7. **Overnight autonomous review**: "review all open PRs, fix findings, harness-test, atomic commits, do NOT merge — I want to wake up to a green mergeable PR."

## C. Proposed guardrails (impact-ranked)

### G1. `npm run gates` — one canonical proof command
`tsc --noEmit && biome ci . && vitest run && npm run test:agent-tools` (+ optional `--changed` scoping and React Doctor over changed `gui/web/src` files — same battery autoreview already runs in parallel). Ends the per-prompt proof-stack re-typing and the whole-repo-vs-changed-files inconsistency. Reference it once in AGENTS.md; every delegation prompt shrinks to "run `npm run gates`". Also add the missing plain `typecheck` script.

### G2. `scripts/agent-bootstrap` — worktree/env preflight
Idempotent script (and the first line of every delegation prompt): copy `.env` from the repo root if absent, `npm ci` if `node_modules` missing or lockfile newer, verify `agent-browser`/graphify availability, print the gate commands and current branch/commit policy. Kills the single biggest parallel-agent time sink (three separate incidents). Optionally wired as a hook when a worktree is created.

### G3. Check in the subagent contract; template the variables
Move the verbatim 6-point contract to `.agents/subagent-contract.md` and have the codex-first skill prepend it automatically, with the per-run variables (commit policy, test scope, owned task IDs, branch target) as explicit template fields instead of re-decided prose. Include the standard resume-after-timeout template. Also solves onboarding: a new engineer inherits the contract instead of reverse-engineering the maintainer's prompt style.

### G4. Fix the Codex AGENTS.md truncation
Codex injects only ~2KB of AGENTS.md, cutting off before CODE STYLE/CONVENTIONS — the direct cause of hand-copied convention blocks. Restructure AGENTS.md so the binding rules (gates command, code style, TDD, never-rules) sit in the first ~1.5KB, with structure/lookup tables after; or maintain a compact core section the fuller doc links from.

### G5. Mechanical "verify like a user" gate
- `npm run harness:smoke`: one scripted TUI harness prompt end-to-end, asserting the expected `opencandle-*` trace entries — cheap enough for the PR ritual, already half-built in `tests/harness/`.
- Autoreview diff-signal: GUI-file changes without screenshot/browser evidence in the PR → advisory the reviewer must confirm or dismiss (the diff-signals mechanism already exists).
- Decide the browser tool once (agent-browser vs built-in Chrome tools — currently contradictory instructions across sessions) and write it into gui/AGENTS.md.

### G6. `merge-ready` check
Small script/skill run before any merge: CI green on all legs **and** zero unresolved review threads (via `gh api`), refuse otherwise. Wire into yeet/codex-first close-out. Directly prevents the PR #128 class ("merged before comments addressed") without needing the approver gate that was rolled back for solo maintenance.

### G7. Spec-readiness check in openspec-propose/apply
A closing checklist pass over a change before dispatch: no unresolved design decisions, every file:line anchor verified to exist, branch/commit policy stated, verification steps included, task ownership partitioned for parallel runs. Automates the manual "polish pass" inserted into every orchestration cycle.

### G8. Evidence-junk pre-commit guard
Autoreview diff-signal or pre-commit check: block/flag commits adding large binaries, `trace*.json`, screenshots, or eval dumps outside allow-listed paths. One-time catch was manual; the next one shouldn't be.

### G9. Small hygiene fixes
- graphify hooks test for `graphify-out/graph.json`, which doesn't exist at that path — verify the hooks actually fire; the referenced `graphify-out/wiki/` also doesn't exist.
- Expose `autoreview` as a slash skill (it's the only `.agents` skill not symlinked into `.claude/skills/`).
- Move the Codex CLI gotchas from personal memory into `.agents/skills/codex-first/` so other engineers hit fewer of them.

## D. Proposed loops (autoreview-style, self-running)

1. **Weekly dependency loop** — schedule the exact ritual already run by hand: pull main, update deps, merge dependabot PRs, `npm run gates`, harness smoke, browser page audit; open a PR with evidence, never merge.
2. **Scheduled dogfood loop** — periodic browser dogfooding of the GUI (send prompts, add to portfolio/alerts, both viewports) producing a severity-ranked P1 findings doc, mirroring the manual UI-audit workflow.
3. **Docs new-user loop** — after feature PRs merge, an agent reads every public docs page as a first-time user and files editorial findings (fluff, internal vocabulary, stale claims) — run twice by hand already.
4. **Nightly canary extension** — the drift canary exists; add the harness smoke and a headless GUI boot to it so "TUI harness still works" stops being a per-session request.

## E. Suggested build order

1. G1 + G2 + G9 (hours, removes the highest-frequency friction immediately)
2. G3 + G4 (turns the orchestration prompt from ~1.5KB of boilerplate into a few template fields)
3. G5 + G6 (mechanizes the two most-repeated quality demands)
4. G7 + G8, then loops D1–D3 as scheduled agents once the gates are stable
