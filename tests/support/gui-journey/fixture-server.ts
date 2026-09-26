import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Parent-process fixture server for the deterministic GUI journey.
 *
 * The child `gui/server/server.ts` process never talks to the real internet:
 * its fetch guard rewrites recognized external data/tool URLs to `/fixture/*`
 * paths on this server. It serves only external HTTP payloads the real product
 * would otherwise fetch (Yahoo quote/search, Ticker Line sparkline, Google
 * Fonts CSS), so failures here are journey failures rather than silent
 * network dependence.
 */

export interface FixtureRequest {
  method: string;
  path: string;
  query: string;
}

export interface GuiJourneyFixtureServer {
  readonly baseUrl: string;
  readonly requests: FixtureRequest[];
  stop(): Promise<void>;
}

/**
 * Optional bounded hold for the held-tool cancellation journey. When `isActive`
 * returns true, a chart request for `symbol` waits on `gate` before responding,
 * so the real tool fetch is genuinely in flight when the test presses Stop.
 * The production provider is read-only and may settle cooperatively; this only
 * delays the fixture response, it does not fake the provider.
 */
export interface FixtureQuoteHold {
  symbol: string;
  isActive(): boolean;
  gate: { wait(): Promise<void> };
}

export interface StartFixtureServerOptions {
  holdQuote?: FixtureQuoteHold;
}

/** Deterministic quote values keyed by symbol; unknowns get a stable hash value. */
const FIXTURE_QUOTES: Record<string, { price: number; previousClose: number; volume: number }> = {
  AAPL: { price: 189.42, previousClose: 187.0, volume: 48_234_567 },
  MSFT: { price: 512.34, previousClose: 509.11, volume: 21_345_678 },
  NVDA: { price: 185.25, previousClose: 182.0, volume: 312_000_000 },
  "^GSPC": { price: 6500.12, previousClose: 6475.5, volume: 2_500_000_000 },
  "^NDX": { price: 22000.5, previousClose: 21800.0, volume: 900_000_000 },
  "^DJI": { price: 45000.75, previousClose: 44900.0, volume: 400_000_000 },
  "BTC-USD": { price: 68000.0, previousClose: 67000.0, volume: 30_000_000 },
};

const FIXTURE_AS_OF_SECONDS = 1_784_145_600; // 2026-07-15T20:00:00.000Z

export function fixtureQuoteFor(symbol: string): {
  price: number;
  previousClose: number;
  volume: number;
} {
  const known = FIXTURE_QUOTES[symbol];
  if (known) return known;
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  const price = 50 + (hash % 450) + 0.25;
  return { price, previousClose: price - 1, volume: 100_000 + hash * 10 };
}

export function yahooChartFixture(symbol: string): unknown {
  const quote = fixtureQuoteFor(symbol);
  const open = Number((quote.price - 0.5).toFixed(2));
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            longName: `${symbol} Test Instrument`,
            regularMarketPrice: quote.price,
            previousClose: quote.previousClose,
            chartPreviousClose: quote.previousClose,
            regularMarketOpen: open,
            regularMarketDayHigh: Number((quote.price + 1.2).toFixed(2)),
            regularMarketDayLow: Number((quote.price - 1.5).toFixed(2)),
            regularMarketVolume: quote.volume,
            regularMarketTime: FIXTURE_AS_OF_SECONDS,
            marketCap: 1_000_000_000_000,
            fiftyTwoWeekHigh: Number((quote.price * 1.2).toFixed(2)),
            fiftyTwoWeekLow: Number((quote.price * 0.7).toFixed(2)),
            currency: "USD",
          },
          timestamp: [FIXTURE_AS_OF_SECONDS],
          indicators: {
            quote: [
              {
                open: [open],
                high: [Number((quote.price + 1.2).toFixed(2))],
                low: [Number((quote.price - 1.5).toFixed(2))],
                close: [quote.price],
                volume: [quote.volume],
              },
            ],
          },
        },
      ],
    },
  };
}

function yahooSearchFixture(query: string): unknown {
  const symbol =
    query
      .trim()
      .toUpperCase()
      .replace(/[^A-Z.]/g, "")
      .slice(0, 8) || "AAPL";
  const quote = fixtureQuoteFor(symbol);
  return {
    quotes: [
      {
        symbol,
        longname: `${symbol} Test Instrument`,
        shortname: `${symbol} Test`,
        quoteType: "EQUITY",
        exchange: "NMS",
        score: 100,
      },
    ],
    news: [],
    meta: { priceHint: quote.price },
  };
}

export async function startGuiJourneyFixtureServer(
  options: StartFixtureServerOptions = {},
): Promise<GuiJourneyFixtureServer> {
  const requests: FixtureRequest[] = [];
  const server = createServer((req, res) => {
    handle(req, res, requests, options);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    stop: () => closeServer(server),
  };
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  requests: FixtureRequest[],
  options: StartFixtureServerOptions,
): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  requests.push({ method: req.method ?? "GET", path: url.pathname, query: url.search });

  if (url.pathname.startsWith("/fixture/fonts")) {
    write(res, 200, "text/css; charset=utf-8", FONT_CSS);
    return;
  }
  if (url.pathname.startsWith("/fixture/ticker-line/sparkline")) {
    write(
      res,
      200,
      "image/svg+xml",
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="20"><path d="M0 10 L64 10" stroke="#888"/></svg>',
    );
    return;
  }
  if (url.pathname.startsWith("/fixture/yahoo/v8/finance/chart/")) {
    const symbol = decodeURIComponent(
      url.pathname.slice("/fixture/yahoo/v8/finance/chart/".length),
    );
    const hold = options.holdQuote;
    if (hold?.isActive() && symbol === hold.symbol) {
      // Bounded hold: the tool fetch is genuinely in flight. The response is
      // written once the test releases the gate; a client abort is tolerated.
      void hold.gate.wait().then(() => {
        if (res.writableEnded || res.destroyed) return;
        writeJson(res, 200, yahooChartFixture(symbol));
      });
      return;
    }
    writeJson(res, 200, yahooChartFixture(symbol));
    return;
  }
  if (url.pathname.startsWith("/fixture/yahoo/v1/finance/search")) {
    writeJson(res, 200, yahooSearchFixture(url.searchParams.get("q") ?? ""));
    return;
  }
  if (url.pathname.startsWith("/fixture/yahoo/v10/finance/quoteSummary/")) {
    writeJson(res, 200, {
      quoteSummary: {
        result: [
          {
            assetProfile: { longBusinessSummary: "Test company summary." },
            financialData: {},
          },
        ],
      },
    });
    return;
  }
  if (url.pathname.startsWith("/fixture/deny")) {
    writeJson(res, 404, {
      error: { code: "Not Found", description: "No fixture for this request" },
    });
    return;
  }
  writeJson(res, 404, { error: `No fixture for ${req.method} ${url.pathname}` });
}

const FONT_CSS = `/* fixture fonts */
@font-face { font-family: "Inter"; src: local("Arial"); font-display: swap; }
`;

function write(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  write(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
