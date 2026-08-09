import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ApiKeyProviderId } from "../../src/onboarding/providers.js";
import type { FirstClassModelProviderId } from "../../src/pi/model-provider-metadata.js";
import type { ChatRunAttachmentInput, ChatRunImageInput } from "./chat-run-input.js";

export const HOSTED_GUI_READ_ACTIONS = [
  "bootstrap",
  "market_state",
  "market_quotes",
  "market_indices",
  "instrument_history",
  "instrument_search",
  "instrument_quote",
  "instrument_endpoint",
  "diagnostics",
  "preferences_list",
  "validate_model_key",
  "validate_provider_key",
] as const;

export type HostedGuiReadAction = (typeof HOSTED_GUI_READ_ACTIONS)[number];

export const GUI_HTTP_COMMAND_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "/api/model-setup/refresh": "model.setup.refresh",
  "/api/model-setup/api-key": "model.setup.save_api_key",
  "/api/model-setup/model": "model.setup.select_model",
  "/api/model-setup/thinking": "model.setup.set_thinking",
  "/api/provider-setup/api-key": "provider.save_api_key",
});

export type GuiRequest =
  | {
      action:
        | "bootstrap"
        | "new_session"
        | "market_state"
        | "market_quotes"
        | "market_indices"
        | "diagnostics"
        | "preferences_list";
    }
  | { action: "preferences_delete"; namespace: string; key: string }
  | { action: "tool_defaults_delete"; toolName: string; paramPath: string }
  | { action: "instrument_search"; query: string }
  | { action: "instrument_quote"; symbol: string }
  | { action: "instrument_history"; symbol: string; range: string }
  | { action: "instrument_endpoint"; endpoint: string; symbol: string }
  | {
      action: "configure_model";
      provider: FirstClassModelProviderId;
      modelId: string;
      apiKey: string;
    }
  | { action: "configure_thinking"; level: ThinkingLevel }
  | { action: "validate_provider_key"; providerId: ApiKeyProviderId; apiKey: string }
  | { action: "validate_model_key"; provider: FirstClassModelProviderId; apiKey: string }
  | { action: "load_session" | "delete_session"; sessionId: string }
  | { action: "rename_session"; sessionId: string; name: string }
  | { action: "ask_user.answer"; sessionId: string; id: string; answer: string }
  | { action: "ask_user.cancel"; sessionId: string; id: string }
  | {
      action: "tool_invoke";
      toolName: string;
      sessionId: string;
      actionId: string;
      args: Record<string, unknown>;
      recordTranscript?: boolean;
    }
  | {
      action: "chat_run";
      sessionId: string;
      actionId: string;
      prompt: string;
      images: ChatRunImageInput[];
      attachments: ChatRunAttachmentInput[];
    };

const hostedGuiReadActions = new Set<string>(HOSTED_GUI_READ_ACTIONS);

export function hostedGuiActionBlocksUpdate(action: unknown): boolean {
  return typeof action !== "string" || !hostedGuiReadActions.has(action);
}
