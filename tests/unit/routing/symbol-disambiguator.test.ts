import { describe, expect, it } from "vitest";
import {
  disambiguateSymbols,
  FINANCE_ACRONYM_DICTIONARY,
} from "../../../src/routing/symbol-disambiguator.js";

describe("disambiguateSymbols", () => {
  it("drops bare finance acronyms even inside mixed symbol lists", () => {
    const result = disambiguateSymbols(["KO", "IV", "PEP"], "compare KO, IV, PEP");

    expect(result.kept).toEqual(["KO", "PEP"]);
    expect(result.dropped).toEqual([
      expect.objectContaining({
        token: "IV",
        reason: "no positive ticker signal",
      }),
    ]);
  });

  it("keeps acronym tickers when the user uses a cashtag", () => {
    const result = disambiguateSymbols(["IV"], "Get me a quote on $IV");

    expect(result.kept).toEqual(["IV"]);
    expect(result.dropped).toEqual([]);
  });

  it("keeps acronym tickers when a local ticker phrase marks the token", () => {
    const result = disambiguateSymbols(["KO", "IV", "PEP"], "compare KO, the IV ticker, and PEP");

    expect(result.kept).toEqual(["KO", "IV", "PEP"]);
    expect(result.dropped).toEqual([]);
  });

  it("does not blanket-drop the common Mastercard ticker MA", () => {
    const result = disambiguateSymbols(["V", "MA"], "compare V and MA");

    expect(result.kept).toEqual(["V", "MA"]);
    expect(result.dropped).toEqual([]);
  });

  it("covers the initial finance acronym dictionary", () => {
    expect([...FINANCE_ACRONYM_DICTIONARY].sort()).toEqual([
      "ATM",
      "BOE",
      "BOJ",
      "CPI",
      "ECB",
      "FED",
      "FOMC",
      "FX",
      "GDP",
      "HV",
      "IPO",
      "IRS",
      "ITM",
      "IV",
      "NDA",
      "OTM",
      "PPI",
      "SEC",
    ]);
  });
});
