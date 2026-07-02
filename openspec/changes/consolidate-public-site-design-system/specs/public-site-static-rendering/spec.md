## ADDED Requirements

### Requirement: Static React public site build
The public website SHALL build to static files under `website/dist` and SHALL remain deployable by the GitHub Pages workflow without requiring a Node server at request time.

#### Scenario: GitHub Pages artifact contains static entry files
- **WHEN** `npm run docs:site:build` completes
- **THEN** `website/dist/index.html` exists
- **AND** each configured public docs route has a corresponding static `.html` file under `website/dist`
- **AND** the site can be served by `npm run docs:site:serve` without running the OpenCandle GUI server

#### Scenario: Public pages do not require local runtime APIs
- **WHEN** a generated public page is opened from `website/dist`
- **THEN** its primary content renders without calling OpenCandle local GUI APIs, WebSocket endpoints, writer-lock state, Pi session state, provider credentials, or market-data tools

#### Scenario: Generated HTML contains prerendered content
- **WHEN** a generated public HTML file is read directly from `website/dist` without executing JavaScript
- **THEN** the file contains that page's primary heading and main content text
- **AND** docs pages contain their rendered navigation links and resolved document links in the HTML source
- **AND** link checks can inspect those links from the generated HTML source

### Requirement: Markdown source-of-truth rendering
The public docs site SHALL render configured Markdown sources through a maintained Markdown parsing pipeline rather than a hand-written line parser.

#### Scenario: GitHub-flavored Markdown features render
- **WHEN** a configured docs page includes headings, paragraphs, ordered lists, unordered lists, fenced code blocks, inline code, blockquotes, links, images, or tables
- **THEN** the generated HTML preserves the intended structure using valid semantic HTML

#### Scenario: Custom markdown parser is removed
- **WHEN** the maintained Markdown pipeline is active
- **THEN** public docs rendering no longer depends on custom line-by-line Markdown parsing helpers for frontmatter, inline markup, tables, headings, lists, blockquotes, or code fences
- **AND** project-specific link rewriting is implemented against parsed document structure or focused metadata rather than broad Markdown rendering regexes where practical

#### Scenario: Heading anchors are stable
- **WHEN** a docs page contains headings
- **THEN** the generated HTML includes stable heading IDs
- **AND** duplicate heading text is disambiguated without producing duplicate IDs

#### Scenario: Local markdown links resolve
- **WHEN** a public docs page links to another configured Markdown source
- **THEN** the generated HTML link points to the corresponding public `.html` page
- **AND** generated Markdown/AI-readable outputs preserve public canonical URLs where required

### Requirement: Public metadata and AI-readable outputs
The public static build SHALL preserve metadata and auxiliary outputs needed by users, crawlers, package metadata, and AI readers.

#### Scenario: Per-page metadata is generated
- **WHEN** a public HTML page is generated
- **THEN** it includes a canonical URL, title, description, Open Graph metadata, Twitter card metadata, favicon links, JSON-LD structured data, and Markdown alternate link where applicable

#### Scenario: Site-wide metadata files are generated
- **WHEN** `npm run docs:site:build` completes
- **THEN** `website/dist/robots.txt` exists
- **AND** `website/dist/sitemap.xml` exists
- **AND** `website/dist/llms.txt` exists
- **AND** `website/dist/llms-full.txt` exists

### Requirement: Static site validation
The public site build SHALL include automated checks that prove generated docs are linkable, readable, and visually aligned with the local GUI.

#### Scenario: Link checks run on built output
- **WHEN** release validation runs
- **THEN** public documentation link checks inspect the generated static output
- **AND** broken public links fail validation

#### Scenario: Browser visual proof covers app alignment
- **WHEN** implementation validation is performed for this change
- **THEN** Browser verification captures or inspects the local GUI, public homepage, and docs page at desktop and mobile widths
- **AND** validation records whether shared tokens, navigation chrome, typography, buttons, cards, and mobile navigation match the GUI design system
