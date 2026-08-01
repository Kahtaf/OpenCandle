# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

OpenCandle is for individual investors, builders, and market researchers who want agent-assisted financial research without losing sight of source data. They may work in a terminal, a local browser, or both, and they often need to move quickly between a chat thread, explicit tool calls, provider setup, session history, and market context.

Users are not asking OpenCandle to replace judgment or provide fiduciary advice. They are using it to gather market, macro, options, fundamentals, sentiment, SEC, and portfolio data, then have a model synthesize that evidence into a clearer research answer.

## Product Purpose

OpenCandle exists to make financial data analysis agentic, inspectable, and practical. The CLI remains the terminal-first Pi experience, while the GUI provides a local browser workbench for chat, tool discovery, provider configuration, session navigation, and a live financial context dashboard.

Success means a user can understand what tools are available, configure missing providers, run tools directly or through chat, inspect results in session history, and keep enough dashboard context visible to know how the conversation is changing the research state.

## Positioning

OpenCandle is an evidence-first financial research workbench, not a generic chatbot or trading dashboard. Its distinct advantage is the combination of explicit market-data tools, visible provider and freshness state, durable research context, and shared live sessions across the terminal and browser surfaces.

## Operating Context

Users work in a terminal-first Pi session, a local browser workbench, or both. The browser surfaces chat, saved market state, provider configuration, tool discovery, and session history; the terminal provides the same underlying research tools and session continuity for direct and scripted workflows.

## Capabilities and Constraints

OpenCandle gathers and formats market, macro, options, fundamentals, sentiment, SEC, portfolio, and related provider data, then supports model-assisted synthesis over that evidence. It preserves missing credentials, stale or partial data, provider limits, provenance, and downside scenarios as visible research constraints.

OpenCandle does not replace investor judgment or provide fiduciary advice. It must not guess financial figures, hide uncertainty, or present unavailable evidence as fact.

## Brand Commitments

Calm, exacting, and useful. The product should feel like research software operated by someone who respects financial risk: direct about uncertainty, careful with numbers, and more interested in clear evidence than impressive theater. The tone is pragmatic and analyst-grade, with concise labels, visible provenance, restrained emphasis, and no false confidence.

OpenCandle should not look or behave like a glossy fintech landing page, a gamified trading app, a crypto dashboard, a decorative AI chat demo, or terminal cosplay. Avoid navy-and-gold finance cliches, purple AI gradients, stock-photo polish, animated hero metrics, ornamental glass cards, and controls that hide basic capabilities behind obscure prompts or commands.

## Evidence on Hand

- `README.md` and `docs/` document the CLI, GUI, data sources, configuration, and investigation workflows.
- `docs/images/gui-chat-research.png`, `docs/images/gui-portfolio.png`, and `docs/images/gui-symbol-page.png` show the working browser product with real research surfaces.
- `tests/` covers provider integrations, runtime coordination, market-state behavior, and GUI behavior.
- `packages/ui/src/` and `packages/ui/src/styles.css` provide the shared component and token implementation used by the browser surfaces.

## Product Principles

1. Make tools visible. A financial agent is more trustworthy when users can see which tools exist, what they need, and when they are being used.
2. Keep chat and dashboard in balance. The transcript carries reasoning and conversation, while the dashboard reflects the accumulating research context without competing for attention.
3. Preserve session continuity. Pi sessions are the source of truth, so the GUI and TUI should share live sessions while coordinating which surface applies each action.
4. Show evidence before confidence. Tool output, data quality gaps, missing credentials, stale data, and warnings should remain visible enough for users to audit conclusions.
5. Prefer familiar product patterns. Sidebars, command palettes, sheets, explicit forms, and inspector panels are affordances, not decoration.

## Accessibility & Inclusion

Target WCAG AA for text contrast, focus visibility, keyboard navigation, labels, and touch targets. All icon-only controls need accessible names. The GUI must work on narrow mobile screens, keyboard-only desktop use, and local remote-access setups such as Tailscale or a tunnel.

Do not communicate financial state through color alone. Positive, negative, warning, stale, partial, configured, and missing states need readable text or badges in addition to color. Motion should be limited to short state transitions and respect reduced-motion preferences.
