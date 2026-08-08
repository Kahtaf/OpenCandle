// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelContent } from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";
import { ReportScheduleForm } from "../../../gui/web/src/features/market-state/report-schedule-form.jsx";
import { AutomationSection } from "../../../gui/web/src/features/settings/sections/AutomationSection.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

type Invocation = { toolName: string; args: Record<string, unknown> };

function stubTransport(invocations: Invocation[], overrides: Record<string, unknown> = {}) {
  return {
    kind: "loopback",
    async bootstrap() {
      return { sessionId: "session-1" };
    },
    async invokeTool(body: { toolName: string; args: Record<string, unknown> }) {
      invocations.push({ toolName: body.toolName, args: body.args });
      return { ok: true };
    },
    async getDiagnostics() {
      return { metadata: { notificationWebhookConfigured: false } };
    },
    ...overrides,
  };
}

describe("ReportScheduleForm", () => {
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

  it("dispatches the daily report configure action with the chosen local time", async () => {
    const calls: Invocation[] = [];
    const onSaved = vi.fn();
    const invokeTool = vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      calls.push({ toolName, args });
      return true;
    });

    act(() => {
      root.render(React.createElement(ReportScheduleForm, { invokeTool, onSaved }));
    });

    const input = container.querySelector('input[type="time"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe("daily_watchlist_report");
    expect(calls[0].args).toMatchObject({ action: "configure", local_time: "08:00" });
    expect(String(calls[0].args.timezone ?? "")).not.toBe("");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("offers no schedule controls in the web app", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RuntimeTransportProvider,
        { transport: stubTransport([], { kind: "hosted" }) },
        React.createElement(ReportScheduleForm, { disabled: false, invokeTool: vi.fn() }),
      ),
    );

    expect(html).toContain("reports run when you ask for one");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });

  it("keeps the save action inert while the surface is read only", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportScheduleForm, { disabled: true, invokeTool: vi.fn() }),
    );

    expect(html).toContain('data-slot="report-schedule-form"');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("renders the same form in the reports slide over and in settings", async () => {
    const panelHtml = renderToStaticMarkup(
      React.createElement(PanelContent, {
        panel: { type: "report-configure" },
        invokeTool: vi.fn(),
        closePanel: vi.fn(),
      }),
    );
    expect(panelHtml).toContain('data-slot="report-schedule-form"');

    const invocations: Invocation[] = [];
    act(() => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport: stubTransport(invocations) },
          React.createElement(AutomationSection, { role: "writer" }),
        ),
      );
    });

    expect(container.querySelector('[data-slot="report-schedule-form"]')).not.toBeNull();

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0].toolName).toBe("daily_watchlist_report");
    expect(invocations[0].args).toMatchObject({ action: "configure", local_time: "08:00" });
  });
});

describe("AutomationSection", () => {
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

  async function renderSection(transport: Record<string, unknown>, props = {}) {
    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport },
          React.createElement(AutomationSection, { role: "writer", ...props }),
        ),
      );
    });
    return container.textContent ?? "";
  }

  it("names the webhook environment variable and offers no input for it", async () => {
    const text = await renderSection(stubTransport([]));

    expect(text).toContain("OPENCANDLE_NOTIFICATION_WEBHOOK_URL");
    expect(text).toContain("Not configured");
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });

  it("states that a configured webhook is managed by the environment", async () => {
    const text = await renderSection(
      stubTransport([], {
        async getDiagnostics() {
          return { metadata: { notificationWebhookConfigured: true } };
        },
      }),
    );

    expect(text).toContain("Configured");
    expect(text).not.toContain("Not configured");
  });

  it("describes local automation as a monitor process and hosted automation as on demand", async () => {
    const localText = await renderSection(stubTransport([]));
    expect(localText).toContain("opencandle monitor");

    const hostedText = await renderSection(stubTransport([], { kind: "hosted" }));
    expect(hostedText).toContain("Nothing runs in the background or after you close the tab.");
    expect(hostedText).not.toContain("while this app is open");
    expect(hostedText).not.toContain("OPENCANDLE_NOTIFICATION_WEBHOOK_URL");
  });

  it("disables the schedule form for a follower or offline tab", async () => {
    await renderSection(stubTransport([]), { role: "offline" });

    const button = container.querySelector('[data-slot="report-schedule-form"] button');
    expect(button?.hasAttribute("disabled")).toBe(true);
  });
});
