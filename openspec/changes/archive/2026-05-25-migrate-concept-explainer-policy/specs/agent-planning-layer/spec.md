## ADDED Requirements

### Requirement: Concept Explainer Slice Migration

The planning layer SHALL support migrating the `concept_explainer` task family from legacy fallback prompt prose into a dedicated policy card and answer contract after parity passes. The slice SHALL preserve no-tool conceptual education routing and SHALL NOT require live evidence.

#### Scenario: Concept prompt selects concept planning owners

- **WHEN** the user asks a no-symbol conceptual or valuation education question
- **THEN** the resolved planning metadata selects task family `concept_explainer`
- **AND** it selects the `concept_explainer` policy card and answer contract
- **AND** it selects evidence plan `placeholder_concept_explainer`
- **AND** no live finance tool bundle is required

#### Scenario: Concept policy preserves educational answer shape

- **WHEN** concept explanation is selected
- **THEN** the answer contract requires a framework or checklist answer
- **AND** the policy card requires educational sections such as Bottom line, Core mental model, Practical workflow, Where it misleads, Cross-checks, and Quick checklist when the user asks how to use a valuation metric without over-relying on it
- **AND** it prevents analyst commitment, confidence-band, and invalidation boilerplate for pure education prompts

#### Scenario: Concept migration has explicit activation states

- **WHEN** the slice is observe-only
- **THEN** the concept policy card is not injected and the legacy fallback conceptual-education clause remains authoritative
- **WHEN** the slice is dual-run
- **THEN** the concept policy card may be injected while the legacy fallback clause remains present
- **WHEN** the slice is replacement-active or legacy-removed
- **THEN** only the matching conceptual-education fallback playbook clause may be removed for concept turns

#### Scenario: Concept migration does not promote deferred roadmap items

- **WHEN** concept explanation is implemented
- **THEN** the change does not add providers, meta-tools, evidence types, persisted workspaces, typed artifacts, semantic validators, active retry, role escalation, hard tool-bundle enforcement, or router-owned planning
