import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getOptionsChain } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { OptionsChain, OptionContract } from "../../types/options.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, TSLA, SPY, MSFT)" }),
  expiration: Type.Optional(
    Type.String({
      description:
        "Expiration date as YYYY-MM-DD. If omitted, uses the nearest expiration.",
    }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal("call"), Type.Literal("put"), Type.Literal("CALL"), Type.Literal("PUT")], {
      description: "Filter by option type. Omit for both calls and puts.",
    }),
  ),
});

export const optionChainTool: AgentTool<typeof params, OptionsChain> = {
  name: "get_option_chain",
  label: "Options Chain",
  description:
    "Get the full options chain for a stock with strikes, bids, asks, volume, open interest, implied volatility, and computed Greeks (Delta, Gamma, Theta, Vega, Rho via Black-Scholes). No API key required.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const normalizedType = args.type?.toLowerCase();
    const expirationTs = args.expiration
      ? Math.floor(new Date(args.expiration).getTime() / 1000)
      : undefined;

    const result = await wrapProvider("yahoo", () => getOptionsChain(symbol, expirationTs));
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Options chain unavailable for ${symbol} (${result.reason}).` }],
        details: null as any,
      };
    }
    const chain = result.data;

    const lines: string[] = [
      `**${chain.symbol} Options Chain** — Expiry: ${chain.expirationDate}`,
      `Underlying: $${chain.underlyingPrice.toFixed(2)}`,
      `Available expirations: ${chain.expirationDates.slice(0, 6).join(", ")}${chain.expirationDates.length > 6 ? ` (+${chain.expirationDates.length - 6} more)` : ""}`,
      "",
    ];

    const showCalls = !normalizedType || normalizedType === "call";
    const showPuts = !normalizedType || normalizedType === "put";

    if (showCalls && chain.calls.length > 0) {
      lines.push(`**CALLS** (${chain.calls.length} contracts, volume: ${chain.totalCallVolume.toLocaleString()})`);
      lines.push("Strike | Bid/Ask | Last | Vol | OI | IV | Delta | Theta");
      const topCalls = sortByVolume(chain.calls).slice(0, 10);
      for (const c of topCalls) {
        lines.push(formatContract(c));
      }
      lines.push("");
    }

    if (showPuts && chain.puts.length > 0) {
      lines.push(`**PUTS** (${chain.puts.length} contracts, volume: ${chain.totalPutVolume.toLocaleString()})`);
      lines.push("Strike | Bid/Ask | Last | Vol | OI | IV | Delta | Theta");
      const topPuts = sortByVolume(chain.puts).slice(0, 10);
      for (const c of topPuts) {
        lines.push(formatContract(c));
      }
      lines.push("");
    }

    lines.push(`Put/Call Ratio: ${chain.putCallRatio.toFixed(2)}`);

    return { content: [{ type: "text", text: lines.join("\n") }], details: chain };
  },
};

function sortByVolume(contracts: OptionContract[]): OptionContract[] {
  return [...contracts].sort((a, b) => b.volume - a.volume);
}

function formatContract(c: OptionContract): string {
  const itm = c.inTheMoney ? "*" : " ";
  return `${itm}$${c.strike.toFixed(2)} | $${c.bid.toFixed(2)}/$${c.ask.toFixed(2)} | $${c.lastPrice.toFixed(2)} | ${c.volume} | ${c.openInterest} | ${(c.impliedVolatility * 100).toFixed(1)}% | ${c.greeks.delta.toFixed(3)} | ${c.greeks.theta.toFixed(3)}`;
}
