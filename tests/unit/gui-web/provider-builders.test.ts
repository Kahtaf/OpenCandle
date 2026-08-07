// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ApiKeyProviderBuilder } from "../../../gui/web/src/features/settings/provider-builders/api-key-provider-builder.jsx";
import { ExternalToolProviderBuilder } from "../../../gui/web/src/features/settings/provider-builders/external-tool-provider-builder.jsx";
import { ProviderBuilder } from "../../../gui/web/src/features/settings/provider-builders/provider-builder.jsx";
import {
  providerIcon,
  providerStatus,
  statusLabel,
} from "../../../gui/web/src/features/settings/provider-builders/provider-status-info.js";
import { PublicHttpProviderBuilder } from "../../../gui/web/src/features/settings/provider-builders/public-http-provider-builder.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const API_KEY_PROVIDER = {
  id: "alpha_vantage",
  kind: "api-key",
  displayName: "Alpha Vantage",
  envVar: "ALPHA_VANTAGE_API_KEY",
  status: "absent",
  source: "absent",
  unlocks: ["company fundamentals", "earnings history"],
  signupUrl: "https://www.alphavantage.co/support/#api-key",
  instructionsHint: "Saved to ~/.opencandle/config.json.",
};

const EXTERNAL_TOOL_PROVIDER = {
  id: "reddit",
  kind: "external-tool",
  displayName: "Reddit",
  binary: "rdt",
  installCmd: "uv tool install rdt-cli",
  status: "unknown",
  supportedBrowsers: ["Chrome", "Arc"],
  fallbackDescription: "Sentiment summaries continue with web search when Reddit is unavailable",
};

const PUBLIC_HTTP_PROVIDER = {
  id: "yahoo",
  kind: "public-http",
  displayName: "Yahoo Finance",
  status: "unknown",
  probeUrl: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
  fallbackDescription: null,
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

function mount(element: React.ReactElement) {
  act(() => {
    root.render(React.createElement(TooltipProvider, null, element));
  });
}

function staticMarkup(element: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(TooltipProvider, null, element));
}

function buttonNamed(text: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeInto(input: HTMLInputElement | null, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("provider status helpers", () => {
  it("prefers the probed state over the coarse status", () => {
    expect(providerStatus({ status: "unknown", statusDetail: { state: "session_ok" } })).toBe(
      "session_ok",
    );
    expect(providerStatus({ status: "file" })).toBe("file");
    expect(providerStatus({})).toBe("absent");
  });

  it("labels each status in the words the rows read", () => {
    expect(statusLabel("file")).toBe("Configured");
    expect(statusLabel("env")).toBe("From environment");
    expect(statusLabel("skipped")).toBe("Skipped");
    expect(statusLabel("absent")).toBe("Not configured");
  });

  it("picks an icon per provider kind", () => {
    expect(providerIcon({ kind: "external-tool" })).not.toBe(providerIcon({ kind: "api-key" }));
    expect(providerIcon({ kind: "public-http" })).not.toBe(providerIcon({ kind: "api-key" }));
  });
});

describe("ApiKeyProviderBuilder", () => {
  it("saves a pasted key through provider.save_api_key", () => {
    const send = vi.fn().mockReturnValue(true);
    const setToast = vi.fn();
    mount(
      React.createElement(ApiKeyProviderBuilder, { provider: API_KEY_PROVIDER, send, setToast }),
    );

    expect(buttonNamed("Save key")).toBeTruthy();
    typeInto(container.querySelector("input"), "  av-key-123  ");
    click(buttonNamed("Save key"));

    expect(send).toHaveBeenCalledWith("provider.save_api_key", {
      providerId: "alpha_vantage",
      apiKey: "av-key-123",
    });
  });

  it("offers replacement once a key is stored", () => {
    const html = staticMarkup(
      React.createElement(ApiKeyProviderBuilder, {
        provider: { ...API_KEY_PROVIDER, status: "file", source: "file", maskedKeyHint: "…f00d" },
        send: vi.fn(),
        setToast: vi.fn(),
      }),
    );

    expect(html).toContain("Replace key");
    expect(html).toContain("Paste a new key to replace.");
    expect(html).toContain("…f00d");
  });

  it("keeps an environment-managed key read-only and explains how to override it", () => {
    const send = vi.fn();
    const setToast = vi.fn();
    const provider = { ...API_KEY_PROVIDER, status: "env", source: "env" };
    const html = staticMarkup(
      React.createElement(ApiKeyProviderBuilder, { provider, send, setToast }),
    );

    expect(html).toContain("From environment");
    expect(html).toContain("ALPHA_VANTAGE_API_KEY");
    expect(html).toContain("Unset that variable to manage the key here.");
    expect(html).toContain("disabled");

    mount(React.createElement(ApiKeyProviderBuilder, { provider, send, setToast }));
    click(buttonNamed("Save key"));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("ExternalToolProviderBuilder", () => {
  it("shows the install command and checks install and session state", () => {
    const send = vi.fn();
    const setToast = vi.fn();
    mount(
      React.createElement(ExternalToolProviderBuilder, {
        provider: EXTERNAL_TOOL_PROVIDER,
        send,
        setToast,
      }),
    );

    expect(container.textContent).toContain("uv tool install rdt-cli");
    click(buttonNamed("Check install"));
    click(buttonNamed("Check session"));

    expect(send).toHaveBeenNthCalledWith(1, "provider.status.check", {
      providerId: "reddit",
      mode: "install",
      reenable: false,
    });
    expect(send).toHaveBeenNthCalledWith(2, "provider.status.check", {
      providerId: "reddit",
      mode: "session",
      reenable: false,
    });
  });

  it("turns both checks into re-enable actions for a skipped provider", () => {
    const send = vi.fn();
    mount(
      React.createElement(ExternalToolProviderBuilder, {
        provider: { ...EXTERNAL_TOOL_PROVIDER, status: "skipped" },
        send,
        setToast: vi.fn(),
      }),
    );

    click(buttonNamed("Re-enable & check install"));
    click(buttonNamed("Re-enable & check session"));

    expect(send).toHaveBeenNthCalledWith(1, "provider.status.check", {
      providerId: "reddit",
      mode: "install",
      reenable: true,
    });
    expect(send).toHaveBeenNthCalledWith(2, "provider.status.check", {
      providerId: "reddit",
      mode: "session",
      reenable: true,
    });
  });
});

describe("PublicHttpProviderBuilder", () => {
  it("checks reachability against the published probe", () => {
    const send = vi.fn();
    mount(
      React.createElement(PublicHttpProviderBuilder, {
        provider: PUBLIC_HTTP_PROVIDER,
        send,
        setToast: vi.fn(),
      }),
    );

    expect(container.textContent).toContain(PUBLIC_HTTP_PROVIDER.probeUrl);
    click(buttonNamed("Check reachability"));

    expect(send).toHaveBeenCalledWith("provider.status.check", { providerId: "yahoo" });
  });

  it("offers no reachability check in the hosted app, where the runtime cannot probe", () => {
    const send = vi.fn();
    mount(
      React.createElement(PublicHttpProviderBuilder, {
        provider: { ...PUBLIC_HTTP_PROVIDER, hosted: true },
        send,
        setToast: vi.fn(),
      }),
    );

    expect(buttonNamed("Check reachability")).toBeUndefined();
    expect(container.textContent).toContain("negotiated with the relay");
  });
});

describe("ProviderBuilder dispatcher", () => {
  it("renders the builder that matches the provider kind", () => {
    expect(
      staticMarkup(
        React.createElement(ProviderBuilder, { provider: API_KEY_PROVIDER, send: vi.fn() }),
      ),
    ).toContain("Save key");
    expect(
      staticMarkup(
        React.createElement(ProviderBuilder, { provider: EXTERNAL_TOOL_PROVIDER, send: vi.fn() }),
      ),
    ).toContain("Check install");
    expect(
      staticMarkup(
        React.createElement(ProviderBuilder, { provider: PUBLIC_HTTP_PROVIDER, send: vi.fn() }),
      ),
    ).toContain("Check reachability");
  });
});
