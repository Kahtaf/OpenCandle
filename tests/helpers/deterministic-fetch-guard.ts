/**
 * Test-only `globalThis.fetch` guard for the deterministic session journey.
 *
 * Every outbound fetch must be explicitly routed: either delegated to the
 * caller-provided local model server, served from a checked-in fixture, or
 * denied with a synthetic response. Anything else is recorded and thrown, so
 * an accidental live network call fails the journey loudly instead of silently
 * depending on the internet.
 */

export interface FetchRoute {
  /** URL prefix this route matches. */
  prefix: string;
  /** Delegate to the original fetch (used for the local model server). */
  passthrough?: boolean;
  /** JSON body returned without touching the network. */
  json?: unknown;
  /** HTTP status for an explicit denial (defaults to 200 with `json`). */
  status?: number;
}

export interface DeterministicFetchGuard {
  /** External URLs that matched no route and were rejected. */
  readonly unrecognizedUrls: string[];
  /** External URLs that matched a denial route (recognized but not fetched). */
  readonly deniedUrls: string[];
  restore(): void;
}

export function installDeterministicFetchGuard(
  routes: readonly FetchRoute[],
): DeterministicFetchGuard {
  const originalFetch = globalThis.fetch;
  const unrecognizedUrls: string[] = [];
  const deniedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes.find((candidate) => url.startsWith(candidate.prefix));

    if (route?.passthrough) {
      return originalFetch(input, init);
    }
    if (route) {
      // A route without a fixture body is a deliberate denial (for example the
      // optional extended-hours enrichment). Serve a synthetic response without
      // touching the network and record it for the caller's assertions.
      if (route.json === undefined) deniedUrls.push(url);
      return new Response(route.json === undefined ? null : JSON.stringify(route.json), {
        status: route.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    unrecognizedUrls.push(url);
    throw new Error(`Deterministic journey rejected unrecognized external URL: ${url}`);
  }) as typeof fetch;

  return {
    unrecognizedUrls,
    deniedUrls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
