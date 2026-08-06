import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  Cell: () => null,
  Pie: ({
    data = [],
    isAnimationActive,
    shape,
  }: {
    data?: Array<Record<string, unknown>>;
    isAnimationActive: boolean;
    shape?: (props: Record<string, unknown>) => React.ReactNode;
  }) =>
    React.createElement(
      "g",
      { "data-animation-active": String(isAnimationActive) },
      data.map((entry, index) =>
        React.createElement(
          React.Fragment,
          { key: String(entry.symbol ?? index) },
          shape?.({ ...entry, payload: entry, index }),
        ),
      ),
    ),
  PieChart: ({ children }: React.PropsWithChildren) => React.createElement("svg", null, children),
  ResponsiveContainer: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
  Tooltip: () => null,
  Sector: (props: React.SVGProps<SVGPathElement>) => React.createElement("path", props),
}));

import AllocationDonut from "../../../gui/web/src/components/allocation-donut.jsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AllocationDonut", () => {
  it("renders formatted, keyboard-focusable segments with token-matched legend colors", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
    });

    const html = renderToStaticMarkup(
      React.createElement(AllocationDonut, {
        totalValue: 1234.5,
        currency: "USD",
        segments: [
          { symbol: "AAPL", percent: 60, value: 740.7 },
          { symbol: "NVDA", percent: 40, value: 493.8 },
        ],
      }),
    );

    expect(html).toContain('data-slot="allocation-donut"');
    // The portfolio total belongs to the stat header, so the donut does not
    // print it a second time in its own centre.
    expect(html).not.toContain("$1,234.50");
    expect(html).not.toContain("Total value");
    expect(html).toContain("AAPL");
    expect(html).toContain("60.0%");
    expect(html).toContain("$740.70");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("focus-visible:stroke-foreground");
    expect(html).toContain("hsl(var(--tw-info))");
    expect(html).toContain('data-animation-active="true"');
  });

  it("disables the donut sweep when reduced motion is preferred", () => {
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });

    const html = renderToStaticMarkup(
      React.createElement(AllocationDonut, {
        totalValue: 100,
        currency: "USD",
        segments: [{ symbol: "AAPL", percent: 100, value: 100 }],
      }),
    );

    expect(html).toContain('data-animation-active="false"');
  });
});
