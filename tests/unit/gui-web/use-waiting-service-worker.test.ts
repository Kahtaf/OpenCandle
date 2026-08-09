// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWaitingServiceWorker } from "../../../gui/web/src/hooks/use-waiting-service-worker.js";

let container: HTMLDivElement;
let root: Root;
let latest: unknown;

function Probe() {
  latest = useWaitingServiceWorker();
  return null;
}

async function renderProbe() {
  await act(async () => {
    root.render(React.createElement(Probe));
    await Promise.resolve();
  });
}

describe("useWaitingServiceWorker", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    latest = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("detects a service worker that was already waiting before mount", async () => {
    const waiting = { postMessage: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => ({ waiting })) },
    });
    await renderProbe();
    expect(latest).toBe(waiting);
  });

  it("adopts a waiting worker announced after mount", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => undefined) },
    });
    await renderProbe();
    expect(latest).toBeNull();
    const waiting = { postMessage: vi.fn() };
    act(() => {
      dispatchEvent(
        new CustomEvent("opencandle:update-ready", { detail: { registration: { waiting } } }),
      );
    });
    expect(latest).toBe(waiting);
  });

  it("stays null when service workers are unavailable", async () => {
    await renderProbe();
    expect(latest).toBeNull();
  });
});
