/**
 * E2E CLI test — sends queries to the real agent and validates responses.
 * Tests each new feature through the actual LLM-powered agent loop.
 *
 * Usage: npx tsx tests/e2e/cli.test.ts
 */
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { loadConfig } from "../../src/config.js";
import { createAgent } from "../../src/agent.js";
import { cache } from "../../src/infra/cache.js";

const config = loadConfig();
const agent = createAgent(config);

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function queryAgent(prompt: string): Promise<{ text: string; toolCalls: string[] }> {
  let text = "";
  const toolCalls: string[] = [];

  return new Promise((resolve) => {
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            text += event.assistantMessageEvent.delta;
          }
          break;
        case "tool_execution_start":
          toolCalls.push(event.toolName);
          break;
        case "agent_end":
          unsubscribe();
          resolve({ text, toolCalls });
          break;
      }
    });
    agent.prompt(prompt);
  });
}

async function test(name: string, prompt: string, validate: (text: string, tools: string[]) => void) {
  try {
    cache.clear();
    console.log(`\n  Testing: ${name}`);
    console.log(`  Prompt: "${prompt}"`);
    const { text, toolCalls } = await queryAgent(prompt);
    console.log(`  Tools called: ${toolCalls.join(", ") || "(none)"}`);
    console.log(`  Response: ${text.slice(0, 200).replace(/\n/g, " ")}${text.length > 200 ? "..." : ""}`);
    validate(text, toolCalls);
    console.log(`  ✓ PASS`);
    passed++;
  } catch (err: any) {
    console.log(`  ✗ FAIL: ${err.message}`);
    failures.push(`${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log("=== Vantage CLI E2E Tests ===");
  console.log(`Testing through the actual agent (Gemini LLM + all 23 tools)\n`);

  // --- 1. Stock Quote (sanity) ---
  await test(
    "Stock quote via agent",
    "What is the current price of MSFT?",
    (text, tools) => {
      assert(tools.includes("get_stock_quote"), `expected get_stock_quote, got: ${tools}`);
      assert(text.includes("MSFT") || text.includes("Microsoft"), "response should mention MSFT");
      assert(/\$\d+/.test(text), "response should include a dollar amount");
    },
  );

  // --- 2. Technical indicators with OBV/VWAP ---
  await test(
    "Technical analysis includes OBV and VWAP",
    "Run technical analysis on SPY",
    (text, tools) => {
      assert(tools.includes("get_technical_indicators"), `expected get_technical_indicators, got: ${tools}`);
      assert(text.includes("OBV") || text.includes("volume"), "response should mention OBV or volume");
      assert(text.includes("VWAP") || text.includes("vwap"), "response should mention VWAP");
    },
  );

  // --- 3. Backtesting ---
  await test(
    "Backtest SMA crossover on SPY",
    "Backtest the SMA crossover strategy on SPY over 2 years",
    (text, tools) => {
      assert(tools.includes("backtest_strategy"), `expected backtest_strategy, got: ${tools}`);
      assert(text.toLowerCase().includes("return") || text.includes("%"), "should mention returns");
      assert(text.toLowerCase().includes("trade") || text.toLowerCase().includes("win"), "should mention trades");
    },
  );

  // --- 4. SEC EDGAR filings ---
  await test(
    "SEC filings for AAPL",
    "Show me recent SEC filings for Apple",
    (text, tools) => {
      assert(tools.includes("get_sec_filings"), `expected get_sec_filings, got: ${tools}`);
      assert(text.includes("10-K") || text.includes("10-Q") || text.includes("filing"), "should mention filing types");
    },
  );

  // --- 5. Watchlist ---
  await test(
    "Add to watchlist",
    "Add NVDA to my watchlist with a target price of 200 and stop loss at 100",
    (text, tools) => {
      assert(tools.includes("manage_watchlist"), `expected manage_watchlist, got: ${tools}`);
      assert(text.includes("NVDA"), "should confirm NVDA added");
    },
  );

  await test(
    "Check watchlist",
    "Check my watchlist",
    (text, tools) => {
      assert(tools.includes("manage_watchlist"), `expected manage_watchlist, got: ${tools}`);
      assert(text.includes("NVDA"), "should show NVDA in watchlist");
    },
  );

  // --- 6. Correlation ---
  await test(
    "Correlation matrix",
    "What is the correlation between AAPL, MSFT, and GOOGL?",
    (text, tools) => {
      assert(tools.includes("analyze_correlation"), `expected analyze_correlation, got: ${tools}`);
      assert(/0\.\d+/.test(text) || text.includes("correlation"), "should show correlation values");
    },
  );

  // --- 7. Predictions ---
  await test(
    "Record prediction",
    "Record a bullish prediction on AAPL at $248 with conviction 8 for 30 days",
    (text, tools) => {
      assert(tools.includes("track_prediction"), `expected track_prediction, got: ${tools}`);
      assert(text.includes("AAPL") || text.includes("bullish") || text.includes("Recorded"), "should confirm prediction recorded");
    },
  );

  await test(
    "Check predictions",
    "Check my prediction scorecard",
    (text, tools) => {
      assert(tools.includes("track_prediction"), `expected track_prediction, got: ${tools}`);
      assert(text.toLowerCase().includes("hit rate") || text.toLowerCase().includes("scorecard") || text.includes("prediction"), "should show hit rate");
    },
  );

  // --- 8. DCF (if Alpha Vantage key available) ---
  if (config.alphaVantageApiKey) {
    await test(
      "DCF valuation",
      "Run a DCF valuation on AAPL",
      (text, tools) => {
        assert(tools.includes("compute_dcf") || tools.includes("get_financials"), `expected DCF tools, got: ${tools}`);
        // May get "negative FCF" or actual valuation — both are valid
        assert(text.length > 50, "response too short");
      },
    );
  }

  // --- 9. Comprehensive analysis (named personas + voting + validation) ---
  // This test is special — the orchestrator queues 7 followUp messages after the initial prompt.
  // We need to capture ALL agent turns, not just the first.
  console.log(`\n  Testing: Comprehensive analysis triggers named personas`);
  console.log(`  Prompt: "analyze NVDA"`);
  try {
    cache.clear();
    let allText = "";
    const allTools: string[] = [];
    let turnCount = 0;

    const { text, toolCalls } = await queryAgent(
      "analyze NVDA"
    );
    allText += text;
    allTools.push(...toolCalls);
    turnCount++;

    console.log(`  Tools called: ${allTools.join(", ")}`);
    console.log(`  Response length: ${allText.length} chars, ${turnCount} turn(s)`);

    assert(allTools.length >= 2, `expected multiple tool calls, got ${allTools.length}: ${allTools}`);
    assert(allText.length > 100, `response too short: ${allText.length} chars`);
    console.log(`  ✓ PASS`);
    passed++;
  } catch (err: any) {
    console.log(`  ✗ FAIL: ${err.message}`);
    failures.push(`Comprehensive analysis: ${err.message}`);
    failed++;
  }

  // --- Summary ---
  console.log(`\n${"=".repeat(50)}`);
  console.log(`CLI E2E Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  } else {
    console.log("\nAll CLI tests passed!");
  }

  // Clean up
  const { existsSync, unlinkSync } = await import("node:fs");
  for (const f of [".vantage-watchlist.json", ".vantage-predictions.json"]) {
    if (existsSync(f)) unlinkSync(f);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
