import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  buildComprehensiveAnalysisDefinition,
  isAnalysisRequest,
  normalizeSymbol,
} from "../analysts/orchestrator.js";
import { getConfig } from "../config.js";
import type { InstrumentCandidate } from "../market-state/resolve.js";
import { runProviderConnect } from "../onboarding/connect.js";
import { resolveCredentialRequired } from "../onboarding/credential-interceptor.js";
import { createDegradationAccumulator } from "../onboarding/degradation-accumulator.js";
import { promptUser } from "../onboarding/prompt-user.js";
import { getProvider, type ProviderId } from "../onboarding/providers.js";
import {
  loadOnboardingState,
  markProviderNeverAsk,
  markProviderSnoozed,
  markWelcomeShown,
  saveOnboardingState,
  shouldShowWelcome,
} from "../onboarding/state.js";
import { buildConnectedTag, buildSkippedTag, parseToolTag } from "../onboarding/tool-tags.js";
import { DISCLAIMER_TEXT } from "../prompts/disclaimer.js";
import { formatPreflightDropAnnotation, preflightSymbols } from "../prompts/symbol-preflight.js";
import { buildAssumptionsBlockFromRouter } from "../prompts/workflow-prompts.js";
import {
  buildResolvedTurnContext,
  createPiAiRouterClient,
  resolveOptionsScreenerSlots,
  resolvePortfolioSlots,
  route as routeLlm,
} from "../routing/index.js";
import type { RouterInputContext, RouterLlmClient, RouterOutput } from "../routing/router-types.js";
import type { ResolvedTurnContext } from "../routing/turn-context.js";
import type {
  CompareAssetsSlots,
  ExtractedEntities,
  SlotResolution,
  SlotSource,
} from "../routing/types.js";
import {
  SessionCoordinator,
  type SessionCoordinatorOptions,
} from "../runtime/session-coordinator.js";
import { generateSessionTitle } from "../runtime/session-title.js";
import { registerAskUserTool } from "../tools/interaction/ask-user.js";
import type { AskUserHandler } from "../types/index.js";
import {
  buildCompareAssetsWorkflowDefinition,
  buildOptionsScreenerWorkflowDefinition,
  buildPortfolioWorkflowDefinition,
} from "../workflows/index.js";

export interface OpenCandleExtensionOptions {
  modelRuntime?: ModelRuntime;
  askUserHandler?: AskUserHandler;
  /**
   * Optional router LLM client. When provided, this instance is used instead
   * of the pi-ai-backed default. Intended for tests + offline eval runners.
   */
  routerLlmClient?: RouterLlmClient;
  symbolSearch?: (query: string) => Promise<InstrumentCandidate[]>;
  /**
   * Optional completion function for LLM session titles. When omitted, the
   * extension resolves a pi-ai client from the session's current model.
   * Intended for tests + offline runners.
   */
  titleCompletion?: (prompt: string) => Promise<string>;
  stateDatabaseFactory?: SessionCoordinatorOptions["stateDatabaseFactory"];
  setupRunner?: SessionCoordinatorOptions["setupRunner"];
  addonToolDescriptionsFactory?: SessionCoordinatorOptions["addonToolDescriptionsFactory"];
  toolDefaultsFactory?: SessionCoordinatorOptions["toolDefaultsFactory"];
  toolDefinitions?: readonly ToolDefinition[];
  onCoordinatorCreated?: (coordinator: SessionCoordinator) => void;
}

interface OriginalInputMarkerContext {
  sessionManager?: { getBranch?: () => unknown[]; getEntries?: () => unknown[] };
}

export default function openCandleExtension(
  pi: ExtensionAPI,
  options?: OpenCandleExtensionOptions,
): void {
  const coordinator = new SessionCoordinator({
    stateDatabaseFactory: options?.stateDatabaseFactory,
    setupRunner: options?.setupRunner,
    addonToolDescriptionsFactory: options?.addonToolDescriptionsFactory,
    toolDefaultsFactory: options?.toolDefaultsFactory,
  });
  options?.onCoordinatorCreated?.(coordinator);

  // Workflow transforms replace the user's turn with the expanded prompt; this
  // marker lets the GUI render the user's original words instead.
  const markOriginalInput = (original: string, ctx?: OriginalInputMarkerContext): void => {
    if (hasUnconsumedOriginalInputMarker(ctx)) return;
    pi.appendEntry("opencandle-user-input", { original });
  };

  const appendComprehensiveAnalysisWorkflowEntry = (
    symbol: string,
    definition: ReturnType<typeof buildComprehensiveAnalysisDefinition>,
  ): void => {
    pi.appendEntry("opencandle-workflow", {
      workflow: "comprehensive_analysis",
      resolvedSlots: { symbol },
      analystsTotal: definition.steps.filter((step) => step.stepType.startsWith("analyst_")).length,
    });
  };

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
  let activeToolSnapshot: string[] | null = null;
  let currentRouteToolContext: ResolvedTurnContext | null = null;
  // LLM session-title state: one title attempt per session per process.
  // Reset on session_start; set before the (async) title call fires so
  // overlapping turn_end events cannot double-title.
  let sessionTitleAttempted = false;

  // Register tools
  for (const tool of options?.toolDefinitions ?? []) {
    pi.registerTool(tool);
  }
  registerAskUserTool(pi, options?.askUserHandler);

  // /analyze command
  pi.registerCommand("analyze", {
    description: "Run the multi-analyst OpenCandle workflow for a ticker symbol",
    handler: async (args, ctx) => {
      const symbol = normalizeSymbol(args);
      if (!symbol) {
        ctx.ui.notify("Usage: /analyze <ticker>", "warning");
        return;
      }
      const definition = buildComprehensiveAnalysisDefinition(symbol);
      appendComprehensiveAnalysisWorkflowEntry(symbol, definition);
      coordinator.executeWorkflow(pi, definition, ctx);
    },
  });

  // /setup command — reconfigure the OpenCandle AI model (sign-in / API key).
  // Data providers are configured separately via `/connect`.
  pi.registerCommand("setup", {
    description: "Reconfigure the OpenCandle AI model (sign-in or API key)",
    handler: async (_args, ctx) => {
      const result = await coordinator.runSetup(pi, ctx, { mode: "manual" }, options?.modelRuntime);
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
    description: "Connect an API-key data provider (Alpha Vantage, FRED, Finnhub, Brave, Exa)",
    handler: async (args, ctx) => {
      const { listApiKeyProviders, resolveProviderFromArgument, hasCredential, isApiKeyProvider } =
        await import("../onboarding/providers.js");

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
        targetId = await pickProvider(listApiKeyProviders());
      } else {
        const resolved = resolveProviderFromArgument(trimmed);
        if (!resolved) {
          const all = listApiKeyProviders()
            .map((p) => `  ${p.displayName} (${p.aliases.join(", ")})`)
            .join("\n");
          ctx.ui.notify(`Unknown provider: "${trimmed}". Available:\n${all}`, "warning");
          return;
        }
        if (Array.isArray(resolved)) {
          // Multi-provider category — show a sub-picker.
          const apiKeyProviders = resolved.filter(isApiKeyProvider);
          if (apiKeyProviders.length === 0) {
            ctx.ui.notify(
              `"${trimmed}" does not use API-key setup. Run opencandle doctor for setup status.`,
              "warning",
            );
            return;
          }
          targetId = await pickProvider(apiKeyProviders);
        } else {
          const descriptor = resolved as ReturnType<typeof getProvider>;
          if (!isApiKeyProvider(descriptor)) {
            ctx.ui.notify(
              `${descriptor.displayName} does not use API-key setup. Run opencandle doctor for setup status.`,
              "warning",
            );
            return;
          }
          targetId = descriptor.id;
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
    sessionTitleAttempted = false;

    if (!ctx.hasUI) return;
    // Pin the user-facing disclaimer in the UI footer for the entire session.
    // Using `setStatus` keeps it always visible to the user without ever
    // entering the LLM's conversation context (unlike `sendMessage`, which Pi
    // reinjects as a `role:"user"` message every turn).
    ctx.ui.setStatus("opencandle-disclaimer", DISCLAIMER_TEXT);

    const result = await coordinator.runSetup(pi, ctx, { mode: "startup" }, options?.modelRuntime);
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
    const isSuccessfulFinalAssistantTurn = msg.role === "assistant" && msg.stopReason === "stop";
    const isTerminalAssistantTurn =
      msg.role === "assistant" &&
      (msg.stopReason === "stop" ||
        msg.stopReason === "length" ||
        msg.stopReason === "error" ||
        msg.stopReason === "aborted");
    if (isSuccessfulFinalAssistantTurn) {
      pi.appendEntry("opencandle-disclaimer", { text: DISCLAIMER_TEXT });
    }
    if (isTerminalAssistantTurn) {
      restoreRouteToolScope();
    }

    if (degradationAccumulator.isEmpty()) return;
    const state = loadOnboardingState();
    const annotation = degradationAccumulator.buildCombinedAnnotation(state);
    if (annotation !== null) {
      pi.appendEntry("opencandle-turn-gap", { annotation });
    }
    degradationAccumulator.reset();
  });

  // LLM session titles. After the first completed user↔assistant exchange,
  // replace the placeholder session name (the raw first prompt, set by the
  // GUI server / Pi's firstMessage fallback) with a short model-written
  // summary. Manual renames are left alone, and each session is attempted at
  // most once per process. Model failures are swallowed (placeholder stays)
  // but recorded as an `opencandle-title-error` entry for observability.
  pi.on("turn_end", async (event, ctx) => {
    if (sessionTitleAttempted) return;
    const msg = event.message as { role?: unknown; stopReason?: unknown };
    if (msg?.role !== "assistant" || msg?.stopReason !== "stop") return;
    const sessionManager = ctx?.sessionManager;
    if (typeof sessionManager?.getBranch !== "function") return;

    const branch = sessionManager.getBranch();
    let firstUserText: string | null = null;
    let firstAssistantText: string | null = null;
    let originalInput: string | null = null;
    for (const entry of branch) {
      if (
        originalInput === null &&
        entry.type === "custom" &&
        (entry as { customType?: unknown }).customType === "opencandle-user-input"
      ) {
        const original = (entry as { data?: { original?: unknown } }).data?.original;
        if (typeof original === "string" && original.trim().length > 0) {
          originalInput = original;
        }
        continue;
      }
      if (entry.type !== "message") continue;
      const message = (entry as { message?: { role?: unknown; content?: unknown } }).message;
      const text = extractMessageText(message?.content);
      if (text.trim().length === 0) continue;
      if (firstUserText === null && message?.role === "user") firstUserText = text;
      if (firstAssistantText === null && message?.role === "assistant") {
        firstAssistantText = text;
      }
      if (firstUserText !== null && firstAssistantText !== null) break;
    }
    // Fall back to the just-finished assistant message when the branch has
    // not surfaced it yet at turn_end time.
    if (firstAssistantText === null) {
      const eventText = extractMessageText((msg as { content?: unknown }).content);
      if (eventText.trim().length > 0) firstAssistantText = eventText;
    }
    if (firstUserText === null || firstAssistantText === null) return;

    const userText = originalInput ?? firstUserText;
    // A manual rename must be left alone — only replace the placeholder
    // (unset, the raw first prompt, or the GUI's "first 77 chars + ..." form).
    if (!isPlaceholderSessionName(pi.getSessionName(), [userText, firstUserText])) return;

    const completion =
      options?.titleCompletion ??
      (() => {
        const client = options?.routerLlmClient ?? resolveRouterLlmClient(ctx);
        return client ? (prompt: string) => client.complete(prompt) : null;
      })();
    if (!completion) return;

    sessionTitleAttempted = true;
    try {
      const title = await generateSessionTitle(
        { userText, assistantText: firstAssistantText.slice(0, 500) },
        completion,
      );
      if (title !== null) {
        pi.setSessionName(title);
      }
    } catch (err) {
      pi.appendEntry("opencandle-title-error", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
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

    // Second pass: look for setup-required tags; on match, run the interception
    // decision and either replace the tool result or prompt the user. Only the
    // first setup tag in the content list is acted on.
    for (const block of event.content) {
      if (block.type !== "text") continue;
      const parsed = parseToolTag(block.text);
      if (
        !parsed ||
        (parsed.kind !== "credential_required" && parsed.kind !== "external_tool_required")
      ) {
        continue;
      }

      if (parsed.kind === "external_tool_required") {
        const state = loadOnboardingState();
        const descriptor = getProvider(parsed.provider);
        if (state.providers[parsed.provider]?.status === "never_ask") {
          return {
            content: [
              {
                type: "text",
                text:
                  `${buildSkippedTag({
                    provider: parsed.provider,
                    reason: "credential_not_provided",
                    remediation: `run ${parsed.installCmd} and ${parsed.loginCmd ?? "rdt login"} to enable ${descriptor.displayName} (silenced)`,
                    silenced: true,
                  })}\n\n` +
                  `${descriptor.displayName} data was not fetched because you previously asked not to be reminded about this provider.`,
              },
            ],
          };
        }
        const setupLabel =
          parsed.reason === "not_installed"
            ? `Continue after installing ${descriptor.displayName}`
            : `Continue after logging in to ${descriptor.displayName}`;
        const skipLabel = `Skip ${descriptor.displayName} once`;
        const neverLabel = `Always skip ${descriptor.displayName}`;
        const installOrLogin =
          parsed.reason === "not_installed"
            ? `Install command: ${parsed.installCmd}.`
            : `Login command: ${parsed.loginCmd ?? "rdt login"}.`;
        const questionBody =
          `${descriptor.displayName} requires a local external tool before this data can be fetched. ` +
          `${installOrLogin} How would you like to proceed?`;

        sessionPromptedSet.add(parsed.provider);
        const promptResult = await promptUser(
          ctx,
          {
            question: questionBody,
            questionType: "select",
            options: [setupLabel, skipLabel, neverLabel],
          },
          options?.askUserHandler,
        );

        const answer = promptResult.cancelled ? skipLabel : (promptResult.answer ?? skipLabel);
        if (answer.startsWith("Always")) {
          saveOnboardingState(markProviderNeverAsk(state, parsed.provider));
        }

        if (answer.startsWith("Continue")) {
          return {
            content: [
              {
                type: "text",
                text:
                  `${buildConnectedTag({ provider: parsed.provider })}\n\n` +
                  `${descriptor.displayName} setup was acknowledged. Re-run the original ${descriptor.displayName} request now; if setup is still unavailable, continue without ${descriptor.displayName} and disclose the source gap.`,
              },
            ],
          };
        }

        const silenced = answer.startsWith("Always");
        const remediation = silenced
          ? `run ${parsed.installCmd} and ${parsed.loginCmd ?? "rdt login"} to enable ${descriptor.displayName} (silenced)`
          : `run ${parsed.installCmd} and ${parsed.loginCmd ?? "rdt login"} to enable ${descriptor.displayName}`;
        return {
          content: [
            {
              type: "text",
              text: `${buildSkippedTag({
                provider: parsed.provider,
                reason: "credential_not_provided",
                remediation,
                silenced,
              })}\n\n${descriptor.displayName} data was omitted per your choice.`,
            },
          ],
        };
      }

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
      const canConnectInline = ctx.hasUI === true;
      const connectLabel = canConnectInline
        ? `Connect now — ${descriptor.instructionsHint}`
        : "Show provider setup instructions";
      const continueLabel = descriptor.fallbackDescription
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
              text: `${buildSkippedTag({
                provider: parsed.provider,
                reason: "credential_not_provided",
                remediation: `run /connect ${descriptor.aliases[0] ?? descriptor.id} to unlock`,
              })}\n\nPrompt was cancelled.`,
            },
          ],
        };
      }

      const answer = promptResult.answer ?? "";

      if (!canConnectInline && answer.startsWith("Show provider")) {
        return {
          content: [
            {
              type: "text",
              text:
                `${buildSkippedTag({
                  provider: parsed.provider,
                  reason: "credential_not_provided",
                  remediation: "open Providers settings and add the provider key",
                })}\n\n` +
                `Open Providers settings, add the ${descriptor.displayName} key, then re-run the request.`,
            },
          ],
        };
      }

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
        // Cancelled or unsuccessful validation: fall through to skipped
        // with a result-specific explanation so the LLM can describe what
        // just happened in its final answer.
        const connectOutcomeDescription =
          connectResult.status === "blocked_by_env"
            ? "blocked by an existing environment variable"
            : connectResult.status === "invalid_key"
              ? `rejected by ${descriptor.displayName} (the key was invalid and nothing was saved)`
              : connectResult.status === "verification_failed"
                ? `not completed because ${descriptor.displayName} could not verify the key (nothing was saved)`
                : "cancelled";
        return {
          content: [
            {
              type: "text",
              text: `${buildSkippedTag({
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
            text: `${buildSkippedTag({
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

  pi.on("tool_call", async (event) => {
    if (!currentRouteToolContext) return undefined;
    const allowed = new Set(currentRouteToolContext.activeToolNames);
    if (allowed.has(event.toolName)) return undefined;

    const diagnostic = {
      routeKind: currentRouteToolContext.routeKind,
      workflow: currentRouteToolContext.workflow,
      toolName: event.toolName,
      toolBundles: currentRouteToolContext.toolBundles,
      activeToolNames: currentRouteToolContext.activeToolNames,
    };
    pi.appendEntry("opencandle-tool-scope-violation", diagnostic);

    if (getConfig().toolScopeMode === "enforce") {
      return {
        block: true,
        reason: `Tool ${event.toolName} is outside the route-selected OpenCandle tool bundle.`,
      };
    }
    return undefined;
  });

  // Input handling — the LLM router is the single production routing path.
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    coordinator.clearTickerValidationCache();

    // Check for comprehensive analysis pattern before routing.
    const analysis = isAnalysisRequest(event.text);
    if (analysis.match && analysis.symbol) {
      const definition = buildComprehensiveAnalysisDefinition(analysis.symbol);
      appendComprehensiveAnalysisWorkflowEntry(analysis.symbol, definition);
      const prompt = coordinator.transformWorkflowInput(pi, definition, ctx);
      if (prompt) markOriginalInput(event.text, ctx);
      return prompt ? { action: "transform", text: prompt } : { action: "handled" };
    }

    const dispatched = await handleLlmRouterTurn(event.text, ctx);
    // Dispatched a workflow → the original user turn is now represented by
    // the workflow's queued prompts; tell Pi not to also forward it.
    // Fallback path (no dispatch) → let Pi pass the user turn through to the
    // main agent, which will run under the router-supplied fallback context.
    return dispatched || undefined;
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
  ): Promise<{ action: "transform"; text: string } | false> {
    const storage = coordinator.getStorage();
    const { profileSnapshot, recentWorkflowRuns, priorTurns } = coordinator.buildRouterContextBase(
      ctx.sessionManager,
    );
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

    const availableToolNames = safeGetAllToolNames();
    const memory = coordinator.retrieveMemoryForRoute(
      output.routeKind,
      output.workflow,
      Object.keys(output.slots),
    );
    const resolvedTurnContext = buildResolvedTurnContext(input, output, {
      availableToolNames,
      memoryEntries: memory.entries,
      filteredMemory: memory.filtered.map(({ entry, reason }) => ({
        category: entry.category,
        key: entry.key,
        source: entry.source,
        recordedAt: entry.recordedAt,
        confidence: entry.confidence,
        filtered: true,
        filterReason: reason,
      })),
      planning: {
        migrationStatuses: getConfig().planningMigrationStatuses,
      },
    });

    pi.appendEntry("opencandle-router", { output });
    appendRouterSymbolDropEntries(output);
    pi.appendEntry("opencandle-route-context", resolvedTurnContext);
    coordinator.setPendingResolvedTurnContext(resolvedTurnContext);
    applyRouteToolScope(resolvedTurnContext);

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
    if (output.routeKind === "workflow_dispatch" && output.workflow) {
      return dispatchRouterWorkflow(output, ctx, text);
    }

    if (output.routeKind === "pass_through") {
      return false;
    }

    // Fallback: record the turn and stash the fallback context for the
    // upcoming `before_agent_start` hook to render into the system prompt.
    coordinator.recordWorkflowRun(
      "fallback",
      output.entities,
      Object.fromEntries(Object.entries(output.slots).map(([k, v]) => [k, v.value])),
      [],
      output.routeKind,
    );

    const assumptionsBlock = buildAssumptionsBlockFromRouter(output.slots);
    coordinator.setPendingFallbackContext({
      assumptionsBlock,
      missingRequired: output.missing_required,
      extraContext:
        output.entities.symbols.length > 0
          ? `Router-extracted symbols: ${output.entities.symbols.join(", ")}.` +
            ` Route kind: ${output.routeKind}. Tool bundles: ${output.tool_bundles.join(", ") || "(none)"}.`
          : undefined,
    });
    return false;
  }

  async function dispatchRouterWorkflow(
    output: RouterOutput,
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
    originalText: string,
  ): Promise<{ action: "transform"; text: string } | false> {
    const workflow = output.workflow;
    if (!workflow) return false;
    const storage = coordinator.getStorage();
    const workflowPrefs = storage?.getWorkflowPreferences("global") ?? {};
    const entities = mergeRouterSlotsIntoEntities(output);

    if (workflow === "portfolio_builder") {
      const resolution = withRouterSlotSources(
        resolvePortfolioSlots(entities, workflowPrefs),
        output,
      );
      coordinator.recordWorkflowRun(
        "portfolio_builder",
        entities,
        resolution.resolved,
        resolution.defaultsUsed,
        output.routeKind,
      );
      pi.appendEntry("opencandle-workflow", {
        workflow: "portfolio_builder",
        entities,
        resolved: resolution.resolved,
      });
      const definition = buildPortfolioWorkflowDefinition(resolution);
      const prompt = coordinator.transformWorkflowInput(pi, definition, ctx);
      if (prompt) markOriginalInput(originalText, ctx);
      return prompt ? { action: "transform", text: prompt } : false;
    }
    if (workflow === "options_screener") {
      const resolution = withRouterSlotSources(
        resolveOptionsScreenerSlots(entities, workflowPrefs),
        output,
      );
      // Router may emit missing_required; main agent handles via ask_user.
      // Still dispatch the workflow when symbol is present.
      if (resolution.missingRequired.length === 0) {
        coordinator.recordWorkflowRun(
          "options_screener",
          entities,
          resolution.resolved,
          resolution.defaultsUsed,
          output.routeKind,
        );
        pi.appendEntry("opencandle-workflow", {
          workflow: "options_screener",
          entities,
          resolved: resolution.resolved,
        });
        const definition = buildOptionsScreenerWorkflowDefinition(resolution);
        const prompt = coordinator.transformWorkflowInput(pi, definition, ctx);
        if (prompt) markOriginalInput(originalText, ctx);
        return prompt ? { action: "transform", text: prompt } : false;
      }
      // Missing required symbol — treat as fallback with ask_user directive.
    }
    if (workflow === "compare_assets" && entities.symbols.length >= 2) {
      const resolution: SlotResolution<CompareAssetsSlots> = {
        resolved: {
          symbols: entities.symbols,
          metrics: entities.compareMetrics,
          timeHorizon: entities.timeHorizon,
          budget: entities.budget,
          assetScope: entities.assetScope,
        },
        sources: {
          symbols: sourceForRouterSlot(output, "symbols", "user"),
          ...(entities.timeHorizon ? { timeHorizon: "user" as const } : {}),
          ...(entities.compareMetrics ? { metrics: "user" as const } : {}),
          ...(entities.budget !== undefined
            ? { budget: sourceForRouterSlot(output, "budget", "user") }
            : {}),
          ...(entities.assetScope ? { assetScope: "user" as const } : {}),
        },
        defaultsUsed: [],
        missingRequired: [],
      };
      coordinator.recordWorkflowRun(
        "compare_assets",
        entities,
        resolution.resolved,
        [],
        output.routeKind,
      );
      pi.appendEntry("opencandle-workflow", {
        workflow: "compare_assets",
        symbols: entities.symbols,
      });
      const preflight = await preflightCompareResolution(resolution);
      if (!preflight) {
        coordinator.recordWorkflowRun(
          "fallback",
          output.entities,
          Object.fromEntries(Object.entries(output.slots).map(([k, v]) => [k, v.value])),
          [],
          output.routeKind,
        );
        coordinator.setPendingResolvedTurnContext(null);
        coordinator.setPendingFallbackContext({
          assumptionsBlock: buildAssumptionsBlockFromRouter(output.slots),
          missingRequired: ["symbols"],
          extraContext:
            "Compare workflow aborted because ticker preflight left fewer than two valid symbols. Ask the user to clarify the intended tickers.",
        });
        return false;
      }
      const definition = buildCompareAssetsWorkflowDefinition(preflight.resolution);
      applyPreflightAnnotation(definition, preflight.dropped);
      const prompt = coordinator.transformWorkflowInput(pi, definition, ctx);
      if (prompt) markOriginalInput(originalText, ctx);
      return prompt ? { action: "transform", text: prompt } : false;
    }

    // single_asset_analysis / watchlist / general_qa + any workflow with
    // unmet required slots: fall through to fallback handling so the main
    // agent still gets an Assumptions block + ask_user directive.
    coordinator.recordWorkflowRun(
      "fallback",
      output.entities,
      Object.fromEntries(Object.entries(output.slots).map(([k, v]) => [k, v.value])),
      [],
      output.routeKind,
    );
    const assumptionsBlock = buildAssumptionsBlockFromRouter(output.slots);
    coordinator.setPendingFallbackContext({
      assumptionsBlock,
      missingRequired: output.missing_required,
      extraContext: `Router classified as ${workflow} but declined to dispatch. Symbols: ${entities.symbols.join(", ") || "(none)"}.`,
    });
    return false;
  }

  function appendRouterSymbolDropEntries(output: RouterOutput): void {
    for (const diagnostic of output.diagnostics) {
      if (diagnostic.code !== "symbol_dropped") continue;
      const details = diagnostic.details ?? {};
      appendSymbolDropEntries(
        [
          {
            token: String(details.token ?? ""),
            reason: String(details.reason ?? ""),
            signalsChecked: Array.isArray(details.signalsChecked)
              ? details.signalsChecked.map(String)
              : [],
          },
        ],
        String(details.source ?? "llm"),
      );
    }
  }

  function appendSymbolDropEntries(
    dropped: Array<{ token: string; reason: string; signalsChecked: string[] }>,
    source: string,
  ): void {
    for (const drop of dropped) {
      pi.appendEntry("opencandle-symbol-dropped", {
        token: drop.token,
        reason: drop.reason,
        signalsChecked: drop.signalsChecked,
        source,
      });
    }
  }

  async function preflightCompareResolution(
    resolution: SlotResolution<CompareAssetsSlots>,
  ): Promise<{
    resolution: SlotResolution<CompareAssetsSlots>;
    dropped: Array<{ symbol: string; reason: string }>;
  } | null> {
    const result = await preflightSymbols(resolution.resolved.symbols, {
      cache: coordinator.getTickerValidationCache(),
      search: options?.symbolSearch,
    });
    for (const drop of result.dropped) {
      pi.appendEntry("opencandle-symbol-preflight-dropped", drop);
    }
    if (result.valid.length < 2) {
      pi.appendEntry("opencandle-workflow-aborted", {
        reason: "preflight-insufficient-symbols",
        dropped: result.dropped,
      });
      return null;
    }
    return {
      resolution: {
        ...resolution,
        resolved: {
          ...resolution.resolved,
          symbols: result.valid,
        },
      },
      dropped: result.dropped,
    };
  }

  function applyPreflightAnnotation(
    definition: ReturnType<typeof buildCompareAssetsWorkflowDefinition>,
    dropped: Array<{ symbol: string; reason: string }>,
  ): void {
    if (dropped.length === 0 || definition.steps.length === 0) return;
    definition.steps[0] = {
      ...definition.steps[0],
      prompt: `${formatPreflightDropAnnotation(dropped)}\n\n${definition.steps[0].prompt}`,
    };
  }

  function mergeRouterSlotsIntoEntities(output: RouterOutput): ExtractedEntities {
    const entities: ExtractedEntities = {
      ...output.entities,
      symbols: output.entities.symbols,
    };

    if (entities.budget === undefined && typeof output.slots.budget?.value === "number") {
      entities.budget = output.slots.budget.value;
    }

    const droppedSymbols = droppedSymbolsFromDiagnostics(output);
    const slotSymbols = symbolsFromRouterSlots(output).filter(
      (symbol) => !droppedSymbols.has(symbol),
    );
    if (slotSymbols.length > 0 && slotSymbols.length > entities.symbols.length) {
      entities.symbols = mergeSymbols(slotSymbols, entities.symbols);
    }

    return entities;
  }

  function droppedSymbolsFromDiagnostics(output: RouterOutput): Set<string> {
    const dropped = new Set<string>();
    for (const diagnostic of output.diagnostics) {
      if (diagnostic.code !== "symbol_dropped") continue;
      const token = diagnostic.details?.token;
      if (typeof token === "string" && token.trim() !== "") {
        dropped.add(token.toUpperCase());
      }
    }
    return dropped;
  }

  function withRouterSlotSources<T extends object>(
    resolution: SlotResolution<T>,
    output: RouterOutput,
  ): SlotResolution<T> {
    const sources: Record<string, SlotSource | undefined> = { ...resolution.sources };
    if (output.entities.budget === undefined && output.slots.budget) {
      sources.budget = output.slots.budget.source;
    }
    if (output.entities.symbols.length === 0 && output.slots.symbol) {
      sources.symbol = output.slots.symbol.source;
    }
    if (output.entities.symbols.length < 2 && output.slots.symbols) {
      sources.symbols = output.slots.symbols.source;
    }
    return { ...resolution, sources: sources as SlotResolution<T>["sources"] };
  }

  function sourceForRouterSlot(
    output: RouterOutput,
    slotName: "symbol" | "symbols" | "budget",
    fallback: SlotSource,
  ): SlotSource {
    return output.slots[slotName]?.source ?? fallback;
  }

  function symbolsFromRouterSlots(output: RouterOutput): string[] {
    const symbols: string[] = [];
    const symbol = output.slots.symbol?.value;
    if (typeof symbol === "string" && symbol.trim() !== "") {
      symbols.push(symbol.toUpperCase());
    }
    const symbolList = output.slots.symbols?.value;
    if (Array.isArray(symbolList)) {
      for (const value of symbolList) {
        if (typeof value === "string" && value.trim() !== "") {
          symbols.push(value.toUpperCase());
        }
      }
    }
    return symbols;
  }

  function mergeSymbols(primary: string[], secondary: string[]): string[] {
    const merged: string[] = [];
    for (const symbol of [...primary, ...secondary]) {
      if (!merged.includes(symbol)) merged.push(symbol);
    }
    return merged;
  }

  function safeGetAllToolNames(): string[] {
    try {
      return pi.getAllTools().map((tool) => tool.name);
    } catch {
      return [];
    }
  }

  function applyRouteToolScope(context: ResolvedTurnContext): void {
    const mode = getConfig().toolScopeMode;
    currentRouteToolContext = context;
    pi.appendEntry("opencandle-tool-scope", {
      mode,
      routeKind: context.routeKind,
      workflow: context.workflow,
      toolBundles: context.toolBundles,
      activeToolNames: context.activeToolNames,
      enforced: false,
    });

    if (mode !== "enforce") return;
    if (context.activeToolNames.length === 0) return;

    try {
      if (activeToolSnapshot === null) {
        activeToolSnapshot = pi.getActiveTools();
      }
      pi.setActiveTools(context.activeToolNames);
      pi.appendEntry("opencandle-tool-scope", {
        mode,
        routeKind: context.routeKind,
        workflow: context.workflow,
        toolBundles: context.toolBundles,
        activeToolNames: context.activeToolNames,
        enforced: true,
      });
    } catch (err) {
      pi.appendEntry("opencandle-tool-scope", {
        mode,
        routeKind: context.routeKind,
        workflow: context.workflow,
        toolBundles: context.toolBundles,
        activeToolNames: context.activeToolNames,
        enforced: false,
        diagnostic: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function restoreRouteToolScope(): void {
    currentRouteToolContext = null;
    if (activeToolSnapshot === null) return;
    try {
      pi.setActiveTools(activeToolSnapshot);
      pi.appendEntry("opencandle-tool-scope", {
        mode: getConfig().toolScopeMode,
        restored: true,
        activeToolNames: activeToolSnapshot,
      });
    } catch (err) {
      pi.appendEntry("opencandle-tool-scope", {
        mode: getConfig().toolScopeMode,
        restored: false,
        diagnostic: err instanceof Error ? err.message : String(err),
      });
    } finally {
      activeToolSnapshot = null;
    }
  }

  function resolveRouterLlmClient(
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): RouterLlmClient | null {
    // `ctx.model` is the currently selected pi-ai model. When unset (no auth
    // configured yet), we skip the router and the main agent runs with its
    // default unrouted flow for the turn.
    const model = (ctx as { model?: unknown }).model;
    if (!model) return null;
    const complete = options?.modelRuntime?.completeSimple.bind(options.modelRuntime);
    return createPiAiRouterClient(model as Model<Api>, complete);
  }

  // System prompt assembly — delegate to coordinator. When a fallback context
  // is pending (router-mode fallback turns), inject it into the prompt.
  pi.on("before_agent_start", async (event) => {
    const fallbackContext = coordinator.consumePendingFallbackContext() ?? undefined;
    const resolvedTurnContext = coordinator.consumePendingResolvedTurnContext() ?? undefined;
    return {
      systemPrompt: coordinator.buildSystemPrompt(
        event.systemPrompt,
        coordinator.getActiveWorkflowType(),
        fallbackContext,
        resolvedTurnContext,
      ),
    };
  });
}

function hasUnconsumedOriginalInputMarker(ctx?: OriginalInputMarkerContext): boolean {
  const manager = ctx?.sessionManager;
  const entries =
    typeof manager?.getBranch === "function"
      ? manager.getBranch()
      : typeof manager?.getEntries === "function"
        ? manager.getEntries()
        : [];
  let markerAfterLastUser = false;
  for (const entry of entries) {
    if (!isSessionEntryRecord(entry)) continue;
    if (entry.type === "message" && entry.message?.role === "user") {
      markerAfterLastUser = false;
      continue;
    }
    if (entry.type === "custom" && entry.customType === "opencandle-user-input") {
      markerAfterLastUser = true;
      continue;
    }
    if (markerAfterLastUser) {
      markerAfterLastUser = false;
    }
  }
  return markerAfterLastUser;
}

function isSessionEntryRecord(
  entry: unknown,
): entry is { type?: unknown; customType?: unknown; message?: { role?: unknown } } {
  return typeof entry === "object" && entry !== null;
}

/** Concatenate text from a Pi message `content` (plain string or block array). */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      text += (block as { text: string }).text;
    }
  }
  return text;
}

/**
 * True when the session name is still an auto-set placeholder that the LLM
 * title may replace: unset, exactly one of the candidate user texts, or the
 * GUI server's truncated "first 77 chars + ..." form of one of them.
 */
function isPlaceholderSessionName(name: string | undefined, candidates: string[]): boolean {
  if (name === undefined || name.trim().length === 0) return true;
  const trimmed = name.trim();
  for (const candidate of candidates) {
    const candidateTrimmed = candidate.trim();
    if (trimmed === candidateTrimmed) return true;
    if (trimmed.endsWith("...") && candidateTrimmed.startsWith(trimmed.slice(0, -3))) {
      return true;
    }
  }
  return false;
}
