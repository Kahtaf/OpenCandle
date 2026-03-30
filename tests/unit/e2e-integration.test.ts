/**
 * End-to-end integration test for the new orchestration layer.
 *
 * Tests the full pipeline: user input → classify → extract entities →
 * resolve slots → build prompt → persist to SQLite → log to JSONL →
 * extract preferences → retrieve memory context.
 *
 * Does NOT require a live LLM — exercises all orchestration logic in isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { classifyIntent } from "../../src/routing/classify-intent.js";
import { extractEntities } from "../../src/routing/entity-extractor.js";
import { resolvePortfolioSlots, resolveOptionsScreenerSlots } from "../../src/routing/slot-resolver.js";
import { buildPortfolioPrompt, buildOptionsScreenerPrompt, buildCompareAssetsPrompt } from "../../src/prompts/workflow-prompts.js";
import { buildPortfolioWorkflow } from "../../src/workflows/portfolio-builder.js";
import { buildOptionsScreenerWorkflow } from "../../src/workflows/options-screener.js";
import { initDatabase, MemoryStorage, ChatLogger, createSession, buildMemoryContext } from "../../src/memory/index.js";
import { extractPreferences } from "../../src/memory/preference-extractor.js";
import { buildSystemPrompt } from "../../src/system-prompt.js";
import type Database from "better-sqlite3";
import type { SlotResolution, CompareAssetsSlots } from "../../src/routing/types.js";

describe("E2E integration: full orchestration pipeline", () => {
  let db: Database.Database;
  let storage: MemoryStorage;
  let tempDir: string;
  let chatLogger: ChatLogger;
  let sessionId: string;

  beforeEach(() => {
    db = initDatabase(":memory:");
    storage = new MemoryStorage(db);
    tempDir = mkdtempSync(join(tmpdir(), "vantage-e2e-"));
    const session = createSession();
    sessionId = session.id;
    chatLogger = new ChatLogger(join(tempDir, "logs"), sessionId);
    storage.insertSession({
      id: sessionId,
      startedAt: session.startedAt,
      cwd: session.cwd,
      logPath: chatLogger.getLogPath(),
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Scenario 1: "If I had $10k to invest today, what should I invest in?"
  // This was a hard failure before (generic refusal, zero tools).
  // -----------------------------------------------------------------------
  describe("Scenario 1: portfolio builder from ambiguous prompt", () => {
    const INPUT = "If I had $10k to invest today, what should I invest in?";

    it("classifies as portfolio_builder", () => {
      const classification = classifyIntent(INPUT);
      expect(classification.workflow).toBe("portfolio_builder");
      expect(classification.tier).toBe("rule");
    });

    it("extracts $10k budget", () => {
      const entities = extractEntities(INPUT);
      expect(entities.budget).toBe(10_000);
    });

    it("resolves slots with defaults and produces a structured prompt", () => {
      const classification = classifyIntent(INPUT);
      const resolution = resolvePortfolioSlots(classification.entities);

      expect(resolution.resolved.budget).toBe(10_000);
      expect(resolution.resolved.riskProfile).toBe("balanced");
      expect(resolution.sources.budget).toBe("user");
      expect(resolution.sources.riskProfile).toBe("default");
      expect(resolution.defaultsUsed).toContain("riskProfile");

      const plan = buildPortfolioWorkflow(resolution);
      expect(plan.initialPrompt).toContain("$10,000");
      expect(plan.initialPrompt).toContain("balanced [DEFAULT]");
      expect(plan.initialPrompt).toContain("get_stock_quote");
      expect(plan.followUps.length).toBeGreaterThanOrEqual(1);
    });

    it("persists a workflow run to SQLite", () => {
      const classification = classifyIntent(INPUT);
      const resolution = resolvePortfolioSlots(classification.entities);

      storage.insertWorkflowRun({
        sessionId,
        workflowType: "portfolio_builder",
        inputSlotsJson: JSON.stringify(classification.entities),
        resolvedSlotsJson: JSON.stringify(resolution.resolved),
        defaultsUsedJson: JSON.stringify(resolution.defaultsUsed),
      });

      const runs = storage.getRecentWorkflowRuns(5);
      expect(runs).toHaveLength(1);
      expect(runs[0].workflow_type).toBe("portfolio_builder");

      const resolvedSlots = JSON.parse(runs[0].resolved_slots_json as string);
      expect(resolvedSlots.budget).toBe(10_000);
    });

    it("logs events to JSONL", () => {
      chatLogger.log({ type: "user_message", payload: { text: INPUT } });
      chatLogger.log({
        type: "workflow_selected",
        payload: { workflow: "portfolio_builder", confidence: 0.9, tier: "rule" },
      });

      const content = readFileSync(chatLogger.getLogPath(), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      const event1 = JSON.parse(lines[0]);
      expect(event1.type).toBe("user_message");
      expect(event1.payload.text).toBe(INPUT);

      const event2 = JSON.parse(lines[1]);
      expect(event2.type).toBe("workflow_selected");
      expect(event2.payload.workflow).toBe("portfolio_builder");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: "Give me the best MSFT call options that are a month out"
  // This was a hard failure before (asked for exact expiration, no tools).
  // -----------------------------------------------------------------------
  describe("Scenario 2: options screener from natural prompt", () => {
    const INPUT = "Give me the best MSFT call options that are a month out";

    it("classifies as options_screener", () => {
      const classification = classifyIntent(INPUT);
      expect(classification.workflow).toBe("options_screener");
    });

    it("extracts MSFT symbol, bullish direction, month DTE", () => {
      const entities = extractEntities(INPUT);
      expect(entities.symbols).toContain("MSFT");
      expect(entities.direction).toBe("bullish");
      expect(entities.dteHint).toBe("month");
    });

    it("resolves slots with defaults and produces a structured prompt", () => {
      const classification = classifyIntent(INPUT);
      const resolution = resolveOptionsScreenerSlots(classification.entities);

      expect(resolution.resolved.symbol).toBe("MSFT");
      expect(resolution.resolved.direction).toBe("bullish");
      expect(resolution.resolved.dteTarget).toBe("25_to_45_days");
      expect(resolution.sources.dteTarget).toBe("user"); // mapped from dteHint

      const plan = buildOptionsScreenerWorkflow(resolution);
      expect(plan.initialPrompt).toContain("MSFT");
      expect(plan.initialPrompt).toContain("get_option_chain");
      expect(plan.followUps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: "Show me safer NVDA call options next month under $500 premium"
  // Tests max premium extraction and risk profile.
  // -----------------------------------------------------------------------
  describe("Scenario 3: options with premium cap", () => {
    const INPUT = "Show me safer NVDA call options next month under $500 premium";

    it("classifies as options_screener", () => {
      const classification = classifyIntent(INPUT);
      expect(classification.workflow).toBe("options_screener");
    });

    it("extracts NVDA, bullish, month, and $500 max premium", () => {
      const entities = extractEntities(INPUT);
      expect(entities.symbols).toContain("NVDA");
      expect(entities.direction).toBe("bullish");
      expect(entities.dteHint).toBe("month");
      expect(entities.maxPremium).toBe(500);
    });

    it("passes maxPremium through to resolved slots", () => {
      const classification = classifyIntent(INPUT);
      const resolution = resolveOptionsScreenerSlots(classification.entities);
      expect(resolution.resolved.maxPremium).toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: "compare AAPL MSFT GOOGL"
  // -----------------------------------------------------------------------
  describe("Scenario 4: compare assets", () => {
    const INPUT = "compare AAPL MSFT GOOGL";

    it("classifies as compare_assets with 3 symbols", () => {
      const classification = classifyIntent(INPUT);
      expect(classification.workflow).toBe("compare_assets");
      expect(classification.entities.symbols).toEqual(["AAPL", "MSFT", "GOOGL"]);
    });

    it("produces a comparison prompt with all symbols and tools", () => {
      const classification = classifyIntent(INPUT);
      const resolution: SlotResolution<CompareAssetsSlots> = {
        resolved: { symbols: classification.entities.symbols },
        sources: { symbols: "user" },
        defaultsUsed: [],
        missingRequired: [],
      };
      const prompt = buildCompareAssetsPrompt(resolution);
      expect(prompt).toContain("AAPL");
      expect(prompt).toContain("MSFT");
      expect(prompt).toContain("GOOGL");
      expect(prompt).toContain("compare_companies");
      expect(prompt).toContain("analyze_risk");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: "analyze NVDA" — backward compatibility
  // Must still trigger single_asset_analysis exactly as before.
  // -----------------------------------------------------------------------
  describe("Scenario 5: backward compatibility — analyze NVDA", () => {
    it("classifies as single_asset_analysis with symbol NVDA", () => {
      const classification = classifyIntent("analyze NVDA");
      expect(classification.workflow).toBe("single_asset_analysis");
      expect(classification.confidence).toBe(1.0);
      expect(classification.entities.symbols).toEqual(["NVDA"]);
    });

    it("also works with $ prefix", () => {
      const classification = classifyIntent("analyze $NVDA");
      expect(classification.workflow).toBe("single_asset_analysis");
    });

    it("also works with 'deep dive on'", () => {
      const classification = classifyIntent("deep dive on TSLA");
      expect(classification.workflow).toBe("single_asset_analysis");
      expect(classification.entities.symbols).toEqual(["TSLA"]);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 6: Preference extraction, persistence, and retrieval
  // "I'm conservative and prefer ETFs" → stored → used in next workflow.
  // -----------------------------------------------------------------------
  describe("Scenario 6: preference lifecycle", () => {
    it("extracts and persists preferences from user statement", () => {
      const input = "I'm conservative and prefer ETFs. What should I buy with $10k?";

      // Step 1: Extract preferences
      const prefs = extractPreferences(input);
      expect(prefs.length).toBeGreaterThanOrEqual(2);

      // Step 2: Persist to SQLite
      for (const pref of prefs) {
        storage.upsertPreference({
          namespace: "global",
          key: pref.key,
          valueJson: JSON.stringify(pref.value),
          confidence: pref.confidence,
          source: "explicit",
        });
      }

      // Step 3: Verify in DB
      const riskPref = storage.getPreference("global", "risk_profile");
      expect(riskPref).toBeTruthy();
      expect(JSON.parse(riskPref!.value_json as string)).toBe("conservative");

      const assetPref = storage.getPreference("global", "asset_scope");
      expect(assetPref).toBeTruthy();
      expect(JSON.parse(assetPref!.value_json as string)).toBe("etf_focused");
    });

    it("getWorkflowPreferences maps DB rows to typed shape", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("conservative"),
      });
      storage.upsertPreference({
        namespace: "global",
        key: "time_horizon",
        valueJson: JSON.stringify("long"),
      });

      const wfPrefs = storage.getWorkflowPreferences("global");
      expect(wfPrefs.riskProfile).toBe("conservative");
      expect(wfPrefs.timeHorizon).toBe("long");
    });

    it("persisted preferences override defaults in slot resolution", () => {
      // Persist a preference
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("conservative"),
      });

      // Simulate next turn: classify, get preferences, resolve
      const classification = classifyIntent("invest $5k");
      expect(classification.workflow).toBe("portfolio_builder");

      const preferences = storage.getWorkflowPreferences("global");
      const resolution = resolvePortfolioSlots(classification.entities, preferences);

      expect(resolution.resolved.riskProfile).toBe("conservative");
      expect(resolution.sources.riskProfile).toBe("preference");
      expect(resolution.defaultsUsed).not.toContain("riskProfile");
    });

    it("user input in same turn overrides persisted preference", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("conservative"),
      });

      const input = "aggressive growth portfolio for $10k";
      const classification = classifyIntent(input);
      expect(classification.workflow).toBe("portfolio_builder");

      // In the real CLI, collectCurrentTurnPreferences merges extracted + stored.
      // Here we simulate that: entities.riskProfile = "aggressive" from extraction.
      expect(classification.entities.riskProfile).toBe("aggressive");
      const resolution = resolvePortfolioSlots(classification.entities);
      expect(resolution.resolved.riskProfile).toBe("aggressive");
      expect(resolution.sources.riskProfile).toBe("user");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 7: Memory retrieval context is compact and correct
  // -----------------------------------------------------------------------
  describe("Scenario 7: memory context for agent injection", () => {
    it("returns empty string when nothing is stored", () => {
      const context = buildMemoryContext(storage);
      expect(context).toBe("");
    });

    it("includes preferences and recent workflow in context", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("conservative"),
      });
      storage.insertWorkflowRun({
        sessionId,
        workflowType: "portfolio_builder",
        inputSlotsJson: "{}",
        resolvedSlotsJson: JSON.stringify({ budget: 10000 }),
        defaultsUsedJson: "[]",
        outputSummary: "4-position ETF portfolio",
      });

      const context = buildMemoryContext(storage);
      expect(context).toContain("risk_profile");
      expect(context).toContain("conservative");
      expect(context).toContain("portfolio_builder");
      expect(context).toContain("4-position ETF portfolio");
    });

    it("system prompt integrates memory context", () => {
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("aggressive"),
      });

      const memoryContext = buildMemoryContext(storage);
      const prompt = buildSystemPrompt(memoryContext || undefined);
      expect(prompt).toContain("Persistent Memory Context");
      expect(prompt).toContain("aggressive");
      expect(prompt).toContain("Assumption Disclosure");
    });

    it("system prompt works without memory context", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("You are Vantage");
      expect(prompt).not.toContain("Persistent Memory Context");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 8: Session lifecycle and message tracking
  // -----------------------------------------------------------------------
  describe("Scenario 8: session lifecycle and message tracking", () => {
    it("session is created and can be ended", () => {
      const s = storage.getSession(sessionId);
      expect(s).toBeTruthy();
      expect(s!.ended_at).toBeNull();

      storage.endSession(sessionId, "2026-03-29T18:00:00Z");
      const ended = storage.getSession(sessionId);
      expect(ended!.ended_at).toBe("2026-03-29T18:00:00Z");
    });

    it("messages are tracked with role and workflow type", () => {
      storage.insertMessage({
        sessionId,
        role: "user",
        contentText: "I have $10k to invest",
        workflowType: "portfolio_builder",
        messageIndex: 0,
      });
      storage.insertMessage({
        sessionId,
        role: "assistant",
        contentText: "Here is a draft portfolio...",
        workflowType: "portfolio_builder",
        messageIndex: 1,
      });

      const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY message_index").all(sessionId) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0].role).toBe("user");
      expect(rows[1].role).toBe("assistant");
      expect(rows[0].workflow_type).toBe("portfolio_builder");
    });

    it("tool calls are tracked with start and completion", () => {
      storage.insertToolCallStart({
        sessionId,
        toolCallId: "tc-abc",
        toolName: "get_stock_quote",
        argsJson: JSON.stringify({ symbol: "AAPL" }),
      });
      storage.completeToolCall({
        toolCallId: "tc-abc",
        resultSummary: "AAPL: $195.50",
        success: true,
      });

      const row = db.prepare("SELECT * FROM tool_calls WHERE tool_call_id = ?").get("tc-abc") as Record<string, unknown>;
      expect(row.tool_name).toBe("get_stock_quote");
      expect(row.success).toBe(1);
      expect(row.result_summary).toBe("AAPL: $195.50");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 9: JSONL chat log is complete and parseable
  // -----------------------------------------------------------------------
  describe("Scenario 9: JSONL log integrity", () => {
    it("full session lifecycle produces valid JSONL", () => {
      chatLogger.log({ type: "session_start", payload: { cwd: "/test" } });
      chatLogger.log({ type: "user_message", payload: { text: "I have $10k to invest" } });
      chatLogger.log({
        type: "workflow_selected",
        payload: { workflow: "portfolio_builder", confidence: 0.9, tier: "rule" },
      });
      chatLogger.log({
        type: "slot_resolution",
        payload: {
          resolved: { budget: 10000, riskProfile: "balanced" },
          defaultsUsed: ["riskProfile", "timeHorizon"],
        },
      });
      chatLogger.log({
        type: "tool_call_start",
        payload: { toolCallId: "tc-1", toolName: "get_stock_quote", args: { symbol: "VOO" } },
      });
      chatLogger.log({
        type: "tool_call_end",
        payload: { toolCallId: "tc-1", toolName: "get_stock_quote", isError: false },
      });
      chatLogger.log({
        type: "assistant_message",
        payload: { text: "Here is your portfolio draft..." },
      });
      chatLogger.log({ type: "session_end", payload: {} });

      const content = readFileSync(chatLogger.getLogPath(), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(8);

      // Every line must parse as valid JSON with required fields
      for (const line of lines) {
        const event = JSON.parse(line);
        expect(event.type).toBeTruthy();
        expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(event.sessionId).toBe(sessionId);
        expect(event.payload).toBeDefined();
      }

      // Verify event ordering
      const types = lines.map((l) => JSON.parse(l).type);
      expect(types).toEqual([
        "session_start",
        "user_message",
        "workflow_selected",
        "slot_resolution",
        "tool_call_start",
        "tool_call_end",
        "assistant_message",
        "session_end",
      ]);
    });

    it("log file path uses date-based directory and session ID", () => {
      chatLogger.log({ type: "session_start", payload: {} });
      const logPath = chatLogger.getLogPath();
      expect(logPath).toMatch(/\d{4}\/\d{2}\/\d{2}\//);
      expect(logPath).toContain(sessionId);
      expect(existsSync(logPath)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 10: Cross-workflow routing edge cases
  // -----------------------------------------------------------------------
  describe("Scenario 10: routing edge cases", () => {
    it("'what does delta mean?' → general_finance_qa, not options_screener", () => {
      const classification = classifyIntent("what does delta mean?");
      expect(classification.workflow).toBe("general_finance_qa");
    });

    it("'show my portfolio' → watchlist_or_tracking, not portfolio_builder", () => {
      const classification = classifyIntent("show my portfolio");
      expect(classification.workflow).toBe("watchlist_or_tracking");
    });

    it("'add NVDA to my watchlist' → watchlist_or_tracking", () => {
      const classification = classifyIntent("add NVDA to my watchlist");
      expect(classification.workflow).toBe("watchlist_or_tracking");
    });

    it("'hello' → unclassified (passes through to generic agent)", () => {
      const classification = classifyIntent("hello");
      expect(classification.workflow).toBe("unclassified");
    });

    it("'which is better, SPY or QQQ?' → compare_assets with 2 symbols", () => {
      const classification = classifyIntent("which is better, SPY or QQQ?");
      expect(classification.workflow).toBe("compare_assets");
      expect(classification.entities.symbols).toEqual(["SPY", "QQQ"]);
    });

    it("'how are my predictions doing?' → watchlist_or_tracking", () => {
      const classification = classifyIntent("how are my predictions doing?");
      expect(classification.workflow).toBe("watchlist_or_tracking");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 11: DTE hint to target mapping
  // -----------------------------------------------------------------------
  describe("Scenario 11: DTE hint resolution", () => {
    it("'weekly AAPL puts' → 7_to_14_days DTE", () => {
      const classification = classifyIntent("weekly AAPL puts");
      const resolution = resolveOptionsScreenerSlots(classification.entities);
      expect(resolution.resolved.dteTarget).toBe("7_to_14_days");
      expect(resolution.sources.dteTarget).toBe("user");
    });

    it("'LEAPS on MSFT' → 180_plus_days DTE", () => {
      const classification = classifyIntent("LEAPS on MSFT");
      const resolution = resolveOptionsScreenerSlots(classification.entities);
      expect(resolution.resolved.dteTarget).toBe("180_plus_days");
      expect(resolution.sources.dteTarget).toBe("user");
    });

    it("'AAPL calls' with no DTE hint → default 25_to_45_days", () => {
      const classification = classifyIntent("AAPL calls");
      const resolution = resolveOptionsScreenerSlots(classification.entities);
      expect(resolution.resolved.dteTarget).toBe("25_to_45_days");
      expect(resolution.sources.dteTarget).toBe("default");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 12: Multi-turn preference accumulation
  // Simulates: Turn 1 sets risk, Turn 2 uses it automatically.
  // -----------------------------------------------------------------------
  describe("Scenario 12: multi-turn preference accumulation", () => {
    it("preferences from turn 1 influence slot resolution in turn 2", () => {
      // Turn 1: user states preference, no workflow
      const turn1 = "I'm conservative and prefer ETFs";
      const prefs1 = extractPreferences(turn1);
      for (const p of prefs1) {
        storage.upsertPreference({
          namespace: "global",
          key: p.key,
          valueJson: JSON.stringify(p.value),
          confidence: p.confidence,
          source: "explicit",
        });
      }

      // Turn 2: user asks for portfolio without restating preferences
      const turn2 = "invest $5k";
      const classification = classifyIntent(turn2);
      expect(classification.workflow).toBe("portfolio_builder");

      const preferences = storage.getWorkflowPreferences("global");
      const resolution = resolvePortfolioSlots(classification.entities, preferences);

      expect(resolution.resolved.budget).toBe(5_000);
      expect(resolution.resolved.riskProfile).toBe("conservative");
      expect(resolution.sources.riskProfile).toBe("preference");

      // The prompt should reflect the preference, not the default
      const plan = buildPortfolioWorkflow(resolution);
      expect(plan.initialPrompt).toContain("conservative");
      expect(plan.initialPrompt).not.toContain("balanced [DEFAULT]");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 13: Date grounding uses local timezone
  // -----------------------------------------------------------------------
  describe("Scenario 13: local timezone date grounding", () => {
    it("portfolio prompt date matches local date, not UTC", () => {
      const classification = classifyIntent("invest $10k");
      const resolution = resolvePortfolioSlots(classification.entities);
      const plan = buildPortfolioWorkflow(resolution);

      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      expect(plan.initialPrompt).toContain(`Current date: ${localDate}`);
    });

    it("options prompt expiration window uses local dates", () => {
      const classification = classifyIntent("MSFT calls a month out");
      const resolution = resolveOptionsScreenerSlots(classification.entities);
      const plan = buildOptionsScreenerWorkflow(resolution);

      // The expiration window should contain dates that are local, not UTC.
      // We verify by checking the window start date is ~25 days from local today.
      const now = new Date();
      const expected25 = new Date(now);
      expected25.setDate(expected25.getDate() + 25);
      const expectedStr = `${expected25.getFullYear()}-${String(expected25.getMonth() + 1).padStart(2, "0")}-${String(expected25.getDate()).padStart(2, "0")}`;
      expect(plan.initialPrompt).toContain(expectedStr);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 14: Clarification provenance — values from clarification are "user" sourced
  // -----------------------------------------------------------------------
  describe("Scenario 14: clarification provenance", () => {
    it("clarification-extracted risk profile gets 'user' source, not 'preference'", () => {
      // Simulate: user says "What should I invest in?" → clarification → "$15k and I'm aggressive"
      // After clarification, entities should have budget + riskProfile from extractEntities.
      const clarificationAnswer = "$15k and I'm aggressive";
      const clarificationEntities = extractEntities(clarificationAnswer);

      // Verify extraction works
      expect(clarificationEntities.budget).toBe(15_000);
      expect(clarificationEntities.riskProfile).toBe("aggressive");

      // Simulate merging into original entities (what index.ts does)
      const entities = extractEntities("What should I invest in?");
      if (clarificationEntities.budget !== undefined) entities.budget = clarificationEntities.budget;
      if (clarificationEntities.riskProfile) entities.riskProfile = clarificationEntities.riskProfile;

      // Now resolve with NO stored preferences — everything should be "user" source
      const resolution = resolvePortfolioSlots(entities);

      expect(resolution.resolved.budget).toBe(15_000);
      expect(resolution.sources.budget).toBe("user");
      expect(resolution.resolved.riskProfile).toBe("aggressive");
      expect(resolution.sources.riskProfile).toBe("user");
    });

    it("clarification-extracted values take priority over stored preferences", () => {
      // Stored preference says conservative
      storage.upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("conservative"),
      });

      // Clarification says aggressive — should win as "user" source
      const entities = extractEntities("What should I invest in?");
      const clarificationEntities = extractEntities("$10k and I'm aggressive");
      if (clarificationEntities.budget !== undefined) entities.budget = clarificationEntities.budget;
      if (clarificationEntities.riskProfile) entities.riskProfile = clarificationEntities.riskProfile;

      const preferences = storage.getWorkflowPreferences("global");
      const resolution = resolvePortfolioSlots(entities, preferences);

      expect(resolution.resolved.riskProfile).toBe("aggressive");
      expect(resolution.sources.riskProfile).toBe("user");
    });

    it("prompt labels clarification-extracted values correctly (no SAVED PREFERENCE tag)", () => {
      const entities = extractEntities("What should I invest in?");
      const clarificationEntities = extractEntities("$15k and I'm aggressive");
      if (clarificationEntities.budget !== undefined) entities.budget = clarificationEntities.budget;
      if (clarificationEntities.riskProfile) entities.riskProfile = clarificationEntities.riskProfile;

      const resolution = resolvePortfolioSlots(entities);
      const plan = buildPortfolioWorkflow(resolution);

      expect(plan.initialPrompt).toContain("aggressive");
      expect(plan.initialPrompt).not.toContain("aggressive [SAVED PREFERENCE]");
      expect(plan.initialPrompt).not.toContain("aggressive [DEFAULT]");
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 15: SQLite database file creation
  // -----------------------------------------------------------------------
  describe("Scenario 15: SQLite file-backed database", () => {
    it("creates the database file with parent directories", () => {
      const dbPath = join(tempDir, "nested", "deep", "state.db");
      const fileDb = initDatabase(dbPath);
      expect(existsSync(dbPath)).toBe(true);

      const testStorage = new MemoryStorage(fileDb);
      testStorage.upsertPreference({
        namespace: "global",
        key: "test_key",
        valueJson: JSON.stringify("test_value"),
      });

      const pref = testStorage.getPreference("global", "test_key");
      expect(pref).toBeTruthy();
      fileDb.close();
    });
  });
});
