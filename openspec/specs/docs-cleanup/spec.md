## Docs Cleanup

### Requirements

- No stale absolute paths (`/home/user/...`) remain in any tracked `.md` file in the repo
- This includes files moved to `docs/internal/` — they are still tracked by git
- Internal planning docs are in `docs/internal/`, not top-level `docs/`
- Public-facing docs (`build-a-tool.md`, `production-plan.md`) remain in `docs/`
- This-repo paths in internal docs are converted to relative paths from their `docs/internal/` location
- External-repo paths (e.g. claude-code-working references) have link markup removed but descriptive text preserved
- npm keywords include at least 10 relevant search terms
- "Why OpenCandle?" section exists in README (1 paragraph, no feature table)

### Acceptance

- [ ] `git grep '/home/user' -- ':!openspec/'` returns no results (openspec change artifacts are excluded — they reference the path in examples)
- [ ] `docs/internal/` contains the 5 moved planning docs
- [ ] `docs/build-a-tool.md` and `docs/production-plan.md` still exist at their current paths
- [ ] `package.json` keywords array has 10+ entries including finance-relevant terms
- [ ] README contains a "Why OpenCandle?" heading
