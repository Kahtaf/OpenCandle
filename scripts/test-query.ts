import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { loadConfig } from "../src/config.js";
import { createAgent } from "../src/agent.js";

const query = process.argv[2] || "Tell me about MSFT";

const config = loadConfig();
const agent = createAgent(config);

agent.subscribe((event: AgentEvent) => {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") {
        process.stdout.write(e.delta);
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
      process.stdout.write("\n");
      process.exit(0);
      break;
  }
});

console.log(`\n> ${query}\n`);
await agent.prompt(query);
