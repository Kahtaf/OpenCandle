import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { buildFreshnessStamp, type FreshnessStamp, formatAsOfLine } from "../../infra/freshness.js";
import type { OHLCV } from "../../types/market.js";
import { fetchHistoryWithFallback, HISTORY_INTERVALS, HISTORY_RANGES } from "./stock-history.js";

type HistoryRange = (typeof HISTORY_RANGES)[number];
type HistoryInterval = (typeof HISTORY_INTERVALS)[number];
type AlignmentKey = string | number;

const DATE_ALIGNED_INTERVALS = new Set<HistoryInterval>(["1d", "1wk", "1mo"]);

export interface PriceComparisonSeries {
  symbol: string;
  bars: OHLCV[];
  indexed: number[];
  provider?: string;
  providerTimestamp: string;
  cached: boolean;
  stale: boolean;
}

export interface PriceComparisonDetails {
  range: HistoryRange;
  interval: HistoryInterval;
  baseDate: string;
  series: PriceComparisonSeries[];
  unavailableSymbols: string[];
  freshness: FreshnessStamp;
}

const params = Type.Object({
  symbols: Type.Array(Type.String({ description: "Ticker symbol" }), {
    minItems: 2,
    maxItems: 6,
    description: "Ticker symbols to compare",
  }),
  range: Type.Union(
    HISTORY_RANGES.map((range) => Type.Literal(range)),
    {
      description: "History range",
    },
  ),
  interval: Type.Optional(
    Type.Union(
      HISTORY_INTERVALS.map((interval) => Type.Literal(interval)),
      { description: "Data interval. Default: 1d" },
    ),
  ),
});

export const priceComparisonTool: AgentTool<typeof params, PriceComparisonDetails> = {
  name: "get_price_comparison",
  label: "Price Comparison",
  description: "Get aligned indexed price history for multiple ticker symbols",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbols = args.symbols.map((symbol) => symbol.toUpperCase());
    const interval = args.interval ?? "1d";
    const fetched = await Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        result: await fetchHistoryWithFallback(symbol, args.range, interval),
      })),
    );
    const available = fetched.flatMap(({ symbol, result }) =>
      result.status === "ok" && result.data.length > 0
        ? [
            {
              symbol,
              bars: result.data,
              provider: result.provider,
              providerTimestamp: result.timestamp,
              cached: result.cached === true,
              stale: result.stale === true,
            },
          ]
        : [],
    );
    let unavailableSymbols = fetched.flatMap(({ symbol, result }) =>
      result.status === "unavailable" || result.data.length === 0 ? [symbol] : [],
    );
    if (available.length < 2) {
      const freshness = buildFreshnessStamp({});
      const unavailableText = unavailableSymbols.join(", ") || symbols.join(", ");
      return {
        content: [
          {
            type: "text",
            text: [
              `Price comparison unavailable: fewer than 2 series.`,
              `Unavailable symbols: ${unavailableText}`,
              formatAsOfLine(freshness),
            ].join("\n"),
          },
        ],
        details: {
          range: args.range,
          interval,
          baseDate: "",
          series: [],
          unavailableSymbols,
          freshness,
        },
      };
    }
    let survivingAvailable = available;
    let commonKeys = intersectAlignmentKeys(survivingAvailable, interval);
    while (survivingAvailable.length >= 2 && commonKeys.size > 0) {
      const invalidBaselineSymbols = survivingAvailable.flatMap(({ symbol, bars }) => {
        const baseClose = bars.find((bar) => {
          const key = alignmentKey(bar, interval);
          return key !== undefined && commonKeys.has(key);
        })?.close;
        return typeof baseClose !== "number" || !Number.isFinite(baseClose) || baseClose <= 0
          ? [symbol]
          : [];
      });
      if (invalidBaselineSymbols.length === 0) break;
      unavailableSymbols = [...new Set([...unavailableSymbols, ...invalidBaselineSymbols])];
      const invalid = new Set(invalidBaselineSymbols);
      survivingAvailable = survivingAvailable.filter(({ symbol }) => !invalid.has(symbol));
      commonKeys = intersectAlignmentKeys(survivingAvailable, interval);
    }
    if (survivingAvailable.length < 2) {
      return unavailableComparison(args.range, interval, unavailableSymbols);
    }
    if (commonKeys.size === 0) {
      unavailableSymbols = [
        ...new Set([...unavailableSymbols, ...survivingAvailable.map(({ symbol }) => symbol)]),
      ];
      return unavailableComparison(args.range, interval, unavailableSymbols);
    }
    const series = survivingAvailable.map(
      ({ symbol, bars, provider, providerTimestamp, cached, stale }) => {
        const alignedBars = bars.filter((bar) => {
          const key = alignmentKey(bar, interval);
          return key !== undefined && commonKeys.has(key);
        });
        const baseClose = alignedBars[0].close;
        return {
          symbol,
          bars: alignedBars,
          indexed: alignedBars.map((bar) => (bar.close / baseClose) * 100),
          provider,
          providerTimestamp,
          cached,
          stale,
        };
      },
    );
    const baseDate = series[0]?.bars[0]?.date ?? "";
    const latestDate = series[0]?.bars.at(-1)?.date;
    const staleSeries = series.filter((item) => item.stale);
    const freshness = buildFreshnessStamp({
      asOf: latestDate,
      cached: series.some((item) => item.cached),
      stale: staleSeries.length > 0,
      cachedAt: staleSeries.map((item) => item.providerTimestamp).sort()[0],
    });
    const rows = series.map(({ symbol, bars, indexed }) => {
      const first = bars[0]?.close ?? 0;
      const last = bars.at(-1)?.close ?? 0;
      const change = (indexed.at(-1) ?? 100) - 100;
      return `${symbol} | ${first.toFixed(2)} | ${last.toFixed(2)} | ${change.toFixed(2)}%`;
    });
    const alignmentLosses = survivingAvailable.flatMap(({ symbol, bars }) => {
      const dropped = bars.length - commonKeys.size;
      return dropped / bars.length > 0.3
        ? [`${symbol} (${dropped}/${bars.length} dates dropped)`]
        : [];
    });
    const alignmentLine =
      alignmentLosses.length > 0 ? [`Reduced aligned window: ${alignmentLosses.join(", ")}`] : [];

    const unavailableLine =
      unavailableSymbols.length > 0
        ? [`Unavailable symbols: ${unavailableSymbols.join(", ")}`]
        : [];
    const staleLine =
      staleSeries.length > 0
        ? [
            `Stale series: ${staleSeries
              .map((item) => `${item.symbol} (${item.provider ?? "unknown provider"})`)
              .join(", ")}`,
          ]
        : [];

    return {
      content: [
        {
          type: "text",
          text: [
            ...rows,
            ...alignmentLine,
            ...unavailableLine,
            ...staleLine,
            formatAsOfLine(freshness),
          ].join("\n"),
        },
      ],
      details: {
        range: args.range,
        interval,
        baseDate,
        series,
        unavailableSymbols,
        freshness,
      },
    };
  },
};

function intersectAlignmentKeys(
  series: Array<{ bars: OHLCV[] }>,
  interval: HistoryInterval,
): Set<AlignmentKey> {
  const commonKeys = new Set(
    series[0]?.bars.flatMap((bar) => {
      const key = alignmentKey(bar, interval);
      return key === undefined ? [] : [key];
    }) ?? [],
  );
  for (const candidate of series.slice(1)) {
    const candidateKeys = new Set(
      candidate.bars.flatMap((bar) => {
        const key = alignmentKey(bar, interval);
        return key === undefined ? [] : [key];
      }),
    );
    for (const key of commonKeys) {
      if (!candidateKeys.has(key)) commonKeys.delete(key);
    }
  }
  return commonKeys;
}

function alignmentKey(bar: OHLCV, interval: HistoryInterval): AlignmentKey | undefined {
  if (DATE_ALIGNED_INTERVALS.has(interval)) return bar.date;
  return Number.isFinite(bar.timestamp) ? bar.timestamp : undefined;
}

function unavailableComparison(
  range: HistoryRange,
  interval: HistoryInterval,
  unavailableSymbols: string[],
) {
  const freshness = buildFreshnessStamp({});
  return {
    content: [
      {
        type: "text" as const,
        text: [
          "Price comparison unavailable: fewer than 2 usable aligned series.",
          `Unavailable symbols: ${unavailableSymbols.join(", ")}`,
          formatAsOfLine(freshness),
        ].join("\n"),
      },
    ],
    details: { range, interval, baseDate: "", series: [], unavailableSymbols, freshness },
  };
}
