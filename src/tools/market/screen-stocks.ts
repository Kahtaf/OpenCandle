import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { buildFreshnessStamp, formatAsOfLine } from "../../infra/freshness.js";
import type { ScreenerRow, ScreenFilterOp } from "../../providers/tradingview.js";
import { screenStocks } from "../../providers/tradingview.js";
import { wrapProvider } from "../../providers/wrap-provider.js";

const filterOps = [
  "greater",
  "GREATER",
  "gt",
  "GT",
  ">",
  "egreater",
  "EGREATER",
  "gte",
  "GTE",
  ">=",
  "less",
  "LESS",
  "lt",
  "LT",
  "<",
  "eless",
  "ELESS",
  "lte",
  "LTE",
  "<=",
  "equal",
  "EQUAL",
  "eq",
  "EQ",
  "==",
  "nequal",
  "NEQUAL",
  "neq",
  "NEQ",
  "!=",
  "in_range",
  "IN_RANGE",
  "not_in_range",
  "NOT_IN_RANGE",
  "crosses",
  "CROSSES",
  "crosses_above",
  "CROSSES_ABOVE",
  "crosses_below",
  "CROSSES_BELOW",
  "above%",
  "ABOVE%",
  "below%",
  "BELOW%",
  "match",
  "MATCH",
  "nmatch",
  "NMATCH",
  "has",
  "HAS",
  "has_none_of",
  "HAS_NONE_OF",
  "empty",
  "EMPTY",
  "nempty",
  "NEMPTY",
] as const;

const filterOp = Type.String({ enum: [...filterOps] });

const params = Type.Object({
  market: Type.Optional(
    Type.String({ description: "TradingView market path segment. Default: america" }),
  ),
  columns: Type.Optional(
    Type.Array(
      Type.String({
        description:
          "TradingView scanner field, optionally timeframe-qualified (for example RSI|60)",
      }),
    ),
  ),
  filter: Type.Optional(
    Type.Array(
      Type.Object({
        field: Type.String({
          description: "TradingView scanner field, optionally timeframe-qualified",
        }),
        op: filterOp,
        value: Type.Optional(
          Type.Unknown({ description: "Filter value for operations that require one" }),
        ),
      }),
      { description: "Flat AND filter clauses; nested OR trees are not supported" },
    ),
  ),
  sort: Type.Optional(
    Type.Object({
      field: Type.String({ description: "TradingView scanner field to sort by" }),
      direction: Type.Optional(Type.String({ enum: ["asc", "ASC", "desc", "DESC"] })),
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum rows to return. Default 50; maximum 500" }),
  ),
});

export const screenStocksTool: AgentTool<typeof params, ScreenerRow[]> = {
  name: "screen_stocks",
  label: "Stock Screener",
  description:
    'Screen stocks across a market using TradingView scanner filters, columns, sorting, and row limits. Use for breadth queries like finding large caps, oversold stocks, movers, or filtered market lists; use quote/history tools for single-security quote or history requests. Common aliases are accepted: gt/gte/lt/lte for comparisons, market_cap for market_cap_basic, change_percent for change, and RSI|14D for RSI. For sector screens, use the sector field; technology usually means sector in_range ["Electronic Technology", "Technology Services"]. Use description for company names because name is the ticker.',
  parameters: params,
  async execute(_toolCallId, args) {
    const normalized = normalizeArgs(args);
    const result = await wrapProvider("tradingview", () =>
      screenStocks({
        market: normalized.market,
        columns: normalized.columns,
        filter: normalized.filter,
        sort: normalized.sort,
        limit: normalized.limit,
      }),
    );

    if (result.status === "unavailable") {
      return {
        content: [
          {
            type: "text",
            text: [
              `Stock screening unavailable (${result.reason}).`,
              "Manual fallback: run the same screen in TradingView or another screener with the requested filters and sort. Treat matches as candidates, not recommendations, and verify live quotes/news before acting.",
            ].join("\n"),
          },
        ],
        details: [],
      };
    }

    const rows = result.data;
    const freshness = buildFreshnessStamp({
      cached: result.cached,
      stale: result.stale,
      cachedAt: result.cached || result.stale ? result.timestamp : undefined,
      dataDelayMs: 15 * 60_000,
    });
    if (rows.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: [
              "No stocks matched the screen. TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
              formatAsOfLine(freshness),
            ].join("\n"),
          },
        ],
        details: rows,
      };
    }

    const lines = [
      `**Stock screen** — ${rows.length} TradingView result${rows.length === 1 ? "" : "s"}`,
      rows[0]?.dataCaveat ??
        "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      formatInterpretationNote(normalized),
      "",
      ...rows.map(formatRow),
      formatAsOfLine(freshness),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: rows,
    };
  },
};

function normalizeArgs(args: Static<typeof params>) {
  return {
    ...args,
    columns: args.columns
      ?.map(normalizeField)
      .filter((field, index, fields) => fields.indexOf(field) === index),
    filter: args.filter?.map((clause) => ({
      ...clause,
      field: normalizeField(clause.field),
      op: normalizeFilterOp(clause.op),
      ...(clause.value !== undefined && { value: normalizeValue(clause.value) }),
    })),
    sort: args.sort && {
      ...args.sort,
      field: normalizeField(args.sort.field),
      direction: normalizeSortDirection(args.sort.direction),
    },
  };
}

function normalizeFilterOp(op: string): ScreenFilterOp {
  const normalized = op.toLowerCase();
  if (normalized === "gt" || normalized === ">") return "greater";
  if (normalized === "gte" || normalized === ">=") return "egreater";
  if (normalized === "lt" || normalized === "<") return "less";
  if (normalized === "lte" || normalized === "<=") return "eless";
  if (normalized === "eq" || normalized === "==") return "equal";
  if (normalized === "neq" || normalized === "!=") return "nequal";
  return normalized as ScreenFilterOp;
}

function normalizeSortDirection(direction?: string): "asc" | "desc" | undefined {
  const normalized = direction?.toLowerCase();
  if (normalized === "asc" || normalized === "desc") return normalized;
  return undefined;
}

function normalizeField(field: string): string {
  const trimmed = field.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "market_cap" || lower === "marketcap") return "market_cap_basic";
  if (lower === "total_volume" || lower === "share_volume" || lower === "shares_traded")
    return "volume";
  if (
    lower === "change_percent" ||
    lower === "percent_change" ||
    lower === "daily_change_percent" ||
    lower === "day_change_percent" ||
    lower === "price_change_percent"
  )
    return "change";
  if (lower === "company_name" || lower === "company" || lower === "security_name")
    return "description";
  if (/^rsi(?:\|(?:14|14d|14d\|close|1d|d|daily))?$/i.test(trimmed)) return "RSI";
  return trimmed;
}

function formatInterpretationNote(args: ReturnType<typeof normalizeArgs>): string {
  const fields = [
    ...(args.columns ?? []),
    ...(args.filter?.map((clause) => clause.field) ?? []),
    args.sort?.field,
  ].filter(Boolean);
  const hasField = (field: string) => fields.includes(field);
  const notes = ["Treat screen results as candidates, not recommendations."];
  if (hasField("RSI"))
    notes.push("RSI below 30 can mark oversold momentum, but it is not a buy signal by itself.");
  if (args.sort?.field === "volume")
    notes.push(
      "Volume sorting shows the most actively traded matches rather than unusual volume by itself.",
    );
  if (hasField("change"))
    notes.push(
      "Daily percent change depends on the current market session; confirm market status and live quotes before acting.",
    );
  return `Interpretation note: ${notes.join(" ")}`;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/,/g, "");
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const short = /^\$?(\d+(?:\.\d+)?)\s*([kmbt])$/i.exec(trimmed);
  if (short) return Number(short[1]) * multiplierFor(short[2]);
  const long = /^\$?(\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion)$/i.exec(trimmed);
  if (long) return Number(long[1]) * multiplierFor(long[2]);
  return value;
}

function multiplierFor(unit: string): number {
  const normalized = unit.toLowerCase();
  if (normalized === "k" || normalized === "thousand") return 1_000;
  if (normalized === "m" || normalized === "million") return 1_000_000;
  if (normalized === "b" || normalized === "billion") return 1_000_000_000;
  return 1_000_000_000_000;
}

function formatRow(row: ScreenerRow): string {
  const entries = Object.entries(row.values)
    .filter(([field]) => field !== "name")
    .slice(0, 8)
    .map(([field, value]) => `${field}: ${formatValue(value)}`);
  const suffix = entries.length > 0 ? ` — ${entries.join(" | ")}` : "";
  return `  ${row.symbol} (${row.tvSymbol})${suffix}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "number")
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (value === null || value === undefined) return "N/A";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
