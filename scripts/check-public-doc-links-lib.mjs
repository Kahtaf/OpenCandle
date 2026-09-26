// Pure, testable classification + retry logic for the public docs external-link check.
// Kept separate from check-public-doc-links.mjs (which owns fs walking and process exit)
// so the transient-vs-broken decision can be unit-tested without hitting the network.

// Auth, method, and rate-limit responses prove that the documented endpoint exists even
// when a generic link checker cannot make the request the endpoint expects.
export const ACCEPTED_STATUSES = new Set([401, 403, 405, 429]);

export function isAcceptedStatus(status) {
  return (status >= 200 && status < 400) || ACCEPTED_STATUSES.has(status);
}

// Classify the final result after the bounded retry budget. Unreachable endpoints
// remain unverified, distinct from a broken HTTP response; both block the docs gate.
export function classifyLinkOutcome({ status, error } = {}) {
  if (error != null) return "unverified";
  if (typeof status !== "number") return "unverified";
  return isAcceptedStatus(status) ? "ok" : "broken";
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolve a single URL to { outcome, detail, status? }. HEAD first, falling back to GET only
// when HEAD is unsupported (405/501) or fails (including redirect loops). Each attempt
// makes at most one HEAD and one GET fetch; 5xx and network failures share the same
// bounded attempt budget. Other HTTP results return immediately.
export async function checkUrlWithRetry({
  url,
  fetchImpl,
  attempts = 3,
  delayMs = 500,
  sleep = defaultSleep,
  onRetry = () => {},
}) {
  let last = { outcome: "unverified", detail: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let response;
      try {
        response = await fetchImpl(url, "HEAD");
      } catch {
        // A server may reject HEAD via a redirect loop even though GET works.
      }
      if (!response || response.status === 405 || response.status === 501) {
        response = await fetchImpl(url, "GET");
      }
      const status = response.status;
      last = { outcome: classifyLinkOutcome({ status }), detail: `HTTP ${status}`, status };
      if (status < 500 || status >= 600) return last;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      last = { outcome: "unverified", detail: `failed: ${message}` };
    }
    if (attempt < attempts) {
      onRetry({ attempt, detail: last.detail });
      await sleep(delayMs);
    }
  }
  return last;
}
