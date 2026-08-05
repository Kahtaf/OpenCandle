import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton } from "../../../gui/web/src/components/ui/skeleton.jsx";

describe("Skeleton", () => {
  it("pulses only when the viewer allows motion", () => {
    const html = renderToStaticMarkup(React.createElement(Skeleton, { className: "h-4 w-10" }));

    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("h-4 w-10");
  });
});
