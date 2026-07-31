import { loopbackRuntimeTransport } from "../../runtime/runtime-transport.js";

export async function searchInstruments(query, transport = loopbackRuntimeTransport) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return [];
  const data = await transport.searchInstruments(trimmed);
  return data.candidates || [];
}

export async function getInstrumentQuote(symbol, transport = loopbackRuntimeTransport) {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return null;
  return transport.getInstrumentQuote(trimmed);
}
