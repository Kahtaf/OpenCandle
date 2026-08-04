// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Carousel,
  CarouselContent,
  CarouselDots,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../../../gui/web/src/components/ui/carousel.jsx";
import { RadioGroup, RadioGroupItem } from "../../../gui/web/src/components/ui/radio-group.jsx";

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
  vi.restoreAllMocks();
});

function render(element: React.ReactElement) {
  act(() => {
    root.render(element);
  });
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function activeText() {
  return document
    .querySelector('[data-slot="carousel-item"][data-active="true"]')
    ?.textContent?.trim();
}

function slides(labels: string[]) {
  return React.createElement(
    CarouselContent,
    null,
    ...labels.map((label) => React.createElement(CarouselItem, { key: label }, label)),
  );
}

describe("Carousel primitive", () => {
  it("renders one slide at a time with carousel and slide semantics", () => {
    render(
      React.createElement(Carousel, null, slides(["Alpha slide", "Beta slide", "Gamma slide"])),
    );

    const carousel = container.querySelector('[data-slot="carousel"]');
    expect(carousel?.getAttribute("role")).toBe("region");
    expect(carousel?.getAttribute("aria-roledescription")).toBe("carousel");

    const rendered = [...container.querySelectorAll('[data-slot="carousel-item"]')];
    expect(rendered).toHaveLength(3);
    expect(rendered[0].getAttribute("aria-label")).toBe("Slide 1 of 3");
    expect(rendered[0].getAttribute("aria-roledescription")).toBe("slide");
    // Embla lays every slide out in a translated track, so off-screen slides
    // stay in the DOM. They must be out of the accessibility tree and the tab
    // order instead, and only one is ever the active one.
    expect(rendered.map((slide) => slide.getAttribute("data-active"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(rendered[0].hasAttribute("aria-hidden")).toBe(false);
    expect(rendered[1].getAttribute("aria-hidden")).toBe("true");
    expect(rendered[1].hasAttribute("inert")).toBe(true);
    expect(activeText()).toBe("Alpha slide");
  });

  it("advances and rewinds through CarouselPrevious and CarouselNext", () => {
    render(
      React.createElement(
        Carousel,
        null,
        slides(["Alpha slide", "Beta slide"]),
        React.createElement(CarouselPrevious, null),
        React.createElement(CarouselNext, null),
      ),
    );

    const previous = () =>
      container.querySelector('[data-slot="carousel-previous"]') as HTMLButtonElement | null;
    const next = () =>
      container.querySelector('[data-slot="carousel-next"]') as HTMLButtonElement | null;

    expect(previous()?.disabled).toBe(true);
    expect(next()?.disabled).toBe(false);

    click(next());
    expect(activeText()).toBe("Beta slide");
    expect(next()?.disabled).toBe(true);
    expect(previous()?.disabled).toBe(false);

    click(previous());
    expect(activeText()).toBe("Alpha slide");
  });

  it("exposes clickable step dots with accessible names and a current step", () => {
    render(
      React.createElement(
        Carousel,
        null,
        slides(["Alpha slide", "Beta slide", "Gamma slide"]),
        React.createElement(CarouselDots, {
          getItemLabel: (index: number, count: number) => `Go to step ${index + 1} of ${count}`,
        }),
      ),
    );

    const dots = () =>
      [...container.querySelectorAll('[data-slot="carousel-dot"]')] as HTMLButtonElement[];
    expect(dots()).toHaveLength(3);
    expect(dots().map((dot) => dot.getAttribute("aria-label"))).toEqual([
      "Go to step 1 of 3",
      "Go to step 2 of 3",
      "Go to step 3 of 3",
    ]);
    expect(dots()[0].getAttribute("aria-current")).toBe("step");

    click(dots()[2]);

    expect(dots()[2].getAttribute("aria-current")).toBe("step");
    expect(dots()[0].getAttribute("aria-current")).toBe(null);
    expect(activeText()).toBe("Gamma slide");
  });

  it("hands the embla api to the caller through setApi", () => {
    let api: { scrollTo: (index: number) => void } | null = null;
    render(
      React.createElement(
        Carousel,
        {
          setApi: (value: typeof api) => {
            api = value;
          },
        },
        slides(["Alpha slide", "Beta slide", "Gamma slide"]),
      ),
    );

    expect(api).toBeTruthy();
    act(() => api?.scrollTo(2));

    expect(activeText()).toBe("Gamma slide");
  });

  it("starts at a caller-supplied default slide", () => {
    render(
      React.createElement(
        Carousel,
        { opts: { startIndex: 2 } },
        slides(["Alpha slide", "Beta slide", "Gamma slide"]),
      ),
    );

    expect(activeText()).toBe("Gamma slide");
  });
});

describe("RadioGroup primitive", () => {
  function items() {
    return [...container.querySelectorAll('[data-slot="radio-group-item"]')] as HTMLElement[];
  }

  function checkedState() {
    return items().map((item) => item.getAttribute("data-state"));
  }

  it("renders a radiogroup of radios carrying their own checked state", () => {
    render(
      React.createElement(
        RadioGroup,
        { defaultValue: "session", name: "storage" },
        React.createElement(RadioGroupItem, { value: "persistent", id: "storage-persistent" }),
        React.createElement("label", { htmlFor: "storage-persistent" }, "Keep on this device"),
        React.createElement(RadioGroupItem, { value: "session", id: "storage-session" }),
        React.createElement("label", { htmlFor: "storage-session" }, "Only for this session"),
      ),
    );

    const group = container.querySelector('[data-slot="radio-group"]');
    expect(group?.getAttribute("role")).toBe("radiogroup");

    expect(items()).toHaveLength(2);
    expect(items().map((item) => item.getAttribute("role"))).toEqual(["radio", "radio"]);
    expect(items().map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(checkedState()).toEqual(["unchecked", "checked"]);
  });

  it("reports the selected value and honours a controlled value", () => {
    const onValueChange = vi.fn();
    render(
      React.createElement(
        RadioGroup,
        { value: "persistent", onValueChange, name: "storage" },
        React.createElement(RadioGroupItem, { value: "persistent", id: "storage-persistent" }),
        React.createElement(RadioGroupItem, { value: "session", id: "storage-session" }),
      ),
    );

    expect(checkedState()).toEqual(["checked", "unchecked"]);

    act(() => items()[1].click());

    expect(onValueChange).toHaveBeenCalledWith("session");
    // Controlled: the group does not move itself.
    expect(checkedState()).toEqual(["checked", "unchecked"]);
  });

  it("tracks its own value when uncontrolled", () => {
    render(
      React.createElement(
        RadioGroup,
        { defaultValue: "persistent" },
        React.createElement(RadioGroupItem, { value: "persistent", id: "a" }),
        React.createElement(RadioGroupItem, { value: "session", id: "b" }),
      ),
    );

    act(() => items()[1].click());

    expect(checkedState()).toEqual(["unchecked", "checked"]);
  });
});
