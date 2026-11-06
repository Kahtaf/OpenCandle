## MODIFIED Requirements

### Requirement: Portfolio Page Shows Portfolio-Level Meaning

OpenCandle SHALL make saved portfolios useful beyond raw lot entry using the shared portfolio FX valuation contract across TUI, local GUI, and hosted GUI.

#### Scenario: Portfolio row shows holding context

- **WHEN** a portfolio lot has quote data available
- **THEN** the row shows symbol, quantity, average cost with cost currency, native price/value with quote currency, reporting value when available, independently available P&L with its currency, and separate security/FX freshness

#### Scenario: Portfolio summary aggregates holdings

- **WHEN** the portfolio has one or more lots
- **THEN** the page shows a full reporting-currency total only when every holding is valued; otherwise it shows unavailable or an explicitly labeled valued subtotal with exclusions
- **AND** it shows allocation by holding or equivalent summary context, labeling partial allocation as a share of valued holdings

#### Scenario: Mixed-currency portfolio rows are not silently aggregated

- **WHEN** a portfolio contains lots whose lot currency or quote currency differs from the portfolio base currency
- **THEN** OpenCandle shows row-level currency context for those holdings
- **AND** it excludes unsupported mixed-currency rows from base-currency totals unless an explicit FX conversion source is available
- **AND** the portfolio summary discloses which rows were excluded or need FX support

#### Scenario: Quote currency mismatch does not fabricate row P&L

- **WHEN** a portfolio lot's quote currency differs from the lot currency and no FX conversion source is available
- **THEN** OpenCandle does not calculate P&L by subtracting unlike currencies; native market value remains visible when quote units are known
- **AND** the row shows the data gap or FX requirement instead of a fabricated same-currency result

#### Scenario: Missing quote data is visible

- **WHEN** current quote data is unavailable or stale for a holding
- **THEN** the page marks that row as stale or unavailable
- **AND** summary calculations disclose excluded or stale rows

#### Scenario: Current FX does not establish historical cost

- **WHEN** converted market value exists but reporting-currency acquisition cost is unknown
- **THEN** the page shows converted value and unavailable reporting P&L independently
- **AND** it does not convert historical cost at today's rate or show unavailable P&L as zero
