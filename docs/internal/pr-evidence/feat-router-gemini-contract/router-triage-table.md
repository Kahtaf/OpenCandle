# Gemini Router Contract Triage Table

Classes follow the archived 2026-07-03 evidence:

- **A**: benign extra informational slots or assumptions.
- **B**: richer workflow label/tool-bundle choice with the same route kind.
- **C**: slot or vocabulary synonym that downstream resolution normalizes.
- **D**: genuine quality difference; any class change across runs is also treated as D until fixed.

Stability:

- **Stable**: same class/shape across the fresh pre-fix runs.
- **Unstable**: fresh runs changed class or route-kind shape.
- **Fixed**: post-fix live runs are exact under the route contract.

| Fixture | Archived audit class | Archived baseline class | Fresh pre-fix runs | Stability | Action | Post-fix runs |
|---|---:|---:|---:|---|---|---:|
| 001 portfolio aggressive | Pass after prior canonicalization | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 002 portfolio diversified | Pass after prior canonicalization | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 003 options DTE wording | C | C | C / C | Stable | `stripNonContract` removes natural DTE prose/slot synonym from cross-model contract. | Pass / Pass |
| 004 options missing symbol | Pass | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 005 compare assets | Pass | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 006 fallback entry levels | B | B | B / B | Stable | `stripNonContract` ignores richer same-route-kind fallback workflow label/tool bundle expansion. | Pass / Pass |
| 007 fallback data fetch | B | B | B / B | Stable | Same Class B eval normalization as 006. | Pass / Pass |
| 008 single asset | Pass after prior canonicalization | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 009 general QA | Pass | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 010 profile preference copy | D | D | D / D | Stable | Deterministic post-processor fills missing `risk_profile` slot from `profileSnapshot`. | Pass / Pass |
| 011 fallback missing symbol | Pass | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 012 ETF preference vocabulary | C | C | C / C | Stable | `stripNonContract` ignores ETF-only slot/preference vocabulary drift while preserving route kind. | Pass / Pass |
| 013 coreference price | A+B | A+B | A+B / A+B | Stable | Class A slots and Class B fallback workflow label normalized in eval contract. | Pass / Pass |
| 014 carried budget | A | A | A / A | Stable | Class A extra prior-context budget slot normalized in eval contract. | Pass / Pass |
| 015 topic shift | A+B | A+B | A+B / A+B | Stable | Class A/B eval normalization; route kind remains visible. | Pass / Pass |
| 016 ticker correction | Pass | Pass | Pass / Pass | Stable | None | Pass / Pass |
| 017 conversational preference | D route-kind flip | D route-kind flip | D flip / D flip | Stable D | Deterministic post-processor recovers risk-profile update from profile/prior-turn context. | Pass / Pass |
| 018 dollar phrase carryover | A+B partial | A+B partial | A+B / A+B | Stable residual | Documented same-route-kind prior-context symbol carryover gap; below gate threshold and not route-kind instability. | A residual / A residual |
| 019 IV as volatility | A | A | A / A | Stable | Class A extra symbol slot normalized; entity acronym drop remains deterministic. | Pass / Pass |
| 020 SEC as regulator | A | A | A / A | Stable | Class A extra symbol slot normalized; entity acronym drop remains deterministic. | Pass / Pass |
| 021 FED as bank | A | A | A / A | Stable | Class A extra symbol slot normalized; entity acronym drop remains deterministic. | Pass / Pass |
| 022 CPI as metric | A in audit, D flip in baseline | D/A unstable | D flip / A | Unstable D | Deterministic post-processor corrects macro acronym compare dispatch after symbol-slot cleanup. | Pass / Pass |
| 023 IV positive signal | A | A | A / A | Stable | Class A scalar symbol slot normalized; positive ticker signal still keeps `IV` entity. | Pass / Pass |
| 024 IV bare list dropped | A | A | A / A | Stable | Class A extra symbols slot normalized; acronym drop remains deterministic. | Pass / Pass |
| 025 IV local ticker phrase | D | D/unstable | D / D-ish slot drift | Unstable D | Deterministic post-processor restores locally marked acronym tickers and orders compare symbols by text. | Pass / Pass |
| 026 non-finance pass through | Pass | Pass | Pass / Pass | Stable | None | Pass / Pass |

## Gate Summary

The two post-fix Gemini baselines are both 25/26 exact under the route contract (96.2%) with zero route-kind flips. The only residual non-exact fixture, 018, preserves route kind and is documented as a same-route-kind prior-context symbol carryover gap rather than a D-class instability.
