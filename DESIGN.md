---
version: alpha
name: OpenCandle Console
description: Minimal local financial research console. Light surface, single ink for primary actions, sans-serif everywhere, no decoration.
colors:
  primary: "#18181B"
  secondary: "#71717A"
  surface: "#FFFFFF"
  surface-subtle: "#F4F4F5"
  surface-sunk: "#EBEBEC"
  border: "#E4E4E7"
  border-strong: "#D4D4D8"
  on-primary: "#FFFFFF"
  success: "#15803D"
  warning: "#B45309"
  danger: "#DC2626"
  info: "#2563EB"
typography:
  body-md:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0em
  display:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.025em
  heading-lg:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 1.875rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  heading-md:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.005em
  label-caps:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 0.6875rem
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.06em
  label-sm:
    fontFamily: Inter, system-ui, -apple-system, Segoe UI, Helvetica Neue, sans-serif
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0em
  data-sm:
    fontFamily: JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0em
    fontFeature: "tnum"
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  touch: 44px
  sidebar-width: 260px
  composer-max-width: 760px
  mobile-surface-inline: 8px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 12px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    border: "{colors.border}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 12px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.secondary}"
    backgroundColor-hover: "{colors.surface-subtle}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 12px
  button-icon:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    border: "{colors.border}"
    rounded: "{rounded.md}"
    height: 36px
    width: 36px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    border: "{colors.border}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 12px
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    border: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: 16px
  message-assistant:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
  message-user:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.primary}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    border: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: 12px
  selected-row:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  badge:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    height: 22px
    padding: 8px
  status-success:
    textColor: "{colors.success}"
    backgroundColor: "{colors.success}/0.10"
    border: "{colors.success}/0.30"
  status-warning:
    textColor: "{colors.warning}"
    backgroundColor: "{colors.warning}/0.10"
    border: "{colors.warning}/0.30"
  status-danger:
    textColor: "{colors.danger}"
    backgroundColor: "{colors.danger}/0.10"
    border: "{colors.danger}/0.30"
  status-info:
    textColor: "{colors.info}"
    backgroundColor: "{colors.info}/0.10"
    border: "{colors.info}/0.30"
  mobile-sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.xl}"
    padding: 0
---

## Overview

OpenCandle is a minimal financial research console. Light paper background, dark ink for primary actions, sans-serif everywhere, and no ornament. The product is meant to feel like a desk tool — fast to read, easy to scan, honest about what it can and cannot do.

The layout is two columns: a sessions sidebar on the left and the chat reading column in the middle. Mobile collapses the sidebar into a sheet. There is no global topbar — the brand sits in the sidebar, and the chat area starts straight at the messages.

## Colors

The palette is built around the Zinc neutral ramp plus four state colors. The single primary action color is dark ink (#18181B); we treat it as the only "loud" color in the product. Every other surface is a step on the same neutral ramp.

- **Primary (#18181B):** Dark ink. Used for primary actions (Send, Save key, Open setup link), focus rings, and high-emphasis text.
- **Secondary (#71717A):** Muted text — captions, metadata, timestamps, placeholders, and inactive icons.
- **Surface (#FFFFFF):** The page foundation, cards, drawers, dialogs, and the composer chrome.
- **Surface-subtle (#F4F4F5):** The sidebar background, the user message bubble, hover-secondary fills, fact tiles inside tool cards.
- **Surface-sunk (#EBEBEC):** Selected rows, deeper nested fills.
- **Border (#E4E4E7), Border-strong (#D4D4D8):** Hairline dividers and stronger separators for grouped regions.
- **Semantic state:** success #15803D (green), warning #B45309 (ochre), danger #DC2626 (red), info #2563EB (blue). Reserved for state — never decoration.

The single-accent rule is load-bearing: there is exactly one primary action color, and it is dark ink. State colors only ever appear on badges, status text, and percent-change values — not on chrome.

## Typography

A single sans stack: Inter with a system fallback. Inter is unfussy at small sizes, has clear glyphs, and renders predictably across browsers. The only mono presence is in tiny structural snippets (`code` elements, tool argument JSON, ticker-like fragments) — JetBrains Mono there.

- **display:** 2.5rem / 600 / -0.025em — empty-state headlines.
- **heading-lg:** 1.875rem / 600 — onboarding heads.
- **heading-md:** 1rem / 600 — modal titles, panel titles.
- **body-md:** 0.875rem / 400 / 1.5 — message text, descriptions.
- **body-sm:** 0.8125rem / 400 — controls and dense rows.
- **label-caps:** 0.6875rem / 500 / 0.06em tracking — section heads, badges.
- **label-sm:** 0.75rem / 500 — metadata labels.
- **data-sm:** 0.75rem / 400 / `tnum` on — prices, percentages, volumes, dates.

All financial facts (prices, percentages, volumes, dates) render with `font-variant-numeric: tabular-nums` so columns line up. Body and headings share the same family — switching to a second sans for headlines would feel decorative and break the calm.

## Layout

Two-column desktop shell: 260px sidebar on the left, chat as the remaining column. At md (≤820px) the sidebar collapses into a bottom sheet, opened by a hamburger button in a thin mobile top bar.

The chat reading column is capped at ~760px regardless of viewport width, mirrored on the composer. Tool output and dashboard panels can be denser. For wide tables in assistant output, prefer horizontal overflow inside the message rather than page-level overflow.

The dashboard (Watchlist / Active analyses / Recent research / Data quality) lives in a sheet, opened from the sidebar bottom or the mobile top bar, never as a permanent third column.

Spacing follows a 4px-derived scale: 4 / 8 / 12 / 16 / 24 / 32 / 48px. Use gap-based layouts. Mobile sheets share metrics: 8px side inset, 12px top radius, visible drag handle, safe-area-aware bottom padding.

The page itself does not scroll — `html`, `body`, and `#root` are height-locked to `100dvh` with `overflow: hidden`. The chat-messages container and the sidebar threads list each scroll independently within their own panes.

## Elevation & Depth

Depth is carried by tonal layers (surface → surface-subtle → surface-sunk) and 1px borders, not stacked shadows. The composer is a borderless card on the page; modals and bottom sheets get a subtle shadow plus a 1px border. Drawers use a translucent foreground overlay with a 2px backdrop blur — just enough to focus attention without theatre.

Glassmorphism, decorative blurs, and gradient washes are out of scope. Don't increase shadow intensity to solve hierarchy problems — clearer spacing or a stronger label is the right move.

## Shapes

The shape language is tight. Controls and inputs use 6px corners; cards, messages, panels, modals use 8px; user message bubbles use 12px (their slightly rounder corners distinguish them from utility cards); badges are 6px or full pills; mobile sheets get 12px top radius. Icon-only buttons keep fixed square dimensions.

Avoid mixing 16-24px "pillowy" radii with the 6-8px control vocabulary.

## Components

- **Buttons:** `brand` is the dark-ink primary action — exactly one per region. `bordered` is the white-with-hairline-border secondary; `ghost` is the low-emphasis row used in sidebar bottom actions and composer action bars. Icon variants are 36×36 desktop and 44×44 mobile. Every icon-only button needs an `aria-label`.
- **Inputs and Textareas:** White surface on the page, 6px radius, 1px border. Visible labels for durable data. Placeholders may show examples but cannot be the only label for non-obvious fields.
- **Sidebar:** Brand row at top, full-width "+ New chat" button, search field with `⌘K` hint, threads grouped by Pinned / Today / Yesterday / Earlier (empty groups hide), Context + Settings buttons at the bottom.
- **Messages:** User messages are right-aligned `surface-subtle` pills with 12px radius. Assistant messages are plain prose — no card, no border, no role label. Tool calls and tool results use lightweight cards with key facts up top and raw JSON behind a `<details>` summary.
- **Composer:** A single rounded card sitting at the bottom of the chat. The textarea spans the top with an "Ask anything" placeholder; a slim action row underneath holds stop / retry / copy on the left and the send arrow on the right.
- **Catalog (Workflows / Tools / Providers):** Bottom-anchored sheet at every viewport, sharing the dashboard's drawer chrome (vaul `Drawer`, drag handle, hairline border, no shadow theatre). The sheet uses a list ↔ builder push-pop flow: a tabbed list of Workflows / Tools / Providers up top, tap a row and the same sheet replaces its body with a builder form (back arrow at top-left, sticky action bar at the bottom). Builder primitives are explicit form fields (segmented controls, chip presets, ticker/symbols inputs, percent/money fields) rather than free-text guessing. Primary action is "Run workflow" / "Run now" in dark ink; the secondary action is "Send to chat", which pre-fills the composer with a rendered prompt for the user to edit before sending. Provider cards expose a status dot (success / info / warning) plus the env-var name and signup URL. The full bundle is reachable via the sidebar "Catalog" entry, the mobile header BookOpen icon, ⌘K, and a `Browse workflows, tools, and providers` affordance under the empty thread suggestions.
- **Dashboard sheet:** Section labels with hairline rows for Watchlist / Active analyses / Recent research / Data quality. No nested cards.
- **Badges:** `surface-subtle` pills with secondary text by default; success/warning/danger/info variants override only the foreground for state.

## Do's and Don'ts

- **Do** keep OpenCandle dense, calm, and honest — it's a console, not a brochure.
- **Do** reserve dark-ink primary for one action per screen.
- **Do** rely on tonal layers and 1px borders for hierarchy, not shadow.
- **Do** preserve WCAG AA contrast for text, placeholders, icons, and component boundaries.
- **Do** use `tabular-nums` on every financial fact.
- **Don't** introduce gradients, glass surfaces, or background ornament. The system is flat on purpose.
- **Don't** add a second sans family for UI labels or data. Inter carries everything; JetBrains Mono only for inline code.
- **Don't** mix the dark-ink primary with a second decorative accent; the single-accent rule is load-bearing.
- **Don't** use modals when an inline panel, drawer, command palette, or progressive disclosure would fit the workflow.
- **Don't** rely on hover-only affordances; every action must work with keyboard and touch.
