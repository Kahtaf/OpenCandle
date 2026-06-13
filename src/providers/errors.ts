export class InvalidSymbolError extends Error {
  constructor(
    public readonly symbol: string,
    public readonly provider: string,
  ) {
    super(`Invalid symbol ${symbol} for ${provider}`);
    this.name = "InvalidSymbolError";
  }
}
