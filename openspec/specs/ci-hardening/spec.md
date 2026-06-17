# Ci Hardening Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: CI typecheck gate
The CI workflow MUST run a typecheck step with `npx tsc --noEmit` on every pull request and push to `main`, after dependency installation and before merge eligibility.

#### Scenario: Pull request has a type error
- **WHEN** a pull request introduces a TypeScript error
- **THEN** `.github/workflows/ci.yml` runs the typecheck step
- **AND** the workflow fails with a non-zero exit code

### Requirement: Package contents validation
The CI workflow MUST run a package validation step that executes `npm pack --dry-run`, verifies `dist/` is present, and blocks unexpected package contents such as `tests/`, `fixtures/`, `docs/`, `.env`, or `openspec/`.

#### Scenario: Package includes unexpected files
- **WHEN** a pull request changes package configuration so `tests/` would be included in the published tarball
- **THEN** the package validation step fails with a non-zero exit code
- **AND** the workflow blocks the pull request
