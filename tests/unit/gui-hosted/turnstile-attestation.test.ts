import { describe, expect, it, vi } from "vitest";
import { requestTurnstileAttestation } from "../../../gui/hosted/src/runtime/turnstile-attestation.js";

describe("hosted Turnstile attestation", () => {
  it("executes an interaction-only runtime challenge and removes it after success", async () => {
    const container = fakeContainer();
    let configuration: Record<string, unknown> = {};
    const turnstileApi = {
      render: vi.fn((_container, options) => {
        configuration = options;
        return "widget-1";
      }),
      execute: vi.fn(() => {
        (configuration.callback as (token: string) => void)("attestation-token");
      }),
      remove: vi.fn(),
    };

    await expect(
      requestTurnstileAttestation({
        sitekey: "test-sitekey",
        turnstileApi,
        documentRef: fakeDocument(container),
      }),
    ).resolves.toBe("attestation-token");
    expect(turnstileApi.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        sitekey: "test-sitekey",
        action: "turnstile-spin-v1",
        execution: "execute",
        appearance: "interaction-only",
        "response-field": false,
        "refresh-expired": "never",
      }),
    );
    expect(turnstileApi.execute).toHaveBeenCalledWith("widget-1");
    expect(turnstileApi.remove).toHaveBeenCalledWith("widget-1");
    expect(container.remove).toHaveBeenCalledOnce();
  });

  it("fails closed and removes the widget when verification fails", async () => {
    const container = fakeContainer();
    let configuration: Record<string, unknown> = {};
    const turnstileApi = {
      render: vi.fn((_container, options) => {
        configuration = options;
        return "widget-1";
      }),
      execute: vi.fn(() => {
        (configuration["error-callback"] as () => void)();
      }),
      remove: vi.fn(),
    };

    await expect(
      requestTurnstileAttestation({
        sitekey: "test-sitekey",
        turnstileApi,
        documentRef: fakeDocument(container),
      }),
    ).rejects.toThrow("Turnstile verification failed");
    expect(turnstileApi.remove).toHaveBeenCalledWith("widget-1");
    expect(container.remove).toHaveBeenCalledOnce();
  });

  it("times out a stalled Turnstile script load and removes the pending script", async () => {
    vi.useFakeTimers();
    const script = fakeScript();
    const documentRef = {
      body: { append: vi.fn() },
      head: { append: vi.fn() },
      createElement: vi.fn(() => script),
    };

    const attestation = requestTurnstileAttestation({
      sitekey: "test-sitekey",
      documentRef,
      timeoutMs: 25,
    });
    const rejection = expect(attestation).rejects.toThrow("Turnstile API load timed out");
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(script.removeEventListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(script.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(script.remove).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

function fakeContainer() {
  return {
    setAttribute: vi.fn(),
    style: {},
    remove: vi.fn(),
  };
}

function fakeDocument(container: ReturnType<typeof fakeContainer>) {
  return {
    body: { append: vi.fn() },
    createElement: vi.fn(() => container),
  };
}

function fakeScript() {
  return {
    src: "",
    async: false,
    defer: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    remove: vi.fn(),
  };
}
