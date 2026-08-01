---
name: OpenCandle
description: Minimal shadcn-style research workbench UI shared by the GUI, docs site, and homepage.
colors:
  ink: "#18181B"
  graphite: "#71717A"
  paper: "#FFFFFF"
  zinc-mist: "#F4F4F5"
  zinc-sunk: "#EAEAEC"
  hairline: "#E4E4E7"
  hairline-strong: "#D4D4D8"
  brand: "#18181B"
  success: "#1A9948"
  warning: "#DC8409"
  danger: "#EF4343"
  info: "#3C83F6"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "36px"
  page-max: "1320px"
  prose-max: "720px"
components:
  button-brand:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "36px desktop, 44px touch"
    padding: "0 12px"
  button-bordered:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
  badge:
    backgroundColor: "{colors.zinc-mist}"
    textColor: "{colors.graphite}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "24px"
    padding: "0 8px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 12px"
---

# Design System: OpenCandle

## Overview

**Creative North Star: "The Research Desk."**

OpenCandle is a quiet, exacting workbench for financial research. The design language is the GUI's: minimal, professional, shadcn-component construction in the spirit of llmchat — white paper, zinc neutrals, one near-black action color, Inter for everything, JetBrains Mono only where data demands alignment. The docs site and homepage follow the GUI, not the other way around. The shared workspace `packages/ui` is the source of truth: `packages/ui/src/styles.css` for tokens and `packages/ui/src/` for primitive anatomy, consumed by both the local GUI (`gui/web`) and the public site (`website`).

The system rejects glossy fintech theater, navy-and-gold finance cliches, purple AI gradients, decorative glass, stock-photo polish, gamified trading-app energy, and terminal cosplay. Color exists to carry meaning — market direction, provider state, data freshness — never decoration. Evidence (real screenshots, real tool output, real numbers) carries the visual story.

**Key Characteristics:**

- White surfaces layered with zinc tints before any shadow.
- One action color: near-black ink. Semantic green/amber/red/blue communicate state only.
- Inter at every scale; hierarchy from size and weight, never a second display face.
- Hairline borders, 8–12px radii; pill shapes reserved for composer actions and page-level primary CTAs.
- Tabular numerals on all financial figures; signed values accompany every direction color.

## Colors

A zinc-neutral system: white paper, cool grays with a barely-there blue cast (hue 240), one near-black action color, and four semantic signals.

### Primary

- **Research Ink** (`#18181B`): Foreground text, headings, and the only action color. Primary buttons, active navigation, focus rings, and toggles are this near-black — commitment is shown by darkness, not hue.

### Neutral

- **Paper** (`#FFFFFF`): Default surface for pages, panels, cards, and inputs.
- **Zinc Mist** (`#F4F4F5`): Secondary fills — hover states, badges, inline-code backgrounds, selected rows, lot-ledger rows.
- **Zinc Sunk** (`#EAEAEC`): Tertiary fill for pressed/active states and deeper tonal layers.
- **Hairline** (`#E4E4E7`): Default border for panels, tables, dividers, and inputs.
- **Strong Hairline** (`#D4D4D8`): Hover borders, disabled toggle tracks, neutral chart strokes.
- **Graphite** (`#71717A`): Secondary text — descriptions, metadata, column headers, timestamps, inactive nav.

### Semantic

- **Signal Green** (`#1A9948`, `hsl(142 71% 35%)`): Positive market direction, configured providers, success badges. Always paired with a `+` sign or text label.
- **Amber Caveat** (`#DC8409`, `hsl(35 92% 45%)`): Stale quotes, provider limits, partial data, late runs.
- **Signal Red** (`#EF4343`, `hsl(0 84% 60%)`): Negative market direction, failures, destructive actions. Always paired with a `−` sign or text label.
- **Info Blue** (`#3C83F6`, `hsl(217 91% 60%)`): Neutral informational status.

Semantic tints follow the shadcn badge recipe: `color/10` background, `color/30` border, full-strength text.

### Named Rules

**The One Ink Rule.** Research Ink is the only action color. If a control is interactive and committed, it is near-black; if a color is not Research Ink, it is communicating market or system state.

**The Signed Color Rule.** Direction colors never appear without a sign, label, or icon. `+2.41%` in green; never a green number alone.

## Typography

**Display Font:** Inter (system-ui fallback)
**Body Font:** Inter (system-ui fallback)
**Label/Mono Font:** JetBrains Mono (ui-monospace fallback)

**Character:** A single neutral grotesque doing all the work — modern, legible, unsentimental. JetBrains Mono appears only where alignment is functional: code, tickers in dense tables, and tabular financial figures.

### Hierarchy

- **Display** (600, 1.75rem, 1.25): Docs page titles — the largest heading on any surface.
- **Headline** (600, 1.5rem, 1.25): Homepage hero and docs section headings (docs `h2` runs 1.125rem with a top hairline rule).
- **Title** (600, 1.25rem, 1.2): Page titles (17px in the GUI shell), panel headings at 14px/600.
- **Body** (400, 0.875rem, 1.5): GUI default. Docs prose runs 0.875rem at 1.65 line height.
- **Label** (500, 0.75rem, 0.02em): Column headers, badges, kickers, uppercase section labels in inspectors.
- **Code** (400, 0.75rem, tabular numerals): Code blocks, lot ledgers, provider IDs.

### Named Rules

**The One Face Rule.** No second display family, ever. Hierarchy comes from Inter's weight and size, and from spacing.

**The Tabular Rule.** Every financial figure — price, P&L, percentage, quantity — renders with `font-variant-numeric: tabular-nums`.

## Layout

The shared browser surfaces use a responsive application shell with a maximum page width of 1320px and a maximum prose width of 720px. Desktop layouts keep navigation, primary content, and inspectors legible without compressing financial tables; narrow layouts collapse navigation and replace wide tables or inspectors with cards, sheets, and focused detail views.

Use the established 8px-based spacing vocabulary: 8px for tight relationships, 12px for compact component padding, 16px for default panel content, 24px between major groups, and 36px between page sections. Keep chat and financial context in balance rather than allowing either surface to dominate the viewport.

## Elevation & Depth

Tonal layering first, shadows second. Surfaces sit flat with a 1px Hairline border; depth comes from Paper → Zinc Mist → Zinc Sunk. Shadows are neutral-gray, near-invisible, and reserved for genuine lift.

### Shadow Vocabulary

- **Subtle XS** (`0 1px 2px rgba(15, 15, 15, 0.04)`): Cards and panels at rest.
- **Subtle SM** (`0 4px 12px rgba(15, 15, 15, 0.06)`): Popovers, dropdowns, toasts.
- **Subtle MD** (`0 16px 32px rgba(15, 15, 15, 0.08)`): Dialogs, sheets, and the homepage product-screenshot frame.

### Named Rules

**The Neutral Shadow Rule.** Shadow color is neutral near-black at single-digit opacity. Tinted, colored, or glowing shadows are prohibited.

## Shapes

Use 6px radii for compact controls, 8px for standard controls and badges, and 12px for panels and cards. Full pill shapes are reserved for composer actions, page-level primary CTAs, and small count indicators. Hairline borders define structure; avoid decorative outlines, side stripes, and nested rounded containers.

## Components

Components are shadcn/ui constructions (cva variants, Radix primitives where interaction demands it). Shared runtime-agnostic primitives — logo, button, badge, card, input, textarea, kbd, tooltip — live in `packages/ui/src/` and are consumed by the GUI and the public site. GUI-only interactive components (dialog, popover, sheet, toast, status dots) live in `gui/web/src/components/ui/` and compose the same tokens. New components should be composed from these before anything is hand-rolled; efferd.com shadcn blocks are an approved structural reference.

### Buttons

- **Shape:** 8px radius default; the `rounded="full"` pill variant is reserved for composer send actions and page-level primary CTAs.
- **Sizes:** default 36px on desktop and 44px on touch; `sm` 32px/40px. Heights are responsive, larger on touch.
- **Brand:** Research Ink background, Paper text (`hover: opacity 0.9`).
- **Bordered:** Paper background, Hairline border, Ink text (`hover: Zinc Mist`).
- **Ghost:** No border, Graphite text (`hover: Zinc Mist fill, Ink text`).
- **Focus:** 2px Ink ring with offset; never a colored glow.

### Badges

- **Style:** 20–24px tall (`sm`/`md`), 8px radius, 11–12px medium text; the `secondary` variant is a pill. Neutral: Zinc Mist fill + Graphite text. Semantic: `color/10` fill, `color/30` border, full-strength colored text.
- **Status dots:** 7px circles (green armed, amber degraded, gray paused) always adjacent to a text label.

### Cards / Containers

- **Corner Style:** 12px radius.
- **Background:** Paper with 1px Hairline border and Subtle XS shadow.
- **Internal Padding:** 12–16px header band with bottom Hairline rule; content edge-to-edge for tables, 16px otherwise.
- **Nested cards are prohibited** — use a Hairline divider or a Zinc Mist band inside a card.

### Inputs / Fields

- **Style:** Paper background, Hairline border, 8px radius, 36px height.
- **Focus:** Border shifts to Ink with a 2px ring; no glow.
- **Placeholder:** Graphite. Placeholders never substitute for labels.

### Navigation

- **Sidebar:** Paper, right Hairline rule, 13.5px items at 6px/10px padding, 8px radius. Inactive: Graphite. Hover and active: Zinc Mist fill with Ink text; active adds 500 weight. Count pills right-aligned in Zinc Mist.
- **Docs/homepage navbar:** Same vocabulary — Paper bar, Hairline bottom rule, Ink wordmark, Graphite links that resolve to Ink on hover, pill brand CTA.

### Data Tables (signature component)

- **Headers:** 12px/500 Graphite, sentence case, no uppercase, bottom Hairline rule.
- **Rows:** 13.5px, 11px vertical padding, Hairline rules, Zinc Mist hover and selection.
- **Symbol cell grammar:** bold ticker over Graphite company name, two lines.
- **Numbers:** right-aligned, tabular. Direction values use Signed Color Rule.
- **Drill-down:** chevron-expand to Zinc Mist detail rows (lot ledgers), not modals.

## Do's and Don'ts

### Do:

- **Do** treat `packages/ui/src/styles.css` and `packages/ui/src/` as the normative token and primitive source; GUI-only components in `gui/web/src/components/ui/` build on the same tokens.
- **Do** keep one primary (Research Ink) action per region; everything else bordered or ghost.
- **Do** let healthy quotes update silently in the background with no age chrome; age appears only as a caveat — an Amber Caveat badge in plain language ("Quote 26m old", "As of Fri close") when data is stale, from a prior market session, or a provider check failed.
- **Do** use relative, human timestamps in UI surfaces; raw ISO strings belong in tool output only.
- **Do** layer Paper → Zinc Mist → Zinc Sunk before reaching for shadow.

### Don't:

- **Don't** reintroduce the retired docs-site theme: DM Sans, Candle Slate `#34474E`, sage `#87A188`, cream code blocks, or green-tinted shadows.
- **Don't** use purple AI gradients, navy-and-gold finance cliches, glassmorphism, stock-photo gloss, or gamified trading-app styling — PRODUCT.md's anti-references, verbatim.
- **Don't** communicate market direction through color alone; every red/green value carries its sign.
- **Don't** add a second display font, gradient text, side-stripe borders, or decorative card shadows.
- **Don't** leak internal vocabulary (`price_crosses_above`, "Instrument #1", "SQLite-backed") into user-facing copy.
- **Don't** ship manual refresh buttons; data updates in the background and announces its age only when degraded.
