import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { screenStocks } from "../../providers/tradingview.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { ScreenerRow } from "../../providers/tradingview.js";

const filterOp = Type.Union([
  Type.Literal("greater"),
  Type.Literal("egreater"),
  Type.Literal("less"),
  Type.Literal("eless"),
  Type.Literal("equal"),
  Type.Literal("nequal"),
  Type.Literal("in_range"),
  Type.Literal("not_in_range"),
  Type.Literal("crosses"),
  Type.Literal("crosses_above"),
  Type.Literal("crosses_below"),
  Type.Literal("above%"),
  Type.Literal("below%"),
  Type.Literal("match"),
  Type.Literal("nmatch"),
  Type.Literal("has"),
  Type.Literal("has_none_of"),
  Type.Literal("empty"),
  Type.Literal("nempty"),
]);

const params = Type.Object({
  market: Type.Optional(Type.String({ description: "TradingView market path segment. Default: america" })),
  columns: Type.Optional(Type.Array(Type.String({ description: "TradingView scanner field, optionally timeframe-qualified (for example RSI|60)" }))),
  filter: Type.Optional(Type.Array(Type.Object({
    field: Type.String({ description: "TradingView scanner field, optionally timeframe-qualified" }),
    op: filterOp,
    value: Type.Optional(Type.Unknown({ description: "Filter value for operations that require one" })),
  }), { description: "Flat AND filter clauses; nested OR trees are not supported" })),
  sort: Type.Optional(Type.Object({
    field: Type.String({ description: "TradingView scanner field to sort by" }),
    direction: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
  })),
  limit: Type.Optional(Type.Number({ description: "Maximum rows to return. Default 50; maximum 500" })),
});

export const screenStocksTool: AgentTool<typeof params, ScreenerRow[]> = {
  name: "screen_stocks",
  label: "Stock Screener",
  description:
    "Screen stocks across a market using TradingView scanner filters, columns, sorting, and row limits. Use for breadth queries like finding large caps, oversold stocks, movers, or filtered market lists; use quote/history tools for single-security quote or history requests.",
  parameters: params,
  async execute(_toolCallId, args) {
    const result = await wrapProvider("tradingview", () => screenStocks({
      market: args.market,
      columns: args.columns,
      filter: args.filter,
      sort: args.sort,
      limit: args.limit,
    }));

    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `Stock screening unavailable (${result.reason}).` }],
        details: [],
      };
    }

    const rows = result.data;
    if (rows.length === 0) {
      return {
        content: [{ type: "text", text: "No stocks matched the screen. TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint." }],
        details: rows,
      };
    }

    const lines = [
      `**Stock screen** — ${rows.length} TradingView result${rows.length === 1 ? "" : "s"}`,
      ...(result.stale ? [`⚠ Using cached TradingView screen from ${result.timestamp}.`] : []),
      "Data caveat: TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      "",
      ...rows.map(formatRow),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: rows,
    };
  },
};

function formatRow(row: ScreenerRow): string {
  const entries = Object.entries(row.values)
    .filter(([field]) => field !== "name")
    .slice(0, 8)
    .map(([field, value]) => `${field}: ${formatValue(value)}`);
  const suffix = entries.length > 0 ? ` — ${entries.join(" | ")}` : "";
  return `  ${row.symbol} (${row.tvSymbol})${suffix}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (value === null || value === undefined) return "N/A";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
