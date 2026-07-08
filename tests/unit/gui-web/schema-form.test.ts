import { describe, expect, it } from "vitest";
import { validateRequired } from "../../../gui/web/src/features/catalog/field-utils.js";
import {
  coerceFieldValue,
  fieldsForTool,
} from "../../../gui/web/src/features/catalog/schema-form.js";
import { FIELD_OVERRIDES } from "../../../gui/web/src/features/catalog/tool-form-overrides.js";
import { getAllTools } from "../../../src/tools/index.js";

function toolByName(name: string) {
  const tool = getAllTools().find((entry) => entry.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return { name: tool.name, parameters: tool.parameters };
}

describe("schema-derived catalog forms", () => {
  it("derives fields for every registered tool without a handwritten map", () => {
    for (const tool of getAllTools()) {
      const fields = fieldsForTool({ name: tool.name, parameters: tool.parameters });
      expect(Array.isArray(fields)).toBe(true);
      for (const field of fields) {
        expect(field.name).toBeTruthy();
        expect(field.label).toBeTruthy();
        expect(field.kind).toBeTruthy();
      }
    }
  });

  it("maps literal unions to segmented/select options", () => {
    const fields = fieldsForTool(toolByName("backtest_strategy"));
    const strategy = fields.find((field) => field.name === "strategy");
    expect(strategy?.kind).toBe("segmented");
    expect(strategy?.options?.map((option: { value: string }) => option.value)).toContain(
      "sma_crossover",
    );
  });

  it("gives optional select fields an explicit default placeholder", () => {
    const fields = fieldsForTool(toolByName("get_stock_history"));
    const range = fields.find((field) => field.name === "range");
    const interval = fields.find((field) => field.name === "interval");

    expect(range?.kind).toBe("select");
    expect(range?.required).toBe(false);
    expect(range?.default).toBeUndefined();
    expect(range?.placeholder).toBe("Use tool default");
    expect(interval?.kind).toBe("select");
    expect(interval?.required).toBe(false);
    expect(interval?.default).toBeUndefined();
    expect(interval?.placeholder).toBe("Use tool default");
  });

  it("maps symbol and symbols params to symbol inputs with bounds", () => {
    const quote = fieldsForTool(toolByName("get_stock_quote"));
    expect(quote.find((field) => field.name === "symbol")?.kind).toBe("symbol");

    const correlation = fieldsForTool(toolByName("analyze_correlation"));
    const symbols = correlation.find((field) => field.name === "symbols");
    expect(symbols?.kind).toBe("symbols");
    expect(symbols?.required).toBe(true);
  });

  it("maps numeric params to bounded number inputs", () => {
    const fields = fieldsForTool(toolByName("get_economic_data"));
    const limit = fields.find((field) => field.name === "limit");
    expect(limit?.kind).toBe("number-chips");
    expect(limit?.min).toBeGreaterThanOrEqual(1);
    expect(limit?.max).toBeLessThanOrEqual(1000);
  });

  it("maps decimal rate params to percent inputs", () => {
    const fields = fieldsForTool(toolByName("compute_dcf"));
    const growthRate = fields.find((field) => field.name === "growth_rate");
    const discountRate = fields.find((field) => field.name === "discount_rate");
    const terminalGrowth = fields.find((field) => field.name === "terminal_growth");
    const projectionYears = fields.find((field) => field.name === "projection_years");

    expect(growthRate?.kind).toBe("percent");
    expect(discountRate?.kind).toBe("percent");
    expect(terminalGrowth?.kind).toBe("percent");
    expect(projectionYears?.kind).toBe("number-chips");
  });

  it("maps watchlist tool params to text inputs", () => {
    const fields = fieldsForTool(toolByName("manage_watchlist"));
    const symbol = fields.find((field) => field.name === "symbol");
    const watchlistName = fields.find((field) => field.name === "watchlist_name");

    expect(symbol?.kind).toBe("symbol");
    expect(watchlistName?.kind).toBe("text");
  });

  it("marks required fields from the served schema", () => {
    const fields = fieldsForTool(toolByName("get_stock_quote"));
    expect(fields.find((field) => field.name === "symbol")?.required).toBe(true);
  });

  it("coerces csv text fields into string arrays and json fields into values", () => {
    expect(coerceFieldValue({ parse: "csv" }, "wallstreetbets, stocks ,")).toEqual([
      "wallstreetbets",
      "stocks",
    ]);
    expect(coerceFieldValue({ parse: "json" }, '[{"field":"market_cap"}]')).toEqual([
      { field: "market_cap" },
    ]);
    expect(coerceFieldValue({ parse: "json" }, "not json")).toBeUndefined();
    expect(coerceFieldValue({}, "AAPL")).toBe("AAPL");
    expect(coerceFieldValue({}, "")).toBeUndefined();
  });

  it("blocks invalid JSON before optional complex fields are stripped", () => {
    const fields = fieldsForTool(toolByName("screen_stocks"));
    const filter = fields.find((field) => field.name === "filter");

    expect(filter?.parse).toBe("json");
    expect(validateRequired(fields, { filter: "[not json" })).toEqual([
      "Filter must be valid JSON.",
    ]);
    expect(validateRequired(fields, { filter: '[{"field":"market_cap","op":"greater"}]' })).toEqual(
      [],
    );
  });

  it("applies presentation overrides onto derived fields", () => {
    (FIELD_OVERRIDES as Record<string, unknown>).get_stock_quote = {
      symbol: { label: "Ticker", default: "NVDA" },
    };
    try {
      const fields = fieldsForTool(toolByName("get_stock_quote"));
      const symbol = fields.find((field) => field.name === "symbol");
      expect(symbol?.label).toBe("Ticker");
      expect(symbol?.default).toBe("NVDA");
      expect(symbol?.kind).toBe("symbol");
    } finally {
      delete (FIELD_OVERRIDES as Record<string, unknown>).get_stock_quote;
    }
  });

  it("keeps every override key pointing at a registered tool", () => {
    const registered = new Set(getAllTools().map((tool) => tool.name));
    for (const toolName of Object.keys(FIELD_OVERRIDES)) {
      expect(registered.has(toolName), `orphan override for ${toolName}`).toBe(true);
    }
  });
});
