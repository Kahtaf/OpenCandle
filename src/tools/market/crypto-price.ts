import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { buildFreshnessStamp, type FreshnessStamp, formatAsOfLine } from "../../infra/freshness.js";
import { getCryptoPrice } from "../../providers/coingecko.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { CryptoPrice } from "../../types/market.js";
import { formatLargeNumber } from "../formatting.js";

const params = Type.Object({
  id: Type.String({
    description: "CoinGecko coin ID (e.g. bitcoin, ethereum, solana, dogecoin). Use lowercase.",
  }),
});

export const cryptoPriceTool: AgentTool<
  typeof params,
  (CryptoPrice & { freshness: FreshnessStamp }) | null
> = {
  name: "get_crypto_price",
  label: "Crypto Price",
  description: "Get current crypto price, 24h change, market cap, volume, ATH, and supply data",
  parameters: params,
  async execute(_toolCallId, args) {
    const result = await wrapProvider("coingecko", () => getCryptoPrice(args.id.toLowerCase()));
    if (result.status === "unavailable") {
      return {
        content: [
          { type: "text", text: `⚠ Crypto price unavailable for ${args.id} (${result.reason}).` },
        ],
        details: null,
      };
    }
    const crypto = result.data;
    const freshness = buildFreshnessStamp({
      asOf: crypto.asOf,
      cached: result.cached,
      stale: result.stale,
      cachedAt: result.cached || result.stale ? result.timestamp : undefined,
      assetClass: "crypto",
    });
    const sign = crypto.changePercent24h >= 0 ? "+" : "";
    const text = [
      `${crypto.name} (${crypto.symbol.toUpperCase()}): $${formatPrice(crypto.price)} (${sign}${crypto.changePercent24h.toFixed(2)}%)`,
      `24h High: $${formatPrice(crypto.high24h)} | 24h Low: $${formatPrice(crypto.low24h)}`,
      `Market Cap: $${formatLargeNumber(crypto.marketCap)} | 24h Volume: $${formatLargeNumber(crypto.volume24h)}`,
      `ATH: $${formatPrice(crypto.ath)} (${crypto.athDate.split("T")[0]})`,
      `Circulating: ${formatLargeNumber(crypto.circulatingSupply)} ${crypto.symbol.toUpperCase()}`,
      formatAsOfLine(freshness),
    ].join("\n");

    return { content: [{ type: "text", text }], details: { ...crypto, freshness } };
  },
};

function formatPrice(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(8);
}
