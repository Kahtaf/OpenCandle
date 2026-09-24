// Deterministic network boundary for the hosted PWA browser smoke.
//
// The default hosted lane is provider-isolated, not offline: WebContainer boots
// inside the page and must reach its own distribution/network infrastructure, so
// those hosts are allowed through to the real network and documented here rather
// than denied. The one public provider transport the deterministic journey
// actually exercises (Ticker Line sparkline metadata) is answered at the HTTP
// transport boundary by a fixture that mirrors the real provider payload. No
// application state (localStorage, OPFS, SQLite) is injected; the fixture only
// replaces the bytes the provider server would have sent back.
//
// Everything else external fails closed: an unexpected provider/model origin or
// path is aborted by the route guard and recorded. There are deliberately no
// fixtures for providers the journey does not exercise, because an unused
// fixture would advertise coverage that does not exist.
//
// WebContainer boot infrastructure observed in the default lane:
//   - stackblitz.com (headless boot document + shared preview worker)
//   - w-corp-staticblitz.com + *.staticblitz.com (engine bundles, WASM,
//     per-instance iframes)
//   - *.webcontainer-api.io (WebContainer network/auth origin, per CSP)
// These are the only non-application origins the lane may contact.
//
// Interception limit: Playwright's route/request events observe browser-context
// traffic. WebContainer can tunnel a container-initiated fetch through
// *.webcontainer-api.io instead of exposing the upstream provider URL, in which
// case the true provider origin is not observable here. The observer installed
// by the smoke records what the context does see and fails on any unexpected
// external URL; it does not claim to inspect tunneled container traffic.
export const HOSTED_INFRASTRUCTURE_HOST_SUFFIXES = Object.freeze([
  "stackblitz.com",
  "staticblitz.com",
  "w-corp-staticblitz.com",
  "webcontainer-api.io",
]);

// An unexpected provider probe that is allowed by the page CSP and is
// CORS-enabled, but is deliberately not fixtured. The deterministic lane must
// abort it and record it, which is the red/green signal for the guard.
export const HOSTED_GUARD_PROBE_URL = "https://api.coingecko.com/api/v3/ping";

export function isHostedInfrastructureHost(hostname) {
  const host = String(hostname ?? "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) return false;
  return HOSTED_INFRASTRUCTURE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

const TICKER_LINE_SPARKLINE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30" viewBox="0 0 120 30">' +
  '<path d="M0 22 L20 18 L40 20 L60 10 L80 12 L100 6 L120 8" fill="none" stroke="#3b82f6" stroke-width="2"/></svg>';

// Fixtures that the current deterministic journey actually exercises. Add a
// fixture only alongside a journey that consumes it, so `routedFixtureIds` in
// the smoke output is a truthful coverage statement.
export const HOSTED_PROVIDER_FIXTURES = Object.freeze([
  {
    id: "ticker-line-metadata",
    match: (url) =>
      url.hostname === "ticker-line.com" &&
      url.pathname === "/v1/sparkline" &&
      url.searchParams.get("format") === "json",
    contentType: "application/json; charset=utf-8",
    body: (url) =>
      JSON.stringify({
        ticker: url.searchParams.get("ticker") ?? "",
        market: url.searchParams.get("market") ?? "stock",
        timeframe: url.searchParams.get("timeframe") ?? "1d",
        dataAsOf: new Date().toISOString(),
        svg: TICKER_LINE_SPARKLINE_SVG,
      }),
  },
]);

export function hostedProviderFixtureFor(url) {
  return HOSTED_PROVIDER_FIXTURES.find((fixture) => fixture.match(url));
}

export function classifyHostedRequest(rawUrl, localOrigin) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "reject", reason: "unparseable" };
  }
  if (url.origin === localOrigin) return { kind: "local", url };
  if (isHostedInfrastructureHost(url.hostname)) return { kind: "infrastructure", url };
  const fixture = hostedProviderFixtureFor(url);
  if (fixture) return { kind: "fixture", fixture, url };
  return { kind: "reject", url };
}
