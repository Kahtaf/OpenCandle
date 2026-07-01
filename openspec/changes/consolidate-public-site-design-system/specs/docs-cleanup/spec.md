## ADDED Requirements

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
