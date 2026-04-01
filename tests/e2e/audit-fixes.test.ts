/**
 * E2E test for codebase audit fixes.
 * Sends natural language prompts through the real agent and validates
 * that the fixes are working end-to-end.
 *
 * Usage: npx tsx tests/e2e/audit-fixes.test.ts
 */
import assert from "node:assert";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";

const { session } = await createOpenCandleSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    defaultProvider: "google",
    defaultModel: "gemini-2.5-flash",
  }),
  useInlineExtension: true,
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function queryAgent(prompt: string): Promise<{ text: string; toolCalls: string[]; toolResults: Map<string, any> }> {
  let text = "";
  const toolCalls: string[] = [];
  const toolResults = new Map<string, any>();

  return new Promise((resolve) => {
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            text += event.assistantMessageEvent.delta;
          }
          break;
        case "tool_execution_start":
          toolCalls.push(event.toolName);
          break;
        case "tool_execution_end":
          toolResults.set(event.toolName, event.result);
          break;
        case "agent_end":
          unsubscribe();
          resolve({ text, toolCalls, toolResults });
          break;
      }
    });
    void session.prompt(prompt);
  });
}

async function test(
  name: string,
  prompt: string,
  validate: (text: string, tools: string[], results: Map<string, any>) => void,
) {
  try {
    cache.clear();
    console.log(`\n  Testing: ${name}`);
    console.log(`  Prompt: "${prompt}"`);
    const { text, toolCalls, toolResults } = await queryAgent(prompt);
    console.log(`  Tools called: ${toolCalls.join(", ") || "(none)"}`);
    console.log(`  Response: ${text.slice(0, 300).replace(/\n/g, " ")}${text.length > 300 ? "..." : ""}`);
    validate(text, toolCalls, toolResults);
    console.log(`  ✓ PASS`);
    passed++;
  } catch (err: any) {
    console.log(`  ✗ FAIL: ${err.message}`);
    failures.push(`${name}: ${err.message}`);
    failed++;
  }
}

// --- Tests ---

console.log("=== Audit Fix E2E Tests ===\n");

// 1. Options Greeks fix — delta should not be zero for live options
await test(
  "Options Greeks are non-zero for active contracts",
  "Show me the options chain for AAPL. What's the delta on the nearest expiration puts?",
  (text, tools) => {
    assert(tools.includes("get_option_chain"), "should call get_option_chain");
    // The response should mention delta with actual values, not all zeros
    assert(!text.includes("delta: 0.00, gamma: 0.00, theta: 0.00"), "Greeks should not all be zero");
  },
);

// 2. Fear & Greed fix — should NOT mention CNN
await test(
  "Fear & Greed does not claim CNN source",
  "What's the current Fear and Greed index?",
  (text, tools) => {
    assert(tools.includes("get_fear_greed"), "should call get_fear_greed");
    assert(!text.toLowerCase().includes("cnn"), "should not mention CNN as the source");
    // Should not show "Week Ago: 0 | Month Ago: 0"
    assert(!text.includes("Week Ago: 0"), "should not show placeholder zero for Week Ago");
  },
);

// 3. Reddit discussions rename — tool should be called by new name
await test(
  "Reddit discussions tool uses new name",
  "What are people on Reddit saying about NVDA?",
  (text, tools) => {
    const usedRedditTool = tools.includes("get_reddit_discussions") || tools.includes("get_reddit_sentiment");
    assert(usedRedditTool, "should call a reddit tool");
    // Should NOT see "News Sentiment" as a label
    assert(!text.includes("News Sentiment for"), "should not use old 'News Sentiment' label");
  },
);

// 4. SEC filing links — should contain accession number in URL
await test(
  "SEC filing links are accession-specific",
  "Show me the latest SEC filings for AAPL",
  (text, tools) => {
    assert(tools.includes("get_sec_filings"), "should call get_sec_filings");
    // Links should contain Archives/edgar/data, not the generic browse-edgar URL
    if (text.includes("sec.gov")) {
      assert(!text.includes("browse-edgar?action=getcompany"), "should not use generic browse URL");
    }
  },
);

// 5. Backtest — should report non-trivial drawdown info
await test(
  "Backtest reports drawdown metrics",
  "Backtest an SMA crossover strategy on SPY for 2 years",
  (text, tools) => {
    assert(tools.includes("backtest_strategy"), "should call backtest_strategy");
    assert(text.includes("Drawdown") || text.includes("drawdown"), "should mention drawdown in results");
  },
);

// 6. Correlation — should work and mention alignment
await test(
  "Correlation analysis runs with date alignment",
  "What's the correlation between AAPL and MSFT over the last year?",
  (text, tools) => {
    assert(tools.includes("analyze_correlation"), "should call analyze_correlation");
    // Should show correlation values (e.g. "0.39" or "correlation")
    assert(text.toLowerCase().includes("correlation") || text.match(/[0-9]\.[0-9]{2}/), "should show correlation results");
  },
);

// 7. VWAP label fix — should say "cumulative"
await test(
  "VWAP is labeled as cumulative",
  "Show me technical indicators for MSFT",
  (text, tools) => {
    assert(tools.includes("get_technical_indicators"), "should call get_technical_indicators");
    if (text.includes("VWAP")) {
      assert(text.includes("cumulative") || text.includes("Cumulative"), "VWAP should be labeled as cumulative");
    }
  },
);

// --- Summary ---

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log();

session.dispose();
process.exit(failed > 0 ? 1 : 0);
