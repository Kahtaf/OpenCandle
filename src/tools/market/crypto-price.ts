import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getCryptoPrice } from "../../providers/coingecko.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { CryptoPrice } from "../../types/market.js";

const params = Type.Object({
  id: Type.String({
    description:
      "CoinGecko coin ID (e.g. bitcoin, ethereum, solana, dogecoin). Use lowercase.",
  }),
});

export const cryptoPriceTool: AgentTool<typeof params, CryptoPrice> = {
  name: "get_crypto_price",
  label: "Crypto Price",
  description:
    "Get current crypto price, 24h change, market cap, volume, ATH, and supply data",
  parameters: params,
  async execute(toolCallId, args) {
    const result = await wrapProvider("coingecko", () => getCryptoPrice(args.id.toLowerCase()));
    if (result.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Crypto price unavailable for ${args.id} (${result.reason}).` }],
        details: null as any,
      };
    }
    const crypto = result.data;
    const sign = crypto.changePercent24h >= 0 ? "+" : "";
    const text = [
      `${crypto.name} (${crypto.symbol.toUpperCase()}): $${formatPrice(crypto.price)} (${sign}${crypto.changePercent24h.toFixed(2)}%)`,
      `24h High: $${formatPrice(crypto.high24h)} | 24h Low: $${formatPrice(crypto.low24h)}`,
      `Market Cap: $${formatLargeNumber(crypto.marketCap)} | 24h Volume: $${formatLargeNumber(crypto.volume24h)}`,
      `ATH: $${formatPrice(crypto.ath)} (${crypto.athDate.split("T")[0]})`,
      `Circulating: ${formatLargeNumber(crypto.circulatingSupply)} ${crypto.symbol.toUpperCase()}`,
    ].join("\n");

    return { content: [{ type: "text", text }], details: crypto };
  },
};

function formatPrice(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(8);
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
