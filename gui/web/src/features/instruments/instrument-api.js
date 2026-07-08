export async function searchInstruments(query) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return [];
  const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(trimmed)}`);
  if (!response.ok) throw new Error(response.statusText || "Search failed");
  const data = await response.json();
  return data.candidates || [];
}

export async function getInstrumentQuote(symbol) {
  const trimmed = String(symbol ?? "").trim();
  if (!trimmed) return null;
  const response = await fetch(`/api/instruments/quote?symbol=${encodeURIComponent(trimmed)}`);
  if (!response.ok) throw new Error(response.statusText || "Quote lookup failed");
  return response.json();
}
