## 1. Design System And Shell

- [ ] Confirm OC primitives remain the only implementation component layer.
- [ ] Define shared app-shell regions for navigation, primary work surface, and optional context/details panel.
- [ ] Normalize page-header, toolbar, summary-strip, data-surface, empty-state, and detail-panel patterns.
- [ ] Replace ambiguous market-state action copy such as `Quotes` with explicit labels such as `Refresh prices`.

## 2. Market-State Page Layouts

- [ ] Refactor Watchlists into a state-first working-list page.
- [ ] Refactor Portfolios into a portfolio-summary and holdings-first page.
- [ ] Refactor Alerts into monitoring summary, rules, events, check runs, and notifications.
- [ ] Refactor Reports into schedule/output management with report history.
- [ ] Refactor Predictions UI framing into Thesis Tracker unless product naming changes.

## 3. Create/Edit Flows

- [ ] Move add/update ticker flows out of permanent first-viewport panels.
- [ ] Move add/update holding flows into contextual create/edit surfaces.
- [ ] Turn alert creation into a structured rule builder with plain-English preview.
- [ ] Ensure ticker search/autocomplete remains provider-backed before saving.
- [ ] Ensure follower/read-only mode disables mutations without hiding readable state.
- [ ] Ensure search/filter controls operate on the visible saved-state surface they are placed beside.

## 4. Responsive And Motion

- [ ] Provide mobile layouts for each market-state page with accessible navigation.
- [ ] Convert dense tables into usable mobile row layouts where horizontal tables fail.
- [ ] Apply restrained product motion only where it clarifies state changes.
- [ ] Respect `prefers-reduced-motion` for all motion.

## 5. Verification

- [ ] Run unit/render tests affected by GUI layout changes.
- [ ] Run React Doctor for changed GUI React files and resolve errors before merge.
- [ ] Capture a full-GUI React Doctor baseline before implementation and finish with a score greater than or equal to that baseline.
- [ ] Record any deferred React Doctor warnings with rationale.
- [ ] Run the local GUI and browser-test `/`, `/watchlists`, `/portfolios`, `/alerts`, `/reports`, and `/predictions`.
- [ ] Capture temporary desktop and mobile screenshots for implementation review.
- [ ] Verify keyboard focus for navigation, primary actions, sheets/drawers, menus, and dialogs.
- [ ] Verify follower/read-only mode on Watchlists and Alerts: saved state remains readable, mutation actions cannot fire, and explanatory text is visible.
- [ ] Run OpenSpec validation for this change.
