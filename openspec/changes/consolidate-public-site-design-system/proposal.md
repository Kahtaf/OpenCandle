## Why

The public homepage and docs site currently present a separate marketing/documentation design system, while the local GUI uses a compact workspace shell, shared Tailwind tokens, and React UI primitives. This creates visible brand drift and makes future design fixes more expensive because the website and app duplicate component decisions.

The docs site still needs to remain a GitHub Pages-compatible static site with Markdown as the content source. The opportunity is to consolidate the visual system without turning the public site into the local runtime app.

## What Changes

- Extract reusable, runtime-agnostic visual primitives and design tokens from the GUI into a root `packages/ui` workspace consumed by both the local GUI and public site.
- Replace the public website's standalone CSS/HTML generator shell with a React static-site workspace that prerenders real HTML into `website/dist` for GitHub Pages.
- Keep `docs/*.md`, `CONTRIBUTING.md`, and `SECURITY.md` as documentation sources, rendered through `unified`/`remark`/`rehype` and `gray-matter` instead of the hand-written Markdown/frontmatter parser.
- Remove the current custom Markdown rendering helpers once the maintained parser pipeline covers frontmatter, inline markup, links, images, headings, lists, code fences, tables, and blockquotes.
- Make the public homepage and docs chrome visually match the main GUI: app-like shell, compact typography, shared logo/buttons/cards, sidebar navigation, mobile drawer/header behavior, and the same neutral workspace palette.
- Preserve static-site outputs required by the current public site: canonical pages, Markdown alternates, `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml`, social metadata, and static assets.
- Keep local GUI runtime behavior local-only; public pages must not depend on OpenCandle's local server APIs, WebSocket events, writer locks, session storage, or provider credentials.

## Capabilities

### New Capabilities
- `public-site-static-rendering`: Covers the GitHub Pages-compatible static React/docs build, Markdown rendering pipeline, generated public metadata, and validation expectations.

### Modified Capabilities
- `visual-identity`: Require public-facing web surfaces to share the GUI's design tokens and reusable visual primitives instead of maintaining an independent site design language.
- `docs-cleanup`: Require public docs generation to preserve Markdown source-of-truth and public/internal documentation boundaries while rendering through the static site pipeline.

## Impact

- Affected code: `packages/ui/`, `website/`, `docs/`, `gui/web/src/components/ui/`, `gui/web/src/components/brand/`, `gui/web/src/styles.css`, `gui/web/tailwind.config.cjs`, root workspace/package configuration, `.github/workflows/pages.yml`, `biome.json`, and docs link/build checks.
- New or reorganized dependencies should include `@vitejs/plugin-react`, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-stringify`, `rehype-slug`, `rehype-autolink-headings`, `gray-matter`, `unist-util-visit`, and `mdast-util-to-string`. Defer `shiki` unless static syntax highlighting is explicitly included in the implementation slice.
- Public deploy remains GitHub Pages from `website/dist` through the existing Actions artifact workflow.
- No change to OpenCandle's local GUI server APIs, runtime session ownership, Pi integration, market tools, provider configuration, or financial-analysis behavior.
