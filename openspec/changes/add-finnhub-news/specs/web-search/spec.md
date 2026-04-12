## MODIFIED Requirements

### Requirement: Web search provider with conditional cascade
The system SHALL provide a `searchWeb(query, opts)` function in `src/providers/web-search.ts` that returns `ProviderResult<WebSearchEnvelope>`. The provider uses `withFallback()` with cascade order:

- Exa first (MCP endpoint or API key — no configuration required for MCP)
- Brave second (when `BRAVE_API_KEY` is configured)
- DDG last (zero-config fallback via `duck-duck-scrape`)

The provider SHALL NOT be additionally wrapped with `wrapProvider()` at the tool level — `withFallback()` already calls `wrapProvider` per entry internally.

#### Scenario: Exa succeeds
- **WHEN** Exa MCP or API returns results
- **THEN** Exa results are returned; Brave and DDG are not called

#### Scenario: Exa fails, Brave configured, Brave succeeds
- **WHEN** Exa fails and `BRAVE_API_KEY` is set and Brave returns results
- **THEN** Brave results are returned; DDG is not called

#### Scenario: Exa fails, Brave fails or not configured, DDG fallback
- **WHEN** Exa fails and Brave fails (or is not configured)
- **THEN** the cascade falls through to DDG as last resort

#### Scenario: All providers fail, stale cache exists
- **WHEN** all providers fail but a cached result exists within `STALE_LIMIT.WEB_SEARCH` (1 hour)
- **THEN** the stale cached data is returned (stale flag propagated via `wrapProvider`)

#### Scenario: All providers fail, no stale cache
- **WHEN** all providers in the cascade fail and no stale cache exists
- **THEN** `withFallback` returns `{ status: "unavailable", reason: "all providers failed: ...", provider: "..." }`
