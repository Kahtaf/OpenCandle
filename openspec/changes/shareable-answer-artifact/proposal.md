# Shareable Answer Artifact

## Why

Analyses die in the session transcript: there is no export, so a completed `/analyze` — verdict, assumptions, analyst debate, evidence — cannot be saved, shared, or compared later. For a local-first product, exported artifacts are also the only organic sharing surface. The trace machinery already captures everything a rigorous research note needs (`opencandle-route-context` assumptions, `opencandle-analyst-step` breakdowns, tool evidence with freshness, `opencandle-receipts` bindings, `opencandle-turn-gap` data-quality gaps); this change renders it, deterministically, into a document. The report shape follows the strongest pattern surveyed in the ecosystem: progressive disclosure — verdict first, then assumptions, then detail, then evidence appendix.

## What Changes

- New deterministic renderer `src/runtime/answer-artifact.ts`: given a session's entries for one completed turn (or one comprehensive-analysis run), produce a markdown document and a self-contained HTML document (inline CSS, zero external assets/scripts). **No model call** — the artifact is a pure function of recorded entries.
- Document structure (in order):
  1. **Bottom line** — the final assistant answer text.
  2. **Assumptions** — slots with provenance from the turn's route context (rendered like the existing Assumptions block).
  3. **Analyst breakdown** (comprehensive-analysis only) — per-stage signal/conviction from `opencandle-analyst-step` entries, the computed tally, rebuttal/skip status.
  4. **Evidence appendix** — each tool call from the run's evidence records (tool, key arguments, result preview, as-of/freshness when present); the receipts table when an `opencandle-receipts` entry exists; data-quality gaps from `opencandle-turn-gap` entries.
  5. **Footer** — OpenCandle version, generation timestamp, and the user-visible disclaimer text from `src/prompts/disclaimer.ts`.
  Sections render only when their source entries exist (truthful absence — no empty scaffolding, matching the daily-report precedent).
- GUI: an "Export" action downloading the HTML (with a markdown option), served by a session-addressed GUI route behind the standard trusted-session checks. Two homes: (a) recent-research items in the context drawer (exists today), and (b) a **new minimal hover/focus action row on assistant messages containing only Export** — no message action row exists in the chat UI today, so this change introduces the affordance deliberately minimal (it also becomes the natural home for the chat-event-rendering spec's long-promised message actions; copy/retry stay out of scope).
- **Turn identification contract:** the route is `GET /api/sessions/{id}/artifact?message=<assistantMessageEntryId>&format=html|md`. The server slices entries from the user message preceding the anchor assistant message through the anchor, inclusive; if an `opencandle-workflow` entry sits in that span (a workflow run), the slice extends back to that entry so the whole run (all analyst steps) is included. The client learns entry ids and turn eligibility (routed finance turn = an `opencandle-route-context` or `opencandle-workflow` entry in the turn span) from the bootstrap payload's `snapshot.entries`, which it already receives.
- Privacy guard: when the turn's route context shows saved market-state was included, the export confirmation states the file contains saved positions before downloading.
- File naming: `opencandle-<workflow>-<SYMBOL>-<YYYY-MM-DD>.<ext>` with the symbol segment omitted when unknown; non-workflow turns use `opencandle-answer-<YYYY-MM-DD>.<ext>`.

## Non-Goals

- No charts/images in v1 (the artifact is text + tables; embedding evidence-derived SVG charts is a follow-up).
- No hosted sharing, links, or upload — the artifact is a local file the user distributes themselves.
- No PDF (HTML prints fine; browsers own that).
- No TUI export command in v1 (the renderer is a plain function; a TUI command is a cheap follow-up).
- No model-generated summaries, restructuring, or editorializing of recorded content.

## Dependencies

- None hard. Renders richer with `freshness-ledger` (as-of column), `answer-receipts` (receipts table), and I2/I3 analyst-step entries (already on `main`) — all render-if-present.
