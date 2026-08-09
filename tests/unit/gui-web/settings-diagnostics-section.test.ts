// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { settingsSectionRegistry } from "../../../gui/web/src/features/settings/section-registry.jsx";
import { DiagnosticsSection } from "../../../gui/web/src/features/settings/sections/DiagnosticsSection.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const REPORT = {
  schemaVersion: 1,
  generatedAt: "2026-08-06T12:00:00.000Z",
  status: "degraded",
  summary: "OpenCandle is usable with degraded capabilities.",
  sections: [
    {
      id: "model",
      label: "Model",
      status: "blocked",
      checks: [
        {
          id: "model.readiness",
          label: "Model readiness",
          status: "fail",
          summary: "No usable model credentials are configured",
        },
      ],
    },
    {
      id: "providers",
      label: "Providers",
      status: "degraded",
      checks: [
        {
          id: "provider.alpha_vantage.credential",
          label: "Alpha Vantage",
          status: "skip",
          summary: "Not connected — optional.",
          metadata: { providerId: "alpha_vantage", unlocks: ["company fundamentals"] },
        },
      ],
    },
  ],
};

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
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function render(props: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(DiagnosticsSection, {
          role: "writer",
          initialReport: REPORT,
          ...props,
        }),
      ),
    );
  });
}

function buttonNamed(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("DiagnosticsSection", () => {
  it("is the registered body for the diagnostics section", () => {
    expect(settingsSectionRegistry.diagnostics.Component).toBe(DiagnosticsSection);
  });

  it("renders the health report inside the settings frame", () => {
    render();

    expect(container.textContent).toContain("OpenCandle is usable with degraded capabilities.");
    expect(container.textContent).toContain("Model readiness");
    expect(container.textContent).toContain("Alpha Vantage");
    expect(container.querySelector("main")).toBe(null);
    expect(container.querySelector("h1")).toBe(null);
  });

  it("sends provider remediation to the Data providers section for that provider", () => {
    const onOpenProviders = vi.fn();
    render({ onOpenProviders });

    click(buttonNamed("Connect"));

    expect(onOpenProviders).toHaveBeenCalledWith("alpha_vantage");
  });

  it("sends model remediation to the Model section", () => {
    const onOpenModelSetup = vi.fn();
    render({ onOpenModelSetup });

    click(buttonNamed("Model setup"));

    expect(onOpenModelSetup).toHaveBeenCalledTimes(1);
  });

  it("keeps browser-session checks off the hosted runtime", () => {
    render({ initialReport: { ...REPORT, runtime: "hosted-web" } });

    expect(buttonNamed("Check sessions")).toBeUndefined();
    expect(buttonNamed("Refresh")).toBeTruthy();
  });

  it("offers the local session check to the local runtime", () => {
    render();

    expect(buttonNamed("Check sessions")).toBeTruthy();
  });
});
