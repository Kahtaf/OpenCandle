# Verify live provider contracts

Run the provider contract suite from the repository root:

```bash
npm run test:providers:contracts
```

This suite calls real APIs and registered OpenCandle tools. It checks meaningful
payloads, source timestamps, filing identity, citations, and rendered caveats.
It does not mock HTTP responses. Unit tests and the two-case provider release
smoke do not replace this proof.

To run one group or one exact case:

```bash
npm run test:providers:contracts -- --group macro
npm run test:providers:contracts -- --group search --case twitter:sentiment-citations
```

The groups are `market`, `macro`, and `search`. Repeat `--group` or `--case` to
select several. Unknown selections and empty selections fail before live work.
The suite covers non-LSE providers. The existing `test:e2e:providers` command
retains its broader symbol sampling and LSE checks.

Configure provider keys through OpenCandle configuration or environment
variables. The suite uses existing credentials and runs registered tools with
temporary OpenCandle storage. Reddit and Twitter also require their installed
CLI tools and authenticated local sessions. The suite does not install them,
change authentication, purchase access, or bypass upstream restrictions.

Each run clears the provider cache before each case. Requests within a case may
exercise caching deliberately, such as comparing SEC metadata with enrichment.
The complete run has a twelve-minute deadline. A timeout records every unfinished
case as failed. Interrupted runs retain a running status rather than a success.

Read `validation-output/provider-contracts/<run>/summary.json` for the selected
cases, candidate commit, dirty-worktree flag, outcomes, and sanitized reasons.
A dirty run is working-tree evidence; commit changes before recording final proof. Every selected case
is required. Any failure or skip produces exit code 1. Missing credentials,
premium-only capabilities, bot challenges, and forbidden endpoints are not
healthy results. A strict hour search may legitimately return no results; that
case proves exclusion of old or undated results, not availability of recent news.

Run this suite in an authenticated environment for social proof. The existing
nightly workflow retains its provider checks; scheduling the complete contract
suite requires an environment with social CLI sessions and appropriate API
entitlements.

Preserve failed attempts. After a code or assertion fix, rerun only affected
cases before the final integrated run. Do not retry unchanged failures until
they turn green. A supplemental error replay can verify fallback logic, but it
is not evidence that the corresponding live failure occurred.
