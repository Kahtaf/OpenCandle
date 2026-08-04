// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
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

const NEEDS_SETUP = {
  requirement: "connect_auth",
  providers: [
    {
      id: "openai",
      label: "OpenAI",
      envVar: "OPENAI_API_KEY",
      defaultModel: "gpt-5-mini",
      signupUrl: "https://platform.openai.com/api-keys",
    },
  ],
  availableModels: [],
};

function renderPanel(props: Record<string, unknown> = {}) {
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
            modelSetup: NEEDS_SETUP,
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

function dialog() {
  return document.body.querySelector('[data-slot="dialog-content"]');
}

function composer() {
  return document.getElementById("chat-composer") as HTMLTextAreaElement | null;
}

function closeDialog() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

describe("first-run model setup dialog in ChatPanel", () => {
  it("opens automatically when setup is required and leaves the home surface behind it", () => {
    renderPanel();

    expect(dialog()).toBeTruthy();
    expect(dialog()?.textContent).toContain("OpenCandle is a research agent");
    // The setup card no longer replaces the home surface.
    expect(container.querySelector('[data-slot="home-dashboard"]')).toBeTruthy();
    // A standard modal dialog: the surface behind it is inert while it is up.
    expect(container.getAttribute("aria-hidden")).toBe("true");
  });

  it("frees the composer for drafting as soon as the dialog is dismissed", () => {
    renderPanel();
    // The invariant is "setup does not strand you", not "the composer works
    // underneath an open dialog" — dismissal is one Escape or one click.
    closeDialog();
    expect(dialog()).toBe(null);

    const textarea = composer();
    expect(textarea).toBeTruthy();
    expect(textarea?.disabled).toBe(false);
    expect(textarea?.closest("[aria-hidden='true']")).toBe(null);
    expect(container.getAttribute("aria-hidden")).toBe(null);

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(textarea, "Draft while I find my key");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(composer()?.value).toBe("Draft while I find my key");
  });

  it("does not reopen after dismissal while setup stays required", () => {
    renderPanel();
    closeDialog();
    expect(dialog()).toBe(null);

    // A fresh model-setup broadcast that still needs setup must not nag.
    renderPanel({ modelSetup: { ...NEEDS_SETUP } });
    expect(dialog()).toBe(null);
    renderPanel({ modelSetup: { ...NEEDS_SETUP, requirement: "api_key" } });
    expect(dialog()).toBe(null);
  });

  it("reopens only after setup is satisfied and later becomes required again", () => {
    renderPanel();
    closeDialog();
    expect(dialog()).toBe(null);

    renderPanel({ modelSetup: { requirement: "ready", providers: [], availableModels: [] } });
    expect(dialog()).toBe(null);

    renderPanel({ modelSetup: { ...NEEDS_SETUP } });
    expect(dialog()).toBeTruthy();
  });

  it("moves focus to the composer when the first-run dialog closes", async () => {
    renderPanel();
    closeDialog();

    // Radix defers its close-autofocus event to a macrotask.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.activeElement).toBe(composer());
  });

  it("stays closed while the connection is still being established", () => {
    renderPanel({ role: "connecting" });
    expect(dialog()).toBe(null);
  });
});
