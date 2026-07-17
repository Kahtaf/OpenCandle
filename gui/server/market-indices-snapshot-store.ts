import type { MarketIndicesSnapshot } from "./market-indices-api.js";

export class MarketIndicesSnapshotStore {
  private snapshot: MarketIndicesSnapshot | null = null;
  private fetchedAtMs = 0;
  private inFlight: Promise<MarketIndicesSnapshot> | null = null;

  constructor(
    private readonly build: () => Promise<MarketIndicesSnapshot>,
    private readonly maxAgeMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<MarketIndicesSnapshot> {
    if (this.snapshot == null) return this.refresh();
    if (this.now() - this.fetchedAtMs >= this.maxAgeMs) {
      this.refresh().catch(() => {});
    }
    return this.snapshot;
  }

  private refresh(): Promise<MarketIndicesSnapshot> {
    if (this.inFlight) return this.inFlight;
    const inFlight = this.build()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.fetchedAtMs = this.now();
        return snapshot;
      })
      .finally(() => {
        if (this.inFlight === inFlight) this.inFlight = null;
      });
    this.inFlight = inFlight;
    return inFlight;
  }
}
