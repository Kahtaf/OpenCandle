import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomMessage } from "../../../gui/web/src/components/chat/custom-message.jsx";
import { ModelSelector } from "../../../gui/web/src/features/chat/model-selector.jsx";
import { ConnectModelPanel } from "../../../gui/web/src/features/onboarding/ConnectModelPanel.jsx";
import { ProviderKeyForm } from "../../../gui/web/src/features/onboarding/ProviderKeyFlow.jsx";
import {
  buildHttpFallbackMessageRequest,
  resolveModelSetupErrorFromSocketError,
} from "../../../gui/web/src/hooks/useGuiConnection.jsx";

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
      React.createElement(ConnectModelPanel, {
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
      React.createElement(ConnectModelPanel, {
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

    expect(html).toContain("Provider requests pass through OpenCandle&#x27;s audited relay");
    // The row now names the default model in the same sentence
    // ("Runs gpt-4.1-mini through the audited relay"); the invariant is that
    // the hosted row still discloses the relay.
    expect(html).toContain("through the audited relay");
    expect(html).toContain("browser extensions");
    expect(html).not.toContain("Runs directly from this browser");
    expect(html).not.toContain("never sends it to an OpenCandle server");
    expect(html).not.toContain("terminal sign-in");
    expect(html).not.toContain("setup changes are unavailable");

    // The storage choice and the relay wording live on the key step, which is
    // the second step of the provider flow.
    const keyStep = renderToStaticMarkup(
      React.createElement(ProviderKeyForm, {
        hosted: true,
        defaultStorageMode: "session",
        provider: {
          id: "openai",
          label: "OpenAI",
          envVar: "OPENAI_API_KEY",
          defaultModel: "gpt-4.1-mini",
          signupUrl: "https://platform.openai.com/api-keys",
        },
      }),
    );

    expect(keyStep).toContain("Only for this browser session");
    expect(keyStep).toContain("Keep on this device");
    // Same disclosure, now in one sentence with the default model:
    // "Runs gpt-4.1-mini through the audited relay. Pi itself runs in this browser."
    expect(keyStep).toContain("the audited relay");
    expect(keyStep).not.toContain("Runs directly from this browser");
    expect(keyStep).not.toContain("never sends it to an OpenCandle server");
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

  it("attributes socket key-save failures by request id, not by timing", () => {
    const pending = "model-setup-save-api-key-abc";

    // A rejected key already rendered inline over the socket, even untagged.
    expect(
      resolveModelSetupErrorFromSocketError(
        "Key was rejected by OpenAI. The existing configuration was not changed.",
        {},
      ),
    ).toBe("Key was rejected by OpenAI. The existing configuration was not changed.");

    // An unverifiable key is a different outcome and must still reach the
    // inline setup region, matching the HTTP fallback and hosted paths.
    expect(
      resolveModelSetupErrorFromSocketError(
        "Couldn't verify the OpenAI key right now. It was saved with a network notice.",
        { actionId: pending, pendingModelKeySaveActionId: pending },
      ),
    ).toBe("Couldn't verify the OpenAI key right now. It was saved with a network notice.");

    // An unrelated request that fails while a save is in flight must not be
    // painted as a key failure — the catch-all server handler emits errors for
    // every request type on the same socket.
    expect(
      resolveModelSetupErrorFromSocketError("Session is owned by another window.", {
        actionId: "model-setup-refresh-xyz",
        pendingModelKeySaveActionId: pending,
      }),
    ).toBe("");
    // Untagged frames never match a pending save.
    expect(
      resolveModelSetupErrorFromSocketError("Session is owned by another window.", {
        pendingModelKeySaveActionId: pending,
      }),
    ).toBe("");
    expect(resolveModelSetupErrorFromSocketError("Session is owned by another window.", {})).toBe(
      "",
    );
    expect(
      resolveModelSetupErrorFromSocketError("", {
        actionId: pending,
        pendingModelKeySaveActionId: pending,
      }),
    ).toBe("");
  });

  it("maps thinking changes through the same GUI fallback contract", () => {
    expect(buildHttpFallbackMessageRequest("model.setup.set_thinking", { level: "high" })).toEqual({
      path: "/api/model-setup/thinking",
      body: { level: "high" },
    });
  });
});
