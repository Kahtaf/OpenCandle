import * as readline from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { runComprehensiveAnalysis } from "./analysts/orchestrator.js";
import { classifyIntent, resolvePortfolioSlots, resolveOptionsScreenerSlots, extractBudget, extractEntities } from "./routing/index.js";
import type { ClassificationResult, CompareAssetsSlots, SlotResolution } from "./routing/types.js";
import { buildCompareAssetsPrompt } from "./prompts/workflow-prompts.js";
import { initDatabase, MemoryStorage, createSession, ChatLogger } from "./memory/index.js";
import { extractPreferences } from "./memory/preference-extractor.js";
import { buildMemoryContext } from "./memory/retrieval.js";
import { buildPortfolioWorkflow } from "./workflows/portfolio-builder.js";
import { buildOptionsScreenerWorkflow } from "./workflows/options-screener.js";
import { buildSystemPrompt } from "./system-prompt.js";

const config = loadConfig();
const dbPath = join(homedir(), ".vantage", "state.db");
const db = initDatabase(dbPath);
const storage = new MemoryStorage(db);
const session = createSession();
const chatLogger = new ChatLogger(join(homedir(), ".vantage", "logs"), session.id);
storage.insertSession({
  id: session.id,
  startedAt: session.startedAt,
  cwd: session.cwd,
  logPath: chatLogger.getLogPath(),
});
chatLogger.log({ type: "session_start", payload: { cwd: session.cwd } });

const agent = createAgent(config);
let messageIndex = 0;
let currentWorkflow: ClassificationResult["workflow"] = "unclassified";
let currentWorkflowRunId: number | null = null;

let currentLine = "";

agent.subscribe((event: AgentEvent) => {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") {
        process.stdout.write(e.delta);
        currentLine += e.delta;
      }
      break;
    }
    case "tool_execution_start":
      process.stdout.write(`\n🔧 ${event.toolName}(${JSON.stringify(event.args)})\n`);
      storage.insertToolCallStart({
        sessionId: session.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        argsJson: JSON.stringify(event.args),
      });
      chatLogger.log({
        type: "tool_call_start",
        payload: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
      });
      break;
    case "tool_execution_end":
      if (event.isError) {
        process.stdout.write(`❌ Error: ${JSON.stringify(event.result)}\n`);
      }
      storage.completeToolCall({
        toolCallId: event.toolCallId,
        resultSummary: summarizeToolResult(event.result),
        success: !event.isError,
      });
      chatLogger.log({
        type: "tool_call_end",
        payload: { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError },
      });
      break;
    case "agent_end":
      if (currentLine) {
        storage.insertMessage({
          sessionId: session.id,
          role: "assistant",
          contentText: currentLine,
          workflowType: currentWorkflow,
          messageIndex: messageIndex++,
        });
        chatLogger.log({
          type: "assistant_message",
          payload: { text: currentLine },
        });
        if (currentWorkflowRunId !== null) {
          storage.updateWorkflowRunOutputSummary(
            currentWorkflowRunId,
            summarizeAssistantMessage(currentLine),
          );
        }
        process.stdout.write("\n\n");
        currentLine = "";
      }
      currentWorkflowRunId = null;
      promptUser();
      break;
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function persistPreferences(input: string): void {
  const prefs = extractPreferences(input);
  for (const pref of prefs) {
    storage.upsertPreference({
      namespace: "global",
      key: pref.key,
      valueJson: JSON.stringify(pref.value),
      confidence: pref.confidence,
      source: "explicit",
    });
  }
}

function collectCurrentTurnPreferences(input: string): ReturnType<typeof storage.getWorkflowPreferences> {
  const persisted = storage.getWorkflowPreferences("global");
  const extracted = extractPreferences(input);
  if (extracted.length === 0) return persisted;

  const merged = { ...persisted };
  for (const pref of extracted) {
    switch (pref.key) {
      case "risk_profile":
        merged.riskProfile = pref.value;
        break;
      case "time_horizon":
        merged.timeHorizon = pref.value;
        break;
      case "asset_scope":
        merged.assetScope = pref.value;
        break;
      case "dte_target":
        merged.dteTarget = pref.value;
        break;
      case "objective":
        merged.objective = pref.value;
        break;
      case "moneyness_preference":
        merged.moneynessPreference = pref.value;
        break;
      case "options_liquidity":
      case "liquidity_minimum":
        merged.liquidityMinimum =
          pref.value === "high" ? "high_open_interest_and_tight_spread" : pref.value;
        break;
    }
  }

  return merged;
}

function queueFollowUps(followUps: string[]): void {
  for (const text of followUps) {
    agent.followUp({
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    });
  }
}

function userSourcedSlots(sources: Record<string, string | undefined>): string[] {
  return Object.entries(sources)
    .filter(([, source]) => source === "user")
    .map(([key]) => key);
}

function persistWorkflowRun(
  workflowType: string,
  inputSlots: unknown,
  resolvedSlots: unknown,
  defaultsUsed: string[],
): number {
  return storage.insertWorkflowRun({
    sessionId: session.id,
    workflowType,
    inputSlotsJson: JSON.stringify(inputSlots),
    resolvedSlotsJson: JSON.stringify(resolvedSlots),
    defaultsUsedJson: JSON.stringify(defaultsUsed),
  });
}

async function handleWorkflow(classification: ClassificationResult, input: string): Promise<void> {
  const { workflow, entities } = classification;
  currentWorkflow = workflow;

  // Clear stale follow-ups from any prior workflow before starting a new one.
  agent.clearFollowUpQueue();

  // Persist explicit preferences before prompt construction so the current turn
  // can benefit from them immediately and future turns can reuse them.
  persistPreferences(input);
  let preferences = collectCurrentTurnPreferences(input);

  // Set initial system prompt (may be updated after slot resolution with suppression).
  function updateSystemPrompt(overriddenSlots?: string[]): void {
    const memoryContext = buildMemoryContext(storage, overriddenSlots);
    agent.setSystemPrompt(buildSystemPrompt(memoryContext || undefined));
  }
  updateSystemPrompt();

  chatLogger.log({ type: "user_message", payload: { text: input } });
  storage.insertMessage({
    sessionId: session.id,
    role: "user",
    contentText: input,
    workflowType: workflow,
    messageIndex: messageIndex++,
  });
  chatLogger.log({
    type: "workflow_selected",
    payload: { workflow, confidence: classification.confidence, tier: classification.tier },
  });

  switch (workflow) {
    case "single_asset_analysis": {
      const symbol = entities.symbols[0];
      console.log(`\n📊 Running comprehensive analysis for ${symbol}...\n`);
      await agent.prompt(`Begin comprehensive analysis of ${symbol}. Start by getting the current stock quote.`);
      runComprehensiveAnalysis(agent, symbol);
      return;
    }
    case "portfolio_builder": {
      let resolution = resolvePortfolioSlots(entities, preferences);
      if (resolution.missingRequired.includes("budget")) {
        const answer = await askClarification(
          "What budget are you working with? (e.g., $10k, $50,000)",
        );
        // Merge all entities from the clarification answer into the
        // main entities so the slot resolver treats them as "user" source.
        const clarificationEntities = extractEntities(answer);
        if (clarificationEntities.budget !== undefined) entities.budget = clarificationEntities.budget;
        if (clarificationEntities.riskProfile) entities.riskProfile = clarificationEntities.riskProfile;
        if (clarificationEntities.timeHorizon) entities.timeHorizon = clarificationEntities.timeHorizon;
        resolution = resolvePortfolioSlots(entities, preferences);
      }

      const plan = buildPortfolioWorkflow(resolution);
      chatLogger.log({
        type: "slot_resolution",
        payload: { resolved: resolution.resolved, defaultsUsed: resolution.defaultsUsed },
      });
      currentWorkflowRunId = persistWorkflowRun(
        "portfolio_builder",
        entities,
        resolution.resolved,
        resolution.defaultsUsed,
      );

      // Suppress overridden preference keys from memory context
      const overridden = userSourcedSlots(resolution.sources);
      updateSystemPrompt(overridden);

      console.log(`\n📊 Building portfolio draft...\n`);
      queueFollowUps(plan.followUps);
      await agent.prompt(plan.initialPrompt);
      return;
    }
    case "options_screener": {
      let resolution = resolveOptionsScreenerSlots(entities, preferences);
      if (resolution.missingRequired.includes("symbol")) {
        const answer = await askClarification("Which symbol do you want options for?");
        const clarificationEntities = extractEntities(answer);
        if (clarificationEntities.symbols.length > 0) {
          entities.symbols = clarificationEntities.symbols;
        } else {
          const sym = answer.replace(/\$/g, "").trim().toUpperCase();
          if (sym.length >= 1 && sym.length <= 5) {
            entities.symbols = [sym];
          }
        }
        if (clarificationEntities.direction) entities.direction = clarificationEntities.direction;
        if (clarificationEntities.dteHint) entities.dteHint = clarificationEntities.dteHint;
        resolution = resolveOptionsScreenerSlots(entities, preferences);
      }

      const plan = buildOptionsScreenerWorkflow(resolution);
      chatLogger.log({
        type: "slot_resolution",
        payload: { resolved: resolution.resolved, defaultsUsed: resolution.defaultsUsed },
      });
      currentWorkflowRunId = persistWorkflowRun(
        "options_screener",
        entities,
        resolution.resolved,
        resolution.defaultsUsed,
      );

      const overriddenOpts = userSourcedSlots(resolution.sources);
      updateSystemPrompt(overriddenOpts);

      console.log(`\n📊 Screening options...\n`);
      queueFollowUps(plan.followUps);
      await agent.prompt(plan.initialPrompt);
      return;
    }
    case "compare_assets": {
      const resolution: SlotResolution<CompareAssetsSlots> = {
        resolved: { symbols: entities.symbols },
        sources: { symbols: "user" },
        defaultsUsed: [],
        missingRequired: entities.symbols.length < 2 ? ["symbols"] : [],
      };
      if (resolution.missingRequired.length > 0) {
        await agent.prompt(input);
        return;
      }

      const prompt = buildCompareAssetsPrompt(resolution);
      currentWorkflowRunId = persistWorkflowRun("compare_assets", entities, resolution.resolved, []);

      console.log(`\n📊 Comparing ${entities.symbols.join(" vs ")}...\n`);
      await agent.prompt(prompt);
      return;
    }
    case "watchlist_or_tracking":
    case "general_finance_qa":
    case "unclassified":
    default:
      await agent.prompt(input);
      return;
  }
}

function askClarification(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`❓ ${question}\n> `, (answer) => {
      const trimmed = answer.trim();
      persistPreferences(trimmed);
      storage.insertMessage({
        sessionId: session.id,
        role: "user",
        contentText: trimmed,
        workflowType: currentWorkflow,
        messageIndex: messageIndex++,
      });
      chatLogger.log({ type: "user_message", payload: { text: trimmed, clarification: true } });
      resolve(trimmed);
    });
  });
}

function promptUser() {
  rl.question("> ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      promptUser();
      return;
    }
    if (trimmed === "exit" || trimmed === "quit") {
      chatLogger.log({ type: "session_end", payload: {} });
      storage.endSession(session.id, new Date().toISOString());
      console.log("Goodbye.");
      rl.close();
      process.exit(0);
    }

    const classification = classifyIntent(trimmed);
    await handleWorkflow(classification, trimmed);
  });
}

console.log("Vantage is ready. Type a message or 'exit' to quit.\n");
promptUser();

function summarizeAssistantMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function summarizeToolResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result.slice(0, 500);
  try {
    return JSON.stringify(result).slice(0, 500);
  } catch {
    return String(result).slice(0, 500);
  }
}
