import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomMessage } from "../../../gui/web/src/components/chat/custom-message.jsx";
import { ModelSelector } from "../../../gui/web/src/features/chat/model-selector.jsx";
import { ModelSetupCard } from "../../../gui/web/src/features/onboarding/ModelSetupCard.jsx";
import { buildHttpFallbackMessageRequest } from "../../../gui/web/src/hooks/useGuiConnection.jsx";

describe("model recovery controls", () => {
  it("labels the composer selector when no model is connected", () => {
    const html = renderToStaticMarkup(
      React.createElement(ModelSelector, {
        modelSetup: { requirement: "connect_auth", availableModels: [] },
      }),
    );

    expect(html).toContain("No model connected");
  });

  it("renders a failed model run with retry and key-repair actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomMessage, {
        customType: "opencandle-model-run-failed",
        content: [{ type: "text", text: "OpenAI rejected the configured key." }],
        onRetry: vi.fn(),
        onFixModelKey: vi.fn(),
      }),
    );

    expect(html).toContain("OpenAI rejected the configured key.");
    expect(html).toContain(">Retry</button>");
    expect(html).toContain(">Fix model key</button>");
  });

  it("renders model-key validation errors inline in setup", () => {
    const html = renderToStaticMarkup(
      React.createElement(ModelSetupCard, {
        modelSetup: {
          requirement: "connect_auth",
          availableModels: [],
          providers: [],
          error: "Key was rejected by OpenAI. The existing configuration was not changed.",
        },
      }),
    );

    expect(html).toContain("Key was rejected by OpenAI");
  });

  it("explains hosted key storage and offers persistent and session-only choices", () => {
    const html = renderToStaticMarkup(
      React.createElement(ModelSetupCard, {
        role: "follower",
        modelSetup: {
          hosted: true,
          requirement: "api_key",
          storageMode: "session",
          availableModels: [],
          providers: [
            {
              id: "openai",
              label: "OpenAI",
              envVar: "OPENAI_API_KEY",
              defaultModel: "gpt-4.1-mini",
              signupUrl: "https://platform.openai.com/api-keys",
            },
          ],
        },
      }),
    );

    expect(html).toContain("Only for this browser session");
    expect(html).toContain("Keep on this device");
    expect(html).toContain("browser extensions");
    expect(html).not.toContain("terminal sign-in");
    expect(html).not.toContain("setup changes are unavailable");
  });

  it("passes hosted credential storage mode through the shared command contract", () => {
    expect(
      buildHttpFallbackMessageRequest("model.setup.save_api_key", {
        provider: "openai",
        apiKey: "sentinel",
        storageMode: "session",
      }),
    ).toEqual({
      path: "/api/model-setup/api-key",
      body: { provider: "openai", apiKey: "sentinel", storageMode: "session" },
    });
  });
});
