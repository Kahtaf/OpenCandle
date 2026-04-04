## ADDED Requirements

### Requirement: Add-on tool registry uses first-class naming
The addon tool registry in `tool-kit.ts` SHALL export `registerTools`, `getAddonToolDescriptions`, and use `addonToolRegistry` internally. The `PromptContextBuilder` option SHALL be renamed from `thirdPartyToolDescriptions` to `addonToolDescriptions`. The `buildToolCatalog()` heading SHALL be renamed from "Third-Party Tools" to "Add-on Tools". The `SessionCoordinator` SHALL import and use the renamed exports. The root `index.ts` SHALL re-export `registerTools` instead of `registerOpenCandleTools`. The previous "thirdParty" naming SHALL be removed entirely.

#### Scenario: Registering an add-on tool
- **WHEN** an add-on extension calls `registerTools(pi, [myTool])`
- **THEN** the tool is registered with Pi via `pi.registerTool()` AND recorded in the addon registry with its name and description

#### Scenario: Querying registered add-on tools
- **WHEN** `getAddonToolDescriptions()` is called after add-on tools have been registered
- **THEN** it returns an array of `{ name, description }` for all registered add-on tools

#### Scenario: System prompt displays add-on tools with correct heading
- **WHEN** add-on tools are registered AND `buildToolCatalog()` renders the tool-catalog section
- **THEN** the section includes an "Add-on Tools" heading (not "Third-Party Tools") listing each add-on tool

#### Scenario: No add-on tools registered
- **WHEN** no add-on tools have been registered
- **THEN** the tool-catalog section contains only built-in tool descriptions with no "Add-on Tools" heading

### Requirement: createTool helper validates conventions at definition time
`tool-kit.ts` SHALL export a `createTool()` function that accepts a tool configuration object and returns a valid `AgentTool`. It SHALL validate naming and description at creation time. It SHALL NOT validate `execute()` return shape at runtime.

#### Scenario: Valid tool creation
- **WHEN** `createTool()` is called with a snake_case verb-prefixed name, a non-empty description, a label, Typebox parameters, and an execute function
- **THEN** it returns a valid `AgentTool` object with all fields set

#### Scenario: Invalid tool name rejected
- **WHEN** `createTool()` is called with a name that is not snake_case or not verb-prefixed (e.g., `"twitterSentiment"`, `"sentiment"`)
- **THEN** it throws an error describing the naming convention

#### Scenario: Missing description rejected
- **WHEN** `createTool()` is called with an empty or missing description
- **THEN** it throws an error requiring a description

### Requirement: Duplicate tool name detection
When `registerTools()` registers a tool whose name already exists in the addon registry, it SHALL log a warning to stderr and overwrite the existing entry.

#### Scenario: Duplicate name warns
- **WHEN** `registerTools(pi, [toolA])` is called and a tool named `toolA.name` is already in the registry
- **THEN** a warning is logged to stderr containing the duplicate tool name AND the registry entry is overwritten with the new tool

#### Scenario: Unique names do not warn
- **WHEN** `registerTools(pi, [toolA])` is called and no tool with `toolA.name` exists in the registry
- **THEN** no warning is logged

### Requirement: Consumer smoke test validates published package exports
A test SHALL exist that builds the package first (`npm run build`), then imports `registerTools`, `createTool`, `getAddonToolDescriptions`, `cache`, `rateLimiter`, `httpGet`, and `Type` from the `opencandle/tool-kit` subpath export (resolving through `package.json` exports to `dist/tool-kit.js`), and verifies they are defined and callable. The test MUST NOT import from source paths (`../../src/tool-kit.js`) — it SHALL use the package subpath to catch `package.json` export map or build artifact breakage.

#### Scenario: All public exports are accessible via package subpath
- **WHEN** the package is built AND the smoke test imports from the `opencandle/tool-kit` subpath
- **THEN** all exported functions are defined and callable, confirming the `package.json` exports map and built artifacts are correct
