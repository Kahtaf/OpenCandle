// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ProvidersSection } from "../../../gui/web/src/features/settings/sections/ProvidersSection.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CATALOG = {
  providers: [
    {
      id: "alpha_vantage",
      kind: "api-key",
      displayName: "Alpha Vantage",
      envVar: "ALPHA_VANTAGE_API_KEY",
      status: "absent",
      source: "absent",
      unlocks: ["company fundamentals"],
      signupUrl: "https://www.alphavantage.co/support/#api-key",
    },
    {
      id: "fred",
      kind: "api-key",
      displayName: "FRED",
      envVar: "FRED_API_KEY",
      status: "file",
      source: "file",
      maskedKeyHint: "…f00d",
      unlocks: ["economic series"],
    },
    {
      id: "finnhub",
      kind: "api-key",
      displayName: "Finnhub",
      envVar: "FINNHUB_API_KEY",
      status: "env",
      source: "env",
      unlocks: ["company news"],
    },
    {
      id: "brave",
      kind: "api-key",
      displayName: "Brave Search",
      envVar: "BRAVE_API_KEY",
      status: "absent",
      source: "absent",
      unlocks: ["web search"],
      onboarding: { status: "snoozed", snoozeUntil: "2026-09-01T00:00:00.000Z" },
    },
    {
      id: "twitter",
      kind: "external-tool",
      displayName: "X / Twitter",
      binary: "twitter",
      installCmd: "uv tool install twitter-cli",
      status: "skipped",
      statusDetail: { state: "skipped", message: "Skipped by user preference." },
      onboarding: { status: "never_ask" },
      unlocks: ["X sentiment"],
    },
    {
      id: "yahoo",
      kind: "public-http",
      displayName: "Yahoo Finance",
      status: "unknown",
      probeUrl: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
      unlocks: ["quotes"],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
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
        React.createElement(ProvidersSection, { catalog: CATALOG, send: vi.fn(), ...props }),
      ),
    );
  });
}

function row(providerId: string) {
  return container.querySelector<HTMLElement>(
    `[data-slot="provider-row"][data-provider="${providerId}"]`,
  );
}

function rowTrigger(providerId: string) {
  return row(providerId)?.querySelector<HTMLButtonElement>('[data-slot="provider-row-trigger"]');
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ProvidersSection", () => {
  it("renders one row per provider in catalog order", () => {
    render();

    const ids = [...container.querySelectorAll<HTMLElement>('[data-slot="provider-row"]')].map(
      (element) => element.dataset.provider,
    );
    expect(ids).toEqual(CATALOG.providers.map((provider) => provider.id));
    expect(row("alpha_vantage")?.textContent).toContain("Alpha Vantage");
  });

  it("states each provider's status in one line", () => {
    render();

    expect(row("fred")?.textContent).toContain("Configured");
    expect(row("finnhub")?.textContent).toContain("Managed by FINNHUB_API_KEY");
    expect(row("brave")?.textContent).toContain("Snoozed until");
    expect(row("twitter")?.textContent).toContain("Never ask");
    expect(row("alpha_vantage")?.textContent).toContain("Not configured");
    expect(row("yahoo")?.textContent).toContain("Not verified yet");
  });

  it("expands the matching builder inline when a row is activated", () => {
    render();

    expect(rowTrigger("alpha_vantage")?.getAttribute("aria-expanded")).toBe("false");
    click(rowTrigger("alpha_vantage"));

    expect(rowTrigger("alpha_vantage")?.getAttribute("aria-expanded")).toBe("true");
    expect(row("alpha_vantage")?.textContent).toContain("Save key");
    // Only one builder is open at a time.
    expect(row("yahoo")?.textContent).not.toContain("Check reachability");

    click(rowTrigger("yahoo"));
    expect(row("yahoo")?.textContent).toContain("Check reachability");
    expect(row("alpha_vantage")?.textContent).not.toContain("Save key");
  });

  it("keeps the external-tool checks reachable from its row", () => {
    const send = vi.fn();
    render({ send });

    click(rowTrigger("twitter"));

    expect(row("twitter")?.textContent).toContain("uv tool install twitter-cli");
    expect(row("twitter")?.textContent).toContain("Re-enable & check install");
  });

  it("opens and scrolls to the provider named by the deep link", () => {
    render({ focusProvider: "alpha_vantage" });

    expect(rowTrigger("alpha_vantage")?.getAttribute("aria-expanded")).toBe("true");
    expect(row("alpha_vantage")?.textContent).toContain("Save key");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("states hosted local-only providers without offering setup actions", () => {
    render({
      catalog: {
        providers: [
          {
            id: "reddit",
            kind: "external-tool",
            displayName: "Reddit",
            binary: "rdt",
            installCmd: "uv tool install rdt-cli",
            status: "unknown",
            hosted: true,
            browserTransport: "relayed",
            unlocks: ["Reddit sentiment"],
          },
        ],
      },
    });

    expect(row("reddit")?.textContent).toContain("Available only in the local app");
    expect(rowTrigger("reddit")).toBe(null);
    expect(row("reddit")?.textContent).not.toContain("Check install");
    expect(row("reddit")?.textContent).not.toContain("uv tool install rdt-cli");
  });

  it("says so plainly while the catalog has no providers yet", () => {
    render({ catalog: null });

    expect(container.textContent).toContain("Provider status appears once OpenCandle connects.");
    expect(container.querySelector('[data-slot="provider-row"]')).toBe(null);
  });
});
