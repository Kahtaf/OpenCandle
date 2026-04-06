## Why

OpenCandle's code and documentation infrastructure is solid — LICENSE, CONTRIBUTING, SECURITY, CI, trusted publishing, changelog, issue templates are all in place. But the project's *first impression* is weak. There's no logo, no demo, no badges, no visual identity at all. The README is a wall of text that doesn't show the product in action. Internal planning docs are checked into `docs/` alongside public-facing guides. Stale local paths from worktree-based development are baked into CONTRIBUTING.md, production-plan.md, and several internal docs. CI only runs tests — no typecheck, no packaging validation. npm keywords are too thin for discoverability. These are the gaps between "technically publishable" and "someone lands on this repo and wants to install it."

## What Changes

- **Add logo and demo GIF** to the repo and README header. The logo is a simple mark (candle or typographic). The demo GIF captures a real `analyze` session in the TUI. README images use absolute GitHub raw content URLs so they render on both GitHub and npmjs.com without shipping `assets/` in the npm tarball.
- **Add README badges** — npm version, CI status, license, Node.js version requirement.
- **Fix stale local absolute paths** across all tracked `.md` files — CONTRIBUTING.md, docs/production-plan.md, and internal docs. Paths referencing this repo become relative. Paths referencing external repos (e.g. claude-code-working) are removed or replaced with descriptive text, since they're dead links to a local directory that doesn't exist for anyone else.
- **Clean up internal docs** — move internal planning docs to `docs/internal/`. Keep `build-a-tool.md` and `production-plan.md` as public-facing.
- **Harden CI** — add `tsc --noEmit` typecheck step and a packaging validation step that asserts the `npm pack` tarball contains only expected files (failing CI on unexpected entries).
- **Expand npm keywords** for discoverability — add terms people actually search for (stock, investing, trading, options, ai-agent, market-data, portfolio, terminal).
- **Add brief "Why OpenCandle?" positioning** to the README — one paragraph framing what this replaces and why it exists.

## Capabilities

### New Capabilities
- `visual-identity`: Logo, demo GIF, and README badges that give the project a professional first impression.
- `ci-hardening`: Typecheck and packaging validation steps in CI that catch regressions the test suite alone misses.

### Modified Capabilities
- `docs-cleanup`: Fix stale paths across all tracked docs, separate internal from public docs, expand npm keywords.
- `readme-polish`: Badges, visual header with hosted images, "Why OpenCandle?" positioning section.

## Impact

- **README.md**: New header with logo (absolute GitHub raw URL), badges, demo GIF. New "Why OpenCandle?" section.
- **package.json**: Expanded keywords array. `files` array unchanged — `assets/` stays out of the tarball.
- **CONTRIBUTING.md**: Fix stale absolute path on the last line.
- **docs/production-plan.md**: Fix ~5 stale absolute path references.
- **docs/internal/**: Internal docs moved here with stale paths fixed (this-repo paths made relative, external-repo paths removed or described).
- **.github/workflows/ci.yml**: Add typecheck and pack validation steps (validation fails CI on unexpected tarball contents).
- **New assets**: `assets/logo.svg`, `assets/logo.png`, `assets/demo.gif` (in repo, not in npm tarball).

## Non-goals

- Redesigning the README structure — the content and organization are already good.
- Adding GitHub Discussions, Discord, or other community infrastructure — deliberately out of scope for v1 per the production plan.
- Changing any runtime code, tools, or providers.
- Landing page — split to a separate follow-up change after launch.
