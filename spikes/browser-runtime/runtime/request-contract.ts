export interface ProbeRequest {
  question: string;
  provider: "google" | "openai" | "anthropic";
  modelId: string;
  runModel: boolean;
}

export type ParsedProbeRequest = ProbeRequest;

const MODEL_ENVIRONMENT = {
  google: { modelId: "gemini-2.5-flash", envVar: "GEMINI_API_KEY" },
  openai: { modelId: "gpt-5-mini", envVar: "OPENAI_API_KEY" },
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
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${trustedOrigin}`,
  ].join("; ");
}

export function createBridgeDocument(hostOrigin: string, nonce: string): string {
  const trustedOrigin = parseTrustedHostOrigin(hostOrigin);
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) throw new Error("Bridge nonce is invalid");
  const originLiteral = JSON.stringify(trustedOrigin);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>OpenCandle runtime bridge</title></head>
<body>
<script nonce="${nonce}">
(() => {
  "use strict";
  const trustedHostOrigin = ${originLiteral};
  const channel = "opencandle-browser-runtime-v1";
  const maxResponseCharacters = 65536;
  const send = (message) => parent.postMessage({ channel, ...message }, trustedHostOrigin);

  addEventListener("message", async (event) => {
    if (event.origin !== trustedHostOrigin || event.source !== parent) return;
    const message = event.data;
    if (!message || typeof message !== "object" || message.channel !== channel) return;
    const { operation, requestId } = message;
    if (operation !== "health" && operation !== "probe") return;
    if (typeof requestId !== "string" || !/^[a-f0-9]{32}$/.test(requestId)) return;
    try {
      const response = await fetch(operation === "health" ? "/health" : "/probe", {
        method: operation === "health" ? "GET" : "POST",
        credentials: "omit",
        ...(operation === "probe" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.payload),
        } : {}),
      });
      const result = await response.json();
      const serialized = JSON.stringify(result);
      if (serialized.length > maxResponseCharacters) throw new Error("Runtime response is too large");
      send({ type: "response", requestId, ok: response.ok, status: response.status, result });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Bridge request failed";
      send({ type: "response", requestId, ok: false, status: 0, error: text.slice(0, 240) });
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
