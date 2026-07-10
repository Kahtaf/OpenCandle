const exchangeLabels = {
  NMS: "Nasdaq",
  NGM: "Nasdaq",
  NCM: "Nasdaq",
  NAS: "Nasdaq",
  NYQ: "NYSE",
  NYA: "NYSE",
  ASE: "NYSE American",
  AMX: "NYSE American",
  PCX: "NYSE Arca",
  EBS: "SIX",
  TOR: "TSX",
  LSE: "LSE",
  GER: "XETRA/Frankfurt",
  FRA: "XETRA/Frankfurt",
  PNK: "OTC",
  CCC: "Crypto",
  CCY: "Crypto",
};

const instrumentTypeLabels = {
  EQUITY: "Stock",
  ETF: "ETF",
  MUTUALFUND: "Fund",
  INDEX: "Index",
  CRYPTOCURRENCY: "Crypto",
  CURRENCY: "FX",
};

export function formatExchangeLabel(exchange) {
  return exchangeLabels[exchange] || exchange || "";
}

export function formatInstrumentTypeLabel(type) {
  if (!type) return "";
  return instrumentTypeLabels[type] || titleCase(String(type));
}

function titleCase(value) {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
