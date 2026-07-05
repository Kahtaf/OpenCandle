# Tasks

Follow AGENTS.md (TDD, CHANGELOG, `graphify update .`). The renderer is deterministic — inject the timestamp and version; no `Date.now()` inside render logic. No model calls anywhere in this change.

## 1. Renderer (TDD)

- [ ] 1.1 Failing unit tests with seeded entry fixtures: full `/analyze` render (five sections, tally correctness), sparse fallback render (sections omitted), byte-identical reproducibility, HTML self-containment (assert no `<script` or externally-loading `src=`/`href=` attributes anywhere; URLs appearing as text inside recorded entry content — tool-result previews routinely contain SEC/news links — are allowed and rendered as plain text, not live links), disclaimer text sourced from `src/prompts/disclaimer.ts` (`DISCLAIMER_TEXT`), markdown and HTML parity of content, turn-slice selection (anchor message → preceding user message; workflow span extends to the `opencandle-workflow` entry).
- [ ] 1.2 Implement `src/runtime/answer-artifact.ts` (`renderAnswerArtifact(entries, {format, version, generatedAt})`); reuse `buildAssumptionsBlockFromRouter` (exported from `src/prompts/workflow-prompts.ts`, takes the route-context `slots` record directly) for section 2; version via the `createRequire` package.json pattern used by `src/doctor/report.ts`.

## 2. GUI route + action (TDD)

- [ ] 2.1 Failing server tests: `GET /api/sessions/{id}/artifact?message=<entryId>` returns the rendered file with correct filename and content type; trusted-session rejection; markdown format param; unknown message id → 404; workflow-span slicing (resolve entries via the session manager the bootstrap route already uses).
- [ ] 2.2 Implement the route in `gui/server/http-routes.ts` (session-addressed; slice per the contract; call the renderer).
- [ ] 2.3 Failing client tests (`renderToStaticMarkup` — node test env, no jsdom): eligibility derivation from bootstrap `snapshot.entries` (route-context/workflow entry in turn span); the new minimal assistant-message action row renders Export only for eligible messages; research-item action present; saved-positions notice shown when route context says saved state was included.
- [ ] 2.4 Implement: the minimal hover/focus action row on assistant messages (Export only — deliberately the first message action in the chat UI; keep it extensible but empty otherwise), the research-item action, HTML default with markdown option; hover/click behavior verified in the browser e2e.

## 3. Verification

- [ ] 3.1 `npm test`, `npx tsc --noEmit`, `npx biome ci .` green; React Doctor clean on changed GUI files.
- [ ] 3.2 Live evidence: run `analyze NVDA` in the GUI, export, open the file from disk with network disabled; screenshot the rendered artifact + the export flow at 1440x960; excerpts in the PR.
- [ ] 3.3 CHANGELOG `[Unreleased]` entry.
- [ ] 3.4 `graphify update .`; `npx openspec validate shareable-answer-artifact --strict`.
