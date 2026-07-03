## ADDED Requirements

### Requirement: Catalog Payload Excludes Credential Secrets

The GUI catalog/provider payload SHALL never contain stored credential secret values. Provider configuration state SHALL be communicated as status metadata only.

#### Scenario: Configured provider serializes status, not the key

- **WHEN** the server serializes an API-key provider that has a saved credential
- **THEN** the payload carries configured status, credential source, and at most a masked hint (such as the last four characters)
- **AND** the raw API key value is absent from the payload

#### Scenario: Provider form offers replace-only input

- **WHEN** the user opens the provider setup form for a configured provider
- **THEN** the form shows a configured indicator and an empty replace-key input
- **AND** the saved key is never prefilled into any DOM field

#### Scenario: Saving a replacement key uses the existing save path

- **WHEN** the user enters and saves a replacement key
- **THEN** the existing provider save action persists it
- **AND** subsequent payloads still expose only status metadata

### Requirement: Catalog Tool Forms Derive From Served Schemas

The GUI catalog SHALL build tool invocation forms from the tool parameter schemas served in the catalog payload, so form definitions cannot drift from registered tools.

#### Scenario: Form fields come from the served parameter schema

- **WHEN** the user opens a tool's invocation form in the catalog
- **THEN** field names, types, required flags, enums, defaults, and descriptions derive from that tool's served parameter schema
- **AND** no hand-written per-tool field definition is consulted

#### Scenario: Overrides adjust presentation only

- **WHEN** a per-tool override exists for labels, placeholder examples, or curated defaults
- **THEN** the override refines presentation of schema-derived fields
- **AND** it cannot introduce fields absent from the served schema or reference a tool name that is not in the catalog payload

#### Scenario: No orphan form schemas

- **WHEN** the catalog renders its tool list and forms
- **THEN** every renderable form corresponds to a tool present in the served catalog
- **AND** entries for nonexistent tools (such as the former `predict_returns`) do not exist

### Requirement: Empty-State Suggestions Lead With Fast Prompts

The GUI empty-state prompt suggestions SHALL lead with fast, keyless prompts and SHALL label the multi-analyst workflow as a deep-research option.

#### Scenario: First suggestions are quick wins

- **WHEN** a user views the empty-thread prompt suggestions
- **THEN** the first suggestions are fast keyless prompts such as quotes, comparisons, or filings
- **AND** `/analyze` is not the first suggestion

#### Scenario: Deep research is labeled as such

- **WHEN** the suggestions include the multi-analyst `/analyze` workflow
- **THEN** it is presented with deep-research framing that sets the expectation of a longer multi-step run
