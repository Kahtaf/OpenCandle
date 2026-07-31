export interface ProbeRequest {
  question: string;
  provider: "google" | "openai" | "anthropic";
  modelId: string;
  runModel: boolean;
}

export type ParsedProbeRequest = ProbeRequest;

export interface SessionRequest {
  question: string;
  provider: "openai";
  modelId: "gpt-4.1-mini";
}

export type GuiRequest =
  | {
      action:
        | "bootstrap"
        | "new_session"
        | "market_state"
        | "market_quotes"
        | "market_indices"
        | "diagnostics";
    }
  | { action: "instrument_search"; query: string }
  | { action: "instrument_quote"; symbol: string }
  | { action: "instrument_history"; symbol: string; range: string }
  | { action: "instrument_endpoint"; endpoint: string; symbol: string }
  | {
      action: "configure_model";
      provider: "openai";
      modelId: "gpt-4.1-mini";
      apiKey: string;
    }
  | { action: "load_session" | "delete_session"; sessionId: string }
  | { action: "rename_session"; sessionId: string; name: string }
  | {
      action: "tool_invoke";
      toolName: string;
      sessionId: string;
      actionId: string;
      args: Record<string, unknown>;
    }
  | {
      action: "chat_run";
      sessionId: string;
      actionId: string;
      prompt: string;
    };

const MODEL_ENVIRONMENT = {
  google: { modelId: "gemini-2.5-flash", envVar: "GEMINI_API_KEY" },
  openai: { modelId: "gpt-4.1-mini", envVar: "OPENAI_API_KEY" },
  anthropic: { modelId: "claude-haiku-4-5", envVar: "ANTHROPIC_API_KEY" },
} as const;

export function parseTrustedHostOrigin(value: string | undefined): string {
  const error = new Error("OPENCANDLE_SPIKE_HOST_ORIGIN must be an exact HTTP(S) origin");
  if (!value) throw error;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value) {
      throw error;
    }
    return url.origin;
  } catch {
    throw error;
  }
}

export function createBridgePolicy(hostOrigin: string, nonce: string): string {
  const trustedOrigin = parseTrustedHostOrigin(hostOrigin);
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) throw new Error("Bridge nonce is invalid");
  return [
    "default-src 'none'",
    // WebContainer injects its same-origin preview runtime and one inline bootstrap script.
    // RPC authorization still fails closed on parent source, exact origin, channel, epoch,
    // bounded request IDs, and the operation allowlist below.
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${trustedOrigin}`,
  ].join("; ");
}

export function createBridgeDocument(hostOrigin: string, nonce: string, runtimeEpoch = "00000000000000000000000000000000"): string {
  const trustedOrigin = parseTrustedHostOrigin(hostOrigin);
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) throw new Error("Bridge nonce is invalid");
  if (!/^[a-f0-9]{32}$/.test(runtimeEpoch)) throw new Error("Runtime epoch is invalid");
  const originLiteral = JSON.stringify(trustedOrigin);
  const epochLiteral = JSON.stringify(runtimeEpoch);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>OpenCandle runtime bridge</title></head>
<body>
<script nonce="${nonce}">
(() => {
  "use strict";
  const trustedHostOrigin = ${originLiteral};
  const runtimeEpoch = ${epochLiteral};
  const channel = "opencandle-browser-runtime-v1";
  const maxResponseCharacters = 1500000;
  const allowedOperations = new Set(["health", "probe", "session", "gui", "gui-stream"]);
  const activeStreams = new Map();
  const send = (message) => parent.postMessage({ channel, runtimeEpoch, ...message }, trustedHostOrigin);

  addEventListener("message", async (event) => {
    if (event.origin !== trustedHostOrigin || event.source !== parent) return;
    const message = event.data;
    if (!message || typeof message !== "object" || message.channel !== channel || message.runtimeEpoch !== runtimeEpoch) return;
    if (message.type === "cancel" && typeof message.requestId === "string") {
      activeStreams.get(message.requestId)?.abort();
      activeStreams.delete(message.requestId);
      return;
    }
    const { operation, requestId } = message;
    if (!allowedOperations.has(operation)) return;
    if (typeof requestId !== "string" || !/^[a-f0-9]{32}$/.test(requestId)) return;
    try {
      const controller = new AbortController();
      if (operation === "gui-stream") activeStreams.set(requestId, controller);
      const response = await fetch(operation === "health" ? "/health" : "/" + operation, {
        method: operation === "health" ? "GET" : "POST",
        credentials: "omit",
        ...(operation !== "health" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.payload),
        } : {}),
        signal: controller.signal,
      });
      if (operation === "gui-stream") {
        if (response.ok && response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            send({ type: "stream-chunk", requestId, value: Array.from(value) });
          }
          activeStreams.delete(requestId);
          send({ type: "stream-end", requestId, ok: true });
          return;
        }
        const failure = await response.json().catch(() => ({ error: "Runtime stream failed" }));
        activeStreams.delete(requestId);
        send({ type: "stream-end", requestId, ok: false, status: response.status, error: failure.error });
        return;
      }
      const result = await response.json();
      const serialized = JSON.stringify(result);
      if (serialized.length > maxResponseCharacters) throw new Error("Runtime response is too large");
      send({ type: "response", requestId, ok: response.ok, status: response.status, result });
    } catch (error) {
      activeStreams.delete(requestId);
      const text = error instanceof Error ? error.message : "Bridge request failed";
      send({ type: operation === "gui-stream" ? "stream-end" : "response", requestId, ok: false, status: 0, error: text.slice(0, 240) });
    }
  });

  send({ type: "ready" });
})();
</script>
</body></html>`;
}

export function parseProbeRequest(
  value: unknown,
  environment: Record<string, string | undefined>,
): ParsedProbeRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request must be a JSON object");
  }
  const request = value as Record<string, unknown>;
  const question = typeof request.question === "string" ? request.question.trim() : "";
  if (!question) throw new Error("Question must not be blank");
  if (question.length > 500) throw new Error("Question must be 500 characters or fewer");
  const provider = request.provider;
  const modelId = request.modelId;
  if (
    (provider !== "google" && provider !== "openai" && provider !== "anthropic") ||
    modelId !== MODEL_ENVIRONMENT[provider].modelId
  ) {
    throw new Error("Unsupported provider or model");
  }
  const runModel = request.runModel === true;
  if (runModel && provider !== "openai") {
    throw new Error("Browser model probe currently supports OpenAI only");
  }
  if (runModel && !environment[MODEL_ENVIRONMENT[provider].envVar]?.trim()) {
    throw new Error("Model probe requires a configured model key");
  }

  return {
    question,
    provider,
    modelId,
    runModel,
  };
}

export function parseSessionRequest(
  value: unknown,
  environment: Record<string, string | undefined>,
): SessionRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request must be a JSON object");
  }
  const request = value as Record<string, unknown>;
  const question = parseQuestion(request.question);
  if (request.provider !== "openai" || request.modelId !== MODEL_ENVIRONMENT.openai.modelId) {
    throw new Error("Browser Pi session currently supports OpenAI only");
  }
  if (!environment.OPENAI_API_KEY?.trim()) {
    throw new Error("Pi session requires a configured model key");
  }
  return {
    question,
    provider: "openai",
    modelId: MODEL_ENVIRONMENT.openai.modelId,
  };
}

export function parseGuiRequest(value: unknown): GuiRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Hosted GUI request must be a JSON object");
  }
  const request = value as Record<string, unknown>;
  switch (request.action) {
    case "bootstrap":
    case "new_session":
    case "market_state":
    case "market_quotes":
    case "market_indices":
    case "diagnostics":
      return { action: request.action };
    case "configure_model": {
      if (request.provider !== "openai" || request.modelId !== MODEL_ENVIRONMENT.openai.modelId) {
        throw new Error("Hosted model configuration supports OpenAI GPT-4.1 mini only");
      }
      if (typeof request.apiKey !== "string" || request.apiKey.length > 512) {
        throw new Error("Hosted OpenAI key is invalid");
      }
      return {
        action: request.action,
        provider: "openai",
        modelId: MODEL_ENVIRONMENT.openai.modelId,
        apiKey: request.apiKey,
      };
    }
    case "instrument_search": {
      const query = parseBoundedString(request.query, "query", 120);
      return { action: request.action, query };
    }
    case "instrument_quote":
      return { action: request.action, symbol: parseSymbol(request.symbol) };
    case "instrument_history":
      return {
        action: request.action,
        symbol: parseSymbol(request.symbol),
        range: parseBoundedString(request.range, "range", 20),
      };
    case "instrument_endpoint":
      return {
        action: request.action,
        endpoint: parseBoundedString(request.endpoint, "endpoint", 40),
        symbol: parseSymbol(request.symbol),
      };
    case "load_session":
    case "delete_session":
      return {
        action: request.action,
        sessionId: parseSessionId(request.sessionId),
      };
    case "rename_session": {
      const name = typeof request.name === "string" ? request.name.trim() : "";
      if (!name || name.length > 160) {
        throw new Error("Session name must be between 1 and 160 characters");
      }
      return {
        action: request.action,
        sessionId: parseSessionId(request.sessionId),
        name,
      };
    }
    case "chat_run": {
      if (request.images !== undefined || request.attachments !== undefined) {
        throw new Error("Hosted OpenCandle does not support chat attachments yet");
      }
      const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
      if (!prompt) throw new Error("Question must not be blank");
      if (prompt.length > 4_000) throw new Error("Question must be 4,000 characters or fewer");
      const actionId =
        typeof request.actionId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(request.actionId)
          ? request.actionId
          : "";
      if (!actionId) throw new Error("Invalid actionId");
      return {
        action: request.action,
        sessionId: parseSessionId(request.sessionId),
        actionId,
        prompt,
      };
    }
    case "tool_invoke": {
      const toolName = typeof request.toolName === "string" ? request.toolName.trim() : "";
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(toolName)) throw new Error("Invalid toolName");
      const actionId =
        typeof request.actionId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(request.actionId)
          ? request.actionId
          : "";
      if (!actionId) throw new Error("Invalid actionId");
      if (!request.args || typeof request.args !== "object" || Array.isArray(request.args)) {
        throw new Error("Tool args must be a JSON object");
      }
      if (JSON.stringify(request.args).length > 8_000) throw new Error("Tool args are too large");
      return {
        action: request.action,
        toolName,
        sessionId: parseSessionId(request.sessionId),
        actionId,
        args: request.args as Record<string, unknown>,
      };
    }
    default:
      throw new Error("Unsupported hosted GUI action");
  }
}

function parseBoundedString(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max) throw new Error(`Invalid ${label}`);
  return text;
}

function parseSymbol(value: unknown): string {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9.^=_/-]{0,31}$/.test(symbol)) throw new Error("Invalid symbol");
  return symbol;
}

export function serializeProbeError(
  error: unknown,
  sensitiveValues: ReadonlyArray<string | undefined> = [],
): { error: string } {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of sensitiveValues) {
    if (value) message = message.replaceAll(value, "[redacted]");
  }
  return { error: message.slice(0, 240) };
}

function parseQuestion(value: unknown): string {
  const question = typeof value === "string" ? value.trim() : "";
  if (!question) throw new Error("Question must not be blank");
  if (question.length > 500) throw new Error("Question must be 500 characters or fewer");
  return question;
}

function parseSessionId(value: unknown): string {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!sessionId || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
    throw new Error("Invalid sessionId");
  }
  return sessionId;
}
