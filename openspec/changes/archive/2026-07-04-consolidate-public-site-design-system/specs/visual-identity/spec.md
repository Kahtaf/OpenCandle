## ADDED Requirements

### Requirement: Shared public and GUI design system
Public-facing web surfaces SHALL use the same runtime-agnostic design tokens and primitive visual components as the local GUI for core interface elements.

#### Scenario: Public site uses shared primitives
- **WHEN** the public homepage or docs site renders primary actions, secondary actions, cards, badges, keyboard labels, inputs, or the OpenCandle logo
- **THEN** those elements are rendered through shared visual primitives or shared token-backed equivalents used by the local GUI
- **AND** the public site does not maintain a separate, conflicting button/card/logo design language

#### Scenario: GUI keeps existing visual behavior
- **WHEN** the local GUI is built after shared visual primitives are extracted
- **THEN** the chat shell, sidebar, composer, prompt suggestions, and common controls retain their existing visual hierarchy and interaction affordances

#### Scenario: Shared primitives stay runtime-agnostic
- **WHEN** the shared UI package is built or its import boundaries are checked
- **THEN** it has no import path into GUI runtime hooks, session state, toast state, local API clients, context-panel state, or feature modules
- **AND** it remains usable by the static public site build without starting the local GUI server

### Requirement: Public pages mirror the app shell
The public homepage and docs shell SHALL visually mirror the local GUI workspace rather than a separate marketing-site layout.

#### Scenario: Desktop public docs match app chrome
- **WHEN** the public docs site is opened on a desktop viewport
- **THEN** documentation navigation uses an app-like sidebar/header treatment consistent with the local GUI shell
- **AND** the main reading area uses the GUI's shared typography scale, neutral palette, border treatment, and component radius tokens

#### Scenario: Mobile public docs match app mobile behavior
- **WHEN** the public docs site is opened on a mobile viewport
- **THEN** page content is reachable without forcing the entire docs navigation list above the document content
- **AND** navigation uses a compact app-like mobile header, drawer, or equivalent mobile control consistent with the local GUI

#### Scenario: Public homepage matches app first impression
- **WHEN** the public homepage first viewport renders
- **THEN** it presents OpenCandle with an app/workspace-like composition based on the local GUI's visual language
- **AND** it avoids decorative marketing-only motifs that do not exist in the GUI design system
