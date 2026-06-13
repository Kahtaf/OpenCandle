import { resolveYahooInstrument, searchYahooInstruments } from "./resolve.js";

export type MutationInstrumentResolution =
  | { status: "resolved"; instrument: Awaited<ReturnType<typeof resolveYahooInstrument>> }
  | {
      status: "needs_selection";
      query: string;
      candidates: Awaited<ReturnType<typeof searchYahooInstruments>>;
    };

export async function resolveInstrumentForMutation(
  symbol: string,
): Promise<MutationInstrumentResolution> {
  try {
    return { status: "resolved", instrument: await resolveYahooInstrument(symbol) };
  } catch (error) {
    const query = symbol.trim();
    const candidates = await searchYahooInstruments(query);
    if (candidates.length > 0) {
      return { status: "needs_selection", query, candidates };
    }
    throw error;
  }
}
