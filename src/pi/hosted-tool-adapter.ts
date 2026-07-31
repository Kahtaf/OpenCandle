import { getHostedBrowserCapabilityReport } from "../onboarding/providers.js";
import { eventProbabilitiesTool } from "../tools/macro/event-probabilities.js";
import { agentToolToPiTool } from "./tool-adapter-core.js";

const HOSTED_TOOLS = [
  {
    tool: eventProbabilitiesTool,
    providers: ["polymarket"],
  },
] as const;

/** Model-visible hosted tools. Unknown tools and non-direct provider paths are omitted. */
export function getHostedOpenCandleToolDefinitions() {
  const direct = new Set(getHostedBrowserCapabilityReport().direct.map((provider) => provider.id));
  return HOSTED_TOOLS.filter(({ providers }) =>
    providers.every((provider) => direct.has(provider)),
  ).map(({ tool }) => agentToolToPiTool(tool));
}
