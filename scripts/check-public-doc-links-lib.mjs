// Pure, testable classification + retry logic for the public docs external-link check.
// Kept separate from check-public-doc-links.mjs (which owns fs walking and process exit)
// so the transient-vs-broken decision can be unit-tested without hitting the network.

// Auth, method, and rate-limit responses prove that the documented endpoint exists even
// when a generic link checker cannot make the request the endpoint expects.
export const ACCEPTED_STATUSES = new Set([401, 403, 405, 429]);

export function isAcceptedStatus(status) {
  return (status >= 200 && status < 400) || ACCEPTED_STATUSES.has(status);
}

// A completed HTTP response is definitive: 2xx/3xx (or an accepted auth/method/rate-limit status)
// means the link resolves; any other status means it is genuinely broken. A thrown error
// (DNS, TCP, TLS, timeout/abort) means the host was unreachable from here — unverifiable,
// not proof the link is broken.
export function classifyLinkOutcome({ status, error } = {}) {
  if (error != null) return "unverified";
  if (typeof status !== "number") return "unverified";
  return isAcceptedStatus(status) ? "ok" : "broken";
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolve a single URL to { outcome, detail, status? }. HEAD first, falling back to GET only
// when the server rejects HEAD (405/501). Any definitive HTTP status returns immediately;
// only transient network errors are retried, up to `attempts` times with `delayMs` backoff.
export async function checkUrlWithRetry({
  url,
  fetchImpl,
  attempts = 3,
  delayMs = 500,
  sleep = defaultSleep,
}) {
  let last = { outcome: "unverified", detail: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let response = await fetchImpl(url, "HEAD");
      let status = response.status;
      if (status === 405 || status === 501) {
        response = await fetchImpl(url, "GET");
        status = response.status;
      }
      return { outcome: classifyLinkOutcome({ status }), detail: `HTTP ${status}`, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      last = { outcome: "unverified", detail: `failed: ${message}` };
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  return last;
}
