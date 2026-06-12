import type { MarketStateQuoteSnapshot } from "./market-state-api.js";

export class QuoteSnapshotStore {
  private snapshot: MarketStateQuoteSnapshot | null = null;
  private fetchedAtMs = 0;
  private inFlight: Promise<MarketStateQuoteSnapshot> | null = null;

  constructor(
    private readonly build: () => Promise<MarketStateQuoteSnapshot>,
    private readonly maxAgeMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<MarketStateQuoteSnapshot> {
    if (this.snapshot == null) return this.refresh();
    if (this.now() - this.fetchedAtMs >= this.maxAgeMs) {
      // Stale-while-revalidate: serve the old snapshot now, refresh in the background.
      this.refresh().catch(() => {});
    }
    return this.snapshot;
  }

  private refresh(): Promise<MarketStateQuoteSnapshot> {
    this.inFlight ??= this.build()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.fetchedAtMs = this.now();
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
