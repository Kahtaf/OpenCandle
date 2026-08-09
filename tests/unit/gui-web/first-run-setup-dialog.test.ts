// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";
import { FIRST_RUN_ONBOARDING_SEEN_KEY } from "../../../gui/web/src/features/onboarding/setup-dismissal.js";

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
  localStorage.clear();
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

// A new chat, a route change, a reload, and a second tab all give the panel a
// fresh mount. Remounting is the only way to tell a remembered dismissal apart
// from state that merely survived a re-render.
function remountPanel(props: Record<string, unknown> = {}) {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  renderPanel(props);
}

function seenRecord() {
  return localStorage.getItem(FIRST_RUN_ONBOARDING_SEEN_KEY);
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

  it("does not open on the boot placeholder before a real setup broadcast arrives", () => {
    // During boot the connection state carries requirement "unknown" while the
    // role can already read "writer". That proves nothing about setup and must
    // not flash the dialog open, which also left a stuck Radix exit zombie
    // when the real "ready" broadcast closed it a frame later.
    renderPanel({
      modelSetup: { requirement: "unknown", providers: [], availableModels: [] },
    });

    expect(dialog()).toBeNull();
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

  it("records that onboarding was seen as soon as the dialog opens", () => {
    expect(seenRecord()).toBe(null);

    renderPanel();

    // Opening is what the record is about. A user who read the dialog and
    // navigated away without an explicit dismissal has still seen it.
    expect(dialog()).toBeTruthy();
    expect(seenRecord()).toBe("true");
  });

  it("does not record onboarding as seen on a boot where the dialog never opened", () => {
    // The boot placeholder and a reconnecting tab both keep the dialog closed.
    // Neither may burn a first-timer's one automatic opening.
    renderPanel({
      modelSetup: { requirement: "unknown", providers: [], availableModels: [] },
    });
    expect(seenRecord()).toBe(null);

    remountPanel({ role: "connecting" });
    expect(seenRecord()).toBe(null);

    remountPanel({ modelSetup: { requirement: "ready", providers: [], availableModels: [] } });
    expect(seenRecord()).toBe(null);
  });

  it("treats the legacy dismissal record as already seen and migrates it", () => {
    localStorage.removeItem("opencandle.onboarding.first-run-seen.v1");
    localStorage.setItem("opencandle.onboarding.first-run-dismissed.v1", "true");

    renderPanel();

    expect(dialog()).toBeNull();
    expect(localStorage.getItem("opencandle.onboarding.first-run-seen.v1")).toBe("true");
    expect(localStorage.getItem("opencandle.onboarding.first-run-dismissed.v1")).toBeNull();
  });

  it("stays closed on a mount where setup is required but onboarding was already seen", () => {
    // A returning browser profile: a reload lands on a real non-ready
    // requirement for a frame before stored keys resolve, which must not flash
    // the dialog open again.
    localStorage.setItem(FIRST_RUN_ONBOARDING_SEEN_KEY, "true");

    renderPanel();

    expect(dialog()).toBe(null);
  });

  it("stays closed across fresh mounts once onboarding has been seen", () => {
    renderPanel();
    closeDialog();
    expect(dialog()).toBe(null);

    // Starting a new chat, changing route, reloading, or opening a second tab.
    remountPanel();
    expect(dialog()).toBe(null);
    remountPanel({ modelSetup: { ...NEEDS_SETUP, requirement: "api_key" } });
    expect(dialog()).toBe(null);
  });

  it("never auto-opens again after setup is satisfied and later regresses", () => {
    renderPanel();
    closeDialog();

    // A saved key satisfies setup.
    remountPanel({ modelSetup: { requirement: "ready", providers: [], availableModels: [] } });
    expect(dialog()).toBe(null);

    // Keys cleared later: onboarding is a first-run introduction, not a nag.
    // Setup is reached from the composer's model control or Settings instead.
    remountPanel({ modelSetup: { ...NEEDS_SETUP } });
    expect(dialog()).toBe(null);
    remountPanel({ modelSetup: { ...NEEDS_SETUP, requirement: "api_key" } });
    expect(dialog()).toBe(null);
  });

  it("stays closed when setup regresses after being completed from the open dialog", () => {
    // The dialog closes by prop when setup completes, so Radix never fires
    // onOpenChange. The mounted panel must still count that as seen: a later
    // key clearing in the same mount must not reopen the dialog.
    renderPanel();
    expect(dialog()).toBeTruthy();

    renderPanel({ modelSetup: { requirement: "ready", providers: [], availableModels: [] } });
    expect(dialog()).toBeNull();

    renderPanel({ modelSetup: NEEDS_SETUP });
    expect(dialog()).toBeNull();
  });

  it("keeps the seen record while the connection is still being established", () => {
    renderPanel();
    closeDialog();

    // A reconnecting mount reports no requirement yet, and a later ready
    // broadcast is no longer a reason to forget anything either.
    remountPanel({ role: "connecting", modelSetup: undefined });
    expect(dialog()).toBe(null);
    expect(seenRecord()).toBe("true");
    remountPanel({ modelSetup: { ...NEEDS_SETUP } });
    expect(dialog()).toBe(null);
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
