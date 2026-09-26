import { appendFileSync } from "node:fs";

/**
 * Child-process fetch guard for the deterministic GUI journey.
 *
 * Installed before `gui/server/server.ts` is imported. Every outbound fetch is
 * routed explicitly:
 *   - the local model fixture and aux fixture server pass through;
 *   - recognized external data/tool/font URLs are rewritten to the aux fixture
 *     server, so the real product code paths still run but never touch the
 *     network;
 *   - anything else is recorded to the unexpected-request log and rejected.
 *
 * This is a test-only transport boundary. No GUI HTTP/SSE/WebSocket/controller
 * or storage code is faked.
 */

export interface GuiJourneyFetchGuardOptions {
  modelBaseUrl: string;
  auxBaseUrl: string;
  unexpectedLogPath?: string;
}

export function installGuiJourneyFetchGuard(options: GuiJourneyFetchGuardOptions): void {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const { modelBaseUrl, auxBaseUrl, unexpectedLogPath } = options;

  const recordUnexpected = (url: string): void => {
    if (!unexpectedLogPath) return;
    try {
      appendFileSync(unexpectedLogPath, `${url}\n`, "utf-8");
    } catch {
      // Logging must never mask the rejection itself.
    }
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith(modelBaseUrl) || url.startsWith(auxBaseUrl)) {
      return originalFetch(input, init);
    }
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return originalFetch(input, init);
    }

    const rewrite = rewriteExternalUrl(url, auxBaseUrl);
    if (rewrite) {
      return originalFetch(rewrite, init);
    }

    recordUnexpected(url);
    throw new Error(`Deterministic GUI journey rejected unexpected external request: ${url}`);
  }) as typeof fetch;
}

function rewriteExternalUrl(url: string, auxBaseUrl: string): string | null {
  if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) {
    const rest = url.slice("https://query1.finance.yahoo.com".length);
    return `${auxBaseUrl}/fixture/yahoo${rest}`;
  }
  if (url.startsWith("https://query1.finance.yahoo.com/v1/finance/search")) {
    const query = new URL(url).search;
    return `${auxBaseUrl}/fixture/yahoo/v1/finance/search${query}`;
  }
  if (url.startsWith("https://query1.finance.yahoo.com/v10/finance/quoteSummary/")) {
    const rest = url.slice("https://query1.finance.yahoo.com".length);
    return `${auxBaseUrl}/fixture/yahoo${rest}`;
  }
  if (url.startsWith("https://ticker-line.com/v1/sparkline")) {
    const query = new URL(url).search;
    return `${auxBaseUrl}/fixture/ticker-line/sparkline${query}`;
  }
  if (
    url.startsWith("https://fonts.googleapis.com/") ||
    url.startsWith("https://fonts.gstatic.com/")
  ) {
    return `${auxBaseUrl}/fixture/fonts`;
  }
  // Other Yahoo hosts are the optional best-effort enrichment paths; serve a
  // synthetic "not found" rather than letting them reach the network.
  if (
    url.startsWith("https://finance.yahoo.com/") ||
    url.startsWith("https://query1.finance.yahoo.com/") ||
    url.startsWith("https://query2.finance.yahoo.com/")
  ) {
    return `${auxBaseUrl}/fixture/deny`;
  }
  return null;
}
