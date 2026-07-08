## 1. Command and Matcher

- [ ] 1.1 Implement `/forget <topic>`, `/forget`, and `/forget --remove <topic>` parsing without adding a separate `/remember` command.
- [ ] 1.2 Implement topic normalization: trim, casefold, and strip one leading `$`.
- [ ] 1.3 Implement ticker mode for normalized topics matching `^[A-Za-z]{1,5}$`, with case-insensitive word-boundary matching for bare symbols and `$SYMBOL` cashtags.
- [ ] 1.4 Implement phrase mode for all other topics, with case-insensitive substring matching.
- [ ] 1.5 Add unit tests for the matcher decision table: `ASTS` vs "blasts off" no-match, `$IV` vs "implied volatility (IV)" match, phrase with punctuation, phrase spanning a markdown code span, cashtag match, and company-name alias no-match.

## 2. Durable Forget List

- [ ] 2.1 Add the `forget_entries` memory SQLite table with `kind` constrained to `ticker` or `phrase`, stored normalized `pattern`, and `created_at`.
- [ ] 2.2 Bump the memory database schema from v9 to v10 through an additive migration.
- [ ] 2.3 Add a migration test upgrading a representative v9 database constructed in a temporary directory to v10 and asserting no data loss.
- [ ] 2.4 Ensure forget entries persist across sessions and processes that share the same memory database.

## 3. Suppression Surfaces

- [ ] 3.1 Filter `buildPriorTurns` in `src/runtime/session-coordinator.ts` by excluding whole matching turns, not masking or rewriting them.
- [ ] 3.2 Filter Pi compaction and branch summary entries from prior-turn derivation when their text matches an active forget entry.
- [ ] 3.3 Filter matching structured memory and preference rows at read time for prompt-context assembly and memory retrieval without deleting the rows.
- [ ] 3.4 Filter saved watchlist, portfolio, alert, and report summaries from AI-visible prompt context without deleting rows or hiding them from GUI/TUI management surfaces.
- [ ] 3.5 Ensure the forget list filters history only and never suppresses the live user turn that re-introduces a topic.

## 4. User Feedback and Limitations

- [ ] 4.1 Show success confirmations that state pattern kind and suppression counts without echoing the topic or matched historical text.
- [ ] 4.2 Implement `/forget` with no argument as an active-entry listing that includes patterns, kinds, and per-entry suppression counts.
- [ ] 4.3 Implement `/forget --remove <topic>` to delete the matching durable forget entry.
- [ ] 4.4 Document v1 limitations: no watchlist/portfolio/alert/report deletion, no transcript redaction, no provider-side or model-side deletion, and no prevention of future user re-introduction.

## 5. Verification

- [ ] 5.1 Add an extension-level test proving that after `/forget`, the serialized router prompt for the next turn contains no forgotten match; assert on the actual prompt string, not intermediate structures.
- [ ] 5.2 Add a structured-memory prompt-context test where a saved preference mentioning the forgotten ticker no longer appears in rendered prompt context.
- [ ] 5.3 Add a saved market-state prompt-context test where a forgotten ticker remains in SQLite/GUI state but is absent from the serialized AI-visible summary.
- [ ] 5.4 Add a harness e2e using the multi-prompt harness from `docs/internal/archive/high-leverage-improvements-plan.md` item I1: turn 1 mentions the topic, turn 2 runs `/forget`, turn 3 asks an unrelated question, and `trace.json` router input is clean.
- [ ] 5.5 Add the privacy eval case from `docs/internal/archive/high-leverage-improvements-plan.md` item I5/E4: turn 1 "I hold 4,000 shares of XYZ at $12", turn 2 `/forget XYZ`, turn 3 "what should I buy this month?", with assertions that the trace does not expose the forgotten holding.
- [ ] 5.6 Run `npm test`, `npx tsc --noEmit`, `npx biome ci .`, and `openspec validate forget-command --strict`.
- [ ] 5.7 Before archiving the implemented change, run `openspec validate forget-command --strict` and archive through the OpenSpec CLI.
