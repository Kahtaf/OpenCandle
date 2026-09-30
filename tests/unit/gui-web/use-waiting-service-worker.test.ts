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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// A minimal ServiceWorker stand-in: a state plus statechange listeners.
function fakeWorker(state = "installed") {
  const worker = new EventTarget() as EventTarget & {
    state: string;
    postMessage: ReturnType<typeof vi.fn>;
    moveTo(next: string): void;
  };
  worker.state = state;
  worker.postMessage = vi.fn();
  worker.moveTo = (next: string) => {
    worker.state = next;
    worker.dispatchEvent(new Event("statechange"));
  };
  return worker;
}

// A minimal ServiceWorkerContainer stand-in with a controller and a
// registration whose `waiting` slot the test drives.
function installContainer({
  controller = {} as object | null,
  waiting = null as unknown,
}: {
  controller?: object | null;
  waiting?: unknown;
} = {}) {
  const registration = { waiting };
  const serviceWorker = Object.assign(new EventTarget(), {
    controller,
    getRegistration: vi.fn(async () => registration),
  });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  return { registration, serviceWorker };
}

function announce(registration: { waiting: unknown }) {
  dispatchEvent(new CustomEvent("opencandle:update-ready", { detail: { registration } }));
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
    const waiting = fakeWorker();
    installContainer({ waiting });
    await renderProbe();
    expect(latest).toBe(waiting);
  });

  it("adopts a waiting worker announced after mount", async () => {
    const { registration } = installContainer();
    await renderProbe();
    expect(latest).toBeNull();
    const waiting = fakeWorker();
    registration.waiting = waiting;
    act(() => announce(registration));
    expect(latest).toBe(waiting);
  });

  it("stays null when service workers are unavailable", async () => {
    await renderProbe();
    expect(latest).toBeNull();
  });

  it("ignores a first install that is only passing through waiting (#219)", async () => {
    // A brand-new profile has no controller. The first worker sits in
    // `registration.waiting` for a moment before it activates; that is not an
    // update the user can install.
    const waiting = fakeWorker();
    installContainer({ controller: null, waiting });
    await renderProbe();
    expect(latest).toBeNull();
  });

  it("ignores an announced worker that is not waiting in the installed state", async () => {
    const { registration } = installContainer();
    await renderProbe();
    const activating = fakeWorker("activating");
    registration.waiting = activating;
    act(() => announce(registration));
    expect(latest).toBeNull();
  });

  it("clears an adopted worker once it activates (#219)", async () => {
    const { registration } = installContainer();
    await renderProbe();
    const waiting = fakeWorker();
    registration.waiting = waiting;
    act(() => announce(registration));
    expect(latest).toBe(waiting);

    registration.waiting = null;
    act(() => waiting.moveTo("activating"));
    expect(latest).toBeNull();
  });

  it("re-checks the registration when the controller changes", async () => {
    const waiting = fakeWorker();
    const { registration, serviceWorker } = installContainer({ waiting });
    await renderProbe();
    expect(latest).toBe(waiting);

    registration.waiting = null;
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    await flush();
    expect(latest).toBeNull();
  });
});
