import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  isFirstClassModelProvider,
} from "../../../src/pi/model-provider-metadata.js";
import { resolveFirstClassModelEntry } from "../../../src/pi/model-catalog-lookup.js";
import {
  type ApiKeyProviderId,
  listApiKeyProviders,
} from "../../../src/onboarding/providers.js";
import { parseChatRunBody } from "../../shared/chat-run-input.js";
import type { GuiRequest } from "../../shared/hosted-gui-protocol.js";

export type { GuiRequest } from "../../shared/hosted-gui-protocol.js";

const apiKeyProviderIds = new Set<string>(listApiKeyProviders().map((provider) => provider.id));
const thinkingLevels = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

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
    case "preferences_list":
      return { action: request.action };
    case "preferences_delete":
      return {
        action: request.action,
        namespace: parseBoundedString(request.namespace, "preference namespace", 200),
        key: parseBoundedString(request.key, "preference key", 200),
      };
    case "tool_defaults_delete": {
      const toolName = typeof request.toolName === "string" ? request.toolName.trim() : "";
      if (!/^[a-z][a-z0-9_]{0,79}$/.test(toolName)) throw new Error("Invalid toolName");
      return {
        action: request.action,
        toolName,
        paramPath: parseBoundedString(request.paramPath, "parameter path", 200),
      };
    }
    case "configure_model": {
      if (!isFirstClassModelProvider(request.provider) || !resolveFirstClassModelEntry(request.provider, request.modelId)) {
        throw new Error("Unsupported provider or model");
      }
      if (typeof request.apiKey !== "string" || request.apiKey.length > 512) {
        throw new Error("Hosted model key is invalid");
      }
      return {
        action: request.action,
        provider: request.provider,
        modelId: request.modelId,
        apiKey: request.apiKey,
      };
    }
    case "configure_thinking": {
      if (!thinkingLevels.has(request.level as ThinkingLevel)) {
        throw new Error("Unsupported thinking level");
      }
      return { action: request.action, level: request.level as ThinkingLevel };
    }
    case "validate_provider_key": {
      const providerId = request.providerId;
      if (typeof providerId !== "string" || !apiKeyProviderIds.has(providerId)) {
        throw new Error("Unsupported hosted provider");
      }
      if (typeof request.apiKey !== "string" || !request.apiKey.trim() || request.apiKey.length > 8_192) {
        throw new Error("Hosted provider key is invalid");
      }
      return {
        action: request.action,
        providerId: providerId as ApiKeyProviderId,
        apiKey: request.apiKey.trim(),
      };
    }
    case "validate_model_key": {
      if (!isFirstClassModelProvider(request.provider)) {
        throw new Error("Unsupported model provider");
      }
      if (typeof request.apiKey !== "string" || !request.apiKey.trim() || request.apiKey.length > 512) {
        throw new Error("Hosted model key is invalid");
      }
      return { action: request.action, provider: request.provider, apiKey: request.apiKey.trim() };
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
    case "ask_user.answer": {
      const id = parseBoundedString(request.id, "ask_user id", 200);
      const answer = parseBoundedString(request.answer, "ask_user answer", 4_000);
      return {
        action: request.action,
        sessionId: parseSessionId(request.sessionId),
        id,
        answer,
      };
    }
    case "ask_user.cancel":
      return {
        action: request.action,
        sessionId: parseSessionId(request.sessionId),
        id: parseBoundedString(request.id, "ask_user id", 200),
      };
    case "chat_run": {
      const parsed = parseChatRunBody(request);
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.value.prompt.length > 4_000) {
        throw new Error("Question must be 4,000 characters or fewer");
      }
      const actionId =
        typeof request.actionId === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(request.actionId)
          ? request.actionId
          : "";
      if (!actionId) throw new Error("Invalid actionId");
      return {
        action: request.action,
        sessionId: parseSessionId(request.sessionId),
        actionId,
        ...parsed.value,
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

function parseSessionId(value: unknown): string {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!sessionId || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
    throw new Error("Invalid sessionId");
  }
  return sessionId;
}
