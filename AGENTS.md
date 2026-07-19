# OPENCANDLE

Financial data analysis agent. TypeScript + Vitest + Pi shell framework.

## COMMANDS
```bash
npm start                      # run agent (tsx src/cli.ts)
npm run gui                    # run local browser GUI at 127.0.0.1:14567
npm test                       # unit tests — full test menu in tests/AGENTS.md
npm run lint                   # biome check (CI gates on this)
npm run typecheck              # TypeScript typecheck without emitting files
npm run gates                  # full agent handoff proof battery
npm run bootstrap:agent        # prepare a fresh agent worktree
npm run eval -- <suite>        # eval front door — the only supported eval surface
npm run review:pr              # repo autoreview + typecheck/lint/test gate
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| New market tool | `src/tools/<domain>/` | → `src/tools/AGENTS.md` |
| New API provider | `src/providers/` | Wrap with `wrapProvider()`; fixture in `tests/fixtures/` |
| New workflow | `src/workflows/` | Wire routing in `src/routing/` |
| Tests, evals, fixtures | `tests/` | → `tests/AGENTS.md` |
| Local GUI | `gui/` | → `gui/AGENTS.md` |
| Type definitions | `src/types/<domain>.ts` | One file per domain |
| Memory / persistence | `src/memory/` | SQLite-backed |
| System prompt | `src/system-prompt.ts` | Core AI persona instructions |
| Pi shell integration | `src/pi/` | Extension, session, tool adapter |
| Add-on tool package | `docs/build-a-tool.md` | Tools as separate npm packages |

Core abstractions (most-connected in the codebase; start here when tracing behavior):
- `SessionCoordinator` (`src/runtime/session-coordinator.ts`) — session/turn orchestration
- `MarketStateService` (`src/market-state/service.ts`) — durable watchlists, portfolios, alerts, reports
- `cache` / `rateLimiter` (`src/infra/`) and `wrapProvider()` (`src/providers/wrap-provider.ts`) — every external call goes through these

## CODE STYLE
- Files kebab-case; tool names snake_case with Typebox params — copy the shape of an existing tool in `src/tools/market/`.
- Imports: `node:` prefix for builtins, `.js` extensions on relative imports, `type` keyword for type-only imports.
- Strictly typed. No `any` except provider raw API responses.

## CONVENTIONS
- **TDD mandatory**: write failing test first, then implement - refer to tdd skill
- Tools fetch + format. Analysts/LLM synthesize. Never analyze within a tool.
- Use `cache` and `rateLimiter` from `src/infra/` for all external calls.
- Tests mock `globalThis.fetch` with fixture JSON. No live API calls in unit tests.

## GIT & REVIEW
- Conventional commits (`feat:`, `fix:`, `docs:`, `style:`, `chore:`); atomic commits — one logical change per commit.
- Run `npm run review:pr` (autoreview) after every sizable piece of work, before opening or updating a PR.
- For new atomic features or bug fixes, update the @CHANGELOG.md (use changelog-automation skill).

## DELEGATION

Prepend `.agents/delegation/subagent-contract.md` to delegation prompts and fill its per-run variables. Resume interrupted runs with `.agents/delegation/resume-template.md`.

## VERIFY LIKE A USER
Unit tests passing is not done. Exercise the change on the live product before declaring it complete:
- **Agent/TUI behavior**: drive OpenCandle headlessly with the TUI harness — `runOpenCandleSession()` from `tests/harness/opencandle-runner.ts` for scripted runs, or `npx tsx tests/harness/cli.ts run/wait/answer/trace --ipc <dir>` for interactive ask-user driving → `tests/harness/README.md`.
- **GUI behavior**: click through the live GUI in a real browser — use the `@browser` tool (Codex) or `npx agent-browser` when `@browser` isn't available.

When fixing eval or competitive-benchmark regressions, classify the issue into the narrowest durable layer before editing prompts: routing/planning, slot/entity extraction, tool capability, evidence normalization, policy card, workflow prompt, answer contract, structured check, eval assertion, or harness. Do not append benchmark-specific instructions to the fallback playbook or a broad prompt. If production prompt guidance changes, run `npx vitest run tests/unit/prompts/prompt-debt-guard.test.ts` and keep benchmark literals in manifests/tests only.

## BOUNDARIES

**Always (do autonomously):**
- Run `npm run gates` before handing off work (`npm test` alone mid-loop is fine)
- Follow Pi conventions where possible (sessions, TUI) (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/index.md)
- Add fixture JSON in `tests/fixtures/<provider>/` for new API responses
- Use existing `cache`/`rateLimiter` infra for new providers

**Ask first:**
- Adding a new provider (needs rate-limit config, fixture strategy)
- Changing system prompt or analyst orchestration
- Modifying Pi shell integration (`src/pi/`)
- Schema changes in memory SQLite tables
- Larger features or breaking changes → OpenSpec proposal first (`openspec/`, opsx skills)

**Never:**
- Prompt engineering: never overfit prompts to specific tickers, sectors, rates, dollar amounts, share counts, or benchmark phrases
- Guess financial numbers, prices, ratios, or metrics
- Downplay downside scenarios; always flag risks prominently
- Hardcode mock data in tools; use providers
- Make live API calls in unit tests
- Draw conclusions until all relevant data is gathered

## RUNTIME STATE
- Pi config: `.pi/` and `~/.pi/agent/` — do not move into OpenCandle storage.
- OpenCandle user state: `~/.opencandle/` — CLI must not depend on repo-local `.pi/extensions/`.
- GUI writer/follower: one process holds `writer.lock` per Pi session; followers are read-only and poll/re-render session entries.

## GRAPHIFY

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
