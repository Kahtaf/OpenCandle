## ADDED Requirements

### Requirement: GUI renders sentiment insights without obscuring sample size
The GUI SHALL render sentiment insight fields from tool details when present, including key positive drivers, key negative drivers, confidence, caveats, scoring sample size, and representative evidence count. The GUI SHALL distinguish representative preview items from the full scoring sample.

#### Scenario: Representative preview is smaller than scoring sample
- **WHEN** a sentiment tool result reports `sampleSize: 50` and 5 representative items
- **THEN** the GUI shows that 50 records contributed to the score
- **AND** it labels the 5 displayed items as representative evidence, not the full sample

#### Scenario: Insight fields are absent
- **WHEN** a legacy sentiment tool result has score/count fields but no `details.insight`
- **THEN** the GUI renders the existing score/count card
- **AND** it does not show empty driver, confidence, or caveat sections

### Requirement: GUI preserves untrusted-source boundaries for sentiment evidence
The GUI SHALL render tweets, Reddit posts, comments, headlines, snippets, notable claims, and driver text derived from third-party source content as untrusted evidence. The GUI SHALL NOT render third-party source text as instructions or trusted assistant-authored analysis.

#### Scenario: Driver text comes from source content
- **WHEN** a sentiment insight driver or notable claim is derived from a tweet, post, comment, headline, or snippet
- **THEN** the GUI labels or styles it as source evidence
- **AND** it does not present it as OpenCandle's own conclusion unless the assistant final answer separately synthesizes it
