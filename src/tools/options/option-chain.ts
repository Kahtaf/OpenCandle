import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { buildFreshnessStamp, type FreshnessStamp, formatAsOfLine } from "../../infra/freshness.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getOptionsChain } from "../../providers/yahoo-finance.js";
import type { OptionContract, OptionsChain } from "../../types/options.js";

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

    const lines: string[] = [
      `**${chain.symbol} Options Chain** — Expiry: ${chain.expirationDate}`,
      `Underlying: $${chain.underlyingPrice.toFixed(2)}`,
      `Quote status: ${chain.quoteStatus.marketSession} / ${chain.quoteStatus.bidAskState}`,
      "Option bid/ask and last prices are quoted per share; multiply by 100 for one standard contract premium.",
      ...(chain.quoteStatus.warning
        ? [
            `⚠ ${chain.quoteStatus.warning} do not treat zero bid/ask as confirmed live illiquidity without broker verification; do not stop at the stale quote caveat. Disclose the gap, avoid naming tradable live premiums, and finish the strategy explanation with mechanics, assignment outcomes, labeled hypotheticals, and what live broker quotes would change.`,
          ]
        : []),
      `Available expirations: ${formatAvailableExpirations(chain.expirationDates)}`,
      "",
    ];

    const showCalls = !normalizedType || normalizedType === "call";
    const showPuts = !normalizedType || normalizedType === "put";

    if (showCalls && chain.calls.length > 0) {
      lines.push(
        `**CALLS** (${chain.calls.length} contracts, volume: ${chain.totalCallVolume.toLocaleString()})`,
      );
      lines.push(
        "Strike | Bid/Ask (per share) | Last (per share) | Vol | OI | IV | Delta | Gamma | Theta | Vega | Rho",
      );
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
      lines.push(
        "Strike | Bid/Ask (per share) | Last (per share) | Vol | OI | IV | Delta | Gamma | Theta | Vega | Rho",
      );
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

function formatContract(c: OptionContract): string {
  const itm = c.inTheMoney ? "*" : " ";
  return `${itm}$${c.strike.toFixed(2)} | $${c.bid.toFixed(2)}/$${c.ask.toFixed(2)} | $${c.lastPrice.toFixed(2)} | ${c.volume} | ${c.openInterest} | ${(c.impliedVolatility * 100).toFixed(1)}% | ${c.greeks.delta.toFixed(3)} | ${c.greeks.gamma.toFixed(3)} | ${c.greeks.theta.toFixed(3)} | ${c.greeks.vega.toFixed(3)} | ${c.greeks.rho.toFixed(3)}`;
}
