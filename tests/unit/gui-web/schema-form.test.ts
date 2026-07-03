import { describe, expect, it } from "vitest";
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
