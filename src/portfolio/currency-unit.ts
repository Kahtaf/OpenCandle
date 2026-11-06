/** Units are case-sensitive: GBp is pence, while GBP is pounds. */
export interface CurrencyUnit {
  raw: string;
  currency: string;
  scale: number;
}

const majorCurrencies = new Set(Intl.supportedValuesOf("currency"));

export function normalizeCurrencyUnit(raw: string | null | undefined): CurrencyUnit | null {
  if (raw === "GBp" || raw === "GBX") return { raw, currency: "GBP", scale: 0.01 };
  if (!raw || !majorCurrencies.has(raw)) return null;
  return { raw, currency: raw, scale: 1 };
}
