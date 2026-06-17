# Docs Cleanup Specification

## Purpose
TBD - normalized from existing baseline requirements.

## Requirements

### Requirement: Repository markdown avoids stale local paths
Tracked markdown documentation MUST NOT contain stale absolute local paths such as `/home/user/...`, except inside archived OpenSpec artifacts that intentionally preserve historical examples.

#### Scenario: Markdown path audit
- **WHEN** maintainers run a markdown path audit excluding archived OpenSpec examples
- **THEN** no tracked public or internal markdown file contains `/home/user`

### Requirement: Internal and public docs are separated
Internal planning documentation MUST live under `docs/internal/`, while public-facing docs such as `docs/build-a-tool.md` and `docs/production-plan.md` MUST remain in `docs/`.

#### Scenario: Documentation layout check
- **WHEN** documentation is inspected after cleanup
- **THEN** internal planning docs are under `docs/internal/`
- **AND** public docs remain at their existing public paths

### Requirement: Public package and README metadata
The package metadata MUST include at least ten relevant npm keywords, and the README MUST include a concise "Why OpenCandle?" section.

#### Scenario: README and package metadata check
- **WHEN** the package manifest and README are inspected
- **THEN** `package.json` has at least ten finance-relevant keywords
- **AND** README contains a "Why OpenCandle?" heading
