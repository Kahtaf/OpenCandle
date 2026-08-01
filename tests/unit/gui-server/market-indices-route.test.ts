import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { MarketIndicesSnapshotStore } from "../../../gui/server/market-indices-snapshot-store.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";

const { fetchTickerLineSparklineMock } = vi.hoisted(() => ({
  fetchTickerLineSparklineMock: vi.fn(),
}));

vi.mock("../../../gui/server/ticker-line-sparkline.js", () => ({
  fetchTickerLineSparkline: fetchTickerLineSparklineMock,
}));

const privateApiSessionToken = "market-indices-route-token";
const snapshot = {
  generatedAt: "2026-07-16T14:10:00.000Z",
  indices: ["^GSPC", "^NDX", "^DJI", "BTC-USD"].map((symbol) => ({
    symbol,
    assetType: symbol === "BTC-USD" ? ("crypto" as const) : ("index" as const),
    status: "ok" as const,
    price: 100,
    change: 1,
    changePercent: 1,
    currency: "USD",
  })),
};
const getIndicesSnapshot = vi.fn();

describe("market indices HTTP route", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    const unavailable = () => {
      throw new Error("not used by market indices route tests");
    };
    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      role: "follower",
      cwd: process.cwd(),
      agentDir: "/missing-agent-dir",
      sessionDir: "/missing-session-dir",
      privateApiSessionToken,
      localCoordinatorEndpoint: "",
      localCoordinatorSecret: "coordinator-secret",
      allowRemotePrivateApi: false,
      getSession: unavailable,
      getSessionManager: unavailable,
      createSessionForManager: async () => unavailable(),
      wsHub: {} as never,
      modelSetupController: {} as never,
      sessionActionsController: {} as never,
      toolInvokeController: {} as never,
      quoteSnapshotStore: {} as QuoteSnapshotStore,
      indicesSnapshotStore: { get: getIndicesSnapshot } as unknown as MarketIndicesSnapshotStore,
    });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    getIndicesSnapshot.mockReset();
    getIndicesSnapshot.mockResolvedValue(snapshot);
    fetchTickerLineSparklineMock.mockReset();
  });

  it("ignores query parameters and returns the fixed snapshot", async () => {
    const response = await fetch(`${endpoint}/api/market-state/indices?symbols=AAPL`, {
      headers: { cookie: privateApiCookieHeader(privateApiSessionToken) },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(getIndicesSnapshot).toHaveBeenCalledOnce();
    expect(getIndicesSnapshot).toHaveBeenCalledWith();
  });

  it("rejects untrusted requests before reading the snapshot store", async () => {
    const response = await fetch(`${endpoint}/api/market-state/indices`);

    expect(response.status).toBe(403);
    expect(getIndicesSnapshot).not.toHaveBeenCalled();
  });

  it("serves a trusted, same-origin Ticker Line SVG with restrictive headers", async () => {
    fetchTickerLineSparklineMock.mockResolvedValue({
      status: "ok",
      svg: "<svg></svg>",
      dataAsOf: "2026-08-01T00:00:00.000Z",
    });

    const response = await fetch(
      `${endpoint}/api/market-state/sparkline?symbol=AAPL&assetType=equity`,
      { headers: { cookie: privateApiCookieHeader(privateApiSessionToken) } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("x-data-as-of")).toBe("2026-08-01T00:00:00.000Z");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    await expect(response.text()).resolves.toBe("<svg></svg>");
    expect(fetchTickerLineSparklineMock).toHaveBeenCalledWith("AAPL", "equity");
  });

  it("serves Ticker Line as-of metadata for the sparkline caption", async () => {
    fetchTickerLineSparklineMock.mockResolvedValue({
      status: "ok",
      svg: "<svg></svg>",
      dataAsOf: "2026-08-01T00:00:00.000Z",
    });

    const response = await fetch(
      `${endpoint}/api/market-state/sparkline?symbol=AAPL&assetType=equity&metadata=1`,
      { headers: { cookie: privateApiCookieHeader(privateApiSessionToken) } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      source: "Ticker Line",
      dataAsOf: "2026-08-01T00:00:00.000Z",
    });
  });

  it("rejects untrusted sparkline requests before contacting Ticker Line", async () => {
    const response = await fetch(
      `${endpoint}/api/market-state/sparkline?symbol=AAPL&assetType=equity`,
    );

    expect(response.status).toBe(403);
    expect(fetchTickerLineSparklineMock).not.toHaveBeenCalled();
  });
});
