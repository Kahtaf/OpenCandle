## CI Hardening

### Requirements

- `.github/workflows/ci.yml` runs typecheck (`tsc --noEmit`) on every PR and push to main
- `.github/workflows/ci.yml` runs a packaging validation step that:
  - Executes `npm pack --dry-run` and captures its output
  - Fails CI if the tarball contains unexpected files (tests/, fixtures/, docs/, .env, openspec/)
  - Fails CI if the tarball is missing `dist/`
- Both steps run after `npm ci` and before or alongside `npm test`
- The validation step must use the exit code to block CI — not just print warnings

### Acceptance

- [ ] CI workflow includes a "Typecheck" step that runs `npx tsc --noEmit`
- [ ] CI workflow includes a "Validate package contents" step with grep assertions
- [ ] A PR that adds `tests/` to the `files` array would be blocked by CI
- [ ] A PR with a type error is blocked by CI
- [ ] Workflow completes in under 3 minutes total
