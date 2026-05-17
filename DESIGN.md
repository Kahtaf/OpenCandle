---
name: OpenCandle Research Surface
description: Light evidence-first financial research UI for the homepage, docs, and GUI.
colors:
  ink: "#18181B"
  body: "#303633"
  muted: "#71717A"
  paper: "#FFFFFF"
  paper-soft: "#F4F4F5"
  paper-sunk: "#EBEBEC"
  line: "#E4E4E7"
  line-strong: "#D4D4D8"
  brand: "#34474E"
  accent: "#87A188"
  success: "#15803D"
  warning: "#B45309"
  danger: "#DC2626"
  info: "#2563EB"
  code-dark: "#202523"
  code-dark-border: "#111412"
  code-light: "#F5F1E5"
  chrome-dot: "#9FA7A2"
typography:
  display:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "5.25rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0"
  headline:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0"
  title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0"
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  lede:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
  label:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0"
  code:
    fontFamily: "SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
    fontFeature: "tnum"
rounded:
  xs: "5px"
  sm: "7px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  frame: "14px"
  tile: "24px"
  full: "9999px"
spacing:
  xxs: "6px"
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "36px"
  xxl: "52px"
  section-y: "92px"
  hero-top: "150px"
  docs-top: "98px"
  content-max: "780px"
  page-max: "1320px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "54px"
    padding: "0 24px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "54px"
    padding: "0 24px"
  nav-button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  nav-button-active:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "18px"
  docs-content:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "34px"
  floating-tile:
    backgroundColor: "{colors.paper-soft}"
    textColor: "{colors.brand}"
    typography: "{typography.label}"
    rounded: "{rounded.tile}"
    height: "96px"
    width: "96px"
  code-block:
    backgroundColor: "{colors.code-dark}"
    textColor: "{colors.code-light}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "16px"
  screenshot-frame:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
    padding: "0"
---

# Design System: OpenCandle Research Surface

## 1. Overview

**Creative North Star: "The Research Desk."**

OpenCandle should feel like a precise research desk: bright surface, visible instruments, quiet chrome, and strong evidence hierarchy. The current homepage is the source of truth for the static site and the direction for the GUI. It uses a light workspace, DM Sans, dark ink text, green-gray primary actions, and restrained panels that make the real product screenshot feel central.

This system is calm, exacting, and useful. It rejects glossy fintech theater, navy-and-gold finance cliches, purple AI gradients, decorative glass, stock-photo polish, and hidden capabilities. The interface can be visually memorable through scale, grid, and product evidence, but it should never feel like a trading game or a generic AI landing page.

**Key Characteristics:**

- Light research surface with subtle gray page wash.
- Dark ink text and one green-gray primary action.
- Large, confident homepage typography; quieter Markdown typography in docs and GUI.
- Thin borders, small radii, and only a few purposeful shadows.
- Real product evidence, especially screenshots and tool output, carries the visual story.

## 2. Colors

The palette is a restrained light system: white paper, zinc-like grays, deep ink, and a muted green-gray brand action.

### Primary

- **Research Ink** (`#18181B`): Main text, high-emphasis headings, hover state for primary actions, and the darkest UI state.
- **Candle Slate** (`#34474E`): Primary action color. Use it for Install, Run, selected docs nav, active GUI actions, and focus rings.
- **Sage Evidence** (`#87A188`): Soft brand accent. Use sparingly for background tints, generated image accents, and subtle visual association with the logo.

### Neutral

- **White Paper** (`#FFFFFF`): Main page surface, panels, nav, content cards, and screenshot frames.
- **Soft Paper** (`#F4F4F5`): Page wash, code inline backgrounds, nav hover fills, browser chrome strips, and secondary tonal layers.
- **Sunk Paper** (`#EBEBEC`): Selected rows, deeper GUI surfaces, and low emphasis state fills.
- **Hairline** (`#E4E4E7`): Default border, dividers, table rules, and panel outlines.
- **Strong Hairline** (`#D4D4D8`): Hover border and stronger separation when a surface needs a clearer edge.
- **Muted Graphite** (`#71717A`): Secondary copy, metadata, nav labels, captions, and inactive states.
- **Body Graphite** (`#303633`): Long-form Markdown body text, GUI prose, and dense readable copy.

### Semantic

- **Success Green** (`#15803D`): Positive status, configured providers, successful checks, and positive market values with text labels.
- **Warning Ochre** (`#B45309`): Missing keys, stale data, partial results, and caveats.
- **Danger Red** (`#DC2626`): Failed providers, destructive actions, and negative states.
- **Info Blue** (`#2563EB`): Informational statuses, links where the brand action color would imply commitment, and neutral success logs.

### Named Rules

**The One Action Color Rule.** Candle Slate is the only primary action color. Semantic colors communicate state; they do not decorate layout.

**The Paper First Rule.** White Paper is the default surface. Soft Paper and Sunk Paper create depth before shadows do.

## 3. Typography

**Display Font:** DM Sans with system sans fallbacks.
**Body Font:** DM Sans with system sans fallbacks.
**Label/Mono Font:** SFMono-Regular, Menlo, Consolas, monospace.

**Character:** DM Sans gives the homepage a direct, modern, product-native voice without becoming ornamental. The mono stack is only for structural labels, provider names, code, tickers, and data snippets.

### Hierarchy

- **Display** (600, `5.25rem`, 1.05): Homepage hero headline. Use only for the first viewport brand message.
- **Headline** (600, `3.5rem`, 1.05): Homepage sections and major static-site section headings.
- **Docs Title** (600, `3.25rem`, 1.05): Markdown `h1` inside docs content.
- **Title** (600, `1.625rem`, 1.15): Markdown `h2`, GUI panel titles, and dense product page section heads.
- **Body** (400, `1rem`, 1.5): Markdown prose, GUI descriptions, and normal UI copy. Keep long-form text between 65 and 75 characters per line.
- **Lede** (400, `1.25rem`, 1.45): Homepage supporting copy and major static-site intros.
- **Label** (700, `0.75rem`, 1.4): Section kickers, terminal labels, provider labels, and compact metadata. Keep letter spacing at 0.
- **Code** (400, `0.8125rem`, 1.5): Code blocks, terminal snippets, tickers, provider IDs, and structured tool output. Use tabular numbers.

### Named Rules

**The No Decorative Type Rule.** Do not introduce another display family. The difference between homepage, docs, and GUI comes from scale, density, and layout, not font switching.

**The Flat Tracking Rule.** Letter spacing is 0 across the system. Uppercase labels can use weight and mono structure, not tracking, for authority.

## 4. Elevation

OpenCandle uses tonal layering first and shadows second. Most surfaces sit flat with a 1px Hairline border. Shadows appear only on the homepage screenshot frame, the CTA panel, and rare overlays where the surface needs to read as physically above the page.

### Shadow Vocabulary

- **Product Frame Shadow** (`0 24px 90px rgba(52, 71, 78, 0.12)`): Use for the real GUI screenshot frame and large proof surfaces.
- **CTA Shadow** (`0 18px 70px rgba(52, 71, 78, 0.10)`): Use for the final homepage call-to-action or a similarly rare elevated static-site surface.
- **Tile Shadow** (`inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 22px 70px rgba(48, 57, 52, 0.14)`): Use only for homepage floating provider tiles, not for GUI panels.

### Named Rules

**The Flat Product Rule.** GUI surfaces, docs panels, tool cards, tables, and sidebars are flat by default. Use borders and tonal layers before adding shadow.

**The Evidence Frame Rule.** Large shadow belongs to evidence: the product screenshot, an important workflow panel, or a focused overlay. Never use it for decorative card grids.

## 5. Components

### Buttons

- **Shape:** 8px for nav buttons, 10px for large homepage actions, 6px to 8px for compact GUI actions.
- **Primary:** Candle Slate background, White Paper text, 54px height for homepage actions, 40px height for nav actions.
- **Hover / Focus:** Hover shifts primary to Research Ink. Focus uses a 2px Candle Slate outline with a 3px offset.
- **Secondary:** White Paper background, Hairline border, Candle Slate text. Hover uses Soft Paper and Strong Hairline.
- **GUI adaptation:** Keep one primary action per region. Use compact heights when density matters.

### Navigation

- **Homepage and docs navbar:** Fixed top bar, 66px minimum height, White Paper at high opacity, Hairline bottom rule, 14px blur, 52px desktop horizontal padding, 18px mobile padding.
- **Brand lockup:** Logo at 26px, 8px radius, Hairline border, 10px gap to wordmark, 700 weight.
- **Docs navigation:** Left sidebar and right table of contents use the same panel treatment as static site cards. Active nav is Candle Slate with White Paper text.
- **GUI adaptation:** Sidebars should keep the same paper, border, and active-row vocabulary. Do not make the GUI darker than the static site unless the whole product explicitly supports a dark mode.

### Cards / Containers

- **Panels:** White Paper or 86 percent white over the page wash, 1px Hairline border, 12px radius, 18px to 34px internal padding.
- **Docs content:** White Paper panel, 12px radius, 34px desktop padding, Markdown rendered directly without a separate hero.
- **Homepage evidence cards:** Use panels for proof, provider grids, terminal panels, code windows, and open-source tiles. Avoid nested cards.
- **Floating tiles:** 96px square, 24px radius, Soft Paper gradient, one provider abbreviation or logo. They are homepage-specific decoration, not a GUI primitive.

### Code, Tables, and Data

- **Inline code:** Soft Paper fill, Hairline border, 5px radius, mono stack, tabular numbers.
- **Code blocks:** Code Dark background, Code Light text, 8px radius, 16px padding.
- **Tables:** White Paper background, Hairline border, 8px radius, horizontal overflow inside the table, Soft Paper header row.
- **Financial data:** Always use tabular numbers. Do not rely on color alone for positive, negative, warning, stale, or partial states.

### Product Screenshot / GUI Frame

- **Frame:** White Paper, Hairline border, 14px radius, Product Frame Shadow.
- **Chrome strip:** 42px desktop, 36px mobile, Soft Paper fill, Hairline bottom rule.
- **Window dots:** Neutral gray only. No red/yellow/green traffic-light dots because the brand is quieter than a browser mockup.
- **Image:** Use real product screenshots with explicit width and height. Do not fabricate GUI captures.

### Markdown Surfaces

- **Docs layout:** Sidebar, content, and table-of-contents panels in a three-column grid. Content max width is 780px.
- **Docs rhythm:** Markdown starts directly with its `h1`. No docs hero. `h2` sections get a top border, 22px top padding, and 42px top margin.
- **Mobile docs:** Stack sidebar above content, hide table of contents, reduce content padding to 18px, and keep nav accessible without horizontal overflow.

## 6. Do's and Don'ts

- **Do** use the homepage as the source of truth for the static site and the visual direction for the GUI.
- **Do** keep the system light, precise, and evidence-led.
- **Do** use DM Sans for static-site and GUI typography unless a platform constraint prevents it.
- **Do** reserve Candle Slate for committed actions and active navigation.
- **Do** rely on White Paper, Soft Paper, Hairline borders, and radius before adding shadow.
- **Do** render Markdown plainly in docs pages; nav can be designed, docs content should remain readable documentation.
- **Do** make provider state, data freshness, and warnings explicit in text.
- **Don't** return to dark T3-style styling for OpenCandle.
- **Don't** introduce purple AI gradients, navy-and-gold finance cliches, glass panels, or stock-photo gloss.
- **Don't** use decorative shadows on ordinary GUI cards.
- **Don't** fabricate product screenshots or UI states.
- **Don't** communicate market status through color alone.
- **Don't** add a second display font, negative tracking, or ornamental letter spacing.
