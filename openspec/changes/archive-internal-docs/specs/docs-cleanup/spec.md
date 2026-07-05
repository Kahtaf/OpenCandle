## ADDED Requirements

### Requirement: Internal planning docs separate operative state from archived history

`docs/internal/` SHALL contain only operative documents: process docs still followed, ledgers still appended to, design docs for unimplemented work, decision records whose justifications are still load-bearing, and data files referenced by code or tests. Completed plans, point-in-time audits, and superseded records SHALL live under `docs/internal/archive/` with an index in `docs/internal/archive/README.md` that lists each archived document's title, a one-sentence description, the archive date, and the reason it was archived.

Files referenced by code or tests (for example `docs/internal/prompt-to-policy-migration-manifest.json`) SHALL NOT be moved without updating every referencing path in the same change.

#### Scenario: Completed plan is archived with an index entry

- **WHEN** a plan in `docs/internal/` has been fully executed or superseded
- **THEN** it is moved to `docs/internal/archive/` via `git mv` with its content byte-identical
- **AND** `docs/internal/archive/README.md` gains a one-line index entry for it
- **AND** cross-references in remaining tracked markdown are updated to the new path

#### Scenario: Code-referenced data file stays put

- **WHEN** a `docs/internal/` file is referenced by any file under `src/`, `tests/`, `gui/`, or `.github/`
- **THEN** the file is not moved by a docs archive pass
- **AND** the archive index does not claim it

#### Scenario: Operative ledger keeps its path

- **WHEN** a document is an append-only ledger that future runs will append to (for example `competitive-benchmark-history.md`)
- **THEN** it remains at its existing `docs/internal/` path
