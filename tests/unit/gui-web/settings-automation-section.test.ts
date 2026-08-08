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

  it("offers no schedule controls in the web app", async () => {
    await render("hosted", "writer");
    expect(saveButton()).toBeUndefined();
    expect(document.body.querySelector('input[type="time"]')).toBeNull();
  });

  it("offers no schedule controls in an offline hosted tab either", async () => {
    await render("hosted", "offline");
    expect(saveButton()).toBeUndefined();
  });

  it("keeps a local follower read-only", async () => {
    await render("loopback", "follower");
    const save = saveButton();
    expect(save).toBeTruthy();
    expect(save?.disabled).toBe(true);
  });

  it("tells hosted users automation is on-demand only", async () => {
    await render("hosted", "writer");
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "Alert checks and reports run when you ask for them, with a manual check or by running a report. Nothing runs in the background or after you close the tab.",
    );
    expect(text).not.toContain("run while this app is open");
    expect(text).not.toContain("—");
  });

  it("keeps the local copy about the open app and opencandle monitor", async () => {
    await render("loopback", "writer");
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "Alert checks and the daily report run while OpenCandle is open. Run opencandle monitor to keep them running without the app in front of you.",
    );
    expect(text).not.toContain("—");
  });

  it("tells web app users reports run on demand", async () => {
    await render("hosted", "writer");
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "In the web app, reports run when you ask for one. Nothing runs on a schedule or after you close the tab.",
    );
    expect(text).not.toContain("runs daily while OpenCandle is open");
    expect(text).not.toContain("local app's daily schedule");
  });

  it("keeps the local schedule copy in the local app", async () => {
    await render("loopback", "writer");
    expect(document.body.textContent).toContain(
      "The morning report runs daily while OpenCandle is open.",
    );
  });
});
