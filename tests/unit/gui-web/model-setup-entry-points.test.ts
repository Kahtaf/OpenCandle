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

const guiMocks = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock("../../../gui/web/src/hooks/useGuiConnection.jsx", () => ({
  useGuiConnection: () => ({
    role: "writer",
    supportsSessionActions: true,
    currentSessionId: "",
    currentSessionPersisted: false,
    sessions: [],
    sessionSnapshots: {},
    events: guiMocks.events,
    dashboard: null,
    askUserPrompts: [],
    modelSetup: { requirement: "ready", providers: [], availableModels: [] },
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

import { AppShell } from "../../../gui/web/src/App.jsx";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
import { ModelSelector } from "../../../gui/web/src/features/chat/model-selector.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }),
      ),
  );
  // jsdom has no layout, so the transcript scroller's positioning calls need a
  // stub before the panel can mount with content.
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  routerMocks.navigate.mockClear();
  routerMocks.location = { pathname: "/", search: {} };
  guiMocks.events = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const READY_SETUP = {
  requirement: "ready",
  providers: [
    {
      id: "openai",
      label: "OpenAI",
      envVar: "OPENAI_API_KEY",
      defaultModel: "gpt-5-mini",
      signupUrl: "https://platform.openai.com/api-keys",
    },
  ],
  currentModel: "openai/gpt-5-mini",
  availableModels: [{ provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" }],
};

const NEEDS_SETUP = {
  requirement: "connect_auth",
  providers: READY_SETUP.providers,
  availableModels: [],
};

const MODEL_FAILURE_EVENTS = [
  {
    type: "custom.message",
    sessionId: "s1",
    messageId: "cm1",
    customType: "opencandle-model-run-failed",
    content: [{ type: "text", text: "Chat could not authenticate the configured model key." }],
    details: { source: "gui", reason: "model_auth", prompt: "quote NVDA" },
    seq: 1,
  },
];

function queryAll<T extends Element>(selector: string): T[] {
  return [...document.body.querySelectorAll<T>(selector)];
}

function buttonNamed(text: string) {
  return queryAll<HTMLButtonElement>("button").find(
    (button) => button.textContent?.trim() === text,
  );
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function dialog() {
  return document.body.querySelector('[data-slot="dialog-content"]');
}

function modelSettingsNavigations() {
  return routerMocks.navigate.mock.calls.filter(
    ([options]) => options?.to === "/settings/$section" && options?.params?.section === "model",
  );
}

function renderChatPanel(props: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          ToolDrawerProvider,
          null,
          React.createElement(ChatPanel, {
            events: [],
            liveEvents: [],
            askUserPrompts: [],
            modelSetup: READY_SETUP,
            role: "writer",
            runState: "ready",
            catalog: { tools: [], workflows: [], providers: [] },
            send: vi.fn(),
            startChatRun: vi.fn(),
            setToast: vi.fn(),
            onOpenCommandPalette: vi.fn(),
            ...props,
          }),
        ),
      ),
    );
  });
}

// main.jsx mounts the shell inside the tooltip provider; the shell itself has
// tooltip consumers, so the test frame has to match.
function renderApp() {
  act(() => {
    root.render(React.createElement(TooltipProvider, null, React.createElement(AppShell)));
  });
}

describe("composer model chip key management", () => {
  it("hands manage-keys to its host instead of opening a dialog", () => {
    const onManageKeys = vi.fn();
    act(() => {
      root.render(
        React.createElement(ModelSelector, {
          modelSetup: READY_SETUP,
          role: "writer",
          send: vi.fn(),
          onManageKeys,
        }),
      );
    });

    click(buttonNamed("Manage model keys…"));

    expect(onManageKeys).toHaveBeenCalledTimes(1);
    // The manage-variant dialog is gone from the composer path entirely.
    expect(dialog()).toBe(null);
    expect(document.body.querySelector('[role="dialog"]')).toBe(null);
  });

  it("threads the chat panel's model-setup entry point down to the chip", () => {
    const onOpenModelSetup = vi.fn();
    renderChatPanel({ onOpenModelSetup });

    click(buttonNamed("Manage model keys…"));

    expect(onOpenModelSetup).toHaveBeenCalledTimes(1);
    expect(dialog()).toBe(null);
  });

  it("routes the transcript key-repair action through the same entry point", () => {
    const onOpenModelSetup = vi.fn();
    renderChatPanel({ onOpenModelSetup, events: MODEL_FAILURE_EVENTS });

    click(buttonNamed("Fix model key"));

    expect(onOpenModelSetup).toHaveBeenCalledTimes(1);
  });
});

describe("app-level model setup entry points", () => {
  it("navigates to the Model settings section from the composer chip", () => {
    renderApp();

    // Nothing mounts a manage-variant dialog at the app level any more.
    expect(dialog()).toBe(null);

    click(buttonNamed("Manage model keys…"));

    expect(modelSettingsNavigations()).toHaveLength(1);
    expect(dialog()).toBe(null);
  });

  it("navigates to the Model settings section from the transcript CTA", () => {
    guiMocks.events = MODEL_FAILURE_EVENTS;
    renderApp();

    click(buttonNamed("Fix model key"));

    expect(modelSettingsNavigations()).toHaveLength(1);
    expect(dialog()).toBe(null);
  });
});

describe("first-run onboarding never navigates to settings", () => {
  it("stays on the chat route when the dialog is dismissed or satisfied", () => {
    const onOpenModelSetup = vi.fn();
    renderChatPanel({ modelSetup: NEEDS_SETUP, onOpenModelSetup });
    expect(dialog()).toBeTruthy();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(dialog()).toBe(null);
    expect(routerMocks.navigate).not.toHaveBeenCalled();
    expect(onOpenModelSetup).not.toHaveBeenCalled();

    // Completing setup is likewise not a reason to move the user to Settings.
    renderChatPanel({ modelSetup: READY_SETUP, onOpenModelSetup });
    expect(routerMocks.navigate).not.toHaveBeenCalled();
    expect(onOpenModelSetup).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
  });
});
