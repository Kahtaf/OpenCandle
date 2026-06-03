import { describe, expect, it } from "vitest";
import { renderRichText } from "../../../gui/web/src/rendering/text.js";

describe("rich text rendering", () => {
  it("renders level-four markdown headings as h4 elements", () => {
    expect(renderRichText("#### Robinhood Markets (HOOD)")).toContain(
      "<h4>Robinhood Markets (HOOD)</h4>",
    );
  });

  it("renders standalone markdown rules as hr elements", () => {
    expect(renderRichText("First\n\n---\n\nSecond")).toBe("<p>First</p><hr><p>Second</p>");
  });
});
