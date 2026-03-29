import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getCryptoHistory } from "../../providers/coingecko.js";
import type { OHLCV } from "../../types/market.js";

const params = Type.Object({
  id: Type.String({
    description: "CoinGecko coin ID (e.g. bitcoin, ethereum, solana)",
  }),
  days: Type.Optional(
    Type.Number({
      description: "Number of days of history: 1, 7, 14, 30, 90, 180, 365, max. Default: 180",
    }),
  ),
});

export const cryptoHistoryTool: AgentTool<typeof params, OHLCV[]> = {
  name: "get_crypto_history",
  label: "Crypto History",
  description: "Get historical OHLC data for a cryptocurrency",
  parameters: params,
  async execute(toolCallId, args) {
    const id = args.id.toLowerCase();
    const days = args.days ?? 180;
    const bars = await getCryptoHistory(id, days);

    const summary = [
      `${id} — ${bars.length} bars (${days} days)`,
      `Period: ${bars[0]?.date} to ${bars[bars.length - 1]?.date}`,
    ];

    const recent = bars.slice(-10);
    const table = recent
      .map(
        (b) =>
          `${b.date} | O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)}`,
      )
      .join("\n");

    const text = [...summary, "", "Recent bars:", table].join("\n");
    return { content: [{ type: "text", text }], details: bars };
  },
};
