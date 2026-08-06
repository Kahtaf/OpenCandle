// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HostedRuntimePanel,
  MANAGE_DATA_PATH,
} from "../../../gui/hosted/src/HostedRuntimePanel.jsx";
import { refreshHostedRuntimeStatus } from "../../../gui/hosted/src/hosted-runtime-status.js";

describe("HostedRuntimePanel", () => {
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

  function createHost() {
    return {
      getRole: () => "writer",
      getRuntimeProgress: () => ({ phase: "ready", message: "Running on this device" }),
      ready: async () => ({ type: "runtime-progress", phase: "ready" }),
      subscribe: () => () => {},
      handleCommand: vi.fn(),
    };
  }

  async function render(props: Record<string, unknown> = {}) {
    const host = createHost();
    await act(async () => {
      root.render(React.createElement(HostedRuntimePanel, { host, ...props }));
    });
    return host;
  }

  it("shows runtime status and links to the settings data section", async () => {
    await render();

    expect(container.textContent).toContain("Running on this device");
    expect(container.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe(
      MANAGE_DATA_PATH,
    );
  });

  it("no longer carries a data menu or its destructive controls", async () => {
    const confirmSpy = vi.spyOn(globalThis, "confirm");
    await render();

    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    const text = container.textContent ?? "";
    for (const label of ["Export data", "Import data", "Clear secrets", "Clear all"]) {
      expect(text).not.toContain(label);
    }
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("keeps the install update action beside the status", async () => {
    const installUpdate = vi.fn(async () => true);
    const waiting = { postMessage: vi.fn() };
    await render({ actions: { installUpdate } });

    expect(
      [...container.querySelectorAll("button")].some((node) =>
        node.textContent?.includes("Install update"),
      ),
    ).toBe(false);

    await act(async () => {
      dispatchEvent(
        new CustomEvent("opencandle:update-ready", {
          detail: { registration: { waiting } },
        }),
      );
    });

    const button = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Install update"),
    );
    expect(button).toBeDefined();

    await act(async () => button?.click());
    expect(installUpdate).toHaveBeenCalledWith(waiting);
  });

  it("navigates in app instead of reloading when a handler is supplied", async () => {
    const onManageData = vi.fn();
    await render({ onManageData });

    const link = container.querySelector("a") as HTMLAnchorElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(event);
    });

    expect(onManageData).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
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
