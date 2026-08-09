import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    modelSetup: { requirement: "ready" },
    catalog: null,
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

vi.mock("../../../gui/web/src/features/settings/SettingsPage.jsx", async () => {
  const ReactModule = await import("react");
  return {
    SettingsPage: ({ section }: { section: string }) =>
      ReactModule.createElement("div", { "data-page": "settings", "data-section": section }),
  };
});

vi.mock("../../../gui/web/src/features/market-state/MarketStatePage.jsx", async () => {
  const ReactModule = await import("react");
  return {
    MarketStatePage: ({ domain }: { domain: string }) =>
      ReactModule.createElement("div", { "data-page": "market-state", "data-domain": domain }),
  };
});

vi.mock("../../../gui/web/src/features/symbol/SymbolPage.jsx", async () => {
  const ReactModule = await import("react");
  return {
    default: ({ ticker }: { ticker: string }) =>
      ReactModule.createElement("div", { "data-page": "symbol", "data-ticker": ticker }),
  };
});

import { AppShell } from "../../../gui/web/src/App.jsx";

function renderAt(pathname: string) {
  routerMocks.location = { pathname, search: {} };
  return renderToStaticMarkup(React.createElement(AppShell));
}

describe("AppShell page dispatch", () => {
  beforeEach(() => {
    routerMocks.navigate.mockClear();
  });

  it("renders the Settings page for /settings instead of the chat panel", () => {
    const html = renderAt("/settings");

    expect(html).toContain('data-page="settings"');
    expect(html).toContain('data-section="model"');
    expect(html).not.toContain('data-page="chat"');
  });

  it.each([
    ["/settings/providers", "providers"],
    ["/settings/preferences", "preferences"],
    ["/settings/data", "data"],
    ["/settings/bogus", "model"],
  ])("renders %s with the %s section active", (pathname, section) => {
    const html = renderAt(pathname);

    expect(html).toContain('data-page="settings"');
    expect(html).toContain(`data-section="${section}"`);
    expect(html).not.toContain('data-page="chat"');
  });

  it("keeps /diagnostics on the Diagnostics section of the Settings page", () => {
    const html = renderAt("/diagnostics");

    expect(html).toContain('data-page="settings"');
    expect(html).toContain('data-section="diagnostics"');
    expect(html).not.toContain('data-page="chat"');
  });

  it("still dispatches symbol, market-state, and chat pages", () => {
    expect(renderAt("/symbol/AAPL")).toContain('data-page="symbol"');
    expect(renderAt("/watchlists")).toContain('data-page="market-state"');
    expect(renderAt("/sessions/abc")).toContain('data-page="chat"');
  });
});
