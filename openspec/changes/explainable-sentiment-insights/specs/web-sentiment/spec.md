## ADDED Requirements

### Requirement: Web sentiment explains headline and snippet drivers
The `get_web_sentiment` tool SHALL return `details.insight` for web/news results in addition to scored result rows. The insight SHALL identify positive, negative, and mixed drivers from headlines, snippets, source domains, freshness, and matched sentiment evidence.

#### Scenario: News results lean positive
- **WHEN** recent web/news results for a ticker include recurring positive catalysts such as earnings beats, guidance raises, product wins, or analyst upgrades
- **THEN** the tool output includes positive drivers summarizing those catalysts
- **AND** representative articles cite the title, source domain, URL, published timestamp when available, and sentiment score

#### Scenario: News results lean negative
- **WHEN** recent web/news results include recurring risks such as downgrades, lawsuits, weak demand, margin pressure, dilution, or macro headwinds
- **THEN** the tool output includes negative drivers summarizing those risks
- **AND** representative articles cite the title, source domain, URL, published timestamp when available, and sentiment score

### Requirement: Web sentiment separates claims from conclusions
The `get_web_sentiment` insight SHALL separate notable claims found in headlines/snippets from OpenCandle's conclusion about sentiment. Notable claims SHALL be presented as source claims unless corroborated by other fetched evidence.

#### Scenario: Single article makes a strong claim
- **WHEN** one web result claims a major catalyst or risk but other results do not mention it
- **THEN** the claim appears under notable claims with its source
- **AND** confidence or caveats disclose that it is single-source evidence

### Requirement: Web sentiment quality caveats
The `get_web_sentiment` tool SHALL include confidence and caveats for web/news-specific risks including low result count, stale or missing published dates, duplicate syndicated articles, source concentration, search-provider degradation, and snippet-only scoring.

#### Scenario: Snippet-only scoring
- **WHEN** only headlines and snippets are available for scoring
- **THEN** the caveats disclose that full article text was not analyzed
- **AND** confidence reflects the limited text coverage

#### Scenario: Source concentration
- **WHEN** most web results come from one source domain or syndicated duplicates
- **THEN** the caveats disclose source concentration
- **AND** representative articles avoid repeating near-duplicate items where possible
