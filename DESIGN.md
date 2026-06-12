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
    fontSize: "4.5rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1.1
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
  page-max: "1240px"
  prose-max: "720px"
components:
  button-brand:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    height: "36px"
    padding: "0 16px"
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
    rounded: "{rounded.sm}"
    height: "22px"
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

## 1. Overview

**Creative North Star: "The Research Desk."**

OpenCandle is a quiet, exacting workbench for financial research. The design language is the GUI's: minimal, professional, shadcn-component construction in the spirit of llmchat — white paper, zinc neutrals, one near-black action color, Inter for everything, JetBrains Mono only where data demands alignment. The docs site and homepage follow the GUI, not the other way around; `gui/web/src/styles.css` and `gui/web/src/components/ui/` are the source of truth for tokens and component anatomy.

The system rejects glossy fintech theater, navy-and-gold finance cliches, purple AI gradients, decorative glass, stock-photo polish, gamified trading-app energy, and terminal cosplay. Color exists to carry meaning — market direction, provider state, data freshness — never decoration. Evidence (real screenshots, real tool output, real numbers) carries the visual story.

**Key Characteristics:**

- White surfaces layered with zinc tints before any shadow.
- One action color: near-black ink. Semantic green/amber/red/blue communicate state only.
- Inter at every scale; hierarchy from size and weight, never a second display face.
- Hairline borders, 6–12px radii, pill-shaped primary CTAs.
- Tabular numerals on all financial figures; signed values accompany every direction color.

## 2. Colors

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

## 3. Typography

**Display Font:** Inter (system-ui fallback)
**Body Font:** Inter (system-ui fallback)
**Label/Mono Font:** JetBrains Mono (ui-monospace fallback)

**Character:** A single neutral grotesque doing all the work — modern, legible, unsentimental. JetBrains Mono appears only where alignment is functional: code, tickers in dense tables, and tabular financial figures.

### Hierarchy

- **Display** (600, 4.5rem, 1.05, −0.02em): Homepage hero only.
- **Headline** (600, 2.75rem, 1.1): Homepage and docs section headings.
- **Title** (600, 1.25rem, 1.2): Page titles (17px in the GUI shell), panel headings at 14px/600.
- **Body** (400, 0.875rem, 1.5): GUI default. Docs prose runs 1rem with a 65–75ch measure.
- **Label** (500, 0.75rem, 0.02em): Column headers, badges, kickers, uppercase section labels in inspectors.
- **Code** (400, 0.75rem, tabular numerals): Code blocks, lot ledgers, provider IDs.

### Named Rules

**The One Face Rule.** No second display family, ever. Hierarchy comes from Inter's weight and size, and from spacing.

**The Tabular Rule.** Every financial figure — price, P&L, percentage, quantity — renders with `font-variant-numeric: tabular-nums`.

## 4. Elevation

Tonal layering first, shadows second. Surfaces sit flat with a 1px Hairline border; depth comes from Paper → Zinc Mist → Zinc Sunk. Shadows are neutral-gray, near-invisible, and reserved for genuine lift.

### Shadow Vocabulary

- **Subtle XS** (`0 1px 2px rgba(15, 15, 15, 0.04)`): Cards and panels at rest.
- **Subtle SM** (`0 4px 12px rgba(15, 15, 15, 0.06)`): Popovers, dropdowns, toasts.
- **Subtle MD** (`0 16px 32px rgba(15, 15, 15, 0.08)`): Dialogs, sheets, and the homepage product-screenshot frame.

### Named Rules

**The Neutral Shadow Rule.** Shadow color is neutral near-black at single-digit opacity. Tinted, colored, or glowing shadows are prohibited.

## 5. Components

Components are shadcn/ui constructions (cva variants, Radix primitives where interaction demands it). New GUI components should be composed from `gui/web/src/components/ui/` before anything is hand-rolled; efferd.com shadcn blocks are an approved structural reference.

### Buttons

- **Shape:** 8px radius default; primary CTAs are pills (9999px).
- **Brand:** Research Ink background, Paper text, pill shape, 36px height (`hover: opacity 0.9`).
- **Bordered:** Paper background, Hairline border, Ink text, 32px height (`hover: Zinc Mist`).
- **Ghost:** No border, Graphite text (`hover: Zinc Mist fill, Ink text`).
- **Focus:** 2px Ink ring with offset; never a colored glow.

### Badges

- **Style:** 22px tall, 6px radius, 11–12px medium text. Neutral: Zinc Mist fill + Graphite text. Semantic: `color/10` fill, `color/30` border, full-strength colored text.
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

## 6. Do's and Don'ts

### Do:

- **Do** treat `gui/web/src/styles.css` and `gui/web/src/components/ui/` as the normative token and component source.
- **Do** keep one primary (pill, Research Ink) action per region; everything else bordered or ghost.
- **Do** show data freshness in plain language ("Updated 2m ago", "Quote 26m old") with Amber Caveat when stale.
- **Do** use relative, human timestamps in UI surfaces; raw ISO strings belong in tool output only.
- **Do** layer Paper → Zinc Mist → Zinc Sunk before reaching for shadow.

### Don't:

- **Don't** reintroduce the retired docs-site theme: DM Sans, Candle Slate `#34474E`, sage `#87A188`, cream code blocks, or green-tinted shadows.
- **Don't** use purple AI gradients, navy-and-gold finance cliches, glassmorphism, stock-photo gloss, or gamified trading-app styling — PRODUCT.md's anti-references, verbatim.
- **Don't** communicate market direction through color alone; every red/green value carries its sign.
- **Don't** add a second display font, gradient text, side-stripe borders, or decorative card shadows.
- **Don't** leak internal vocabulary (`price_crosses_above`, "Instrument #1", "SQLite-backed") into user-facing copy.
- **Don't** ship manual refresh buttons; data updates in the background and announces its own age.
