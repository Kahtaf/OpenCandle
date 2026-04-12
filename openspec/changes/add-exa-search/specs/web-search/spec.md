## MODIFIED Requirements

### Requirement: Web search provider with conditional cascade
The system SHALL provide a `searchWeb(query, opts)` function in `src/providers/web-search.ts` that returns `ProviderResult<WebSearchEnvelope>`. The provider uses `withFallback()` with a cascade order that depends on configuration:

- Exa is always first (uses MCP when no `EXA_API_KEY`, direct API when key is set)
- When `BRAVE_API_KEY` is configured: Brave second, DDG last
- When no `BRAVE_API_KEY`: DDG second (Brave omitted entirely)

The cascade order is the same for both `"news"` and `"general"` categories. The provider SHALL NOT be additionally wrapped with `wrapProvider()` at the tool level — `withFallback()` already calls `wrapProvider` per entry internally.

#### Scenario: Exa succeeds (default case)
- **WHEN** Exa returns results (via MCP or API)
- **THEN** Exa results are returned; Brave and DDG are not called

#### Scenario: Exa fails, Brave configured, Brave succeeds
- **WHEN** Exa fails (timeout, error, empty) and `BRAVE_API_KEY` is set and Brave returns results
- **THEN** Brave results are returned; DDG is not called

#### Scenario: Exa fails, no Brave key, DDG succeeds
- **WHEN** Exa fails and `getConfig().braveApiKey` is undefined and DDG returns results
- **THEN** DDG results are returned

#### Scenario: All providers fail, no stale cache
- **WHEN** all providers in the cascade fail and no stale cache exists
- **THEN** `withFallback` returns `{ status: "unavailable", reason: "all providers failed: ...", provider: "..." }`

#### Scenario: All providers fail, stale cache exists
- **WHEN** all providers fail but a cached result exists within `STALE_LIMIT.WEB_SEARCH` (1 hour)
- **THEN** the stale cached data is returned (stale flag propagated via `wrapProvider`)

### Requirement: WebSearchEnvelope type
The system SHALL define `WebSearchEnvelope` in `src/types/sentiment.ts`: `{ query: string; results: WebSearchResult[]; resultCount: number; fetchedAt: string; provider: "ddg" | "brave" | "exa" }`.

#### Scenario: Envelope fields populated from Exa
- **WHEN** Exa returns 5 results
- **THEN** the envelope has `query` (the normalized query), `results` (5 items), `resultCount: 5`, `fetchedAt` (ISO 8601), `provider: "exa"`
