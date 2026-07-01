## 1. Shared Design System Extraction

- [x] 1.1 Add a root `packages/ui` workspace and wire it into npm workspaces without changing runtime behavior.
- [x] 1.2 Move runtime-agnostic tokens, Tailwind theme mapping, and primitive styling into the shared UI surface.
- [x] 1.3 Move or re-export shared primitives for logo, buttons, cards, badges, keyboard labels, inputs, text areas, and basic layout affordances.
- [x] 1.4 Add an import-boundary check proving `packages/ui` does not import GUI runtime hooks, session state, toast state, local API clients, context-panel state, or feature modules.
- [x] 1.5 Update the local GUI to consume shared primitives and tokens with no intended visual regression.
- [x] 1.6 Run `npm run gui:web:build` and targeted GUI unit tests for affected shared primitives.

## 2. Static Website Build Pipeline

- [x] 2.1 Add a `website` public-site workspace with Vite React build wiring while keeping the root `npm run docs:site:build` command stable.
- [x] 2.2 Add the public-site build dependencies: `@vitejs/plugin-react`, `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-stringify`, `rehype-slug`, `rehype-autolink-headings`, `gray-matter`, `unist-util-visit`, and `mdast-util-to-string`; defer `shiki` unless static syntax highlighting is in scope.
- [x] 2.3 Replace the current public-site generator internals with a React static rendering pipeline that writes prerendered HTML to `website/dist`.
- [x] 2.4 Add a maintained Markdown pipeline for configured docs sources, including frontmatter, GitHub-flavored Markdown, heading IDs, local link rewriting, code fences, tables, images, and blockquotes.
- [x] 2.5 Remove the old custom Markdown/frontmatter rendering helpers, including line-based rendering for inline markup, tables, headings, lists, blockquotes, and code fences, once parser parity checks pass.
- [x] 2.6 Preserve the existing configured public page inventory and output paths for homepage, docs pages, root project pages, static assets, favicon, and social image assets.
- [x] 2.7 Preserve generated Markdown alternates, `llms.txt`, `llms-full.txt`, `robots.txt`, `sitemap.xml`, canonical URLs, Open Graph metadata, Twitter card metadata, and JSON-LD.
- [x] 2.8 Preserve an explicit public-page registry so `docs/internal/**` and newly added docs are not published by directory walk.
- [x] 2.9 Add fixture tests or focused build assertions for Markdown rendering edge cases, generated artifact presence, JSON-LD output, and raw prerendered HTML content before JavaScript execution.

## 3. App-Matched Public UI

- [x] 3.1 Rebuild the public homepage as a static, app-like first impression that uses the GUI's shared visual language without depending on local runtime APIs.
- [x] 3.2 Rebuild the public docs shell with GUI-consistent sidebar/header navigation, active states, typography, cards, buttons, and responsive behavior.
- [x] 3.3 Implement mobile docs navigation so document content is reachable immediately and docs navigation is available through an app-like compact control.
- [x] 3.4 Confirm public pages do not call `/api/bootstrap`, `/api/session/events`, WebSocket endpoints, provider setup endpoints, or other local GUI runtime routes.

## 4. Validation and Release Integration

- [x] 4.1 Keep `npm run docs:site:build`, `npm run docs:site:serve`, and `npm run docs:links:check` working against the new static output.
- [x] 4.2 Update CI/Pages workflow only if required by the new build, preserving deployment from `website/dist`.
- [x] 4.3 Bring new website React source under Biome lint/format coverage instead of leaving all `website/` source ignored.
- [x] 4.4 Run `npm run docs:site:build`, `npm run docs:links:check`, `npm run gui:web:build`, `npx biome ci .`, and `npm test`.
- [x] 4.5 Use Browser to verify the local GUI, public homepage, docs index, and at least one long docs page at desktop and mobile widths.
- [x] 4.6 Run `npm run release:check` before merge because this change affects release-facing docs and public assets.
