## Design Decisions

### Logo approach

Use a minimal, single-color SVG mark that works at small sizes (16px favicon through 200px README header). A candle or candlestick chart motif is the obvious choice given the name. Keep it typographic or geometric — avoid detailed illustrations that don't scale.

Ship as `assets/logo.svg` with a rasterized `assets/logo.png` for README embedding. Both live in the repo but are **not** included in the npm tarball (`files` in package.json stays as `["dist"]`).

### README image hosting strategy

README images must render on both GitHub and npmjs.com. Relative paths (e.g. `assets/logo.png`) work on GitHub but fail on npmjs.com because the npm tarball doesn't include `assets/`. Using absolute GitHub raw content URLs solves both:

```markdown
![OpenCandle](https://raw.githubusercontent.com/opencandle/opencandle/main/assets/logo.png)
```

This avoids bloating the tarball while rendering everywhere. The URLs are pinned to `main` branch so they stay current.

### Demo GIF

Record a real TUI session showing 2-3 prompts:
1. A quick quote (`What's the price of AAPL?`)
2. The flagship `analyze TSLA` multi-analyst workflow
3. Maybe a portfolio or options query

Use [VHS](https://github.com/charmbracelet/vhs) (tape files are reproducible) or manual screen recording. Target under 5MB to keep README load times reasonable. Store as `assets/demo.gif`, referenced via the same absolute GitHub raw URL pattern.

### Badges

Standard shield.io badges in this order:
```
[npm version] [CI status] [license] [node version]
```

These go immediately below the logo, above the one-line description. Use static badges where possible to avoid external service dependencies for rendering.

### README structure after changes

```
[Logo centered]
[Badges row]
[One-line description]

## Why OpenCandle?              ← NEW: 1 paragraph positioning
## What This Does               ← existing, unchanged
## Getting Started              ← existing, unchanged
## Usage                        ← existing, unchanged
## Tools (23)                   ← existing, unchanged
## How It Works                 ← existing, unchanged
## Test                         ← existing, unchanged
## Project Docs                 ← existing, unchanged
## Tech Stack                   ← existing, unchanged
```

The demo GIF goes inside "What This Does" or between "Why OpenCandle?" and "Getting Started" — wherever it contextually fits best after the one-line description.

### "Why OpenCandle?" content

One paragraph covering:
- The problem: checking multiple financial sites, copying data into spreadsheets, no unified view
- What OpenCandle does differently: single agent, real data, local computation, no API dependency for math
- Who it's for: investors and traders who want terminal-speed answers with real data

No feature comparison table — that would be over-engineering positioning for a v0.2 launch.

### Internal docs cleanup

Move these files to `docs/internal/`:
- `codebase-audit.md`
- `competitive-analysis.md`
- `e2e-handoff-real-usage-fixes.md`
- `claude-code-principles-for-opencandle.md`
- `eval-framework-plan.md`

Keep in `docs/` (public-facing):
- `build-a-tool.md`
- `production-plan.md` (after fixing paths — shows project maturity)

The `docs/internal/` directory stays in git (not gitignored) — these are fine to be visible in a public repo, they just shouldn't be in the top-level docs path where contributors might mistake them for current guides.

### Stale path fixes — full scope

Three categories of stale absolute paths exist:

1. **Public-facing docs** (CONTRIBUTING.md, docs/production-plan.md): Replace `/path/to/opencandle/X` with relative repo paths (`./X` or `../X`).

2. **Internal docs — this-repo references** (docs/claude-code-principles-for-opencandle.md lines referencing `/path/to/opencandle/src/...`): Replace with relative paths from their new location in `docs/internal/` (e.g. `../../src/pi/opencandle-extension.ts`).

3. **Internal docs — external-repo references** (docs/claude-code-principles-for-opencandle.md lines referencing `/path/to/claude-code-working/src/...`): These are dead links to a local directory that doesn't exist for anyone else. Replace with descriptive text (e.g. just the file path without the link, or remove the link markup entirely). The line descriptions are still valuable as architectural references; only the link targets are broken.

4. **Internal docs — old repo name references** (docs/e2e-handoff-real-usage-fixes.md referencing `/path/to/opencandle/src/...`): Same as #2 — these are this-repo paths from before it was renamed. Replace with relative paths.

The acceptance criteria (`git grep '/home/user' -- ':!openspec/'` returns no results) must hold across all tracked files outside of `openspec/`, which contains change artifacts that reference the path in examples and task descriptions.

### CI hardening

Add two steps to `.github/workflows/ci.yml` after `npm ci`:

**Typecheck:**
```yaml
- name: Typecheck
  run: npx tsc --noEmit
```

**Package validation** — must actually fail CI on unexpected contents, not just print:
```yaml
- name: Validate package contents
  run: |
    PACK_OUTPUT=$(npm pack --dry-run 2>&1)
    echo "$PACK_OUTPUT"
    
    # Fail if tests, fixtures, or internal docs leak into tarball
    if echo "$PACK_OUTPUT" | grep -qE '(tests/|fixtures/|docs/|\.env|openspec/)'; then
      echo "::error::Tarball contains files that should not be published"
      exit 1
    fi
    
    # Fail if dist/ is missing
    if ! echo "$PACK_OUTPUT" | grep -q 'dist/'; then
      echo "::error::Tarball is missing dist/ — build may have failed"
      exit 1
    fi
```

This satisfies the ci-hardening spec: unexpected contents block CI, and a missing `dist/` also blocks CI.

### npm keywords

Replace the current sparse list with:
```json
[
  "opencandle", "finance", "stock", "investing", "trading",
  "options", "market-data", "portfolio", "ai-agent", "terminal",
  "financial-analysis", "sentiment", "technical-analysis",
  "pi-package"
]
```
