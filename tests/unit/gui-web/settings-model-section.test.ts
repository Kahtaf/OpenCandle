// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsSectionRegistry } from "../../../gui/web/src/features/settings/section-registry.jsx";
import { ModelSection } from "../../../gui/web/src/features/settings/sections/ModelSection.jsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5-mini",
    signupUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    signupUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4",
    signupUrl: "https://console.anthropic.com/settings/keys",
  },
];

const READY_SETUP = {
  requirement: "ready",
  providers: PROVIDERS,
  currentModel: "openai/gpt-5-mini",
  availableModels: [
    { provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" },
    { provider: "openai", id: "gpt-4.1-mini", label: "openai/gpt-4.1-mini" },
  ],
  availableThinkingLevels: ["off", "low", "high"],
  currentThinkingLevel: "low",
};

function renderSection(props: Record<string, unknown> = {}) {
  const send = vi.fn();
  const setToast = vi.fn();
  act(() => {
    root.render(
      React.createElement(ModelSection, {
        modelSetup: READY_SETUP,
        role: "writer",
        send,
        setToast,
        ...props,
      }),
    );
  });
  return { send, setToast };
}

function query<T extends Element>(selector: string): T | null {
  return document.body.querySelector<T>(selector);
}

function queryAll<T extends Element>(selector: string): T[] {
  return [...document.body.querySelectorAll<T>(selector)];
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function providerOptions() {
  return queryAll<HTMLButtonElement>('[data-slot="provider-option"]');
}

function chooseProvider(label: string) {
  click(providerOptions().find((option) => option.textContent?.includes(label)));
}

function keyInput() {
  return query<HTMLInputElement>('[data-slot="provider-key-input"]');
}

function saveButton() {
  return query<HTMLButtonElement>('[data-slot="provider-key-save"]');
}

function buttonNamed(text: string) {
  return queryAll<HTMLButtonElement>("button").find(
    (button) => button.textContent?.trim() === text,
  );
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Settings model section", () => {
  it("is the registered component for the model section", () => {
    expect(settingsSectionRegistry.model.Component).toBe(ModelSection);
  });

  it("renders the provider list, model select, and refresh with no dialog around them", () => {
    renderSection();

    expect(providerOptions().map((option) => option.textContent)).toEqual([
      expect.stringContaining("OpenAI"),
      expect.stringContaining("Google Gemini"),
      expect.stringContaining("Anthropic"),
    ]);
    expect(query('[data-slot="connect-model-panel"]')).toBeTruthy();
    const select = query<HTMLSelectElement>("select");
    expect(select?.value).toBe("openai/gpt-5-mini");
    expect(buttonNamed("Refresh")).toBeTruthy();

    // A page section, not a modal: nothing here may mount dialog chrome.
    expect(query('[role="dialog"]')).toBe(null);
    expect(query('[data-slot="dialog-content"]')).toBe(null);
    expect(query('[data-slot="dialog-overlay"]')).toBe(null);
    expect(query('[data-slot="carousel-dot"]')).toBe(null);
  });

  it("saves a key through the same probe-before-save command with an inline pending state", () => {
    const { send, setToast } = renderSection();
    chooseProvider("OpenAI");

    const input = keyInput();
    expect(input?.type).toBe("password");
    setValue(input as HTMLInputElement, "  sk-settings-secret  ");
    click(saveButton());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("model.setup.save_api_key", {
      provider: "openai",
      apiKey: "sk-settings-secret",
    });
    expect(saveButton()?.disabled).toBe(true);
    expect(saveButton()?.getAttribute("aria-busy")).toBe("true");
    expect(setToast).not.toHaveBeenCalled();
  });

  it("reports a rejected key in the inline error band rather than a toast", () => {
    const { setToast } = renderSection({
      modelSetup: {
        ...READY_SETUP,
        error: "Key was rejected by OpenAI. The existing configuration was not changed.",
      },
    });

    const band = query('[data-slot="model-setup-error"]');
    expect(band?.getAttribute("role")).toBe("alert");
    expect(band?.textContent).toContain("Key was rejected by OpenAI");
    expect(band?.closest('[data-slot="connect-model-panel"]')).toBeTruthy();
    expect(setToast).not.toHaveBeenCalled();
  });

  it("dispatches model.setup.select_model from the model picker", () => {
    const { send } = renderSection();

    const select = query<HTMLSelectElement>("select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter?.call(select, "openai/gpt-4.1-mini");
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(send).toHaveBeenCalledWith("model.setup.select_model", {
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });
  });

  it("dispatches model.setup.set_thinking from the reasoning default control", () => {
    const { send } = renderSection();

    const levels = queryAll<HTMLButtonElement>('[data-slot="thinking-level-option"]');
    expect(levels.map((level) => level.textContent?.trim())).toEqual(["off", "low", "high"]);
    expect(levels[1].getAttribute("aria-pressed")).toBe("true");

    click(levels[2]);

    expect(send).toHaveBeenCalledWith("model.setup.set_thinking", { level: "high" });
  });

  it("omits the reasoning control when the model offers no choice of level", () => {
    renderSection({
      modelSetup: { ...READY_SETUP, availableThinkingLevels: ["off"] },
    });

    expect(queryAll('[data-slot="thinking-level-option"]')).toHaveLength(0);
  });

  it("keeps a local follower read-only across the whole section", () => {
    const { send } = renderSection({ role: "follower" });

    expect(document.body.textContent).toContain("Model setup changes are unavailable");
    expect(providerOptions().every((option) => option.disabled)).toBe(true);
    click(queryAll<HTMLButtonElement>('[data-slot="thinking-level-option"]').at(-1));
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a hosted follower fully enabled", () => {
    renderSection({
      role: "follower",
      modelSetup: { ...READY_SETUP, hosted: true },
    });

    expect(document.body.textContent).not.toContain("setup changes are unavailable");
    expect(providerOptions().every((option) => option.disabled)).toBe(false);
    expect(
      queryAll<HTMLButtonElement>('[data-slot="thinking-level-option"]').every(
        (option) => option.disabled,
      ),
    ).toBe(false);
  });
});
