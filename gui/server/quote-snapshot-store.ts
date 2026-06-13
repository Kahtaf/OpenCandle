import type { MarketStateQuoteSnapshot } from "./market-state-api.js";

export class QuoteSnapshotStore {
  private snapshot: MarketStateQuoteSnapshot | null = null;
  private fetchedAtMs = 0;
  private inFlight: Promise<MarketStateQuoteSnapshot> | null = null;
  private invalidationVersion = 0;

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

  invalidate(): void {
    this.invalidationVersion += 1;
    this.snapshot = null;
    this.fetchedAtMs = 0;
    this.inFlight = null;
  }

  private refresh(): Promise<MarketStateQuoteSnapshot> {
    if (this.inFlight) return this.inFlight;
    const version = this.invalidationVersion;
    const inFlight = this.build()
      .then((snapshot) => {
        if (version === this.invalidationVersion) {
          this.snapshot = snapshot;
          this.fetchedAtMs = this.now();
        }
        return snapshot;
      })
      .finally(() => {
        if (this.inFlight === inFlight) {
          this.inFlight = null;
        }
      });
    this.inFlight = inFlight;
    return this.inFlight;
  }
}
