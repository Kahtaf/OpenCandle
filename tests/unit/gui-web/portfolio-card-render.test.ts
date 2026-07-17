import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorrelationCard } from "../../../gui/web/src/features/renderers/cards/portfolio.jsx";

describe("CorrelationCard", () => {
  it("marks matrix symbols as row headers", () => {
    const html = renderToStaticMarkup(
      React.createElement(CorrelationCard, {
        header: React.createElement("h2", null, "Correlation"),
        text: "",
        message: {
          details: {
            symbols: ["AAPL", "NVDA"],
            matrix: {
              AAPL: { AAPL: 1, NVDA: 0.5 },
              NVDA: { AAPL: 0.5, NVDA: 1 },
            },
          },
        },
      }),
    );

    expect(html).toContain('<th scope="row"');
    expect(html).toContain('<th scope="col"');
  });
});
