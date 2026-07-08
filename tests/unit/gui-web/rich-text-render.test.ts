import { describe, expect, it } from "vitest";
import { renderInline, renderRichText } from "../../../gui/web/src/rendering/text.js";

describe("rich text rendering", () => {
  it("renders level-four markdown headings as h4 elements", () => {
    expect(renderRichText("#### Robinhood Markets (HOOD)")).toContain(
      "<h4>Robinhood Markets (HOOD)</h4>",
    );
  });

  it("renders standalone markdown rules as hr elements", () => {
    expect(renderRichText("First\n\n---\n\nSecond")).toBe("<p>First</p><hr><p>Second</p>");
  });

  it("renders explicit cashtags as entity chips", () => {
    expect(renderInline("Buy $nvda here")).toContain(
      '<button type="button" class="entity-chip" data-symbol="NVDA">$NVDA</button>',
    );
  });

  it("renders bare known uppercase tokens as entity chips", () => {
    expect(renderInline("Compare NVDA and CPI", { knownSymbols: ["NVDA"] })).toContain(
      '<button type="button" class="entity-chip" data-symbol="NVDA">NVDA</button>',
    );
    expect(renderInline("Compare NVDA and CPI", { knownSymbols: ["NVDA"] })).toContain(" and CPI");
  });

  it("leaves bare unknown uppercase tokens plain", () => {
    expect(renderInline("CPI is elevated", { knownSymbols: [] })).toBe("CPI is elevated");
  });

  it("does not render chips inside inline code spans", () => {
    expect(renderInline("Use `$NVDA` literally")).toBe("Use <code>$NVDA</code> literally");
  });
});
