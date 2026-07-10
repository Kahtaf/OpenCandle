import { describe, expect, it } from "vitest";
import {
  formatExchangeLabel,
  formatInstrumentTypeLabel,
} from "../../../gui/web/src/features/instruments/exchange-labels.js";

describe("exchange labels", () => {
  it("uses a familiar name for a Nasdaq stock result", () => {
    expect(formatExchangeLabel("NMS")).toBe("Nasdaq");
    expect(formatInstrumentTypeLabel("EQUITY")).toBe("Stock");
  });

  it("maps common Yahoo exchange and instrument type codes", () => {
    expect(formatExchangeLabel("NGM")).toBe("Nasdaq");
    expect(formatExchangeLabel("NCM")).toBe("Nasdaq");
    expect(formatExchangeLabel("NAS")).toBe("Nasdaq");
    expect(formatExchangeLabel("NYQ")).toBe("NYSE");
    expect(formatExchangeLabel("NYA")).toBe("NYSE");
    expect(formatExchangeLabel("ASE")).toBe("NYSE American");
    expect(formatExchangeLabel("AMX")).toBe("NYSE American");
    expect(formatExchangeLabel("PCX")).toBe("NYSE Arca");
    expect(formatExchangeLabel("EBS")).toBe("SIX");
    expect(formatExchangeLabel("TOR")).toBe("TSX");
    expect(formatExchangeLabel("LSE")).toBe("LSE");
    expect(formatExchangeLabel("GER")).toBe("XETRA/Frankfurt");
    expect(formatExchangeLabel("FRA")).toBe("XETRA/Frankfurt");
    expect(formatExchangeLabel("PNK")).toBe("OTC");
    expect(formatExchangeLabel("CCC")).toBe("Crypto");
    expect(formatExchangeLabel("CCY")).toBe("Crypto");
    expect(formatInstrumentTypeLabel("ETF")).toBe("ETF");
    expect(formatInstrumentTypeLabel("MUTUALFUND")).toBe("Fund");
    expect(formatInstrumentTypeLabel("INDEX")).toBe("Index");
    expect(formatInstrumentTypeLabel("CRYPTOCURRENCY")).toBe("Crypto");
    expect(formatInstrumentTypeLabel("CURRENCY")).toBe("FX");
  });

  it("preserves unknown exchange codes and title-cases unknown types", () => {
    expect(formatExchangeLabel("XYZ")).toBe("XYZ");
    expect(formatInstrumentTypeLabel("FUTURE_OPTION")).toBe("Future Option");
  });
});
