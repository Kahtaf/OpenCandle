// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPED_CONFIRM_WORD } from "../../../gui/web/src/components/ui/typed-confirm-word.js";
import { DataSection } from "../../../gui/web/src/features/settings/sections/DataSection.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

const LOCAL_REPORT = {
  metadata: {
    opencandleHome: "/Users/test/.opencandle",
    opencandleHomeSource: "default",
    notificationWebhookConfigured: false,
  },
  sections: [
    {
      id: "state",
      checks: [{ id: "state.config", metadata: { path: "/Users/test/.opencandle/config.json" } }],
    },
  ],
};

function hostedActions() {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      exportData: vi.fn(async () => {
        calls.push("export");
        return { archive: "{}" };
      }),
      importData: vi.fn(async () => {
        calls.push("import");
      }),
      clearSecrets: vi.fn(async () => {
        calls.push("clear_secrets");
      }),
      clearAll: vi.fn(async () => {
        calls.push("clear_all");
      }),
      installUpdate: vi.fn(async () => {
        calls.push("install_update");
        return true;
      }),
    },
  };
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(scope: ParentNode, text: string) {
  return [...scope.querySelectorAll("button")].find((node) =>
    (node.textContent ?? "").includes(text),
  );
}

describe("DataSection", () => {
  let container: HTMLDivElement;
  let root: Root;

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

  async function render(transport: Record<string, unknown>, props: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport },
          React.createElement(DataSection, { role: "writer", ...props }),
        ),
      );
    });
  }

  it("carries the hosted data actions with the destructive rows last", async () => {
    const { actions } = hostedActions();
    await render({ kind: "hosted", hostedData: actions });

    const text = container.textContent ?? "";
    expect(text).toContain("Export");
    expect(text).toContain("Import");
    expect(text).toContain("Clear secrets");
    expect(text).toContain("Clear all");
    expect(text).not.toContain("/Users/test/.opencandle");
    expect(text.indexOf("Clear all")).toBeGreaterThan(text.indexOf("Export"));

    await act(async () => buttonByText(container, "Export")?.click());
    expect(actions.exportData).toHaveBeenCalledTimes(1);
  });

  it("offers the install update row only while an update is waiting", async () => {
    const { actions } = hostedActions();
    await render({ kind: "hosted", hostedData: actions });

    expect(buttonByText(container, "Install update")).toBeUndefined();

    await act(async () => {
      dispatchEvent(
        new CustomEvent("opencandle:update-ready", {
          detail: { registration: { waiting: { postMessage: () => {} } } },
        }),
      );
    });

    expect(buttonByText(container, "Install update")).toBeDefined();
    await act(async () => buttonByText(container, "Install update")?.click());
    expect(actions.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the install row for an update discovered before the section mounted", async () => {
    const waiting = { postMessage: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => ({ waiting })) },
    });
    try {
      const actions = hostedActions();
      await render({ kind: "hosted", hostedData: actions }, { role: "writer" });
      await act(async () => {
        await Promise.resolve();
      });
      expect(buttonByText(container, "Install update")).toBeDefined();
    } finally {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("requires the typed word before clearing everything", async () => {
    const { actions } = hostedActions();
    await render({ kind: "hosted", hostedData: actions });

    await act(async () => buttonByText(container, "Clear all")?.click());

    const dialog = document.querySelector('[data-slot="typed-confirm-dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const confirm = dialog.querySelector('[data-slot="typed-confirm-action"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(actions.clearAll).not.toHaveBeenCalled();

    act(() => setValue(dialog.querySelector("input") as HTMLInputElement, TYPED_CONFIRM_WORD));
    expect(confirm.disabled).toBe(false);

    await act(async () => confirm.click());
    expect(actions.clearAll).toHaveBeenCalledTimes(1);
  });

  it("confirms clearing secrets without a typed word", async () => {
    const { actions } = hostedActions();
    await render({ kind: "hosted", hostedData: actions });

    await act(async () => buttonByText(container, "Clear secrets")?.click());

    const confirm = document.querySelector(
      '[data-slot="alert-dialog-action"]',
    ) as HTMLButtonElement;
    expect(confirm).not.toBeNull();
    expect(document.querySelector('[data-slot="typed-confirm-dialog"]')).toBeNull();

    await act(async () => confirm.click());
    expect(actions.clearSecrets).toHaveBeenCalledTimes(1);
  });

  it("disables every mutating row while the tab cannot act, but keeps export", async () => {
    const { actions } = hostedActions();
    await render({ kind: "hosted", hostedData: actions }, { role: "offline" });

    for (const label of ["Import", "Clear secrets", "Clear all"]) {
      expect(buttonByText(container, label)?.disabled).toBe(true);
    }
    expect(container.textContent).toContain("while OpenCandle reconnects");

    // Export only reads what this browser already holds, so an offline or
    // follower tab can still take its data with it.
    expect(buttonByText(container, "Export")?.disabled).toBe(false);
    await act(async () => buttonByText(container, "Export")?.click());
    expect(actions.exportData).toHaveBeenCalledTimes(1);
  });

  it("reads out where local state lives and offers no destructive controls", async () => {
    await render({
      kind: "loopback",
      getDiagnostics: async () => LOCAL_REPORT,
    });

    const text = container.textContent ?? "";
    expect(text).toContain("/Users/test/.opencandle");
    expect(text).toContain("/Users/test/.opencandle/config.json");
    expect(buttonByText(container, "Clear all")).toBeUndefined();
    expect(buttonByText(container, "Export")).toBeUndefined();
    expect(buttonByText(container, "Import")).toBeUndefined();
  });

  it("names the environment override when the home directory came from one", async () => {
    await render({
      kind: "loopback",
      getDiagnostics: async () => ({
        ...LOCAL_REPORT,
        metadata: { ...LOCAL_REPORT.metadata, opencandleHomeSource: "env" },
      }),
    });

    expect(container.textContent).toContain("OPENCANDLE_HOME");
  });
});
