import * as readline from "node:readline";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { loadConfig } from "./config.js";
import { createAgent } from "./agent.js";
import { isAnalysisRequest, runComprehensiveAnalysis } from "./analysts/orchestrator.js";

const config = loadConfig();
const agent = createAgent(config);

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
      break;
    case "tool_execution_end":
      if (event.isError) {
        process.stdout.write(`❌ Error: ${JSON.stringify(event.result)}\n`);
      }
      break;
    case "agent_end":
      if (currentLine) {
        process.stdout.write("\n\n");
        currentLine = "";
      }
      promptUser();
      break;
  }
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptUser() {
  rl.question("> ", async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      promptUser();
      return;
    }
    if (trimmed === "exit" || trimmed === "quit") {
      console.log("Goodbye.");
      rl.close();
      process.exit(0);
    }

    // Check for comprehensive analysis trigger
    const analysis = isAnalysisRequest(trimmed);
    if (analysis.match && analysis.symbol) {
      console.log(`\n📊 Running comprehensive analysis for ${analysis.symbol}...\n`);
      await agent.prompt(`Begin comprehensive analysis of ${analysis.symbol}. Start by getting the current stock quote.`);
      runComprehensiveAnalysis(agent, analysis.symbol);
      return;
    }

    await agent.prompt(trimmed);
  });
}

console.log("Vantage is ready. Type a message or 'exit' to quit.\n");
promptUser();
