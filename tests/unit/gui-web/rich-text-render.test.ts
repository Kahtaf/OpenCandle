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

  it("promotes workflow synthesis labels into spaced markdown sections", () => {
    const html = renderRichText(
      "**BULL THESIS:** Demand remains strong. **BEAR THESIS:** Valuation is elevated. **VERDICT:** Hold. **CORRECTIONS NEEDED:** None.",
    );

    expect(html).toBe(
      "<h3>BULL THESIS</h3><p>Demand remains strong.</p><h3>BEAR THESIS</h3><p>Valuation is elevated.</p><h3>VERDICT</h3><p>Hold.</p><h3>CORRECTIONS NEEDED</h3><p>None.</p>",
    );
  });

  it("marks numeric markdown-table columns for right-aligned tabular styling", () => {
    const html = renderRichText(
      "| Symbol | Price | Change | Note |\n| --- | ---: | ---: | --- |\n| NVDA | $1,234.50 | +2.50% | Strong |\n| AMD | $165.25 | −1.20% | Watch |",
    );

    expect(html).toContain('<th scope="col"');
    expect(html).toContain('<th scope="col" class="rich-table__numeric">Price</th>');
    expect(html).toContain('<th scope="col" class="rich-table__numeric">Change</th>');
    expect(html).toContain('<td class="rich-table__numeric">$1,234.50</td>');
    expect(html).not.toContain('<th scope="col" class="rich-table__numeric">Symbol</th>');
    expect(html).not.toContain('<th scope="col" class="rich-table__numeric">Note</th>');
  });

  it("keeps a column numeric when placeholder cells like N/A appear", () => {
    const html = renderRichText(
      "| Metric | Value |\n| --- | --- |\n| Current Price | $50.32 |\n| Fundamental Data | N/A |\n| RSI (14D) | 32.8 |",
    );

    expect(html).toContain('<th scope="col" class="rich-table__numeric">Value</th>');
    expect(html).toContain('<td class="rich-table__numeric">$50.32</td>');
    expect(html).toContain('<td class="rich-table__numeric">N/A</td>');
    expect(html).not.toContain('<th scope="col" class="rich-table__numeric">Metric</th>');
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
