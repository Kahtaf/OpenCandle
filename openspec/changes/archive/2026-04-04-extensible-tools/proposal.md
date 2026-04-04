## Why

OpenCandle's 22 tools are hardcoded in `src/tools/index.ts`. Adding a new tool requires editing core source and rebuilding. Contributors and ecosystem authors have no way to ship tools as separate packages that feel native. The `tool-kit.ts` export layer exists but frames add-on tools as "third-party" — creating a false distinction when they should just be OpenCandle tools that happen to live in a separate package.

## What Changes

- Rename `thirdPartyToolRegistry` / `registerOpenCandleTools` / `getThirdPartyToolDescriptions` to remove the "third-party" framing — add-on tools are first-class OpenCandle tools
- Rename "Third-Party Tools" heading in system prompt `buildToolCatalog()` and `PromptContextBuilder` options to match (existing prompt injection through `SessionCoordinator` → `PromptContextBuilder` → `tool-catalog` section is already correct)
- Add a `createTool()` helper in `tool-kit.ts` that validates OpenCandle conventions at definition time (snake_case name, Typebox params, required description) — does not validate async `execute()` output at runtime
- Add duplicate tool name detection: warn on collision when registering add-on tools
- Create an agent-friendly "Build a Tool" guide documenting the tool contract, conventions, and how Pi extension discovery works
- Create a template repository (`opencandle-tool-template`) with a working example (Twitter sentiment tool) that a coding agent can scaffold from
- Add a consumer-facing smoke test in this repo that exercises `opencandle/tool-kit` exports

## Capabilities

### New Capabilities
- `tool-extensibility`: Add-on tool registration, discovery via Pi extensions, dynamic system prompt integration, and conventions enforcement via `createTool()` helper
- `tool-authoring-docs`: Agent-friendly documentation and template for building OpenCandle tools as separate packages

### Modified Capabilities

## Impact

- **`src/tool-kit.ts`**: Rename exports, add `createTool()` helper, add duplicate-name warning
- **`src/prompts/context-builder.ts`**: Rename `thirdPartyToolDescriptions` option and "Third-Party Tools" heading
- **`src/runtime/session-coordinator.ts`**: Update to use renamed exports
- **`src/index.ts`**: Update re-export of renamed function
- **`tests/unit/tool-kit.test.ts`**: Update to use renamed exports, add new tests
- **`package.json` exports**: `opencandle/tool-kit` subpath unchanged but API surface grows
- **Docs**: New `docs/build-a-tool.md` guide
- **Template repo**: New `opencandle-tool-template` (separate repo, referenced from docs)
- **Breaking changes**: Renames to public API of `tool-kit.ts` and root export. Acceptable — 0 external consumers
