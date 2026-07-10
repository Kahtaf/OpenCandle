import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomMessage } from "../../../gui/web/src/components/chat/custom-message.jsx";
import { ModelSelector } from "../../../gui/web/src/features/chat/model-selector.jsx";
import { ModelSetupCard } from "../../../gui/web/src/features/onboarding/ModelSetupCard.jsx";

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
});
