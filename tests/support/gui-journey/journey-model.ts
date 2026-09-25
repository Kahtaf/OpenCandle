import type {
  ModelChatRequest,
  ModelScriptedReply,
} from "../../helpers/deterministic-model-server.js";

/**
 * Fixture-scripted model responses for the deterministic GUI journeys.
 *
 * These replies are synthesized at the transport boundary. They prove that the
 * real GUI/server/tool/session stack transports prompts, tool results, and
 * persisted events correctly; they are not evidence of model intelligence.
 */

export const QUOTE_PROMPT = "What is AAPL trading at?";
export const SECOND_PROMPT = "What is MSFT trading at?";
export const PREFERENCE_PROMPT = "I am an aggressive investor with a long time horizon.";
export const ASK_USER_PROMPT = "Ask me which horizon I want and then give the plan.";
/** Holds the router model response so the run is active before the router settles. */
export const CANCEL_PROMPT = "Hold the NVDA router while I think about it.";
/** Holds the native Pi answer stream (the main-agent text after the tool result). */
export const STREAM_HOLD_PROMPT = "Stream the NVDA answer slowly while I watch.";
/** The router and model respond quickly; the real quote tool fetch is held. */
export const TOOL_HOLD_PROMPT = "Hold the NVDA tool while I think about it.";

const AS_OF = "2026-07-15T20:00:00.000Z";

const QUOTE_VALUES: Record<string, number> = { AAPL: 189.42, MSFT: 512.34, NVDA: 185.25 };

export interface HoldGate {
  /** Resolves only after release() is called. */
  wait(): Promise<void>;
  release(): void;
  /** How many model requests actually waited on this gate. */
  readonly waitCount: number;
}

export function createHoldGate(): HoldGate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waitCount = 0;
  return {
    wait() {
      waitCount += 1;
      return promise;
    },
    release: () => release(),
    get waitCount() {
      return waitCount;
    },
  };
}

export function createJourneyModelScript(
  gates: { routerHold?: HoldGate; answerHold?: HoldGate } = {},
) {
  const { routerHold, answerHold } = gates;
  const script = async (request: ModelChatRequest): Promise<ModelScriptedReply> => {
    const flat = JSON.stringify(request.messages);

    if (flat.includes("routing agent")) {
      const turn = currentTurnText(request);
      if (turn.includes("Hold the NVDA router")) {
        // Early-Stop probe: the router response never settles, so the run is
        // genuinely active when the test presses Stop.
        if (routerHold) await routerHold.wait();
      }
      return { kind: "text", text: JSON.stringify(routerOutputFor(turn)) };
    }

    if (flat.includes("Write a 4-8 word title")) {
      const turn = latestUserText(request) ?? "";
      return { kind: "text", text: titleForPrompt(turn) };
    }

    const lastUserText = latestUserText(request) ?? "";
    // Only this turn's tool results count: an earlier stopped turn in the same
    // session can leave a tool result in history.
    const hasToolResult = currentTurnMessages(request).some((message) => message.role === "tool");
    if (!hasToolResult) {
      if (lastUserText.includes("Ask me which horizon")) {
        return {
          kind: "tool_call",
          id: "call-ask-user",
          name: "ask_user",
          arguments: {
            question: "Which horizon should the plan target?",
            question_type: "select",
            options: ["1 month", "1 year"],
            reason: "The plan depends on the horizon.",
          },
        };
      }
      const symbol = symbolForPrompt(lastUserText) ?? "AAPL";
      return {
        kind: "tool_call",
        id: "call-gui-quote",
        name: "get_stock_quote",
        arguments: { symbol },
      };
    }

    const toolText = toolResultText(request);
    if (toolText.includes("User answered:")) {
      const answer = toolText.split("User answered:")[1]?.trim() ?? "";
      return {
        kind: "text",
        text: `Plan for a ${answer} horizon: keep a diversified core and rebalance each quarter.`,
      };
    }
    for (const [symbol, price] of Object.entries(QUOTE_VALUES)) {
      if (toolText.includes(price.toFixed(2))) {
        const text = `${symbol} is trading at $${price.toFixed(2)} as of ${AS_OF}.`;
        // Native Pi answer stream hold: the main-agent text that follows the
        // real tool result. The first half of this answer flushes, then the
        // stream pauses, so Stop lands on the answer stream itself rather than
        // on the router response.
        if (symbol === "NVDA" && lastUserText.includes("Stream the NVDA answer")) {
          return { kind: "text", text, pause: answerHold?.wait() };
        }
        return { kind: "text", text };
      }
    }
    return {
      kind: "text",
      text: "The quote provider is unavailable; no price can be confirmed.",
    };
  };
  return script;
}

function routerOutputFor(turn: string): Record<string, unknown> {
  if (turn.includes("aggressive investor")) {
    return {
      routeKind: "agent_task",
      workflow: "general_finance_qa",
      entities: { symbols: [] },
      slots: {},
      preference_updates: [
        { key: "risk_profile", value: "aggressive", confidence: "high", source: "inferred" },
      ],
      missing_required: [],
      tool_bundles: [],
      diagnostics: [],
      reasoning: "Stable disposition stated in the turn.",
    };
  }
  const symbol = symbolForPrompt(turn);
  return {
    routeKind: "agent_task",
    workflow: "general_finance_qa",
    entities: { symbols: symbol ? [symbol] : [] },
    slots: {},
    preference_updates: [],
    missing_required: [],
    tool_bundles: symbol ? ["core_market"] : [],
    diagnostics: [],
    reasoning: "Simple request routed to the main agent.",
  };
}

function symbolForPrompt(text: string): string | undefined {
  for (const symbol of ["AAPL", "MSFT", "NVDA"]) {
    if (text.includes(symbol)) return symbol;
  }
  return undefined;
}

function titleForPrompt(text: string): string {
  if (text.includes("AAPL")) return "AAPL quote journey";
  if (text.includes("MSFT")) return "MSFT quote journey";
  if (text.includes("aggressive")) return "Aggressive investor profile";
  if (text.includes("Ask me which horizon")) return "Horizon plan";
  if (text.includes("Hold the NVDA router")) return "NVDA router hold probe";
  if (text.includes("Stream the NVDA answer")) return "NVDA answer hold probe";
  if (text.includes("Hold the NVDA tool")) return "NVDA tool hold probe";
  return "GUI journey session";
}

function currentTurnText(request: ModelChatRequest): string {
  const flat = request.messages.map(messageText).join("\n");
  const marker = "--- CURRENT TURN ---";
  const index = flat.lastIndexOf(marker);
  return index === -1 ? flat : flat.slice(index + marker.length).trim();
}

function latestUserText(request: ModelChatRequest): string | undefined {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === "user") {
      const text = messageText(message);
      if (text) return text;
    }
  }
  return undefined;
}

function currentTurnMessages(request: ModelChatRequest): ModelChatRequest["messages"] {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    if (request.messages[index]?.role === "user") return request.messages.slice(index + 1);
  }
  return request.messages;
}

function toolResultText(request: ModelChatRequest): string {
  return currentTurnMessages(request)
    .filter((message) => message.role === "tool")
    .map((message) => messageText(message))
    .join("\n");
}

/** Pi sends user turns as blocks (`[{type:"text",text}]`) and router prompts as plain strings. */
function messageText(message: ModelChatRequest["messages"][number]): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .flatMap((block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
          ? [(block as { text: string }).text]
          : [],
      )
      .join("");
  }
  return "";
}
