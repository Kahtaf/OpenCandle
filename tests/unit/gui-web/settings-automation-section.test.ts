// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationSection } from "../../../gui/web/src/features/settings/sections/AutomationSection.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

let container: HTMLDivElement;
let root: Root;

function makeTransport(kind: string) {
  return {
    kind,
    bootstrap: vi.fn(async () => ({
      sessionId: "session-1",
      coordination: { sessionId: "session-1", ownerKind: "hosted", writable: kind !== "offline" },
    })),
    invokeTool: vi.fn(async () => ({ ok: true })),
    getDiagnostics: vi.fn(async () => ({
      sections: [],
      metadata: { notificationWebhookConfigured: false },
    })),
  };
}

async function render(kind: string, role: string) {
  const transport = makeTransport(kind);
  await act(async () => {
    root.render(
      React.createElement(
        RuntimeTransportProvider,
        { transport },
        React.createElement(AutomationSection, { role, setToast: vi.fn() }),
      ),
    );
    await Promise.resolve();
  });
  return transport;
}

function saveButton() {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.toLowerCase().includes("save"),
  );
}

describe("Settings automation section gating", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("disables schedule changes in an offline hosted tab", async () => {
    await render("hosted", "offline");
    const save = saveButton();
    expect(save).toBeTruthy();
    expect(save?.disabled).toBe(true);
  });

  it("keeps schedule changes available for an online hosted follower", async () => {
    await render("hosted", "follower");
    const save = saveButton();
    expect(save).toBeTruthy();
    expect(save?.disabled).toBe(false);
  });

  it("keeps a local follower read-only", async () => {
    await render("loopback", "follower");
    const save = saveButton();
    expect(save).toBeTruthy();
    expect(save?.disabled).toBe(true);
  });
});
