## 1. Rename "third-party" to "addon" across codebase

- [x] 1.1 Rename in `src/tool-kit.ts`: `thirdPartyToolRegistry` → `addonToolRegistry`, `registerOpenCandleTools` → `registerTools`, `getThirdPartyToolDescriptions` → `getAddonToolDescriptions`, drop `namespace` from `RegisterToolsOptions`
- [x] 1.2 Rename in `src/prompts/context-builder.ts`: `thirdPartyToolDescriptions` option → `addonToolDescriptions`, `"Third-Party Tools"` heading → `"Add-on Tools"`
- [x] 1.3 Update `src/runtime/session-coordinator.ts` to import and use renamed exports
- [x] 1.4 Update `src/index.ts` re-export: `registerOpenCandleTools` → `registerTools`
- [x] 1.5 Update `tests/unit/tool-kit.test.ts` to use renamed imports and assertions

## 2. createTool helper

- [x] 2.1 Implement `createTool()` in `src/tool-kit.ts` — validates snake_case verb-prefixed name, requires non-empty description, requires parameters, returns `AgentTool`
- [x] 2.2 Write tests: valid creation, invalid name rejection, missing description rejection

## 3. Duplicate tool name detection

- [x] 3.1 Add duplicate-name warning in `registerTools()`: log to stderr when overwriting, pass through silently when unique
- [x] 3.2 Write tests: duplicate warns to stderr, unique does not warn

## 4. Consumer smoke test

- [x] 4.1 Add test that builds the package first, then imports all public exports from the `opencandle/tool-kit` subpath (through `package.json` exports → `dist/`), verifying they are defined and callable — must NOT import from source paths

## 5. Documentation

- [x] 5.1 Create `docs/build-a-tool.md` covering tool contract, `createTool()` helper, package structure, Pi extension boilerplate, infra usage (`cache`, `rateLimiter`, `httpGet`), and links to Pi docs
- [x] 5.2 Update `AGENTS.md` with a brief entry pointing to `docs/build-a-tool.md` for add-on tool authoring

## 6. ~~Template repository~~ (superseded)

Tasks 6.1–6.2 are no longer needed. Tools are contributed directly to this repo via PR. The `docs/build-a-tool.md` guide covers both the in-repo path (primary) and standalone package path (advanced section). Existing tools like `src/tools/sentiment/reddit-sentiment.ts` serve as the reference example.
