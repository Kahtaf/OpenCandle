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
      return {
        ...this.snapshot,
        indices: this.snapshot.indices.map((entry) => ({ ...entry, stale: true })),
      };
    }
    return this.snapshot;
  }

  private refresh(): Promise<MarketIndicesSnapshot> {
    if (this.inFlight) return this.inFlight;
    const inFlight = this.build()
      .then((snapshot) => {
        if (this.snapshot && snapshot.indices.some((entry) => entry.status === "unavailable")) {
          const validRefreshCount = snapshot.indices.filter(
            (entry) => entry.status === "ok",
          ).length;
          if (validRefreshCount === 0) return this.snapshot;
          const priorBySymbol = new Map(
            this.snapshot.indices.map((entry) => [entry.symbol, entry]),
          );
          snapshot = {
            ...snapshot,
            indices: snapshot.indices.map((entry) => {
              if (entry.status === "ok") return entry;
              const prior = priorBySymbol.get(entry.symbol);
              return prior?.status === "ok" ? { ...prior, stale: true } : entry;
            }),
          };
        }
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
