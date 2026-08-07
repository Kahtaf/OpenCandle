// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hostedStatusPillView,
  refreshHostedRuntimeStatus,
} from "../../../gui/hosted/src/hosted-runtime-status.js";
import { HostedStatusPill } from "../../../gui/hosted/src/hosted-status-pill.jsx";

describe("hosted status pill view", () => {
  const base = { role: "writer", online: true, busy: false, actionError: "" };

  it("shows the preparing message while the runtime boots", () => {
    expect(
      hostedStatusPillView(
        { ...base, phase: "booting", message: "Preparing browser runtime…" },
        { updateWaiting: false },
      ),
    ).toEqual({ kind: "status", text: "Preparing browser runtime…" });
  });

  it("keeps offline and error phases visible while they persist", () => {
    expect(
      hostedStatusPillView(
        {
          ...base,
          online: false,
          phase: "offline",
          message: "Offline: saved research is read-only",
        },
        { updateWaiting: false },
      ),
    ).toEqual({ kind: "status", text: "Offline: saved research is read-only" });
    expect(
      hostedStatusPillView(
        { ...base, phase: "error", message: "Runtime failed" },
        { updateWaiting: false },
      ),
    ).toEqual({ kind: "status", text: "Runtime failed" });
  });

  it("renders nothing once the runtime is ready with no update waiting", () => {
    expect(
      hostedStatusPillView(
        { ...base, phase: "ready", message: "Running on this device" },
        { updateWaiting: false },
      ),
    ).toBeNull();
    expect(
      hostedStatusPillView(
        { ...base, role: "follower", phase: "ready", message: "Ready through the active tab" },
        { updateWaiting: false },
      ),
    ).toBeNull();
  });

  it("offers the install action when an update is waiting", () => {
    expect(
      hostedStatusPillView(
        { ...base, phase: "ready", message: "Running on this device" },
        { updateWaiting: true },
      ),
    ).toEqual({ kind: "action", text: "Install update?" });
  });

  it("keeps a runtime error ahead of the install action and reports install failures", () => {
    expect(
      hostedStatusPillView(
        { ...base, phase: "error", message: "Runtime failed" },
        { updateWaiting: true },
      ),
    ).toEqual({ kind: "status", text: "Runtime failed" });
    expect(
      hostedStatusPillView(
        {
          ...base,
          phase: "ready",
          message: "Running on this device",
          actionError: "Update failed",
        },
        { updateWaiting: true },
      ),
    ).toEqual({ kind: "alert", text: "Update failed" });
  });
});

describe("HostedStatusPill", () => {
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
    vi.restoreAllMocks();
  });

  function createHost(progress: { phase: string; message: string }, ready?: Promise<unknown>) {
    return {
      getRole: () => "writer",
      getRuntimeProgress: () => progress,
      ready: () => ready ?? new Promise(() => {}),
      subscribe: () => () => {},
      handleCommand: vi.fn(),
    };
  }

  async function render(host: unknown, props: Record<string, unknown> = {}) {
    await act(async () => {
      root.render(React.createElement(HostedStatusPill, { host, ...props }));
    });
  }

  it("floats the boot message as a pill while the runtime prepares", async () => {
    await render(createHost({ phase: "booting", message: "Preparing browser runtime…" }));

    const pill = container.querySelector('[role="status"]');
    expect(container.textContent).toContain("Preparing browser runtime…");
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain("rounded-full");
    expect(pill?.getAttribute("title")).toBe("Preparing browser runtime…");
    expect(pill?.querySelector(".truncate")).not.toBeNull();
  });

  it("renders nothing at all once the runtime is ready", async () => {
    await render(
      createHost(
        { phase: "ready", message: "Running on this device" },
        Promise.resolve({ type: "runtime-progress", phase: "ready" }),
      ),
    );

    expect(container.innerHTML).toBe("");
    expect(container.textContent).not.toContain("Running on this device");
  });

  it("installs a waiting update from the pill and returns to nothing", async () => {
    const installUpdate = vi.fn(async () => true);
    const waiting = { postMessage: vi.fn() };
    await render(
      createHost(
        { phase: "ready", message: "Running on this device" },
        Promise.resolve({ type: "runtime-progress", phase: "ready" }),
      ),
      { actions: { installUpdate } },
    );

    await act(async () => {
      dispatchEvent(
        new CustomEvent("opencandle:update-ready", { detail: { registration: { waiting } } }),
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Install update?");
    // The offer keeps the pill's geometry instead of reading as a bordered
    // rectangle dropped into the chrome.
    expect(button?.className).toContain("rounded-full");

    await act(async () => button?.click());
    expect(installUpdate).toHaveBeenCalledWith(waiting);
  });

  it("surfaces a failed install without a permanent status message", async () => {
    const installUpdate = vi.fn(async () => {
      throw new Error("Update failed");
    });
    const waiting = { postMessage: vi.fn() };
    await render(
      createHost(
        { phase: "ready", message: "Running on this device" },
        Promise.resolve({ type: "runtime-progress", phase: "ready" }),
      ),
      { actions: { installUpdate } },
    );

    await act(async () => {
      dispatchEvent(
        new CustomEvent("opencandle:update-ready", { detail: { registration: { waiting } } }),
      );
    });
    await act(async () => container.querySelector("button")?.click());

    expect(container.textContent).toContain("Update failed");
    expect(container.textContent).not.toContain("Running on this device");
  });
});

describe("hosted runtime status", () => {
  it("keeps an action error visible across background coordination refreshes", () => {
    expect(
      refreshHostedRuntimeStatus(
        {
          role: "writer",
          online: true,
          busy: false,
          message: "Running on this device",
          actionError: "Unsupported hosted archive version",
        },
        undefined,
        { role: "writer", online: false },
      ),
    ).toMatchObject({
      actionError: "Unsupported hosted archive version",
      message: "Offline: saved research is read-only",
    });
  });

  it("surfaces explicit runtime errors in the primary status", () => {
    expect(
      refreshHostedRuntimeStatus(
        { role: "writer", online: true, message: "Running on this device", actionError: "" },
        { error: "Runtime failed" },
        { role: "writer", online: true },
      ),
    ).toMatchObject({ message: "Runtime failed" });
  });

  it("states that a follower can act through the active runtime tab", () => {
    expect(
      refreshHostedRuntimeStatus(
        { role: "writer", online: true, message: "Running on this device", actionError: "" },
        undefined,
        { role: "follower", online: true },
      ),
    ).toMatchObject({ message: "Ready through the active tab" });
  });

  it("keeps browser boot progress visible until the runtime is ready", () => {
    const current = {
      role: "writer",
      online: true,
      phase: "booting",
      message: "Preparing browser runtime…",
      actionError: "",
    };

    expect(
      refreshHostedRuntimeStatus(current, undefined, { role: "writer", online: true }),
    ).toMatchObject({ message: "Preparing browser runtime…", phase: "booting" });
    expect(
      refreshHostedRuntimeStatus(
        current,
        { type: "runtime-progress", phase: "ready", message: "Running on this device" },
        { role: "writer", online: true },
      ),
    ).toMatchObject({ message: "Running on this device", phase: "ready" });
  });
});
