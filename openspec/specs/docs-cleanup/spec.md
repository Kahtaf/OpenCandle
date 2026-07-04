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

### Requirement: Completed Generated Plans Archive Under OpenSpec

Completed generated implementation-plan queues SHALL be preserved under archived OpenSpec changes instead of remaining as a root-level `plans/` folder.

#### Scenario: Generated plan queue is complete

- **WHEN** every item in a generated plan queue is implemented or intentionally rejected
- **THEN** the queue is moved into a completed OpenSpec change as source evidence
- **AND** the root of the repository no longer contains the generated `plans/` folder

#### Scenario: OpenSpec remains the completed-work ledger

- **WHEN** maintainers inspect completed generated implementation work
- **THEN** they can find the proposal, completed tasks, and original plan records under `openspec/changes/archive/`
- **AND** no second root-level planning index is required for those completed records

### Requirement: Public docs source boundaries
Public documentation generation SHALL use an explicit public-page registry for configured Markdown sources and SHALL keep internal planning documents out of the public docs navigation unless they are explicitly promoted.

#### Scenario: Public docs navigation excludes internal docs
- **WHEN** the public docs site is generated
- **THEN** files under `docs/internal/` are not included in public navigation
- **AND** root project files such as `CONTRIBUTING.md` and `SECURITY.md` are included only when explicitly configured as public pages

#### Scenario: Docs generation does not publish by directory walk
- **WHEN** new Markdown files are added under `docs/` or `docs/internal/`
- **THEN** they are not published to the public docs site unless the public-page registry includes them

### Requirement: Markdown alternates remain available
Public documentation pages SHALL continue to expose Markdown alternatives for AI readers, direct source inspection, and lightweight text consumption.

#### Scenario: Markdown alternate emitted for docs page
- **WHEN** a configured docs page is generated as HTML
- **THEN** a corresponding public Markdown output is generated where the current public site contract expects one
- **AND** the HTML page links to its Markdown alternate with an appropriate `rel="alternate"` tag

### Requirement: Docs build remains release-gated
The public docs static build SHALL remain part of release-facing validation.

#### Scenario: Release check includes public docs build
- **WHEN** `npm run release:check` runs
- **THEN** the public docs static build is executed
- **AND** public docs link checks are executed against the generated output

