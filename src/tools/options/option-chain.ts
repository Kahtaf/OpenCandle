import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { buildFreshnessStamp, type FreshnessStamp, formatAsOfLine } from "../../infra/freshness.js";
import { localDateTimeParts } from "../../infra/market-calendar.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getOptionsChain } from "../../providers/yahoo-finance.js";
import type { OptionContract, OptionsChain, OptionsQuoteStatus } from "../../types/options.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, TSLA, SPY, MSFT)" }),
  expiration: Type.Optional(
    Type.String({
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Expiration date as YYYY-MM-DD. If omitted, uses the nearest expiration.",
    }),
  ),
  type: Type.Optional(
    Type.Union(
      [Type.Literal("call"), Type.Literal("put"), Type.Literal("CALL"), Type.Literal("PUT")],
      {
        description: "Filter by option type. Omit for both calls and puts.",
      },
    ),
  ),
});

export const optionChainTool: AgentTool<
  typeof params,
  (OptionsChain & { freshness: FreshnessStamp }) | null
> = {
  name: "get_option_chain",
  label: "Options Chain",
  description:
    "Get the full options chain for a stock with strikes, bids, asks, volume, open interest, implied volatility, and computed Greeks (Delta, Gamma, Theta, Vega, Rho via Black-Scholes). No API key required.",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const normalizedType = args.type?.toLowerCase();
    const expirationTs = args.expiration ? parseExpiration(args.expiration) : undefined;

    const result = await wrapProvider("yahoo", () => getOptionsChain(symbol, expirationTs));
    if (result.status === "unavailable") {
      return {
        content: [
          { type: "text", text: `⚠ Options chain unavailable for ${symbol} (${result.reason}).` },
        ],
        details: null,
      };
    }
    const chain = result.data;
    const freshness = buildFreshnessStamp({
      asOf: chain.asOf,
      cached: result.cached,
      stale: result.stale,
      cachedAt: result.cached || result.stale ? result.timestamp : undefined,
    });

    const status = chain.quoteStatus;
    const columns = contractColumns(status);
    const lines: string[] = [
      `**${chain.symbol} Options Chain** — Expiry: ${chain.expirationDate}`,
      `Underlying: $${chain.underlyingPrice.toFixed(2)}`,
      `Quote status: ${status.marketSession} / ${status.bidAskState}`,
      `Session source: ${formatSessionSource(status)}`,
      ...(status.latestContractTradeAt
        ? [`Latest contract trade: ${formatEasternTime(status.latestContractTradeAt)} ET`]
        : []),
      "Option bid/ask and last prices are quoted per share; multiply by 100 for one standard contract premium.",
      ...(status.warning ? [`⚠ ${status.warning}`] : []),
      `Available expirations: ${formatAvailableExpirations(chain.expirationDates)}`,
      "",
    ];

    const showCalls = !normalizedType || normalizedType === "call";
    const showPuts = !normalizedType || normalizedType === "put";

    if (showCalls && chain.calls.length > 0) {
      lines.push(
        `**CALLS** (${chain.calls.length} contracts, volume: ${chain.totalCallVolume.toLocaleString()})`,
      );
      lines.push(columns);
      const topCalls = sortByVolume(chain.calls).slice(0, 10);
      for (const c of topCalls) {
        lines.push(formatContract(c));
      }
      lines.push("");
    }

    if (showPuts && chain.puts.length > 0) {
      lines.push(
        `**PUTS** (${chain.puts.length} contracts, volume: ${chain.totalPutVolume.toLocaleString()})`,
      );
      lines.push(columns);
      const topPuts = sortByVolume(chain.puts).slice(0, 10);
      for (const c of topPuts) {
        lines.push(formatContract(c));
      }
      lines.push("");
    }

    lines.push(`Put/Call Ratio: ${chain.putCallRatio.toFixed(2)}`);
    lines.push(formatAsOfLine(freshness));

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { ...chain, freshness },
    };
  },
};

function parseExpiration(expiration: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) {
    throw new Error("expiration must be a valid YYYY-MM-DD date.");
  }
  const parsed = new Date(`${expiration}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiration) {
    throw new Error("expiration must be a valid YYYY-MM-DD date.");
  }
  return Math.floor(parsed.getTime() / 1000);
}

function sortByVolume(contracts: OptionContract[]): OptionContract[] {
  return [...contracts].sort((a, b) => b.volume - a.volume);
}

function formatAvailableExpirations(expirationDates: string[]): string {
  return expirationDates.join(", ");
}

function contractColumns(status: OptionsQuoteStatus): string {
  const bidAsk =
    status.bidAskState === "live_quotes" || status.bidAskState === "live_zero_bid_ask"
      ? "Bid/Ask (per share)"
      : status.bidAskState === "last_session_quotes"
        ? "Last-session bid/ask (per share, not executable)"
        : "Bid/Ask (per share, not executable)";
  return `Strike | ${bidAsk} | Last (per share) | Last trade (ET) | Vol | OI | IV | Delta | Gamma | Theta | Vega | Rho`;
}

function formatSessionSource(status: OptionsQuoteStatus): string {
  if (status.marketSessionSource === "provider_market_state") {
    return `Yahoo marketState ${status.providerMarketState}`;
  }
  if (status.marketSessionSource === "local_calendar_recheck") {
    return status.providerMarketState
      ? `local US market calendar (cached Yahoo marketState ${status.providerMarketState} was reported before the regular session ended)`
      : "local US market calendar (cached chain was fetched before the regular session ended)";
  }
  return status.providerMarketState
    ? `local US market calendar (unrecognized Yahoo marketState ${status.providerMarketState})`
    : "local US market calendar (Yahoo did not report marketState)";
}

function formatEasternTime(iso: string): string {
  const parts = localDateTimeParts(new Date(iso), "America/New_York");
  return `${parts.date} ${parts.time}`;
}

function formatContract(c: OptionContract): string {
  const itm = c.inTheMoney ? "*" : " ";
  const lastTrade = c.lastTradeDate ? formatEasternTime(c.lastTradeDate) : "n/a";
  return `${itm}$${c.strike.toFixed(2)} | $${c.bid.toFixed(2)}/$${c.ask.toFixed(2)} | $${c.lastPrice.toFixed(2)} | ${lastTrade} | ${c.volume} | ${c.openInterest} | ${(c.impliedVolatility * 100).toFixed(1)}% | ${c.greeks.delta.toFixed(3)} | ${c.greeks.gamma.toFixed(3)} | ${c.greeks.theta.toFixed(3)} | ${c.greeks.vega.toFixed(3)} | ${c.greeks.rho.toFixed(3)}`;
}
