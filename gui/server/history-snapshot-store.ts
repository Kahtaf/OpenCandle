interface HistorySnapshotEntry<T> {
  value?: T;
  hasValue: boolean;
  fetchedAtMs: number;
  inFlight: Promise<T> | null;
}

export class HistorySnapshotStore<T> {
  private readonly entries = new Map<string, HistorySnapshotEntry<T>>();

  constructor(
    private readonly maxAgeMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, build: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing?.hasValue && this.now() - existing.fetchedAtMs < this.maxAgeMs) {
      return Promise.resolve(existing.value as T);
    }
    if (existing?.inFlight) return existing.inFlight;

    const entry =
      existing ??
      ({ hasValue: false, fetchedAtMs: 0, inFlight: null } satisfies HistorySnapshotEntry<T>);
    let buildPromise: Promise<T>;
    try {
      buildPromise = build();
    } catch (error) {
      buildPromise = Promise.reject(error);
    }
    const inFlight = buildPromise
      .then((value) => {
        entry.value = value;
        entry.hasValue = true;
        entry.fetchedAtMs = this.now();
        return value;
      })
      .finally(() => {
        if (entry.inFlight === inFlight) entry.inFlight = null;
      });
    entry.inFlight = inFlight;
    this.entries.set(key, entry);
    return inFlight;
  }

  clear(): void {
    this.entries.clear();
  }
}
