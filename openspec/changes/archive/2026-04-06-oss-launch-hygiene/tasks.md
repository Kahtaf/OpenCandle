## Tasks

### 1. Fix stale local paths — public-facing docs
- [x] Replace `/path/to/opencandle/AGENTS.md` with `./AGENTS.md` in `CONTRIBUTING.md` (line 131)
- [x] Replace all `/path/to/opencandle/` references with relative paths in `docs/production-plan.md` (lines 22, 108-111, 266-267)

### 2. Fix stale local paths — internal docs (before moving)
- [x] In `docs/e2e-handoff-real-usage-fixes.md`: replace `/path/to/opencandle/src/...` paths — removed link markup, kept descriptive text
- [x] In `docs/claude-code-principles-for-opencandle.md`: replace this-repo paths (`/path/to/opencandle/src/...`) — removed link markup, kept backtick code references
- [x] In `docs/claude-code-principles-for-opencandle.md`: replace external-repo paths (`/path/to/claude-code-working/src/...`) — removed link markup, kept descriptive text only
- [x] Verify: `git grep '/home/user' -- ':!openspec/'` returns no results

### 3. Organize internal docs
- [x] Create `docs/internal/` directory
- [x] Move `docs/codebase-audit.md` → `docs/internal/`
- [x] Move `docs/competitive-analysis.md` → `docs/internal/`
- [x] Move `docs/e2e-handoff-real-usage-fixes.md` → `docs/internal/`
- [x] Move `docs/claude-code-principles-for-opencandle.md` → `docs/internal/`
- [x] Move `docs/eval-framework-plan.md` → `docs/internal/`
- [x] Move `docs/agent-usefulness-memory-design.md` → `docs/internal/` (also internal)
- [x] Verify `docs/build-a-tool.md` and `docs/production-plan.md` remain in `docs/`

### 4. Harden CI workflow
- [x] Add `npx tsc --noEmit` typecheck step to `.github/workflows/ci.yml`
- [x] Add package validation step that asserts tarball contents and fails on unexpected files (tests/, fixtures/, docs/, .env, openspec/) or missing dist/
- [x] Verify workflow passes locally (typecheck clean, pack validation passes)

### 5. Expand npm keywords
- [x] Update `package.json` keywords array: 14 keywords (was 3)
- [x] Pack validation already confirmed clean in task 4

### 6. Create logo
- [x] Placeholder candle SVG mark created at `assets/logo.svg`
- [x] PNG raster exported to `assets/logo.png`
- [x] User will replace with final design

### 7. Record demo GIF
- [x] Placeholder demo GIF created at `assets/demo.gif` (14KB)
- [x] User will replace with real TUI recording

### 8. Polish README
- [x] Add centered logo image at top using absolute GitHub raw URL
- [x] Add badge row (npm version, CI, license, node version)
- [x] Add demo GIF using absolute GitHub raw URL
- [x] Write "Why OpenCandle?" section (1 paragraph)
- [ ] Verify README renders correctly on GitHub (after push)
- [ ] Verify README renders correctly on npmjs.com (after next publish)
