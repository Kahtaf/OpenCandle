// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../gui/web/src/components/ui/popover.jsx";

describe("Popover", () => {
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

  it("stays closed when its open trigger receives the next pointer click", () => {
    function TriggerButton({
      children,
      ref: _ref,
      ...props
    }: React.ComponentPropsWithRef<"button">) {
      return React.createElement("button", { type: "button", ...props }, children);
    }

    act(() => {
      root.render(
        React.createElement(
          Popover,
          null,
          React.createElement(
            PopoverTrigger,
            { asChild: true },
            React.createElement(TriggerButton, null, "Choose model"),
          ),
          React.createElement(PopoverContent, null, "Models"),
        ),
      );
    });

    const trigger = container.querySelector("button");
    const menu = container.querySelector('[role="menu"]');
    expect(trigger).not.toBeNull();
    expect(menu).not.toBeNull();

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    act(() => trigger?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(menu?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps document listeners stable when the open callback changes", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");

    act(() => {
      root.render(
        React.createElement(
          Popover,
          { open: true, onOpenChange: () => undefined },
          React.createElement(PopoverTrigger, null, "Choose model"),
          React.createElement(PopoverContent, null, "Models"),
        ),
      );
    });
    const pointerListenerCount = addEventListener.mock.calls.filter(
      ([eventName]) => eventName === "pointerdown",
    ).length;

    act(() => {
      root.render(
        React.createElement(
          Popover,
          { open: true, onOpenChange: () => undefined },
          React.createElement(PopoverTrigger, null, "Choose model"),
          React.createElement(PopoverContent, null, "Models"),
        ),
      );
    });

    expect(
      addEventListener.mock.calls.filter(([eventName]) => eventName === "pointerdown"),
    ).toHaveLength(pointerListenerCount);
  });

  it("keeps owned menu clicks inside even when a forwarded content ref is unavailable", () => {
    act(() => {
      root.render(
        React.createElement(
          Popover,
          null,
          React.createElement(PopoverTrigger, null, "Choose model"),
          React.createElement(
            PopoverContent,
            null,
            React.createElement("button", { type: "button" }, "Model A"),
          ),
        ),
      );
    });

    const trigger = container.querySelector("button");
    act(() => trigger?.click());
    const menu = container.querySelector<HTMLElement>('[role="menu"]');
    const item = menu?.querySelector("button");
    expect(menu).not.toBeNull();
    expect(item).not.toBeNull();
    if (menu) vi.spyOn(menu, "contains").mockReturnValue(false);

    act(() => item?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  });
});
