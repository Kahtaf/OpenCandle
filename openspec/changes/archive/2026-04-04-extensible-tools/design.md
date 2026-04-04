## Context

OpenCandle is a Pi extension that registers 22 financial tools. The `tool-kit.ts` module already exports infrastructure (`cache`, `rateLimiter`, `httpGet`, `Type`, `AgentTool`) and a `registerOpenCandleTools()` function for external tool registration. However, the naming frames add-on tools as "third-party" and there's no documentation, template, or convention enforcement to guide tool authors.

The system prompt already integrates add-on tool descriptions through a working pipeline: `SessionCoordinator.buildSystemPrompt()` → `PromptContextBuilder.populateFromOptions()` → `buildToolCatalog()` which appends them to the `tool-catalog` section. This pipeline just needs renaming — not new wiring.

Pi's extension system already handles discovery (via `package.json` `pi.extensions` field) and loading. OpenClaw embeds Pi, so any Pi extension automatically works in OpenClaw.

## Goals / Non-Goals

**Goals:**
- Make it trivial for someone with a coding agent to build and publish an OpenCandle tool package
- Add-on tools feel first-class: same conventions, same system prompt presence, same agent awareness
- Lean on Pi's extension infrastructure — no custom plugin discovery
- Provide a `createTool()` helper that validates conventions at definition time
- Warn on duplicate tool name collisions across packages

**Non-Goals:**
- No OpenCandle-specific plugin discovery or marketplace
- No changes to intent classification / workflow routing for add-on tools (LLM figures it out from tool descriptions)
- No CLI scaffolding command (template repo is sufficient)
- No runtime tool loading / hot-reload — tools register at extension init time
- No deep integration hooks for `/analyze` orchestration (future work if needed)
- No metadata beyond `name`/`description` (no `category`, `namespace`, `keywords` — add when a real use case emerges)

## Decisions

### 1. Rename "third-party" to "addon" across the codebase

Rename in `tool-kit.ts`:
- `thirdPartyToolRegistry` → `addonToolRegistry`
- `registerOpenCandleTools` → `registerTools`
- `getThirdPartyToolDescriptions` → `getAddonToolDescriptions`

Rename in `context-builder.ts`:
- `thirdPartyToolDescriptions` option → `addonToolDescriptions`
- `"Third-Party Tools"` heading → `"Add-on Tools"`

Rename in `session-coordinator.ts`:
- Update import and usage to match new names

Rename in `index.ts`:
- Update re-export: `registerOpenCandleTools` → `registerTools`

Rename in `tool-kit.test.ts`:
- Update imports and assertions

Drop the existing `namespace` field from `RegisterToolsOptions` — it's unused and adds complexity without a consumer.

**Why**: The "third-party" framing creates a class system. Add-on tools are OpenCandle tools that live in separate packages for practical reasons (different deps, different maintainers, keep core lean). The rename reflects this.

**Alternative**: Remove the registry entirely and rely solely on Pi's tool registration. Rejected because `SessionCoordinator.buildSystemPrompt()` needs to know about add-on tools to inject them into the composable prompt's `tool-catalog` section.

### 2. `createTool()` helper for convention validation

```ts
// opencandle/tool-kit
export function createTool<TParams, TDetails>(config: ToolConfig<TParams, TDetails>): AgentTool<TParams, TDetails>
```

Validates at definition time:
- Name is snake_case and verb-prefixed (`get_`, `analyze_`, `search_`, `calculate_`)
- Description is present and non-empty
- Parameters are provided (Typebox schema)

Does NOT validate:
- `execute()` return shape (async — can't check at definition time)
- Typebox `Type.Object()` specifically (any TSchema is fine)

Returns a standard `AgentTool`. This is a convenience — authors can still build `AgentTool` objects directly.

**Why**: A helper catches naming mistakes early and serves as executable documentation. A coding agent reading the helper signature learns the contract immediately.

**Alternative**: Lint rules or a validation function. Rejected — a builder is more ergonomic and discoverable.

### 3. Duplicate tool name detection

When `registerTools()` is called and a tool name already exists in the registry, log a warning to stderr: `[opencandle] Warning: tool "${name}" already registered (overwriting)`. The Map still overwrites (last-write-wins), but the warning makes collisions visible.

**Why**: Multiple add-on packages might accidentally use the same tool name. Silent overwriting is an ecosystem hazard. A warning is sufficient — hard errors would make package composition fragile.

### 4. Add-on packages are Pi extensions that import from `opencandle/tool-kit`

No custom discovery. An add-on package is structured as:

```
package.json:
  "pi": { "extensions": ["./dist/extension.js"] }
  "keywords": ["opencandle-tools"]
  "peerDependencies": { "opencandle": "*" }

extension.ts:
  import { registerTools, createTool, ... } from "opencandle/tool-kit";
  export default function(pi) { registerTools(pi, [myTool]); }
```

Pi discovers it. OpenCandle's registry tracks it. The agent uses it.

**Why**: Pi already solves extension discovery. Adding a parallel system would be redundant and confusing.

### 5. Template repo as the primary onboarding path

A minimal `opencandle-tool-template` repo with:
- Working Twitter sentiment example tool using `createTool()`
- Pi extension wiring (3 lines)
- Test with fixture pattern matching OpenCandle conventions
- README that doubles as the quickstart guide

**Why**: A coding agent given a template + docs can scaffold a new tool package in minutes. This is the lowest-friction path for the target audience (vibe coders with agents).

### 6. `docs/build-a-tool.md` in core repo

Agent-friendly documentation covering:
- The tool contract (`AgentTool` shape, `createTool()` helper)
- Conventions (naming, params, return format)
- How to use OpenCandle infra (`cache`, `rateLimiter`, `httpGet`)
- Package structure (Pi extension boilerplate)
- Link to Pi docs for extension discovery details
- Link to template repo

**Why**: Docs in the core repo are discoverable by anyone reading the codebase. Points to Pi docs for extension mechanics rather than duplicating them.

### 7. Consumer smoke test in this repo

Add a test that exercises `opencandle/tool-kit` exports as a consumer would: imports `registerTools`, `createTool`, `cache`, `httpGet`, etc. and verifies they're callable/constructible. This catches export drift without depending on the template repo.

**Why**: The template repo is separate and won't run in this repo's CI. A local smoke test ensures the public API surface stays correct.

## Risks / Trade-offs

**Registry is in-process only** → Add-on tools must run in the same Node.js process as OpenCandle. This is already how Pi extensions work, so not a new limitation.

**No runtime output validation** → `createTool()` validates definition structure but not `execute()` output. A badly written tool could return malformed results. Mitigation: docs emphasize the `{ content, details }` contract; the template provides a working example.

**System prompt growth** → Each add-on tool adds a line to the `tool-catalog` prompt section. The section has a 3000 char budget (in `sections.ts`) with automatic truncation. With many add-ons, built-in tool descriptions could get truncated. Mitigation: keep entries to one line (name + description). If this becomes a real problem, add priority-based ranking — but not now.

**Breaking API rename** → `registerOpenCandleTools` and `getThirdPartyToolDescriptions` are removed. Acceptable with 0 external consumers.
