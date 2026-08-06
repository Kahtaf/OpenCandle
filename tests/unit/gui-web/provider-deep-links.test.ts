// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  location: { pathname: "/", search: {} as Record<string, unknown> },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  return {
    useNavigate: () => routerMocks.navigate,
    useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
      select({ location: routerMocks.location }),
    Link: ({ to, params, children, ...props }) =>
      ReactModule.createElement(
        "a",
        { href: String(to).replace("$section", String(params?.section ?? "")), ...props },
        children,
      ),
  };
});

const guiMocks = vi.hoisted(() => ({
  catalog: {
    tools: [],
    workflows: [],
    providers: [
      {
        id: "alpha_vantage",
        kind: "api-key",
        displayName: "Alpha Vantage",
        envVar: "ALPHA_VANTAGE_API_KEY",
        status: "absent",
        source: "absent",
        unlocks: ["company fundamentals"],
      },
    ],
  } as Record<string, unknown>,
}));

vi.mock("../../../gui/web/src/hooks/useGuiConnection.jsx", () => ({
  useGuiConnection: () => ({
    role: "writer",
    supportsSessionActions: true,
    currentSessionId: "",
    currentSessionPersisted: false,
    sessions: [],
    sessionSnapshots: {},
    events: [],
    dashboard: null,
    askUserPrompts: [],
    modelSetup: { requirement: "ready", providers: [], availableModels: [] },
    catalog: guiMocks.catalog,
    coordination: null,
    setToast: vi.fn(),
    send: vi.fn(),
    invokeTool: vi.fn(),
    newSession: vi.fn(),
    loadSession: vi.fn(),
    adoptSessionId: vi.fn(),
  }),
}));

vi.mock("../../../gui/web/src/hooks/useChatRun.jsx", () => ({
  useChatRun: () => ({
    runState: "idle",
    lastPrompt: "",
    startChatRun: vi.fn(),
    stopRun: vi.fn(),
  }),
}));

vi.mock("../../../gui/web/src/features/chat/ChatPanel.jsx", async () => {
  const ReactModule = await import("react");
  return { ChatPanel: () => ReactModule.createElement("div", { "data-page": "chat" }) };
});

import { AppShell } from "../../../gui/web/src/App.jsx";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  routerMocks.navigate.mockClear();
  routerMocks.location = { pathname: "/", search: {} };
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

function renderAt(pathname: string, search: Record<string, unknown> = {}) {
  routerMocks.location = { pathname, search };
  act(() => {
    root.render(React.createElement(TooltipProvider, null, React.createElement(AppShell)));
  });
}

function providerSettingsNavigations() {
  return routerMocks.navigate.mock.calls.filter(
    ([options]) => options?.to === "/settings/$section" && options?.params?.section === "providers",
  );
}

function resolvedSearch(options: { search?: (current: Record<string, unknown>) => unknown }) {
  return typeof options.search === "function"
    ? options.search(routerMocks.location.search as Record<string, unknown>)
    : options.search;
}

describe("legacy provider deep links", () => {
  it("sends ?drawer=providers to the Data providers section with the provider kept", () => {
    renderAt("/", { drawer: "providers", provider: "alpha_vantage" });

    const [options] = providerSettingsNavigations()[0] ?? [];
    expect(options).toBeTruthy();
    expect(options.replace).toBe(true);
    expect(resolvedSearch(options)).toMatchObject({ drawer: undefined, provider: "alpha_vantage" });
    // The catalog sheet must not also open on the way through.
    expect(document.body.querySelector('[data-slot="sheet-content"]')).toBe(null);
  });

  it("sends a catalog link that names a provider to the same place", () => {
    renderAt("/", { drawer: "catalog", provider: "alpha_vantage" });

    expect(providerSettingsNavigations()).toHaveLength(1);
  });

  it("leaves a plain catalog link alone", () => {
    renderAt("/", { drawer: "catalog" });

    expect(providerSettingsNavigations()).toHaveLength(0);
  });

  it("opens the named provider row once Settings renders", () => {
    renderAt("/settings/providers", { provider: "alpha_vantage" });

    const trigger = container.querySelector(
      '[data-slot="provider-row"][data-provider="alpha_vantage"] [data-slot="provider-row-trigger"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Save key");
  });
});
