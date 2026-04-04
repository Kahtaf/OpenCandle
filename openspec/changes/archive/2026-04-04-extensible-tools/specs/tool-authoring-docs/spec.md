## ADDED Requirements

### Requirement: Build-a-tool guide exists in core repo
A `docs/build-a-tool.md` file SHALL exist in the OpenCandle repo documenting how to contribute a tool. The primary path SHALL be contributing directly to this repo via PR. A secondary "Advanced" section SHALL cover shipping tools as standalone npm packages. The guide SHALL be written in a style consumable by both humans and coding agents.

#### Scenario: Guide covers the in-repo contribution path
- **WHEN** a reader opens `docs/build-a-tool.md`
- **THEN** it documents where tool files go (`src/tools/<domain>/`), how to register in `getAllTools()`, how to add fixtures, and how to write tests — with a reference to an existing tool as the canonical example

#### Scenario: Guide covers the tool contract
- **WHEN** a reader opens `docs/build-a-tool.md`
- **THEN** it documents the `AgentTool` interface shape, the `createTool()` helper (optional convenience), the recommended parameter convention (Typebox `Type.Object` — recommended but not enforced by the helper), return format (`{ content, details }`), and naming rules (snake_case, verb-prefixed)

#### Scenario: Guide covers OpenCandle infra usage
- **WHEN** a reader opens `docs/build-a-tool.md`
- **THEN** it documents how to import and use `cache`, `rateLimiter`, `httpGet`, `wrapProvider`, and `withFallback` from OpenCandle's infra modules

#### Scenario: Guide covers standalone package path as advanced option
- **WHEN** a reader needs to ship a tool as a separate npm package (heavy deps, separate maintenance)
- **THEN** the guide has an "Advanced" section documenting the Pi extension boilerplate, `registerTools` from `opencandle/tool-kit`, and a link to Pi docs for extension lifecycle

#### Scenario: Guide references existing tools as examples
- **WHEN** a reader wants to see a working example
- **THEN** the guide points to specific existing tool files (e.g., `src/tools/sentiment/reddit-sentiment.ts`) rather than requiring a separate template repo
