// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSetupDialog } from "../../../gui/web/src/features/onboarding/ModelSetupCard.jsx";
import { ProviderKeyFlow } from "../../../gui/web/src/features/onboarding/ProviderKeyFlow.jsx";

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

const LOCAL_PROVIDERS = [
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

type SetupProps = Record<string, unknown>;

function renderCard(props: SetupProps = {}) {
  const send = vi.fn();
  const setToast = vi.fn();
  const onOpenChange = vi.fn();
  act(() => {
    root.render(
      React.createElement(ModelSetupDialog, {
        open: true,
        onOpenChange,
        variant: "first-run",
        modelSetup: {
          requirement: "connect_auth",
          providers: LOCAL_PROVIDERS,
          availableModels: [],
        },
        send,
        setToast,
        ...props,
      }),
    );
  });
  return { send, setToast, onOpenChange };
}

function renderDialog(props: SetupProps = {}) {
  const send = vi.fn();
  const setToast = vi.fn();
  act(() => {
    root.render(
      React.createElement(ModelSetupDialog, {
        open: true,
        onOpenChange: vi.fn(),
        modelSetup: {
          requirement: "ready",
          providers: LOCAL_PROVIDERS,
          availableModels: [],
        },
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

function byLabel(label: string) {
  return queryAll<HTMLElement>("[aria-label]").find(
    (element) => element.getAttribute("aria-label") === label,
  );
}

// Embla keeps every slide mounted in its track, so "visible" is the slide it
// marks active — off-screen slides are `aria-hidden` and `inert`.
function visibleText() {
  const slides = queryAll('[data-slot="carousel-item"]');
  if (slides.length === 0) return document.body.textContent ?? "";
  return slides
    .filter((slide) => slide.getAttribute("data-active") === "true")
    .map((slide) => slide.textContent ?? "")
    .join("\n");
}

function goToConnectStep() {
  click(queryAll<HTMLButtonElement>('[data-slot="carousel-dot"]').at(-1));
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

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonNamed(text: string) {
  return queryAll<HTMLButtonElement>("button").find(
    (button) => button.textContent?.trim() === text,
  );
}

function saveButton() {
  return query<HTMLButtonElement>('[data-slot="provider-key-save"]');
}

describe("onboarding carousel", () => {
  it("opens the first run on the brand slide, not the key form", () => {
    renderCard();

    const dots = queryAll<HTMLButtonElement>('[data-slot="carousel-dot"]');
    expect(dots).toHaveLength(5);
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual([
      "Go to step 1 of 5",
      "Go to step 2 of 5",
      "Go to step 3 of 5",
      "Go to step 4 of 5",
      "Go to step 5 of 5",
    ]);
    expect(dots[0].getAttribute("aria-current")).toBe("step");
    expect(visibleText()).toContain("OpenCandle is a research agent");
    expect(visibleText()).not.toContain("Connect an AI model");
    expect(providerOptions()).toHaveLength(0);
  });

  it("pages the explainers from side arrows and drops them on the setup step", () => {
    renderCard();

    // Named icon controls, not the old footer text buttons.
    const previous = () => query<HTMLButtonElement>('[data-slot="carousel-previous"]');
    const next = () => query<HTMLButtonElement>('[data-slot="carousel-next"]');
    expect(next()?.getAttribute("aria-label")).toBe("Next step");
    // No dead disc over the artwork on the opening slide.
    expect(previous()).toBe(null);

    click(next());
    expect(previous()?.getAttribute("aria-label")).toBe("Previous step");
    expect(previous()?.disabled).toBe(false);
    expect(visibleText()).toContain("Answers you can check");
    click(previous());
    expect(visibleText()).toContain("OpenCandle is a research agent");

    // The setup step is a form whose full-width controls the arrows would
    // cover, and one stray arrow click there would discard a typed key.
    goToConnectStep();
    expect(previous()).toBe(null);
    expect(next()).toBe(null);
    // Its own Back replaces them, and Skip retires once you have arrived.
    expect(buttonNamed("Back")).toBeTruthy();
    expect(buttonNamed("Skip")).toBe(undefined);
  });

  it("offers Skip on every explainer, including the last one", () => {
    renderCard();

    for (let step = 0; step < 4; step += 1) {
      click(byLabel(`Go to step ${step + 1} of 5`));
      // Narrow screens have no side arrows, so this is the one control that is
      // always both visible and forward-moving.
      expect(buttonNamed("Skip")).toBeTruthy();
    }

    click(buttonNamed("Skip"));
    expect(visibleText()).toContain("Connect an AI model");
  });

  it("reaches the provider choice through Next", () => {
    renderCard();

    click(query('[data-slot="carousel-next"]'));
    click(query('[data-slot="carousel-next"]'));
    click(query('[data-slot="carousel-next"]'));
    click(query('[data-slot="carousel-next"]'));

    expect(visibleText()).toContain("Connect an AI model");
    expect(providerOptions().map((option) => option.textContent)).toEqual([
      expect.stringContaining("OpenAI"),
      expect.stringContaining("Google Gemini"),
      expect.stringContaining("Anthropic"),
    ]);
    expect(keyInput()).toBe(null);
  });

  it("sends the exact local save_api_key payload and clears the field", () => {
    const { send } = renderCard();
    goToConnectStep();
    chooseProvider("OpenAI");

    const input = keyInput();
    expect(input?.type).toBe("password");
    expect(input?.getAttribute("autocomplete")).toBe("off");
    expect(input?.getAttribute("spellcheck")).toBe("false");
    expect(input?.value).toBe("");

    setValue(input as HTMLInputElement, "  sk-local-secret  ");
    click(saveButton());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("model.setup.save_api_key", {
      provider: "openai",
      apiKey: "sk-local-secret",
    });
    expect(keyInput()?.value).toBe("");
  });

  it("adds the hosted storage mode to the save payload from a radio group", () => {
    const { send } = renderCard({
      modelSetup: {
        hosted: true,
        requirement: "api_key",
        storageMode: "session",
        providers: LOCAL_PROVIDERS,
        availableModels: [],
      },
    });
    goToConnectStep();
    chooseProvider("OpenAI");

    const radios = queryAll<HTMLElement>('[data-slot="radio-group-item"]');
    expect(radios).toHaveLength(2);
    expect(radios[1].getAttribute("data-state")).toBe("checked");

    act(() => radios[0].click());
    setValue(keyInput() as HTMLInputElement, "sk-hosted-secret");
    click(saveButton());

    expect(send).toHaveBeenCalledWith("model.setup.save_api_key", {
      provider: "openai",
      apiKey: "sk-hosted-secret",
      storageMode: "persistent",
    });
  });

  it("defaults hosted storage to persistent and omits the radios locally", () => {
    const { send } = renderCard({
      modelSetup: {
        hosted: true,
        requirement: "api_key",
        providers: LOCAL_PROVIDERS,
        availableModels: [],
      },
    });
    goToConnectStep();
    chooseProvider("Google Gemini");
    setValue(keyInput() as HTMLInputElement, "hosted-google");
    click(saveButton());
    expect(send).toHaveBeenCalledWith("model.setup.save_api_key", {
      provider: "google",
      apiKey: "hosted-google",
      storageMode: "persistent",
    });

    renderCard();
    goToConnectStep();
    chooseProvider("Google Gemini");
    expect(queryAll('[data-slot="radio-group-item"]')).toHaveLength(0);
  });

  it("refuses an empty key with an inline field error instead of a toast", () => {
    const { send, setToast } = renderCard();
    goToConnectStep();
    chooseProvider("OpenAI");

    setValue(keyInput() as HTMLInputElement, "   ");
    click(saveButton());

    const fieldError = query('[data-slot="provider-key-error"]');
    expect(fieldError?.getAttribute("role")).toBe("alert");
    expect(fieldError?.textContent).toContain("Paste an API key first.");
    expect(keyInput()?.getAttribute("aria-invalid")).toBe("true");
    expect(keyInput()?.getAttribute("aria-describedby")).toContain(fieldError?.id);
    expect(send).not.toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalled();

    setValue(keyInput() as HTMLInputElement, "sk-recovered");
    expect(query('[data-slot="provider-key-error"]')).toBe(null);
  });

  it("shows an inline pending state on save instead of a saving toast", () => {
    const { setToast } = renderCard();
    goToConnectStep();
    chooseProvider("OpenAI");
    setValue(keyInput() as HTMLInputElement, "sk-pending");
    click(saveButton());

    expect(saveButton()?.textContent).toContain("Saving");
    expect(saveButton()?.disabled).toBe(true);
    expect(saveButton()?.getAttribute("aria-busy")).toBe("true");
    expect(setToast).not.toHaveBeenCalled();
  });

  it("disables local follower setup and never sends from that state", () => {
    const { send, setToast } = renderCard({ role: "follower" });
    goToConnectStep();

    expect(visibleText()).toContain("Model setup changes are unavailable");
    expect(providerOptions().every((option) => option.disabled)).toBe(true);

    chooseProvider("OpenAI");
    expect(send).not.toHaveBeenCalled();
    expect(setToast).not.toHaveBeenCalled();
  });

  it("keeps hosted followers fully enabled and free of the unavailable banner", () => {
    renderCard({
      role: "follower",
      modelSetup: {
        hosted: true,
        requirement: "api_key",
        providers: LOCAL_PROVIDERS,
        availableModels: [],
      },
    });
    goToConnectStep();

    expect(visibleText()).not.toContain("setup changes are unavailable");
    expect(providerOptions().every((option) => option.disabled)).toBe(false);
    expect(visibleText()).toContain("audited relay");
    expect(visibleText()).not.toContain("Runs directly from this browser");

    chooseProvider("OpenAI");
    expect(keyInput()?.disabled).toBe(false);
    expect(saveButton()?.disabled).toBe(false);
  });

  it("renders a validation error as an alert inside the setup step", () => {
    renderCard({
      modelSetup: {
        requirement: "connect_auth",
        providers: LOCAL_PROVIDERS,
        availableModels: [],
        error: "Key was rejected by OpenAI. The existing configuration was not changed.",
      },
    });
    goToConnectStep();

    const alert = query('[data-slot="model-setup-error"]');
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("Key was rejected by OpenAI");
    expect(alert?.closest('[data-slot="connect-model-panel"]')).toBeTruthy();
  });

  it("dispatches select_model from the available-model picker", () => {
    const { send } = renderCard({
      modelSetup: {
        requirement: "select_model",
        providers: LOCAL_PROVIDERS,
        availableModels: [
          { provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" },
          { provider: "openai", id: "gpt-4.1-mini", label: "openai/gpt-4.1-mini" },
        ],
      },
    });
    goToConnectStep();

    const select = query<HTMLSelectElement>("select");
    expect(select).toBeTruthy();
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

  it("sends model.setup.refresh from the setup step", () => {
    const { send } = renderCard();
    goToConnectStep();

    click(buttonNamed("Refresh"));

    expect(send).toHaveBeenCalledWith("model.setup.refresh");
  });

  it("never auto-fires a setup command while moving between steps or providers", () => {
    const { send } = renderCard();

    click(query('[data-slot="carousel-next"]'));
    goToConnectStep();
    chooseProvider("OpenAI");
    click(buttonNamed("Back"));
    chooseProvider("Anthropic");
    click(byLabel("Go to step 1 of 5"));
    goToConnectStep();

    expect(send).not.toHaveBeenCalled();
  });

  it("drops a typed key when the user leaves the key form or the setup step", () => {
    renderCard();
    goToConnectStep();
    chooseProvider("OpenAI");
    setValue(keyInput() as HTMLInputElement, "sk-should-not-survive");
    expect(keyInput()?.value).toBe("sk-should-not-survive");

    click(buttonNamed("Back"));
    chooseProvider("OpenAI");
    expect(keyInput()?.value).toBe("");

    setValue(keyInput() as HTMLInputElement, "sk-also-not-surviving");
    click(byLabel("Go to step 1 of 5"));
    // The mechanism, asserted directly: every slide stays mounted in embla's
    // track, so the panel holding the key must be unmounted by the step
    // conditional rather than merely scrolled off screen.
    expect(query('[data-slot="connect-model-panel"]')).toBe(null);
    expect(document.body.innerHTML).not.toContain("sk-also-not-surviving");

    goToConnectStep();
    expect(keyInput()).toBe(null);
    expect(document.body.innerHTML).not.toContain("sk-also-not-surviving");
  });

  it("never echoes a stored key back into the DOM", () => {
    renderCard({
      modelSetup: {
        requirement: "select_model",
        currentModel: "openai/gpt-5-mini",
        providers: LOCAL_PROVIDERS.map((provider) => ({
          ...provider,
          apiKey: "sk-stored-secret",
          authState: "configured",
        })),
        availableModels: [{ provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" }],
      },
    });
    goToConnectStep();
    chooseProvider("OpenAI");

    expect(keyInput()?.value).toBe("");
    expect(document.body.innerHTML).not.toContain("sk-stored-secret");
  });

  it("shows the manage-keys dialog only the connect step, with no route into onboarding", () => {
    renderDialog();

    expect(query('[role="dialog"]')).toBeTruthy();
    expect(visibleText()).toContain("Connect a model");
    expect(providerOptions()).toHaveLength(3);
    // A returning user must not be offered step dots or a Back control that
    // would drop them into first-run onboarding they did not ask for.
    expect(queryAll('[data-slot="carousel-dot"]')).toHaveLength(0);
    expect(buttonNamed("Back")).toBe(undefined);
    expect(visibleText()).not.toContain("Answers you can check");
    // The brand slide belongs to first run only; it must not leak in here.
    expect(document.body.textContent).not.toContain("Market research, on your machine");
  });

  it("renders the setup step for every model-setup requirement", () => {
    for (const requirement of ["unknown", "connect_auth", "api_key", "select_model", "ready"]) {
      renderCard({
        modelSetup: { requirement, providers: LOCAL_PROVIDERS, availableModels: [] },
      });
      goToConnectStep();
      expect(providerOptions()).toHaveLength(3);
      expect(visibleText()).toMatch(/Connect an? (AI )?model/);
    }
  });

  it("explains itself when no providers have been reported yet", () => {
    // The exact shape `requirement: "unknown"` arrives in before the server has
    // answered: EMPTY_MODEL_SETUP from useGuiConnection.
    renderCard({
      modelSetup: { requirement: "unknown", providers: [], availableModels: [] },
    });
    goToConnectStep();

    expect(providerOptions()).toHaveLength(0);
    const empty = query('[data-slot="provider-list-empty"]');
    expect(empty?.textContent).toContain("not reported which model providers are available yet");
    expect(buttonNamed("Refresh")).toBeTruthy();
  });

  it("clears a provider's rejection banner when the user switches provider", () => {
    renderCard({
      modelSetup: {
        requirement: "connect_auth",
        providers: LOCAL_PROVIDERS,
        availableModels: [],
        error: "Key was rejected by OpenAI. The existing configuration was not changed.",
      },
    });
    goToConnectStep();
    expect(query('[data-slot="model-setup-error"]')).toBeTruthy();

    chooseProvider("Anthropic");

    expect(query('[data-slot="model-setup-error"]')).toBe(null);
    expect(document.body.textContent).not.toContain("Key was rejected by OpenAI");
  });
});

describe("carousel keyboard scope on the connect step", () => {
  function pressArrow(target: Element | null | undefined, key: string) {
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  it("leaves arrow keys to the key field instead of navigating away from it", () => {
    renderCard();
    goToConnectStep();
    chooseProvider("OpenAI");
    setValue(keyInput() as HTMLInputElement, "sk-arrow-safe");

    pressArrow(keyInput(), "ArrowLeft");
    pressArrow(keyInput(), "ArrowRight");

    // Still on the connect step, still the same provider, key intact.
    expect(keyInput()?.value).toBe("sk-arrow-safe");
    expect(
      queryAll<HTMLButtonElement>('[data-slot="carousel-dot"]')
        .at(-1)
        ?.getAttribute("aria-current"),
    ).toBe("step");
  });

  it("leaves arrow keys to the hosted storage radio group", () => {
    renderCard({
      modelSetup: {
        hosted: true,
        requirement: "api_key",
        providers: LOCAL_PROVIDERS,
        availableModels: [],
      },
    });
    goToConnectStep();
    chooseProvider("OpenAI");
    const radios = queryAll<HTMLElement>('[data-slot="radio-group-item"]');
    expect(radios).toHaveLength(2);

    pressArrow(radios[0], "ArrowDown");

    expect(queryAll('[data-slot="radio-group-item"]')).toHaveLength(2);
    expect(keyInput()).toBeTruthy();
  });

  it("leaves arrow keys to the available-model select", () => {
    renderCard({
      modelSetup: {
        requirement: "select_model",
        providers: LOCAL_PROVIDERS,
        availableModels: [
          { provider: "openai", id: "gpt-5-mini", label: "openai/gpt-5-mini" },
          { provider: "openai", id: "gpt-4.1-mini", label: "openai/gpt-4.1-mini" },
        ],
      },
    });
    goToConnectStep();

    pressArrow(query("select"), "ArrowDown");

    expect(query("select")).toBeTruthy();
    expect(providerOptions()).toHaveLength(3);
  });

  it("still moves between steps from the step dots", () => {
    renderCard();

    const dots = queryAll<HTMLButtonElement>('[data-slot="carousel-dot"]');
    pressArrow(dots[0], "ArrowRight");

    expect(
      queryAll<HTMLButtonElement>('[data-slot="carousel-dot"]')[1]?.getAttribute("aria-current"),
    ).toBe("step");
  });
});

describe("setup dialog modality and dismissal", () => {
  it("is a standard modal dialog with a scrim over an inert background", () => {
    const outside = document.createElement("button");
    outside.textContent = "Message OpenCandle";
    document.body.append(outside);

    renderCard();

    expect(query('[data-slot="dialog-content"]')).toBeTruthy();
    expect(query('[data-slot="dialog-overlay"]')).toBeTruthy();
    // Radix marks the rest of the document inert for a modal dialog. Drafting
    // resumes on dismissal, so this is expected rather than a regression.
    expect(outside.getAttribute("aria-hidden")).toBe("true");

    outside.remove();
  });

  it("dismisses on Escape", () => {
    const { onOpenChange } = renderCard();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dismisses from the close control", () => {
    const { onOpenChange } = renderCard();

    click(byLabel("Close dialog"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ProviderKeyFlow standalone", () => {
  it("runs its own two steps with no carousel or dialog around it", () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(React.createElement(ProviderKeyFlow, { providers: LOCAL_PROVIDERS, onSubmit }));
    });

    expect(providerOptions()).toHaveLength(3);
    chooseProvider("Anthropic");

    expect(providerOptions()).toHaveLength(0);
    expect(keyInput()?.getAttribute("aria-label") ?? keyInput()?.id).toBeTruthy();
    setValue(keyInput() as HTMLInputElement, "sk-ant");
    click(saveButton());

    expect(onSubmit).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "sk-ant",
      storageMode: undefined,
    });

    click(buttonNamed("Back"));
    expect(providerOptions()).toHaveLength(3);
  });

  it("delegates only first-step back navigation to its host", () => {
    const onBack = vi.fn();
    act(() => {
      root.render(
        React.createElement(ProviderKeyFlow, {
          providers: LOCAL_PROVIDERS,
          onSubmit: vi.fn(),
          onBack,
          backLabel: "Back",
        }),
      );
    });

    click(buttonNamed("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);

    chooseProvider("OpenAI");
    click(buttonNamed("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(providerOptions()).toHaveLength(3);
  });
});
