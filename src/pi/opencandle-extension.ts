import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isAnalysisRequest,
  normalizeSymbol,
} from "../analysts/orchestrator.js";
import { buildComprehensiveAnalysisDefinition } from "../analysts/orchestrator.js";
import { getConfig } from "../config.js";
import {
  classifyIntent,
  createPiAiRouterClient,
  resolveOptionsScreenerSlots,
  resolvePortfolioSlots,
  route as routeLlm,
} from "../routing/index.js";
import type {
  RouterInputContext,
  RouterLlmClient,
  RouterOutput,
} from "../routing/router-types.js";
import type { CompareAssetsSlots, SlotResolution } from "../routing/types.js";
import { buildAssumptionsBlockFromRouter } from "../prompts/workflow-prompts.js";
import {
  buildPortfolioWorkflowDefinition,
  buildOptionsScreenerWorkflowDefinition,
  buildCompareAssetsWorkflowDefinition,
} from "../workflows/index.js";
import { getOpenCandleToolDefinitions } from "./tool-adapter.js";
import { registerAskUserTool } from "../tools/interaction/ask-user.js";
import { registerTwitterLoginTool } from "../tools/interaction/twitter-login.js";
import { SessionCoordinator } from "../runtime/session-coordinator.js";
import {
  getProvider,
  type ProviderId,
} from "../onboarding/providers.js";
import {
  loadOnboardingState,
  saveOnboardingState,
  markProviderSnoozed,
  markProviderNeverAsk,
  markWelcomeShown,
  shouldShowWelcome,
} from "../onboarding/state.js";
import { parseToolTag, buildSkippedTag, buildConnectedTag } from "../onboarding/tool-tags.js";
import { resolveCredentialRequired } from "../onboarding/credential-interceptor.js";
import { createDegradationAccumulator } from "../onboarding/degradation-accumulator.js";
import { promptUser } from "../onboarding/prompt-user.js";
import { runProviderConnect } from "../onboarding/connect.js";
import type { AskUserHandler } from "../types/index.js";
import { DISCLAIMER_TEXT } from "../prompts/disclaimer.js";

export interface OpenCandleExtensionOptions {
  askUserHandler?: AskUserHandler;
  /**
   * Optional router LLM client. When provided, this instance is used instead
   * of the pi-ai-backed default. Intended for tests + offline eval runners.
   */
  routerLlmClient?: RouterLlmClient;
}

export default function openCandleExtension(pi: ExtensionAPI, options?: OpenCandleExtensionOptions): void {
  const coordinator = new SessionCoordinator();

  // Credential-interception state. Lifetime:
  //   `sessionPromptedSet` — cleared on session_start, persists across turns
  //      within a session so users don't get re-prompted after picking
  //      "continue without".
  //   `hardPromptFiredInWorkflow` — reset on turn_start (the nearest clean
  //      boundary for a single user request). Enforces the "at most one hard
  //      prompt per workflow" cap.
  //   `degradationAccumulator` — per-turn record of soft-tier providers that
  //      fell back to their keyless alternative. Reset on turn_start; flushed
  //      on turn_end via `pi.appendEntry("opencandle-turn-gap", ...)` for
  //      session observability. Does NOT pause the workflow or mutate tool
  //      results inline — soft-degraded tags remain visible to the LLM so its
  //      final answer can surface them in a **Data gaps** section.
  const sessionPromptedSet = new Set<ProviderId>();
  let hardPromptFiredInWorkflow = false;
  const degradationAccumulator = createDegradationAccumulator();

  // Register tools
  for (const tool of getOpenCandleToolDefinitions()) {
    pi.registerTool(tool);
  }
  registerAskUserTool(pi, options?.askUserHandler);
  registerTwitterLoginTool(pi);

  // /analyze command
  pi.registerCommand("analyze", {
    description: "Run the multi-analyst OpenCandle workflow for a ticker symbol",
    handler: async (args, ctx) => {
      const symbol = normalizeSymbol(args);
      if (!symbol) {
        ctx.ui.notify("Usage: /analyze <ticker>", "warning");
        return;
      }
      const definition = buildComprehensiveAnalysisDefinition(symbol, { debate: getConfig().debate });
      coordinator.executeWorkflow(pi, definition, ctx);
    },
  });

  // /setup command — reconfigure the OpenCandle AI model (sign-in / API key).
  // Data providers are configured separately via `/connect`.
  pi.registerCommand("setup", {
    description: "Reconfigure the OpenCandle AI model (sign-in or API key)",
    handler: async (_args, ctx) => {
      const result = await coordinator.runSetup(pi, ctx, { mode: "manual" });
      if (result === "ready") {
        ctx.ui.notify("OpenCandle setup complete.", "info");
      }
    },
  });

  // /connect command — reconfigurable sectioned setup for data providers.
  // `/connect` with no args opens a picker listing all providers.
  // `/connect <alias|id|category>` routes to a specific provider (or a
  // sub-picker for multi-provider categories like "search").
  pi.registerCommand("connect", {
    description: "Connect a data provider (Alpha Vantage, FRED, Finnhub, Brave, Exa)",
    handler: async (args, ctx) => {
      const { listAllProviders, resolveProviderFromArgument, hasCredential } = await import(
        "../onboarding/providers.js"
      );

      const formatState = (id: ProviderId): string => {
        const state = loadOnboardingState().providers[id];
        if (state?.status === "completed") return "Configured";
        if (state?.status === "snoozed") {
          return `Snoozed until ${state.snoozeUntil.slice(0, 10)}`;
        }
        if (state?.status === "never_ask") return "Never-ask";
        if (hasCredential(id)) return "Configured (via env)";
        return "Not configured";
      };

      const pickProvider = async (
        providers: readonly ReturnType<typeof getProvider>[],
      ): Promise<ProviderId | undefined> => {
        const labels = providers.map(
          (p) => `${p.displayName} — ${p.unlocks.slice(0, 2).join(", ")} [${formatState(p.id)}]`,
        );
        const choice = await ctx.ui.select("Which provider would you like to connect?", labels);
        if (choice === undefined) return undefined;
        const index = labels.indexOf(choice);
        return providers[index]?.id;
      };

      const trimmed = args.trim();
      let targetId: ProviderId | undefined;

      if (trimmed === "") {
        // Bare /connect → full picker.
        targetId = await pickProvider(listAllProviders());
      } else {
        const resolved = resolveProviderFromArgument(trimmed);
        if (!resolved) {
          const all = listAllProviders()
            .map((p) => `  ${p.displayName} (${p.aliases.join(", ")})`)
            .join("\n");
          ctx.ui.notify(
            `Unknown provider: "${trimmed}". Available:\n${all}`,
            "warning",
          );
          return;
        }
        if (Array.isArray(resolved)) {
          // Multi-provider category — show a sub-picker.
          targetId = await pickProvider(resolved as readonly ReturnType<typeof getProvider>[]);
        } else {
          targetId = (resolved as ReturnType<typeof getProvider>).id;
        }
      }

      if (!targetId) {
        ctx.ui.notify("Connect cancelled.", "info");
        return;
      }

      const result = await runProviderConnect(ctx, targetId);
      if (result.status === "connected") {
        ctx.ui.notify(`${getProvider(targetId).displayName} is now connected.`, "info");
      } else if (result.status === "cancelled") {
        ctx.ui.notify("Connect cancelled.", "info");
      }
      // "blocked_by_env" already notifies from inside runProviderConnect.
    },
  });

  // Session start
  pi.on("session_start", async (_event, ctx) => {
    coordinator.initSession(ctx.sessionManager.getSessionId());
    sessionPromptedSet.clear();
    hardPromptFiredInWorkflow = false;

    if (!ctx.hasUI) return;
    // Pin the user-facing disclaimer in the UI footer for the entire session.
    // Using `setStatus` keeps it always visible to the user without ever
    // entering the LLM's conversation context (unlike `sendMessage`, which Pi
    // reinjects as a `role:"user"` message every turn).
    ctx.ui.setStatus("opencandle-disclaimer", DISCLAIMER_TEXT);

    const result = await coordinator.runSetup(pi, ctx, { mode: "startup" });
    if (result === "shutdown") {
      return;
    }

    // One-shot welcome on the very first session (gated on welcomeShownAt).
    // Uses `pi.sendMessage` with `display: true` so the welcome lands in the
    // chat transcript (persistent, scrollable) rather than a transient
    // `ctx.ui.notify` banner.
    const state = loadOnboardingState();
    if (shouldShowWelcome(state, ctx.hasUI)) {
      const WELCOME_BODY =
        "Welcome to OpenCandle. I'm your AI copilot for market analysis.\n\n" +
        "Try something like:\n" +
        "  • analyze NVDA          — full deep-dive on a ticker\n" +
        "  • quote TSLA            — just the price and daily move\n" +
        "  • how's bitcoin?        — crypto\n" +
        "  • what's r/wallstreetbets saying about META?   — social sentiment\n\n" +
        "You're running with just an LLM right now, which covers most of what\n" +
        "people want. For fundamentals, economic data, or premium news you'll\n" +
        "need a few free API keys — I'll offer to help when they'd actually\n" +
        "make a difference, or run /connect anytime.";

      pi.sendMessage({
        customType: "opencandle-welcome",
        content: [{ type: "text", text: WELCOME_BODY }],
        display: true,
      });
      saveOnboardingState(markWelcomeShown(state));
    } else {
      ctx.ui.notify(
        "OpenCandle ready. Try /analyze NVDA or /connect to add data providers.",
        "info",
      );
    }
  });

  // Reset the per-workflow prompt cap AND the degradation accumulator on each
  // new turn. One user request = one workflow invocation = at most one hard
  // prompt and one combined soft-degradation annotation.
  pi.on("turn_start", async () => {
    hardPromptFiredInWorkflow = false;
    degradationAccumulator.reset();
  });

  // At turn_end, flush the soft-degradation accumulator to a session entry so
  // downstream consumers (UI renderers, debug inspectors, later turns) can see
  // which soft providers fell back during this turn. The LLM has already
  // emitted its answer by the time this fires, so the per-tool-result
  // soft-degraded tags remain the primary carrier for the in-turn gap note.
  //
  // Also persist a per-turn disclaimer entry via `appendEntry`. `CustomEntry`
  // is NOT sent to LLM context (unlike `sendMessage`/`CustomMessage`, which
  // Pi's `convertToLlm` reinjects as a `role:"user"` message), so this keeps
  // the stance instruction-free while still producing a session record that
  // downstream renderers / exporters / tests can surface. The always-visible
  // footer status pinned at session_start is the primary user-visible channel.
  pi.on("turn_end", async (event) => {
    const msg = event.message;
    const isFinalAssistantTurn =
      msg.role === "assistant" && msg.stopReason === "stop";
    if (isFinalAssistantTurn) {
      pi.appendEntry("opencandle-disclaimer", { text: DISCLAIMER_TEXT });
    }

    if (degradationAccumulator.isEmpty()) return;
    const state = loadOnboardingState();
    const annotation = degradationAccumulator.buildCombinedAnnotation(state);
    if (annotation !== null) {
      pi.appendEntry("opencandle-turn-gap", { annotation });
    }
    degradationAccumulator.reset();
  });

  // Intercept tool results for credential-required and soft-degraded tags.
  pi.on("tool_result", async (event, ctx) => {
    // First pass: record any soft-degradation tags in the per-turn accumulator
    // WITHOUT mutating the tool result (the inline tag stays visible to the
    // LLM so it can surface the gap in its final answer). Multiple tags per
    // tool-result block are deduplicated by the accumulator's Set.
    for (const block of event.content) {
      if (block.type !== "text") continue;
      const parsed = parseToolTag(block.text);
      if (parsed?.kind === "soft_degraded") {
        degradationAccumulator.record(parsed.provider);
      }
    }

    // Second pass: look for a credential-required tag; on match, run the
    // interception decision and either replace the tool result or prompt
    // the user. Only the first credential_required tag in the content list
    // is acted on — subsequent hard-tier prompts are silenced by the
    // per-workflow cap at the decision-function level.
    for (const block of event.content) {
      if (block.type !== "text") continue;
      const parsed = parseToolTag(block.text);
      if (!parsed || parsed.kind !== "credential_required") continue;

      const state = loadOnboardingState();
      const action = resolveCredentialRequired({
        provider: parsed.provider,
        reason: parsed.reason,
        state,
        sessionPromptedSet,
        hardPromptFiredInWorkflow,
        now: new Date(),
      });

      if (action.action === "skip") {
        // Replace content with a skipped placeholder so the LLM sees a
        // neutral gap note instead of the credential-required tag.
        const descriptor = getProvider(parsed.provider);
        const remediation = action.silenced
          ? `${action.remediation} (silenced)`
          : action.remediation;
        const tag = buildSkippedTag({
          provider: parsed.provider,
          reason: "credential_not_provided",
          remediation,
          silenced: action.silenced,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `${tag}\n\n${descriptor.displayName} data was not fetched for this request. ` +
                (action.silenced
                  ? `You previously asked not to be reminded about this provider.`
                  : `To unlock ${descriptor.unlocks.join(", ")}, ${action.remediation}.`),
            },
          ],
        };
      }

      // action === "prompt": pause and ask the user via promptUser.
      const descriptor = getProvider(parsed.provider);
      const connectLabel = `Connect now — ${descriptor.instructionsHint}`;
      const continueLabel =
        descriptor.fallbackDescription
          ? `Continue with ${descriptor.fallbackDescription} for this run`
          : `Continue without ${descriptor.displayName} for this run`;
      const snoozeLabel = `Snooze ${descriptor.snoozeDurationDays} days`;
      const neverLabel = `Never ask again`;
      const questionBody =
        `${descriptor.displayName} unlocks ${descriptor.unlocks.join(", ")}. ` +
        `Free signup takes about 30 seconds. How would you like to proceed?`;

      // Mark that a hard-tier prompt has now fired in this workflow (for the cap).
      if (descriptor.tier === "hard") {
        hardPromptFiredInWorkflow = true;
      }
      sessionPromptedSet.add(parsed.provider);

      const promptResult = await promptUser(
        ctx,
        {
          question: questionBody,
          questionType: "select",
          options: [connectLabel, continueLabel, snoozeLabel, neverLabel],
        },
        options?.askUserHandler,
      );

      if (promptResult.cancelled) {
        // Treat cancel like "continue without".
        return {
          content: [
            {
              type: "text",
              text:
                `${buildSkippedTag({
                  provider: parsed.provider,
                  reason: "credential_not_provided",
                  remediation: `run /connect ${descriptor.aliases[0] ?? descriptor.id} to unlock`,
                })}\n\nPrompt was cancelled.`,
            },
          ],
        };
      }

      const answer = promptResult.answer ?? "";

      if (answer.startsWith("Connect")) {
        const connectResult = await runProviderConnect(ctx, parsed.provider);
        if (connectResult.status === "connected") {
          // Pi has no tool re-dispatch API — emit a CONNECTED placeholder so
          // the LLM knows the key was just saved and can retry on the next
          // turn (or use whatever partial data is in context).
          return {
            content: [
              {
                type: "text",
                text:
                  `${buildConnectedTag({ provider: parsed.provider })}\n\n` +
                  `${descriptor.displayName} was just connected. Please re-run the previous request to fetch the data now that the credential is available.`,
              },
            ],
          };
        }
        // Cancelled, blocked-by-env, or invalid_key: fall through to skipped
        // with a result-specific explanation so the LLM can describe what
        // just happened in its final answer.
        const connectOutcomeDescription =
          connectResult.status === "blocked_by_env"
            ? "blocked by an existing environment variable"
            : connectResult.status === "invalid_key"
              ? `rejected by ${descriptor.displayName} (the key was invalid and nothing was saved)`
              : "cancelled";
        return {
          content: [
            {
              type: "text",
              text:
                `${buildSkippedTag({
                  provider: parsed.provider,
                  reason: "credential_not_provided",
                  remediation: `run /connect ${descriptor.aliases[0] ?? descriptor.id} to unlock`,
                })}\n\n${descriptor.displayName} connect was ${connectOutcomeDescription}.`,
            },
          ],
        };
      }

      if (answer.startsWith("Snooze")) {
        saveOnboardingState(
          markProviderSnoozed(state, parsed.provider, descriptor.snoozeDurationDays),
        );
      } else if (answer.startsWith("Never")) {
        saveOnboardingState(markProviderNeverAsk(state, parsed.provider));
      }
      // "Continue" / fallthrough: no state mutation, just skip.
      const silenced = answer.startsWith("Never");
      const remediation = silenced
        ? `run /connect ${descriptor.aliases[0] ?? descriptor.id} to unlock (silenced)`
        : `run /connect ${descriptor.aliases[0] ?? descriptor.id} to unlock`;
      return {
        content: [
          {
            type: "text",
            text:
              `${buildSkippedTag({
                provider: parsed.provider,
                reason: "credential_not_provided",
                remediation,
                silenced,
              })}\n\n${descriptor.displayName} data was omitted per your choice.`,
          },
        ],
      };
    }

    // No OpenCandle tag in this tool result — pass through.
    return undefined;
  });

  // Input handling — branches on OPENCANDLE_ROUTER_MODE.
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;

    // Check for comprehensive analysis pattern — same in both modes.
    const analysis = isAnalysisRequest(event.text);
    if (analysis.match && analysis.symbol) {
      const definition = buildComprehensiveAnalysisDefinition(analysis.symbol, { debate: getConfig().debate });
      coordinator.executeWorkflow(pi, definition, ctx);
      return { action: "handled" };
    }

    const mode = getConfig().routerMode;
    if (mode === "llm") {
      const dispatched = await handleLlmRouterTurn(event.text, ctx);
      // Dispatched a workflow → the original user turn is now represented by
      // the workflow's queued prompts; tell Pi not to also forward it.
      // Fallback path (no dispatch) → let Pi pass the user turn through to the
      // main agent, which will run under the router-supplied fallback context.
      return dispatched ? { action: "handled" } : undefined;
    }

    // --- rules mode (default) ---
    // Extract and persist user preferences (legacy regex path)
    coordinator.extractAndStorePreferences(event.text);
    const storage = coordinator.getStorage();
    const workflowPrefs = storage?.getWorkflowPreferences("global") ?? {};

    // Classify intent
    const classification = classifyIntent(event.text);

    if (classification.workflow === "portfolio_builder") {
      const resolution = resolvePortfolioSlots(classification.entities, workflowPrefs);
      coordinator.recordWorkflowRun("portfolio_builder", classification.entities, resolution.resolved, resolution.defaultsUsed);
      pi.appendEntry("opencandle-workflow", { workflow: "portfolio_builder", entities: classification.entities, resolved: resolution.resolved });
      const definition = buildPortfolioWorkflowDefinition(resolution);
      coordinator.executeWorkflow(pi, definition, ctx);
      return { action: "handled" };
    }

    if (classification.workflow === "options_screener") {
      const resolution = resolveOptionsScreenerSlots(classification.entities, workflowPrefs);
      if (resolution.missingRequired.length === 0) {
        coordinator.recordWorkflowRun("options_screener", classification.entities, resolution.resolved, resolution.defaultsUsed);
        pi.appendEntry("opencandle-workflow", { workflow: "options_screener", entities: classification.entities, resolved: resolution.resolved });
        const definition = buildOptionsScreenerWorkflowDefinition(resolution);
        coordinator.executeWorkflow(pi, definition, ctx);
        return { action: "handled" };
      }
    }

    if (classification.workflow === "compare_assets" && classification.entities.symbols.length >= 2) {
      const resolution: SlotResolution<CompareAssetsSlots> = {
        resolved: {
          symbols: classification.entities.symbols,
          metrics: classification.entities.compareMetrics,
          timeHorizon: classification.entities.timeHorizon,
        },
        sources: {
          symbols: "user",
          ...(classification.entities.timeHorizon ? { timeHorizon: "user" as const } : {}),
          ...(classification.entities.compareMetrics ? { metrics: "user" as const } : {}),
        },
        defaultsUsed: [],
        missingRequired: [],
      };
      coordinator.recordWorkflowRun("compare_assets", classification.entities, resolution.resolved, resolution.defaultsUsed);
      pi.appendEntry("opencandle-workflow", { workflow: "compare_assets", symbols: classification.entities.symbols });
      const definition = buildCompareAssetsWorkflowDefinition(resolution);
      coordinator.executeWorkflow(pi, definition, ctx);
      return { action: "handled" };
    }
  });

  /**
   * LLM-mode input handler. In this mode `classifyIntent` and
   * `extractPreferences` are NOT called — the router is the single source of
   * classification + preference extraction. Mirrors rule-mode dispatch for
   * identified workflows; for `fallback` turns, stashes a fallback context
   * for the next `before_agent_start` to inject.
   */
  async function handleLlmRouterTurn(
    text: string,
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): Promise<boolean> {
    const storage = coordinator.getStorage();
    const { profileSnapshot, recentWorkflowRuns, priorTurns } =
      coordinator.buildRouterContextBase(ctx.sessionManager);
    // priorTurns is not scrubbed for /forget — tracked in proposal.md follow-ups.
    const input: RouterInputContext = {
      text,
      priorTurns,
      profileSnapshot,
      recentWorkflowRuns,
    };

    const client = options?.routerLlmClient ?? resolveRouterLlmClient(ctx);
    if (!client) {
      pi.appendEntry("opencandle-router-error", {
        reason: "no_llm_client_available",
        text,
      });
      return false;
    }

    let output: RouterOutput;
    try {
      output = await routeLlm(input, client);
    } catch (err) {
      pi.appendEntry("opencandle-router-error", {
        reason: "route_failed",
        text,
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    pi.appendEntry("opencandle-router", { output });

    // Preference writes: HIGH-confidence only. Medium/low are logged for
    // observability even when no storage is available.
    const dropped: typeof output.preference_updates = [];
    for (const pref of output.preference_updates) {
      if (pref.confidence === "high") {
        storage?.upsertPreference({
          key: pref.key,
          valueJson: JSON.stringify(pref.value),
          confidence: pref.confidence,
          source: pref.source,
        });
      } else {
        dropped.push(pref);
      }
    }
    if (dropped.length > 0) {
      pi.appendEntry("opencandle-router-prefs-dropped", { dropped });
    }

    // Workflow dispatch for recognised workflows.
    if (output.route === "workflow" && output.workflow) {
      return dispatchRouterWorkflow(output, ctx);
    }

    // Fallback: record the turn and stash the fallback context for the
    // upcoming `before_agent_start` hook to render into the system prompt.
    coordinator.recordWorkflowRun(
      "fallback",
      output.entities,
      Object.fromEntries(Object.entries(output.slots).map(([k, v]) => [k, v.value])),
      [],
      "fallback",
    );

    const assumptionsBlock = buildAssumptionsBlockFromRouter(output.slots);
    coordinator.setPendingFallbackContext({
      assumptionsBlock,
      missingRequired: output.missing_required,
      extraContext: output.entities.symbols.length > 0
        ? `Router-extracted symbols: ${output.entities.symbols.join(", ")}.`
        : undefined,
    });
    return false;
  }

  function dispatchRouterWorkflow(
    output: RouterOutput,
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): boolean {
    const workflow = output.workflow!;
    const storage = coordinator.getStorage();
    const workflowPrefs = storage?.getWorkflowPreferences("global") ?? {};

    if (workflow === "portfolio_builder") {
      const resolution = resolvePortfolioSlots(output.entities, workflowPrefs);
      coordinator.recordWorkflowRun(
        "portfolio_builder",
        output.entities,
        resolution.resolved,
        resolution.defaultsUsed,
        "workflow",
      );
      pi.appendEntry("opencandle-workflow", {
        workflow: "portfolio_builder",
        entities: output.entities,
        resolved: resolution.resolved,
      });
      const definition = buildPortfolioWorkflowDefinition(resolution);
      coordinator.executeWorkflow(pi, definition, ctx);
      return true;
    }
    if (workflow === "options_screener") {
      const resolution = resolveOptionsScreenerSlots(output.entities, workflowPrefs);
      // Router may emit missing_required; main agent handles via ask_user.
      // Still dispatch the workflow when symbol is present.
      if (resolution.missingRequired.length === 0) {
        coordinator.recordWorkflowRun(
          "options_screener",
          output.entities,
          resolution.resolved,
          resolution.defaultsUsed,
          "workflow",
        );
        pi.appendEntry("opencandle-workflow", {
          workflow: "options_screener",
          entities: output.entities,
          resolved: resolution.resolved,
        });
        const definition = buildOptionsScreenerWorkflowDefinition(resolution);
        coordinator.executeWorkflow(pi, definition, ctx);
        return true;
      }
      // Missing required symbol — treat as fallback with ask_user directive.
    }
    if (workflow === "compare_assets" && output.entities.symbols.length >= 2) {
      const resolution: SlotResolution<CompareAssetsSlots> = {
        resolved: {
          symbols: output.entities.symbols,
          metrics: output.entities.compareMetrics,
          timeHorizon: output.entities.timeHorizon,
        },
        sources: {
          symbols: "user",
          ...(output.entities.timeHorizon ? { timeHorizon: "user" as const } : {}),
          ...(output.entities.compareMetrics ? { metrics: "user" as const } : {}),
        },
        defaultsUsed: [],
        missingRequired: [],
      };
      coordinator.recordWorkflowRun(
        "compare_assets",
        output.entities,
        resolution.resolved,
        [],
        "workflow",
      );
      pi.appendEntry("opencandle-workflow", {
        workflow: "compare_assets",
        symbols: output.entities.symbols,
      });
      const definition = buildCompareAssetsWorkflowDefinition(resolution);
      coordinator.executeWorkflow(pi, definition, ctx);
      return true;
    }

    // single_asset_analysis / watchlist / general_qa + any workflow with
    // unmet required slots: fall through to fallback handling so the main
    // agent still gets an Assumptions block + ask_user directive.
    coordinator.recordWorkflowRun(
      "fallback",
      output.entities,
      Object.fromEntries(Object.entries(output.slots).map(([k, v]) => [k, v.value])),
      [],
      "fallback",
    );
    const assumptionsBlock = buildAssumptionsBlockFromRouter(output.slots);
    coordinator.setPendingFallbackContext({
      assumptionsBlock,
      missingRequired: output.missing_required,
      extraContext: `Router classified as ${workflow} but declined to dispatch. Symbols: ${output.entities.symbols.join(", ") || "(none)"}.`,
    });
    return false;
  }

  function resolveRouterLlmClient(
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): RouterLlmClient | null {
    // `ctx.model` is the currently selected pi-ai model. When unset (no auth
    // configured yet), we skip the router and the main agent will run with
    // its default unrouted flow (legacy rules path is the safer default).
    const model = (ctx as { model?: unknown }).model;
    if (!model) return null;
    // biome-ignore lint/suspicious/noExplicitAny: Pi typings keep Model generic
    return createPiAiRouterClient(model as any);
  }

  // System prompt assembly — delegate to coordinator. When a fallback context
  // is pending (router-mode fallback turns), inject it into the prompt.
  pi.on("before_agent_start", async (event) => {
    const fallbackContext = coordinator.consumePendingFallbackContext() ?? undefined;
    return {
      systemPrompt: coordinator.buildSystemPrompt(event.systemPrompt, undefined, fallbackContext),
    };
  });
}
