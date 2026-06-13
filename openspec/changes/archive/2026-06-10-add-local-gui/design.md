# Design — `add-local-gui`

This document captures the architectural decisions where multiple paths existed and the reasoning for each. Where a decision is open, it's flagged.

---

## 0. Implementation correction — current Pi API surface

The original design assumed older Pi APIs and package names. The implemented v1 now uses the current installed Pi packages:

- A local browser app served by `gui/server`; the current implementation is the React/Tailwind revamp captured in `openspec/changes/archive/2026-06-10-revamp-local-gui/`.
- `SessionManager.list(cwd)` for session listing.
- Synthetic assistant `toolCall` messages followed by `toolResult` messages for UI-driven tool execution.
- File/session re-read as the follower fallback. No session append event API is required for v1.

These corrections supersede conflicting references below.

## 1. The chat shell — Pi-native local web shell (decided)

**Decision:** use a small Vite browser shell in `gui/web/` and mount the Pi web-ui chat primitives inside it.

The local shell still owns OpenCandle-specific layout, onboarding, session history, dashboard projection, and direct market-data prompt routing. Pi web-ui owns the reusable chat surface: message list, markdown rendering, editor, and generic tool-call rendering. This keeps OpenCandle-specific behavior narrow while avoiding a hand-rolled chat UI.

---

## 2. Repo layout (decided)

```
opencandle/
├── src/                      ← unchanged. Pure agent + tool library.
│   ├── pi/
│   ├── tools/
│   ├── runtime/
│   └── ...
├── gui/
│   ├── server/               ← Node, wraps createOpenCandleSession
│   │   ├── server.ts
│   │   ├── projector.ts
│   │   ├── quote-poller.ts
│   │   └── package.json
│   └── web/                  ← browser bundle
│       ├── shell.ts
│       ├── chat/
│       │   ├── chat-panel.ts
│       │   └── renderers/
│       ├── dashboard/
│       ├── tools-overlay/
│       └── package.json
└── package.json              scripts: "start" (TUI) | "gui" | "gui:dev"
```

**Key invariants:**
- `src/` does not import `gui/`. Ever.
- `gui/server/` consumes only the public exports of `src/index.ts` (`createOpenCandleSession`, `getOpenCandleToolDefinitions`, etc.).
- `gui/web/` has no Node-only imports.
- TUI (`npm start`) is byte-for-byte identical pre- and post-merge of this change.

**Workspaces vs. flat?** Use npm workspaces with two child packages. Reason: `gui/web/` needs a different bundler (Vite) and a different runtime than `src/`, and we don't want browser-only deps in the root lockfile.

---

## 3. Why no agent-emits-HTML in v1 (decided)

The "agent writes HTML in a sandboxed iframe" path remains out of scope.

**Costs:**
- **Tokens.** A single rich card is 1–3K output tokens. Multiplied across an 8-tool workflow, real $$ and latency.
- **System-prompt cost.** Teaching the agent *when* to emit HTML vs. markdown vs. just-call-the-tool is non-trivial. It would need eval coverage and would increase prompt baseline length.
- **Consistency drift.** Two runs over NVDA and AMD shouldn't render differently. Constraining HTML to a small palette is most of the work of typed renderers anyway.
- **Testability.** OpenCandle's harness writes deterministic `trace.json`. LLM-authored HTML is unstable across runs.

**Benefits we get without it:**
- Typed renderers cover the high-frequency structured outputs (quote, options chain, portfolio, sentiment) — known shape, deterministic, free of LLM cost.
- The handful of one-off synthesis cases (analyst memos, side-by-side comparisons) render fine as markdown today.

**What we keep open for the future:** if a real use case appears that needs ad-hoc layout, a tighter declarative shape (a small `opencandle-card` DSL the agent emits and the frontend renders) is a cheaper addition than full HTML. Not in v1.

---

## 4. Direct UI invocation — session-entry shape (decided, with a verification step)

**Decision:** UI-driven tool calls land as a synthetic assistant `toolCall` message followed by a `toolResult` entry tagged `details.source = "ui"`. The next LLM turn sees them in context.

```
   Session entries (append-only):
   ┌──────────────────────────────────────┐
   │ msg(user)      "analyze NVDA"        │
   │ msg(assistant) tool_call get_quote   │ ← LLM-driven
   │ tool_result    {price: 445}          │
   │ msg(assistant) <synthesis> stop      │
   │                                      │
   │ tool_call get_options_chain          │ ← UI-driven (orphan,
   │   meta: { source: "ui" }             │    no surrounding
   │ tool_result {chain: ...}             │    assistant turn)
   │   meta: { source: "ui" }             │
   │                                      │
   │ msg(user)      "what about IV?"      │
   │ msg(assistant) ... (sees both above) │
   └──────────────────────────────────────┘
```

**Why this shape over the alternatives:**

| Option | Why not |
|---|---|
| **A. Orphan tool entries (chosen)** | LLM sees full context next turn; renders identically in chat history; projector picks up identically; no token bloat. *Risk: Pi's session model needs to accept tool entries outside an LLM turn — verify before committing.* |
| B. Synthetic user message wrapping the result | Token-bloated; reads weirdly in transcript; LLM might "respond" to the pseudo-user message. |
| C. Side channel that doesn't enter the session | LLM is blind on next turn ("why didn't you use the data I just looked up?"); breaks the dashboard projector's invariant of "session is source of truth." |

**Pi verification spike (do before implementation):** confirm that `session.appendToolCall()` / equivalent accepts entries with no surrounding LLM-issued message. Two outcomes:
- Pi accepts orphans → ship as designed.
- Pi rejects orphans → we wrap the UI-invoked call in a synthesized `assistant` message with a single `tool_use` block and a `stopReason` of `"tool_use"`, then immediately follow with the `tool_result`. Slightly more bookkeeping; same observable behavior.

This is a 20-minute spike, not a research project. Either way, the tag `source: "ui"` is the projector's discriminator.

---

## 5. Dashboard as a projection (decided)

**Rule:** the dashboard is a pure derivation of the session. No new tools, no new agent context, no new system-prompt content.

```
Pi session (source of truth)
        │
        ▼
   projector.ts          (gui/server/)
        │
        ▼
   in-memory model       { watchlist, activeAnalyses,
        │                  recentResearch, dataQuality, ... }
        ▼
   WS push to browser    (deltas, not snapshots)
```

**State shape (initial):**
```ts
type DashboardState = {
  watchlist: Array<{
    symbol: string;
    quote: StockQuote | null;       // last seen
    pinned: boolean;
    lastSeen: ISO8601;
  }>;
  activeAnalyses: Array<{
    workflowId: string;
    symbol?: string;
    analystsTotal: number;
    analystsDone: number;
    startedAt: ISO8601;
  }>;
  recentResearch: Array<{
    sessionId: string;
    workflow: string;
    symbol?: string;
    completedAt: ISO8601;
  }>;
  dataQuality: {
    softGaps: Array<{ provider: ProviderId; lastSeen: ISO8601 }>;
    hardSkips: Array<{ provider: ProviderId; lastSeen: ISO8601 }>;
  };
};
```

**Projection rules:**

| Session signal | Projection |
|---|---|
| `tool_result` for `get_stock_quote` (any source) | Upsert watchlist row, refresh `quote`, bump `lastSeen` |
| `appendEntry("opencandle-workflow", ...)` with `comprehensive_analysis` | Open active-analysis card |
| `tool_call` to one of the analyst tools | Increment `analystsDone` on the matching active analysis |
| `assistant` message with `stopReason: "stop"` after a workflow | Close the active analysis, append to `recentResearch` |
| `appendEntry("opencandle-turn-gap", ...)` | Update `dataQuality.softGaps` |
| `tool_result` carrying a `<credential_required>` tag | Update `dataQuality.hardSkips` |

**No state in the projector that isn't derivable from session entries.** On reconnect, the browser receives a snapshot built by re-reading entries — no projector restart loss.

**Live polling** is a separate background loop in `quote-poller.ts`, not part of projection. It calls `tools.get_stock_quote.execute()` directly and the result enters the session as a `source: "background"` orphan. This keeps the watchlist alive between conversations without complicating the projector.

---

## 6. TUI ↔ GUI session sharing — writer/follower model (decided)

**Rule:** at most one writer per session at a time; unlimited followers.

**Why this is right:** Pi sessions are append-only SQLite, so multiple readers are safe. But two processes racing the agent loop on the same session would interleave entries unpredictably and double-bill LLM calls. The writer/follower model is the simplest contract that captures the actual user need ("resume in the GUI what I started in the TUI on the train").

**Mechanism:**

```
┌─────────────────────────────────────────────────────────┐
│ Session metadata (single source of truth)               │
│   ~/.pi/agent/sessions/<id>/                            │
│     session.db                                          │
│     writer.lock      ← advisory lock, holds writer pid  │
└─────────────────────────────────────────────────────────┘

  TUI startup:                      GUI startup:
    acquire writer.lock               check writer.lock
    if held: be a follower           if held: be a follower
    if free: hold it                 if free: hold it

  Followers tail entries via Pi's session-event stream
  (or, fallback, polling getEntries() since X timestamp).
```

**UI affordance:** session in the sidebar is annotated with the writer's identity (`📟 TUI` / `🌐 GUI` / `👻 nobody`). Clicking a session held by another writer offers "Take over" — the UI sends a SIGINT/IPC to the holder, which gracefully releases the lock.

**Edge cases:**
- TUI crashes without releasing the lock → stale lock with no live process. Detected by checking pid liveness on startup; cleared after a short grace period.
- Branches: Pi's branching model means the writer can fork. Followers re-render on branch change (Pi emits the event).
- Compaction: writer-only operation; followers re-fetch the leaf branch.

**Out of scope for v1:** simultaneous-writer mode (operational-transform-style merging). Not worth the complexity for a single-user app.

---

## 7. Tool defaults — storage and merge semantics (decided)

**Storage:** new SQLite table in the existing `src/memory/` store.

```sql
CREATE TABLE tool_defaults (
  tool_name TEXT NOT NULL,
  param_path TEXT NOT NULL,        -- e.g. "expiry" or "filters.min_iv"
  value_json TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (tool_name, param_path)
);
```

**Merge semantics:** at execute time, `wrapWithDefaults(tool, defaults)` produces a wrapped tool whose `execute(args)` calls `tool.execute(merge(defaults, args))` — args win on every conflict. The same wrapper is applied at `pi.registerTool` time (so the LLM tool-call path uses defaults) AND at UI direct-invocation time (so the form path uses them). One source of truth.

**LLM awareness:** the system prompt gets a single line per active default group: *"User has set defaults for `get_options_chain` (expiry: nearest monthly). You may override when the user's request requires it."* This prevents the LLM from arguing with defaults it cannot see.

**Why memory store, not file config:**
- File config is for credentials and provider-level settings (the schema has stable, infrequent shape).
- Tool defaults are user preferences with potentially many keys; SQLite's row model fits better.
- The memory store already persists workflow preferences; tool defaults are a sibling concept.

---

## 8. Slash palette — extending the existing command surface (decided)

OpenCandle already registers `/analyze`, `/connect`, `/setup` as Pi commands. The slash palette extends this surface, not replaces it.

```
Composer with "/" pressed:
┌──────────────────────────────────────────┐
│ /                                        │
│ ┌──────────────────────────────────────┐ │
│ │ 🧠 /analyze   Run multi-analyst...   │ │
│ │ 🔌 /connect   Connect a provider...  │ │
│ │ ⚙ /setup      Reconfigure model...   │ │
│ │ ─────────────────────────────────── │ │
│ │ 📈 quote      Stock Quote           │ │
│ │ 📊 chain      Option Chain          │ │
│ │ 🌐 web_search Web Search            │ │
│ │ ... (fuzzy filtered)                │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**Selection behavior:**
- Pi commands → submit as today (`/analyze NVDA`).
- Tool entries → open the tool's form pre-focused; "Run" path = direct UI invocation (option A from §4).
- Workflow entries → open a slot form; "Run" submits the resolved prompt to chat.

**Source:** palette items are `[...piCommands, ...workflows, ...tools]`, each with `name`, `label`, `description`, `category`, fuzzy-searchable.

---

## 9. Tools overlay — full-screen modal (decided)

```
top bar:  [≡ sessions]  [💬 chat]  [📊 dashboard]  [🛠 tools]  [⚙ settings]

                                      │ click "tools" or ⌘K
                                      ▼
   ┌─────────────────────────────────────────────────────────┐
   │ TOOLS                                              [✕]  │
   ├─────────────────────────────────────────────────────────┤
   │ [Tools] [Workflows] [Providers]                         │
   │                                                         │
   │ ... per-tab content ...                                 │
   └─────────────────────────────────────────────────────────┘
```

**Why a full-screen overlay (Option 3) and not a third pane (Option 1):**
- Tools is a *destination*, not an always-on panel. You go there to configure or run, then come back.
- A third pane on a laptop screen crushes chat or dashboard.
- The overlay is dismissible by ESC and restores the chat+dashboard split unchanged.
- ⌘K + slash palette make it discoverable without leaving the keyboard.

**Three tabs:**
- **Tools** — `getOpenCandleToolDefinitions()`, grouped by domain, each card with the form/run/last-result UI.
- **Workflows** — `src/workflows/` recipes, each with a slot form and "Run".
- **Providers** — `PROVIDERS` array, each with status, unlocks, sign-up CTA, test, disconnect — replacing `/connect` as the always-visible page.

---

## 10. Promote-pattern scope (decided)

**v1 ships with:**

| Pattern | Trigger | Surface |
|---|---|---|
| Empty-state cards | New session, no messages yet | Chat pane, 4 cards: Analyze · Build Portfolio · Screen Options · Compare |
| Slash palette | `/` in composer | Modal over composer |
| Result-attached chips | After a typed result renders | Below the message — 4 max per result type |

**Deferred to v1.5:**
- Provider-just-connected toast (*"4 new tools available"*).
- Onboarding tour (one-time, dismissible).
- Tool-usage counter in the sidebar (*"12 tools available, 3 limited"*).

**Deferred to v2 or never:**
- Inline notifications driven by usage analytics (*"You've never used X — try it"*).
- Bayesian/heuristic tool recommender. (Out of scope; chat does this fine.)

---

## 11. Authentication and exposure (deferred from v1)

v1 binds to localhost only. Tunnel exposure (Tailscale, Cloudflare Tunnel, ngrok) is a v1.5 concern.

**Recorded for v1.5:**
- **Tailscale**: zero-config; private mesh; no app-level auth needed.
- **Cloudflare Tunnel + Cloudflare Access**: public URL with email-gated zero-trust auth. Add `gui/server/auth-middleware.ts` that verifies the `cf-access-jwt-assertion` header.
- **Plain CF Tunnel** (no Access): explicitly disallowed — dashboard contains portfolio holdings and `/connect` exposes provider key inputs.

A `gui:tunnel` script that prints the chosen exposure URL is a small follow-up; not v1 work.

---

## 12. What this change does NOT touch

Recorded so reviewers can verify the boundary:

- `src/system-prompt.ts` — one-paragraph addition for tool defaults; nothing else.
- `src/analysts/orchestrator.ts` — unchanged. The dashboard reads its existing emissions.
- `src/routing/` — unchanged.
- `src/onboarding/` — providers UI consumes `PROVIDERS` and existing onboarding-state functions read-only; no schema change.
- TUI mode (`npm start`) — invariant.
- Memory schema — additive (`tool_defaults` table); existing tables untouched.
- Pi version — none required.
